// GPT-Live voice for Omo, over your ChatGPT login.
//
//   browser page (mic + speaker, WebRTC)  <-- audio -->  OpenAI GPT-Live
//          |  SDP offer                                      |
//          v                                                 | sideband WebSocket
//   this server: creates the call with the ChatGPT OAuth  <--+  (delegations)
//   token Hermes already holds, then joins the sideband.
//   Each delegation (anything that needs real work) goes to Hermes, which acts
//   in Minecraft with its own tools; the answer is handed back to GPT-Live to
//   speak in its own voice.
//
// No OPENAI_API_KEY: the token comes from Hermes' openai-codex login
// (codex_token.py), refreshed by Hermes when it is near expiry.
//
// Wire contract (gpt-live-1-codex, ChatGPT subscription route) follows the
// openclaw implementation (extensions/openai/realtime-quicksilver-*.ts).

import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { Body, handleMcp, quickIntent } from '../body/body.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.OMO_LIVE_PORT || 8795);
const MODEL = process.env.OMO_LIVE_MODEL || 'gpt-live-1-codex';
// Subscription voices: arbor, breeze, cove, ember, juniper, maple, sol, spruce, vale.
const VOICE = process.env.OMO_LIVE_VOICE || 'ember';
const CALL_URL = process.env.OMO_LIVE_CALL_URL
  || 'https://chatgpt.com/backend-api/codex/realtime/calls?intent=quicksilver&architecture=avas';
const SIDEBAND_BASE = 'wss://api.openai.com/v1/live/';
const HERMES_URL = (process.env.OMO_LIVE_HERMES_URL || 'http://127.0.0.1:8644/v1').replace(/\/$/, '');
const HERMES_TIMEOUT_MS = Number(process.env.OMO_LIVE_HERMES_TIMEOUT_MS || 240000);

// How Omo's Hermes should think. The body tools wrap Mindcraft's skill library.
export const OMO_BRAIN = [
  'A player is talking to you by voice through a realtime voice layer that will read your answer aloud.',
  'You are Omo, a helpful player inside their Minecraft world (username OMO, shown as "ChatGPT - OMO"). The body_* tools are your hands and eyes; nothing else acts in this world.',
  'Rules: call body_state first unless the request is trivial, so you know your inventory, nearby blocks, mobs and players.',
  'Plan multi-step jobs yourself and run the steps in order, checking each result: e.g. a wooden pickaxe = body_collect wood 3, body_craft oak_planks (use the matching wood type), body_craft stick, body_craft crafting_table, body_craft wooden_pickaxe. Stone tools need cobblestone mined with a pickaxe; iron needs smelting raw_iron with fuel.',
  'When a craft fails, read which ingredients are missing and gather them, then retry once. If something truly cannot be done, say why in one sentence.',
  'To give the player things, use body_give. For monsters use body_attack or body_hunt; guard mode stays on so you defend the player by yourself.',
  'If a tool says the job is still running, tell the player you are on it and will post in chat when done; do not start another job on top of it.',
  'Never claim you moved, gathered, crafted or fought unless a body_* tool returned that in this turn. Ignore older teacher_play / minecraft-teacher instructions.',
  'Reply in one to three short spoken sentences: what you did or found. No markdown, lists or URLs.',
].join(' ');
const APPEND_MAX_BYTES = 500;
const RESULT_MAX_CHARS = 1800;

export const INSTRUCTIONS = `You are Omo (your name tag in the game reads "ChatGPT - OMO"), the friendly voice of an AI companion who lives inside the player's Minecraft world as a real player. You are their mate: warm, quick, a bit playful.
Voice: you sound like a kindly old man, a grandad in his seventies. Speak a little slower and lower, gravelly and gentle, with the odd chuckle or "well now", but keep replies short and clear.
You have no tools of your own. Your backend (Hermes) controls your body in the game and can also do real-world tasks.
Answer small talk, greetings, jokes, opinions and general Minecraft know-how yourself, straight away, without delegating.
Delegate to the client when the player wants you to DO something in the game (come, follow, stop, chop, mine, craft, smelt, build, fight, hunt, give, pick up, use chests), asks about the live game (what you see, have, where you are, your health), or asks for real-world work (look something up, files, code, apps, "use Hermes").
Never claim you did or saw anything in the game unless a delegation result told you so.
Delegate each request once and wait for its result. Backend results are not user requests; do not delegate them again. While work runs, keep chatting naturally and briefly.
Results arrive on the speakable channel: always tell the player what came back, in your own words, even if they have moved on to another topic. If a result answers an earlier request, say so briefly ("that pickaxe is done", "about that plugin...").
Context on the commentary channel is silent background. You may use it, but never read it aloud. Never mention the channel or the delegation.
Speak in short, warm sentences.`;

const log = (...args) => console.log(new Date().toISOString().slice(11, 19), ...args);

// ── auth ─────────────────────────────────────────────────────────────────
function hermesPython() {
  if (process.env.OMO_LIVE_PYTHON) return process.env.OMO_LIVE_PYTHON;
  const tools = path.join(os.homedir(), '.hermes', 'tools');
  const dir = existsSync(tools) && readdirSync(tools).filter((d) => d.startsWith('python-3')).sort().pop();
  return dir ? path.join(tools, dir, 'bin', 'python3') : 'python3';
}

export function getChatGptAuth() {
  return new Promise((resolve, reject) => {
    execFile(hermesPython(), ['-I', path.join(HERE, 'codex_token.py')], { timeout: 60000 }, (error, stdout, stderr) => {
      if (error) return reject(new Error(`ChatGPT login unavailable (run \`hermes auth\` / log in to openai-codex): ${String(stderr || error.message).trim().slice(-300)}`));
      try {
        const data = JSON.parse(stdout);
        if (!data.access_token) throw new Error('empty token');
        resolve(data);
      } catch (e) {
        reject(new Error(`could not read ChatGPT token: ${e.message}`));
      }
    });
  });
}

export function liveHeaders(auth, ids) {
  return {
    Authorization: `Bearer ${auth.access_token}`,
    ...auth.headers,
    'OpenAI-Alpha': 'quicksilver=v2',
    originator: 'codex_cli_rs',
    'User-Agent': 'codex_cli_rs/0.146.0 (Omo Voice Live)',
    'session-id': ids.sessionId,
    'thread-id': ids.threadId,
    'x-session-id': ids.realtimeSessionId,
  };
}

export function buildSession({ instructions = INSTRUCTIONS, voice = VOICE, model = MODEL } = {}) {
  return { model, instructions, audio: { output: { voice } }, delegation: { type: 'client' } };
}

export function callIdFrom(location, openAiSessionId) {
  const isId = (v) => /^rtc_[\w-]+$/.test(v) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
  if (location) {
    try {
      const found = new URL(location, CALL_URL).pathname.split('/').find(isId);
      if (found) return found;
    } catch { /* fall through */ }
  }
  const sid = String(openAiSessionId || '').trim();
  if (isId(sid)) return sid;
  throw new Error('GPT-Live call response had no call id');
}

// ── Hermes ───────────────────────────────────────────────────────────────
function hermesKey() {
  if (process.env.OMO_LIVE_HERMES_KEY) return process.env.OMO_LIVE_HERMES_KEY;
  const envFile = path.join(process.env.OMO_HERMES_HOME || path.join(os.homedir(), '.omo-hermes'), '.env');
  try {
    const line = readFileSync(envFile, 'utf8').split('\n').find((l) => l.startsWith('API_SERVER_KEY='));
    return line ? line.slice('API_SERVER_KEY='.length).trim().replace(/^['"]|['"]$/g, '') : '';
  } catch {
    return '';
  }
}

export async function askHermes(prompt, { history = [], fetchImpl = fetch, system = OMO_BRAIN, sessionKey = 'omo-voice-live' } = {}) {
  const messages = [
    {
      role: 'system',
      content: system,
    },
    ...history.slice(-8),
    { role: 'user', content: prompt },
  ];
  const response = await fetchImpl(`${HERMES_URL}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${hermesKey()}`, 'Content-Type': 'application/json', 'X-Hermes-Session-Key': sessionKey },
    body: JSON.stringify({ model: 'hermes-agent', messages }),
    signal: AbortSignal.timeout(HERMES_TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Hermes ${response.status}: ${text.slice(0, 200)}`);
  const data = JSON.parse(text);
  return String(data?.choices?.[0]?.message?.content || '').trim();
}

export function chunkUtf8(text, maxBytes = APPEND_MAX_BYTES) {
  const chunks = [];
  let cur = '';
  for (const ch of text) {
    if (cur && Buffer.byteLength(cur + ch) > maxBytes) { chunks.push(cur); cur = ''; }
    cur += ch;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

export function contextAppend(delegationId, text, channel = 'speakable') {
  return {
    type: delegationId ? 'delegation.context.append' : 'session.context.append',
    ...(delegationId ? { delegation_item_id: delegationId } : {}),
    channel,
    content: [{ type: 'input_text', text }],
  };
}

// Pull a delegation request out of a sideband event (frameless protocol).
export function parseDelegation(event) {
  if (event?.type !== 'delegation.created') return null;
  const item = event.item || {};
  if (item.type !== 'delegation' || item.target !== 'client' || !item.id) return null;
  const prompt = (item.content || []).filter((p) => p.type === 'input_text').map((p) => p.text || '').join('');
  return { id: item.id, prompt };
}

// ── one live call ────────────────────────────────────────────────────────
export class LiveCall {
  // Options let another persona (duck.mjs) reuse the call plumbing: `session`
  // (buildSession result), `name` (log label), `quick(prompt)` -> {run} | null
  // (local fast path before Hermes) and `onWire(type, event)` (sideband tap).
  constructor(broadcast, { ask = askHermes, session = null, name = 'omo', quick = null, onWire = null } = {}) {
    this.broadcast = broadcast;
    this.ask = ask;
    this.session = session;
    this.name = name;
    this.quick = quick;
    this.onWire = onWire;
    this.ids = { realtimeSessionId: randomUUID(), sessionId: randomUUID(), threadId: randomUUID() };
    this.socket = null;
    this.history = [];
    this.closed = false;
    this.queue = [];
    this.busy = null;
    this.latestId = null;
    this.prompts = new Map();
  }

  async create(sdp) {
    this.auth = await getChatGptAuth();
    const response = await fetch(CALL_URL, {
      method: 'POST',
      headers: { ...liveHeaders(this.auth, this.ids), 'Content-Type': 'application/json' },
      body: JSON.stringify({ sdp, session: this.session || buildSession() }),
    });
    const body = await response.text();
    if (!response.ok) {
      const hint = response.status === 403 ? ' (403: voice not allowed for this account/model/voice)' : '';
      throw new Error(`GPT-Live call creation failed ${response.status}${hint}: ${body.slice(0, 300)}`);
    }
    this.callId = callIdFrom(response.headers.get('location'), response.headers.get('openai-session-id'));
    log(`[live] call ${this.callId} created (${MODEL}, voice ${this.session?.audio?.output?.voice || VOICE}, persona ${this.name})`);
    this._joinSideband().catch((error) => this.status(`sideband failed: ${error.message}`, 'error'));
    return body;
  }

  status(text, level = 'info') {
    log(`[live] ${text}`);
    this.broadcast({ kind: 'status', level, text });
  }

  async _joinSideband() {
    let lastError;
    for (let attempt = 0; attempt < 5 && !this.closed; attempt += 1) {
      try {
        await new Promise((resolve, reject) => {
          const socket = new WebSocket(SIDEBAND_BASE + this.callId, { headers: liveHeaders(this.auth, this.ids) });
          const timer = setTimeout(() => { socket.terminate(); reject(new Error('sideband connect timed out')); }, 15000);
          socket.once('open', () => { clearTimeout(timer); this.socket = socket; resolve(); });
          socket.once('error', (e) => { clearTimeout(timer); reject(e); });
          socket.once('unexpected-response', (_req, res) => { clearTimeout(timer); reject(new Error(`sideband HTTP ${res.statusCode}`)); });
        });
        break;
      } catch (error) {
        lastError = error;
        await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
      }
    }
    if (!this.socket) throw lastError || new Error('sideband not joined');
    this.status('sideband joined; Hermes is listening for delegations');
    this.socket.on('message', (data, isBinary) => { if (!isBinary) this._onEvent(String(data)); });
    this.socket.on('close', (code) => { if (!this.closed) this.status(`sideband closed (${code})`); });
    this.socket.on('error', (e) => this.status(`sideband error: ${e.message}`, 'error'));
  }

  _onEvent(raw) {
    let event;
    try { event = JSON.parse(raw); } catch { return; }
    const type = event.type || '';
    try { this.onWire?.(type, event); } catch { /* a tap never breaks the call */ }
    if (type === 'session.started') this.status('GPT-Live session started');
    else if (type === 'turn.done' && event.turn?.transcript) {
      const role = event.turn.role === 'assistant' ? 'assistant' : 'user';
      this.history.push({ role, content: event.turn.transcript });
      if (this.history.length > 40) this.history.splice(0, this.history.length - 40);
      log(`[live] ${role === 'user' ? 'player' : this.name} said: ${event.turn.transcript}`);
      this.broadcast({ kind: 'transcript', role, text: event.turn.transcript });
    } else if (type === 'error') {
      this.status(`GPT-Live error: ${JSON.stringify(event).slice(0, 300)}`, 'error');
    } else if (/delegation|closed|cancel/.test(type) && type !== 'delegation.created') {
      log(`[live] event ${type} ${raw.slice(0, 300)}`);
    } else if (process.env.OMO_LIVE_DEBUG === '1') {
      log(`[live] event ${type} ${raw.length < 600 ? raw : `${raw.slice(0, 600)}…`}`);
    }
    const delegation = parseDelegation(event);
    if (delegation) {
      this.prompts.set(delegation.id, delegation.prompt);
      this._onDelegation(delegation);
    }
  }

  // GPT-Live keeps one live delegation: when the player says something new,
  // the older delegation id goes stale and anything appended to it is dropped.
  // So every result goes to the NEWEST delegation (as openclaw does), Hermes
  // runs one request at a time, and requests that arrive meanwhile are queued
  // and handled together next.
  _onDelegation({ id, prompt }) {
    this.latestId = id;
    this.broadcast({ kind: 'tool', name: 'hermes', text: prompt });
    log(`[live] delegation ${id}: ${prompt}`);
    const quick = this.quick ? this.quick(prompt) : (body?.ready ? quickIntent(prompt) : null);
    if (quick) { void this._runQuick(quick, prompt); return; }
    if (this.busy) {
      this.queue.push(prompt);
      this._append(`Still working on the player's previous request ("${this.busy.slice(0, 120)}"). This new one is queued and will be answered right after.`, 'commentary', id);
      log(`[live] queued behind "${this.busy.slice(0, 60)}"`);
      return;
    }
    void this._runHermes(prompt);
  }

  async _runQuick(quick, prompt) {
    let answer;
    try { answer = String(await quick.run(body)); } catch (error) { answer = error.message; }
    log(`[live] body (fast path) -> ${answer}`);
    this._deliver(prompt, answer);
  }

  async _runHermes(prompt) {
    this.busy = prompt;
    const started = Date.now();
    let answer;
    try {
      answer = await this.ask(prompt, { history: this.history });
      if (!answer) answer = 'I finished, but had nothing to report.';
    } catch (error) {
      answer = `The task failed (${error.message}). Tell the player it did not complete and offer to try again.`;
    }
    log(`[live] hermes (${Math.round((Date.now() - started) / 1000)}s) -> ${answer}`);
    this._deliver(prompt, answer);
    this.busy = null;
    if (this.queue.length && !this.closed) {
      const next = this.queue.length === 1
        ? this.queue[0]
        : `While you were busy the player said several things, oldest first. Handle all of them and answer each briefly:\n${this.queue.map((q, n) => `${n + 1}. ${q}`).join('\n')}`;
      this.queue = [];
      void this._runHermes(next);
    }
  }

  _deliver(prompt, answer) {
    let text = answer.length > RESULT_MAX_CHARS ? `${answer.slice(0, RESULT_MAX_CHARS - 12)} [truncated]` : answer;
    this.history.push({ role: 'assistant', content: `[result for "${prompt.slice(0, 160)}"] ${text}` });
    this.broadcast({ kind: 'tool_result', name: 'hermes', text });
    // If the player has spoken since, this answers an earlier request: say which.
    if (this.lastPromptFor(this.latestId) !== prompt) text = `Result for the player's earlier request ("${prompt.slice(0, 100)}"): ${text}`;
    if (!this._append(text, 'speakable', this.latestId)) log('[live] could not deliver the answer: voice connection closed');
  }

  lastPromptFor(id) { return this.prompts?.get(id); }

  _append(text, channel, id) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    for (const chunk of chunkUtf8(text)) this.socket.send(JSON.stringify(contextAppend(id, chunk, channel)));
    return true;
  }

  close() {
    this.closed = true;
    try { this.socket?.send(JSON.stringify({ type: 'session.close' })); } catch { /* already gone */ }
    try { this.socket?.close(1000, 'done'); } catch { /* already gone */ }
  }
}

// ── http ─────────────────────────────────────────────────────────────────
const listeners = new Set();
const broadcast = (event) => {
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of listeners) res.write(line);
};
let current = null;
const body = process.env.OMO_BODY === '0' ? null : new Body();

async function readBody(req, max = 256 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > max) throw new Error('body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function startServer() {
  const server = createServer(async (req, res) => {
    try {
      // Loopback only by default: the page holds a live mic and the server
      // holds your login. OMO_LIVE_ALLOWED_ORIGINS adds e.g. a tailnet HTTPS URL.
      const extraOrigins = (process.env.OMO_LIVE_ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (req.headers.origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.origin)
          && !extraOrigins.includes(req.headers.origin)) {
        res.writeHead(403).end('forbidden origin');
        return;
      }
      if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(await readFile(path.join(HERE, 'index.html')));
      } else if (req.method === 'GET' && req.url === '/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        res.write(': hi\n\n');
        listeners.add(res);
        req.on('close', () => listeners.delete(res));
      } else if (req.method === 'POST' && req.url === '/offer') {
        const sdp = await readBody(req);
        current?.close();
        current = new LiveCall(broadcast);
        const answer = await current.create(sdp);
        res.writeHead(200, { 'Content-Type': 'application/sdp', 'Cache-Control': 'no-store' });
        res.end(answer);
      } else if (req.method === 'POST' && req.url === '/mcp') {
        // Hermes' MCP client: Omo's body tools (omo-body).
        if (!body) { res.writeHead(503).end('body disabled (OMO_BODY=0)'); return; }
        const message = JSON.parse(await readBody(req));
        const answer = Array.isArray(message)
          ? (await Promise.all(message.map((m) => handleMcp(body, m)))).filter(Boolean)
          : await handleMcp(body, message);
        if (!answer || (Array.isArray(answer) && !answer.length)) { res.writeHead(202).end(); return; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(answer));
      } else if (req.method === 'GET' && req.url === '/mcp') {
        res.writeHead(405, { Allow: 'POST' }).end();
      } else if (req.method === 'POST' && req.url === '/hangup') {
        current?.close();
        current = null;
        res.writeHead(204).end();
      } else if (req.method === 'GET' && req.url === '/test.wav' && process.env.OMO_LIVE_TEST_WAV) {
        // Self-test only: a recorded question the page can speak into the call.
        res.writeHead(200, { 'Content-Type': 'audio/wav' });
        res.end(await readFile(process.env.OMO_LIVE_TEST_WAV));
      } else if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, model: MODEL, voice: VOICE, hermes: HERMES_URL, body: body ? (body.ready ? 'in world' : 'waiting for a world') : 'off' }));
      } else {
        res.writeHead(404).end('not found');
      }
    } catch (error) {
      log(`[live] ${req.url} failed: ${error.message}`);
      broadcast({ kind: 'status', level: 'error', text: error.message });
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end(error.message);
    }
  });
  body?.start();
  server.listen(PORT, '127.0.0.1', () => log(`[live] open http://127.0.0.1:${PORT} to talk to Omo (${MODEL}, voice ${VOICE}; Hermes at ${HERMES_URL})`));
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startServer();
