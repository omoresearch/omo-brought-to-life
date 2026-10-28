import test from 'node:test';
import assert from 'node:assert/strict';
import {
  askHermes, buildSession, callIdFrom, chunkUtf8, contextAppend, liveHeaders, parseDelegation,
} from './server.mjs';
import { LiveCall } from './server.mjs';

test('session uses the subscription model, a subscription voice and client delegation', () => {
  const s = buildSession();
  assert.equal(s.model, 'gpt-live-1-codex');
  assert.equal(s.audio.output.voice, 'ember');
  assert.deepEqual(s.delegation, { type: 'client' });
  assert.match(s.instructions, /Delegate to the client/);
});

test('headers carry the ChatGPT token, account and quicksilver alpha', () => {
  const h = liveHeaders(
    { access_token: 'tok', headers: { 'ChatGPT-Account-ID': 'acct' } },
    { sessionId: 's', threadId: 't', realtimeSessionId: 'r' },
  );
  assert.equal(h.Authorization, 'Bearer tok');
  assert.equal(h['ChatGPT-Account-ID'], 'acct');
  assert.equal(h['OpenAI-Alpha'], 'quicksilver=v2');
  assert.equal(h['x-session-id'], 'r');
});

test('call id comes from Location, falling back to openai-session-id', () => {
  assert.equal(callIdFrom('/v1/live/rtc_abc-123', null), 'rtc_abc-123');
  assert.equal(callIdFrom(null, 'rtc_xyz'), 'rtc_xyz');
  assert.throws(() => callIdFrom(null, 'nope'));
});

test('delegation events are parsed and answered on the speakable channel', () => {
  assert.deepEqual(
    parseDelegation({ type: 'delegation.created', item: { type: 'delegation', target: 'client', id: 'd1', content: [{ type: 'input_text', text: 'come here' }] } }),
    { id: 'd1', prompt: 'come here' },
  );
  assert.equal(parseDelegation({ type: 'turn.done' }), null);
  assert.deepEqual(contextAppend('d1', 'On my way.'), {
    type: 'delegation.context.append', delegation_item_id: 'd1', channel: 'speakable',
    content: [{ type: 'input_text', text: 'On my way.' }],
  });
});

test('long answers are split into <=500 byte appends without breaking characters', () => {
  const chunks = chunkUtf8('é'.repeat(400));
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((c) => Buffer.byteLength(c) <= 500));
  assert.equal(chunks.join(''), 'é'.repeat(400));
});

test('askHermes posts the request with recent history and returns the reply text', async () => {
  let sent;
  const reply = await askHermes('follow me', {
    history: [{ role: 'user', content: 'hi' }],
    fetchImpl: async (url, init) => {
      sent = { url, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Following you now.' } }] }), { status: 200 });
    },
  });
  assert.equal(reply, 'Following you now.');
  assert.match(sent.url, /\/chat\/completions$/);
  assert.equal(sent.body.messages.at(-1).content, 'follow me');
  assert.equal(sent.body.messages[1].content, 'hi');
});

test('answers go to the newest delegation and requests during a run are queued', async () => {
  const sent = [];
  let release;
  const calls = [];
  const live = new LiveCall(() => {}, { ask: async (prompt) => { calls.push(prompt); if (calls.length === 1) await new Promise((r) => { release = r; }); return `done: ${prompt}`; } });
  live.socket = { readyState: 1, send: (raw) => sent.push(JSON.parse(raw)) };
  const event = (id, text) => JSON.stringify({ type: 'delegation.created', item: { type: 'delegation', target: 'client', id, content: [{ type: 'input_text', text }] } });
  live._onEvent(event('d1', 'research the viewer plugin'));
  await new Promise((r) => setTimeout(r, 10));
  live._onEvent(event('d2', 'what is the time'));
  assert.equal(sent.at(-1).channel, 'commentary');
  assert.equal(sent.at(-1).delegation_item_id, 'd2');
  release();
  await new Promise((r) => setTimeout(r, 30));
  const speak = sent.filter((m) => m.channel === 'speakable');
  assert.equal(speak[0].delegation_item_id, 'd2');
  assert.match(speak[0].content[0].text, /earlier request .*viewer plugin.*done: research/);
  assert.equal(calls[1], 'what is the time');
  assert.equal(speak[1].delegation_item_id, 'd2');
  assert.match(speak[1].content[0].text, /^done: what is the time/);
});
