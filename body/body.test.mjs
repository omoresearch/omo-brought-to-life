import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Body, BODY_TOOLS, handleMcp, quickIntent, readLan } from './body.mjs';

test('reads the LAN address the omolife mod writes, or null before a world opens', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lan-'));
  const file = path.join(dir, 'lan.json');
  assert.equal(readLan(file), null);
  writeFileSync(file, '{"host":"127.0.0.1","port":25566,"world":"Omo World","version":"26.2"}');
  assert.deepEqual(readLan(file), { host: '127.0.0.1', port: 25566, version: '26.2', world: 'Omo World' });
});

test('MCP lists the body tools and answers initialize and notifications', async () => {
  const body = new Body({ lanReader: () => null });
  const init = await handleMcp(body, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  assert.equal(init.result.serverInfo.name, 'omo-body');
  assert.equal(await handleMcp(body, { jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  const list = await handleMcp(body, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.deepEqual(list.result.tools.map((t) => t.name), BODY_TOOLS.map((t) => t.name));
  assert.ok(list.result.tools.every((t) => t.inputSchema?.type === 'object'));
});

test('a tool call before Omo is in a world is a readable tool error, not a crash', async () => {
  const body = new Body({ lanReader: () => null });
  const res = await handleMcp(body, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'body_state', arguments: {} } });
  assert.equal(res.result.isError, true);
  assert.match(res.result.content[0].text, /not in the world yet/);
  const unknown = await handleMcp(body, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope' } });
  assert.equal(unknown.error.code, -32602);
});

test('follow picks the named player and sets a dynamic follow goal', () => {
  const goals = [];
  const me = { position: { distanceTo: () => 0 } };
  const harry = { username: 'Harry', entity: { position: { distanceTo: () => 5 } } };
  const body = new Body({ lanReader: () => null });
  body.ready = true;
  body.bot = {
    username: 'Teacher',
    entity: me,
    players: { Teacher: { username: 'Teacher', entity: me }, Harry: harry },
    pathfinder: { setGoal: (goal, dynamic) => goals.push({ goal, dynamic }) },
  };
  assert.equal(body.follow('harry'), 'Following Harry.');
  assert.equal(goals[0].dynamic, true);
  assert.equal(body.target, 'Harry');
});

test('plain movement requests take the fast path; anything bigger goes to Hermes', () => {
  const kind = (t) => { const q = quickIntent(t); return q ? q.source.toString().match(/b\.(\w+)/)[1] : null; };
  assert.equal(kind('Hey Teacher, come here please'), 'comeTo');
  assert.equal(kind('walk towards me'), 'comeTo');
  assert.equal(kind('follow me'), 'follow');
  assert.equal(kind('stop'), 'stopMoving');
  assert.equal(kind('come here and then build a house'), null);
  assert.equal(kind('what time is it?'), null);
  assert.equal(kind('he is not moving inside of the game, please fix'), null);
});

test('combat requests take the fast path', () => {
  const kind = (t) => { const q = quickIntent(t); return q ? q.source.toString().match(/b\.(\w+)/)[1] : null; };
  assert.equal(kind('help me fight these zombies'), 'attackNearest');
  assert.equal(kind('attack!'), 'attackNearest');
  assert.equal(kind('protect me'), 'attackNearest');
  assert.equal(kind('stop guarding'), 'guard');
});

test('wood requests start a chopping job', () => {
  const kind = (t) => { const q = quickIntent(t); return q ? q.source.toString().match(/b\.(\w+)/)[1] : null; };
  assert.equal(kind('chop down some trees'), 'collect');
  assert.equal(kind('can you get some wood'), 'collect');
  assert.equal(kind('craft me a pickaxe'), null);
});

test('jobs: a fight pauses the job and it resumes; stop cancels it', async () => {
  const b = new Body({ createBot: () => ({}) });
  const fake = { output: '', interrupt_code: false, modes: { clear() {}, isPaused: () => false }, chat() {},
    pathfinder: { setGoal() {} }, stopDigging() {}, clearControlStates() {}, entity: { position: { x: 0, y: 0, z: 0 } } };
  b.bot = fake; b.ready = true;
  let runs = 0;
  const job = b.runJob('test work', async (bot) => {
    runs += 1;
    if (runs === 1) { b._job.paused = true; setTimeout(() => { b._job.paused = false; }, 50); return false; }
    bot.output += 'done it\n';
    return true;
  }, { waitMs: 2000 });
  const text = await job;
  assert.equal(runs, 2);
  assert.match(text, /Finished test work\. done it/);

  let stopped = false;
  const long = b.runJob('long work', async (bot) => { while (!bot.interrupt_code) await new Promise((r) => setTimeout(r, 20)); stopped = true; return false; }, { waitMs: 2000 });
  await new Promise((r) => setTimeout(r, 50));
  await b.cancelJob();
  assert.equal(stopped, true);
  assert.match(await long, /Stopped long work/);
});
