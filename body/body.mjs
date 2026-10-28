// Omo's body: a Mineflayer player that joins your single-player world
// (opened to LAN by the omolife mod, see mod/ and AgentLan.java) and exposes
// its actions to Hermes as the `omo-body` MCP tools. The skills come from
// Mindcraft's library, vendored in ./mindcraft (MIT).
//
// The world's address comes from ~/.config/omo/lan.json, written by the mod
// when the world opens. The body keeps retrying, so it can start before the game.

import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import mineflayer from 'mineflayer';
import pathfinderPkg from 'mineflayer-pathfinder';
import * as skills from './mindcraft/skills.js';
import * as world from './mindcraft/world.js';
import * as mc from './mindcraft/mcdata.js';

const { pathfinder, Movements, goals } = pathfinderPkg;
const LAN_FILE = process.env.OMO_LAN_FILE || path.join(os.homedir(), '.config', 'omo', 'lan.json');
const NAME = process.env.OMO_BODY_NAME || 'OMO';
const RETRY_MS = 5000;
const GUARD_RADIUS = 16;
const ATTACK_COOLDOWN_MS = 650; // fist/sword cooldown is ~0.6 s; hitting faster does almost no damage
const JOB_WAIT_MS = Number(process.env.OMO_BODY_JOB_WAIT_MS || 60000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WOOD_WORDS = new Set(['log', 'logs', 'wood', 'woods', 'tree', 'trees', 'timber']);

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), '[body]', ...a);
const round = (n) => Math.round(n * 10) / 10;

export function readLan(file = LAN_FILE) {
  try {
    const lan = JSON.parse(readFileSync(file, 'utf8'));
    if (lan?.port) return { host: lan.host || '127.0.0.1', port: Number(lan.port), version: lan.version || '26.2', world: lan.world };
  } catch { /* the world is not open yet */ }
  return null;
}

export class Body {
  constructor({ name = NAME, createBot = mineflayer.createBot, lanReader = readLan } = {}) {
    this.name = name;
    this.createBot = createBot;
    this.lanReader = lanReader;
    this.bot = null;
    this.ready = false;
    this.target = null;
    this.stopped = false;
  }

  start() {
    if (this.stopped || this.bot) return;
    const lan = this.lanReader();
    if (!lan) {
      this._retry('waiting for a world opened to LAN (start Minecraft and load a world)');
      return;
    }
    log(`joining ${lan.world || 'world'} at ${lan.host}:${lan.port} as ${this.name}`);
    const bot = this.createBot({ host: lan.host, port: lan.port, username: this.name, version: lan.version, auth: 'offline' });
    this.bot = bot;
    bot.loadPlugin(pathfinder);
    for (const plugin of Object.values(mc.plugins)) bot.loadPlugin(plugin);
    // What Mindcraft's skill library expects on the bot.
    bot.output = '';
    bot.interrupt_code = false;
    const paused = new Set();
    bot.modes = {
      pause: (mode) => paused.add(mode),
      unpause: (mode) => paused.delete(mode),
      isOn: (mode) => mode === 'self_defense' && !!this.guarding && !paused.has(mode),
      isPaused: (mode) => paused.has(mode),
      clear: () => paused.clear(),
    };
    // 26.2 sends velocity as lpVec3 (already blocks/tick), but mineflayer 4.39 still
    // divides it by 8000 like the old short format, so hits gave him ~zero knockback.
    // Our listener runs after mineflayer's and sets his own velocity correctly.
    bot._client.on('entity_velocity', (p) => {
      try {
        if (!bot.entity || p.entityId !== bot.entity.id || !bot.registry.version['>=']('1.21.9')) return;
        bot.entity.velocity.set(p.velocity.x, p.velocity.y, p.velocity.z);
      } catch { /* not ready */ }
    });
    // Look at whoever just hit him, like a player would.
    bot.on('entityHurt', (e) => {
      if (e !== bot.entity) return;
      const by = bot.nearestEntity((x) => x.type === 'player' && x.position.distanceTo(bot.entity.position) < 6);
      if (by) bot.lookAt(by.position.offset(0, by.height ?? 1.6, 0)).catch(() => {});
    });
    bot.once('spawn', () => {
      this.ready = true;
      this._lastWhy = null;
      mc.useBot(bot);
      try {
        bot.autoEat.options = { ...(bot.autoEat.options || {}), priority: 'foodPoints', startAt: 14,
          bannedFood: ['rotten_flesh', 'spider_eye', 'poisonous_potato', 'pufferfish', 'chicken'] };
      } catch { /* auto-eat optional */ }
      bot.armorManager?.equipAll?.();
      // He works like a real player: survival, so chopping and mining drop items.
      // (LAN worlds with cheats on let him switch himself.)
      const ensureSurvival = () => {
        if (process.env.OMO_BODY_GAMEMODE !== 'keep' && bot.game?.gameMode && bot.game.gameMode !== 'survival') bot.chat('/gamemode survival');
      };
      setTimeout(ensureSurvival, 1000);
      bot.on('game', ensureSurvival);
      const moves = new Movements(bot);
      moves.canDig = false; // never break the player's builds while walking
      bot.pathfinder.setMovements(moves);
      log(`in the world at ${bot.entity.position}`);
      // Fight monsters near you by default; "stop guarding" turns it off.
      if (process.env.OMO_BODY_GUARD !== '0') setTimeout(() => { try { this.guard(null); } catch { /* not ready */ } }, 1500);
    });
    bot.on('death', () => { log('died; respawning'); this._fighting = null; this._fleeing = false; });
    bot.on('kicked', (reason) => log('kicked:', typeof reason === 'string' ? reason : JSON.stringify(reason)));
    bot.on('error', (error) => log('error:', error.message));
    bot.on('end', () => {
      this.ready = false;
      this.bot = null;
      if (this._job) { this._job.cancelled = true; this._job = null; }
      this._retry('left the world; rejoining');
    });
  }

  _retry(why) {
    if (this.stopped || this._timer) return;
    if (why !== this._lastWhy) log(why);
    this._lastWhy = why;
    this._timer = setTimeout(() => { this._timer = null; this.start(); }, RETRY_MS);
    this._timer.unref?.();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this._timer);
    try { this.bot?.quit(); } catch { /* already gone */ }
  }

  _need() {
    if (!this.ready || !this.bot?.entity) throw new Error(`${this.name} is not in the world yet. Open a world in Minecraft first.`);
    return this.bot;
  }

  _player(name) {
    const bot = this._need();
    const others = Object.values(bot.players).filter((p) => p.username !== bot.username && p.entity);
    const wanted = name ? others.find((p) => p.username.toLowerCase() === String(name).toLowerCase()) : null;
    const player = wanted || others.sort((a, b) => a.entity.position.distanceTo(bot.entity.position) - b.entity.position.distanceTo(bot.entity.position))[0];
    if (!player) throw new Error(name ? `I can't see ${name} nearby` : 'I can\'t see any player nearby');
    return player;
  }

  // ── actions (each returns a short fact Hermes can speak) ───────────────
  state() {
    const bot = this._need();
    const p = bot.entity.position;
    const players = Object.values(bot.players).filter((x) => x.username !== bot.username)
      .map((x) => ({ name: x.username, distance: x.entity ? round(x.entity.position.distanceTo(p)) : null }));
    const inventory = {};
    for (const item of bot.inventory.items()) inventory[item.name] = (inventory[item.name] || 0) + item.count;
    const blocks = [];
    for (const pos of bot.findBlocks({ matching: (b) => b && b.name !== 'air', maxDistance: 6, count: 200 })) {
      const name = bot.blockAt(pos)?.name;
      if (name && !blocks.includes(name)) blocks.push(name);
      if (blocks.length >= 12) break;
    }
    let nearbyBlockTypes = blocks;
    let nearbyMobs = [];
    try { nearbyBlockTypes = world.getNearbyBlockTypes(bot, 16).slice(0, 40); } catch { /* fall back */ }
    try { nearbyMobs = world.getNearbyEntityTypes(bot).filter((t) => t !== 'player' && t !== 'item').slice(0, 20); } catch { /* none */ }
    return {
      name: bot.username, position: { x: round(p.x), y: round(p.y), z: round(p.z) },
      health: bot.health, food: bot.food, timeOfDay: bot.time?.timeOfDay, raining: bot.isRaining,
      biome: (() => { try { return world.getBiomeName(bot); } catch { return null; } })(),
      following: this.target, guarding: this.guarding || null, currentJob: this._job?.label || null,
      players, nearbyBlockTypes, nearbyMobs, inventory, armor: bot.inventory.slots.slice(5, 9).filter(Boolean).map((i) => i.name),
    };
  }

  async comeTo(name) {
    let player;
    try {
      player = this._player(name);
    } catch (error) {
      // Out of sight (too far for the server to send them): jump to them
      // with /tp, which LAN worlds with cheats allow.
      const bot = this.bot;
      const far = Object.values(bot?.players || {}).find((p) => p.username !== bot.username
        && (!name || p.username.toLowerCase() === String(name).toLowerCase()));
      if (!far || process.env.OMO_BODY_TELEPORT === '0') throw error;
      await this.cancelJob();
      bot.chat(`/tp ${bot.username} ${far.username}`);
      await sleep(1500);
      if (bot.players[far.username]?.entity) return `${far.username} was too far to walk, so I teleported to you.`;
      throw new Error(`${far.username} is too far away and I couldn't teleport (are cheats on?).`);
    }
    await this.cancelJob();
    this.target = null;
    const { x, y, z } = player.entity.position;
    const reached = await this._goto(new goals.GoalNear(x, y, z, 2), 45000);
    const left = round(this.bot.entity.position.distanceTo(player.entity.position));
    return reached || left <= 3
      ? `I'm next to ${player.username} now.`
      : `I'm on my way to ${player.username}, ${left} blocks away; the path is slow.`;
  }

  follow(name) {
    const bot = this._need();
    const player = this._player(name);
    this.cancelJob();
    this.target = player.username;
    bot.pathfinder.setGoal(new goals.GoalFollow(player.entity, 2), true);
    return `Following ${player.username}.`;
  }

  stopMoving() {
    const bot = this._need();
    this.cancelJob();
    this.target = null;
    this._fighting = null;
    bot.pathfinder.setGoal(null);
    bot.clearControlStates();
    return 'Stopped.';
  }

  async goTo(x, y, z) {
    this._need();
    await this.cancelJob();
    this.target = null;
    const reached = await this._goto(new goals.GoalNear(Number(x), Number(y), Number(z), 1), 60000);
    const p = this.bot.entity.position;
    return reached
      ? `I'm at ${round(x)}, ${round(y)}, ${round(z)}.`
      : `Still walking; I'm at ${round(p.x)}, ${round(p.y)}, ${round(p.z)}.`;
  }

  say(text) {
    const bot = this._need();
    const line = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 240);
    if (!line) throw new Error('nothing to say');
    bot.chat(line);
    return 'Said it in chat.';
  }

  async lookAt(name) {
    const bot = this._need();
    const player = this._player(name);
    await bot.lookAt(player.entity.position.offset(0, player.entity.height, 0));
    return `Looking at ${player.username}.`;
  }

  // ── combat ─────────────────────────────────────────────────────────────
  // Guard mode: every 200 ms, find the nearest hostile mob near the guarded
  // player (or near himself), chase it and hit it on the attack cooldown. When
  // the fight is over he goes back to following.
  guard(name, on = true) {
    const bot = this._need();
    if (!on) {
      this.guarding = null;
      clearInterval(this._guardTimer);
      this._guardTimer = null;
      this._fighting = null;
      return 'Guard mode off.';
    }
    let who = null;
    try { who = this._player(name).username; } catch { /* guard himself */ }
    this.guarding = who || bot.username;
    this._equipWeapon();
    clearInterval(this._guardTimer);
    this._guardTimer = setInterval(() => { this._guardTick().catch(() => {}); }, 200);
    this._guardTimer.unref?.();
    if (who && !this.target) this.follow(who);
    return who ? `Guarding ${who}. I'll fight any monster that comes near.` : "On guard. I'll fight any monster that comes near.";
  }

  _hostiles(center, radius = GUARD_RADIUS) {
    const bot = this.bot;
    return Object.values(bot.entities)
      .filter((e) => e !== bot.entity && e.position && (e.type === 'hostile' || e.kind === 'Hostile mobs')
        && e.position.distanceTo(center) <= radius && e.health !== 0)
      .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position));
  }

  async _guardTick() {
    if (!this.ready) return;
    this._reflexes();
    if (!this.guarding || this._busyHit || this.bot.modes.isPaused('self_defense')) return;
    const bot = this.bot;
    const nearestPlayer = Object.values(bot.players).find((p) => p.username !== bot.username && p.entity)?.entity;
    const ward = (this.guarding !== bot.username && bot.players[this.guarding]?.entity) || nearestPlayer;
    // With a player in view he protects them (16 blocks); alone he only
    // defends himself, so he doesn't wander off chasing every mob in a cave.
    const target = (ward && this._hostiles(ward.position)[0]) || this._hostiles(bot.entity.position, 6)[0];
    if (!target) {
      if (this._fighting) {
        this._fighting = null;
        if (this._job?.paused) { this._job.paused = false; return; } // back to work
        if (this.target && bot.players[this.target]?.entity) {
          bot.pathfinder.setGoal(new goals.GoalFollow(bot.players[this.target].entity, 2), true);
        } else {
          bot.pathfinder.setGoal(null);
        }
      }
      return;
    }
    // Low on health: back off, eat, and only then fight again.
    if (bot.health <= 7 && !this._fleeing) {
      this._fleeing = true;
      this._fighting = null;
      bot.interrupt_code = true;
      log(`low health (${bot.health}); backing off from the ${target.name}`);
      (async () => {
        try { await skills.moveAwayFromEntity(bot, target, 12); } catch { /* cornered */ }
        try {
          const foods = bot.registry.foodsByName || {};
          const food = bot.inventory.items().filter((i) => foods[i.name] && !['rotten_flesh', 'spider_eye', 'poisonous_potato'].includes(i.name))
            .sort((a, b) => (foods[b.name].foodPoints || 0) - (foods[a.name].foodPoints || 0))[0];
          if (food) { await bot.equip(food, 'hand'); await bot.consume(); this._equipWeapon(); }
        } catch { /* nothing to eat */ }
        bot.interrupt_code = false;
        this._fleeing = false;
      })();
      return;
    }
    if (this._fleeing) return;
    if (this._job && !this._job.paused) {
      // Drop the tools and fight; the job resumes when the area is clear.
      this._job.paused = true;
      bot.interrupt_code = true;
      try { bot.stopDigging(); } catch { /* not digging */ }
    }
    if (this._fighting !== target.id) {
      this._fighting = target.id;
      this._equipWeapon();
      bot.pathfinder.setGoal(new goals.GoalFollow(target, 2), true);
    }
    const dist = target.position.distanceTo(bot.entity.position);
    if (dist <= 3.2 && Date.now() - (this._lastHit || 0) >= ATTACK_COOLDOWN_MS) {
      this._busyHit = true;
      try {
        await bot.lookAt(target.position.offset(0, (target.height || 1.6) * 0.8, 0), true);
        bot.attack(target);
        this._lastHit = Date.now();
      } finally {
        this._busyHit = false;
      }
    }
  }

  async attackNearest() {
    this._need();
    const target = this._hostiles(this.bot.entity.position, 24)[0];
    if (!this.guarding) this.guard(null);
    if (!target) return "I don't see any monsters nearby. I'm on guard.";
    this._fighting = null; // let the next tick lock on
    return `Attacking the ${target.name || target.displayName || 'monster'}.`;
  }

  _equipWeapon() {
    const bot = this.bot;
    const rank = (n) => {
      const tier = ['netherite', 'diamond', 'iron', 'stone', 'golden', 'wooden'].findIndex((t) => n.startsWith(t));
      const kind = n.endsWith('_sword') ? 0 : n.endsWith('_axe') ? 1 : null;
      return kind === null ? null : kind * 10 + (tier < 0 ? 9 : tier);
    };
    const best = bot.inventory.items().map((i) => ({ i, r: rank(i.name) })).filter((x) => x.r !== null).sort((a, b) => a.r - b.r)[0];
    if (best) bot.equip(best.i, 'hand').catch(() => {});
  }

  // ── survival reflexes (cheap, every tick) ─────────────────────────────
  _reflexes() {
    const bot = this.bot;
    const feet = bot.blockAt(bot.entity.position);
    const head = bot.blockAt(bot.entity.position.offset(0, 1, 0));
    const danger = (b) => b && ['lava', 'fire', 'soul_fire', 'magma_block'].includes(b.name);
    const underwater = head && head.name === 'water' && (bot.oxygenLevel ?? 20) < 12;
    if (danger(feet) || underwater) {
      bot.setControlState('jump', true);
      if (danger(feet)) bot.setControlState('forward', true);
      this._reflexOn = true;
    } else if (this._reflexOn) {
      this._reflexOn = false;
      bot.setControlState('jump', false);
      bot.setControlState('forward', false);
    }
  }

  // ── jobs: Mindcraft skills with interrupt, fight-pause and resume ──────
  // A job runs one skill function. Movement commands cancel it, a monster
  // pauses it (he fights, then carries on). The tool call waits up to
  // JOB_WAIT_MS; longer jobs keep going and he says in chat when done.
  async cancelJob() {
    const job = this._job;
    if (!job) return;
    job.cancelled = true;
    job.paused = false;
    const bot = this.bot;
    if (bot) {
      bot.interrupt_code = true;
      try { bot.pathfinder.setGoal(null); bot.pvp?.stop?.(); bot.stopDigging(); bot.clearControlStates(); } catch { /* ok */ }
    }
    for (let i = 0; i < 30 && !job.done; i++) await sleep(100);
  }

  async runJob(label, fn, { waitMs = JOB_WAIT_MS } = {}) {
    const bot = this._need();
    await this.cancelJob();
    const resumeFollow = this.target || this._resumeFollow || null;
    this.target = null;
    const job = { label, done: false, cancelled: false, paused: false, backgrounded: false };
    this._resumeFollow = resumeFollow;
    this._job = job;
    const finished = (async () => {
      let result;
      for (;;) {
        bot.output = '';
        bot.interrupt_code = false;
        bot.modes.clear();
        try {
          result = await fn(bot);
        } catch (error) {
          bot.output += `${error.message}\n`;
          result = false;
        }
        if (job.cancelled) break;
        if (job.paused) {
          while (job.paused && !job.cancelled) await sleep(200);
          if (job.cancelled) break;
          continue; // resume after the fight
        }
        break;
      }
      job.done = true;
      if (this._job === job) {
        this._job = null;
        // Go back to following whoever he was with before the job.
        if (!job.cancelled && this._resumeFollow) {
          try { this.follow(this._resumeFollow); } catch { /* they left */ }
        }
        this._resumeFollow = null;
      }
      const notes = bot.output.split('\n').map((l) => l.trim()).filter(Boolean);
      const summary = notes.slice(-4).join(' ').slice(0, 400);
      const text = job.cancelled ? `Stopped ${label}.` : `${result === false ? 'Could not finish' : 'Finished'} ${label}.${summary ? ' ' + summary : ''}`;
      if (job.backgrounded && !job.cancelled) { try { bot.chat(text.slice(0, 240)); } catch { /* left */ } }
      log(`[job] ${text}`);
      return text;
    })();
    const early = await Promise.race([finished, sleep(waitMs).then(() => null)]);
    if (early !== null) return early;
    job.backgrounded = true;
    return `Still working on ${label} (it takes a while). I'll post in chat when it's done.`;
  }

  _resolveBlock(name) {
    const want = String(name || '').toLowerCase().trim().replace(/\s+/g, '_');
    if (!WOOD_WORDS.has(want) && !/^(any_)?(log|wood)s?$/.test(want)) return want;
    const logs = world.getNearestBlocksWhere(this.bot, (b) => /_(log|stem)$/.test(b.name) && !b.name.startsWith('stripped_'), 64, 1);
    if (!logs.length) throw new Error("I can't see any trees nearby.");
    return logs[0].name;
  }

  collect(block, count = 1, opts = {}) {
    this._need();
    const n = Math.max(1, Math.min(64, Number(count) || 1));
    const type = this._resolveBlock(block);
    return this.runJob(`collecting ${n} ${type}`, (bot) => skills.collectBlock(bot, type, n), opts);
  }

  // count = how many items he should end up with. On 26.2, Mineflayer's
  // multi-craft desyncs the inventory, so craft one batch at a time and let the
  // server settle in between.
  craft(item, count = 1) {
    const want = Math.max(1, Math.min(64, Number(count) || 1));
    const name = String(item);
    return this.runJob(`crafting ${want} ${name}`, async (bot) => {
      const have = () => world.getInventoryCounts(bot)[name] || 0;
      const start = have();
      for (let i = 0; i < 64 && have() - start < want; i++) {
        if (bot.interrupt_code) return false;
        const ok = await skills.craftRecipe(bot, name, 1);
        if (!ok) return have() > start;
        await sleep(350);
      }
      return true;
    });
  }

  smelt(item, count = 1) {
    const n = Math.max(1, Math.min(64, Number(count) || 1));
    return this.runJob(`smelting ${n} ${item}`, (bot) => skills.smeltItem(bot, String(item), n));
  }

  place(block, x, y, z) {
    return this.runJob(`placing ${block}`, async (bot) => {
      let pos = (x !== undefined && y !== undefined && z !== undefined) ? { x: Number(x), y: Number(y), z: Number(z) } : null;
      if (!pos) {
        const free = world.getNearestFreeSpace(bot, 1, 6);
        if (!free) throw new Error('No free space nearby to place it.');
        pos = free;
      }
      return skills.placeBlock(bot, String(block), Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
    });
  }

  give(item, count = 1, name) {
    const player = this._player(name);
    return this.runJob(`giving ${count} ${item} to ${player.username}`, (bot) => skills.giveToPlayer(bot, String(item), player.username, Math.max(1, Number(count) || 1)));
  }

  equipItem(item) { return this.runJob(`equipping ${item}`, (bot) => skills.equip(bot, String(item)), { waitMs: 15000 }); }

  eat(item = '') {
    return this.runJob('eating', (bot) => {
      let food = item;
      if (!food) {
        const foods = bot.registry.foodsByName || {};
        food = bot.inventory.items().filter((i) => foods[i.name]).sort((a, b) => (foods[b.name].foodPoints || 0) - (foods[a.name].foodPoints || 0))[0]?.name;
        if (!food) throw new Error("I don't have any food.");
      }
      return skills.consume(bot, food);
    }, { waitMs: 15000 });
  }

  pickup() { return this.runJob('picking up nearby items', (bot) => skills.pickupNearbyItems(bot), { waitMs: 30000 }); }

  hunt(mob) {
    const type = String(mob || '').toLowerCase().trim().replace(/\s+/g, '_');
    return this.runJob(`attacking the ${type}`, (bot) => skills.attackNearest(bot, type, true));
  }

  goToBlock(block) {
    const type = this._resolveBlock(block);
    return this.runJob(`going to the nearest ${type}`, (bot) => skills.goToNearestBlock(bot, type, 2, 64));
  }

  chestPut(item, count) { return this.runJob(`putting ${item} in a chest`, (bot) => skills.putInChest(bot, String(item), count ? Number(count) : -1)); }
  chestTake(item, count) { return this.runJob(`taking ${item} from a chest`, (bot) => skills.takeFromChest(bot, String(item), count ? Number(count) : -1)); }
  sleepInBed() { return this.runJob('going to bed', (bot) => skills.goToBed(bot)); }

  craftable() {
    const bot = this._need();
    try { return world.getCraftableItems(bot).slice(0, 60); } catch (error) { return `Could not check: ${error.message}`; }
  }

  // Resolves true when the goal is reached, false when it timed out (the
  // walk stops there); throws only when no path exists at all.
  async _goto(goal, timeoutMs) {
    const bot = this._need();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; bot.pathfinder.setGoal(null); }, timeoutMs);
    try {
      await bot.pathfinder.goto(goal);
      return true;
    } catch (error) {
      if (timedOut) return false;
      // A newer command (follow, stop, another walk) replaced this one.
      if (error?.name === 'GoalChanged' || /goal was changed/i.test(error?.message || '')) return true;
      throw new Error(`I couldn't get there: ${error.message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

// ── fast path for plain movement ─────────────────────────────────────────
// "come here", "follow me", "stop" should move him at once and never depend
// on the language model remembering to call a tool. Anything else (or any
// request with more to it) still goes to Hermes.
const QUICK = [
  { re: /\b(stop|don'?t) (guarding|fighting|attacking)\b|\bguard off\b/i, run: (b) => b.guard(null, false) },
  { re: /\b(fight|attack|kill|protect|defend|guard|help me (fight|with (the|these|this) (mobs?|monsters?|zombies?|skeletons?|creepers?|spiders?)))\b/i, run: (b) => b.attackNearest() },
  { re: /\b(chop|cut)( down)?\b.*\b(trees?|wood|logs?)\b|\b(get|collect|gather) (some |more )?(wood|logs)\b/i, run: (b, t) => b.collect('wood', Number((t.match(/\b(\d{1,2})\b/) || [])[1]) || 5, { waitMs: 2500 }) },
  { re: /\b(stop|stay|wait|hold on|freeze|stand still)\b/i, run: (b) => b.stopMoving() },
  { re: /\b(follow|come with|keep up|tag along)\b/i, run: (b) => b.follow() },
  { re: /\b(come|get over|walk|head|move)\b.*\b(here|over|to me|towards? me|my way)\b|\bcome here\b|\bover here\b/i, run: (b) => b.comeTo() },
];

export function quickIntent(text) {
  const clean = String(text || '').trim();
  // Long or compound requests ("come here and build a house") are Hermes' job.
  if (!clean || clean.split(/\s+/).length > 14 || /\b(and then|then|build|mine|craft|make|get me|bring)\b/i.test(clean)) return null;
  const hit = QUICK.find((q) => q.re.test(clean));
  return hit ? { re: hit.re, run: (b) => hit.run(b, clean), source: hit.run } : null;
}

// ── MCP tools ────────────────────────────────────────────────────────────
const nameProp = { player: { type: 'string', description: 'Player name; omit for the nearest player.' } };

export const BODY_TOOLS = [
  { name: 'body_state', description: 'Where Omo is in the Minecraft world: position, health, nearby players and blocks, inventory, who it is following.', inputSchema: { type: 'object', properties: {} }, run: (b) => b.state() },
  { name: 'body_come_to', description: 'Walk to a player and stop next to them.', inputSchema: { type: 'object', properties: nameProp }, run: (b, a) => b.comeTo(a.player) },
  { name: 'body_follow', description: 'Keep following a player until told to stop.', inputSchema: { type: 'object', properties: nameProp }, run: (b, a) => b.follow(a.player) },
  { name: 'body_stop', description: 'Stop whatever he is doing (walking, following, chopping, crafting...).', inputSchema: { type: 'object', properties: {} }, run: (b) => b.stopMoving() },
  {
    name: 'body_go_to', description: 'Walk to block coordinates.',
    inputSchema: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } }, required: ['x', 'y', 'z'] },
    run: (b, a) => b.goTo(a.x, a.y, a.z),
  },
  { name: 'body_look_at', description: 'Turn to face a player.', inputSchema: { type: 'object', properties: nameProp }, run: (b, a) => b.lookAt(a.player) },
  {
    name: 'body_guard', description: 'Turn guard mode on or off. On: he stays with the player and attacks any hostile mob within 16 blocks of them.',
    inputSchema: { type: 'object', properties: { on: { type: 'boolean' }, ...nameProp }, required: ['on'] },
    run: (b, a) => b.guard(a.player, a.on !== false),
  },
  { name: 'body_attack', description: 'Attack the nearest hostile mob right now (and stay on guard).', inputSchema: { type: 'object', properties: {} }, run: (b) => b.attackNearest() },
  {
    name: 'body_collect', description: 'Gather blocks by breaking them: chop trees (block "wood" picks the nearest log type, or e.g. "oak_log"), mine "stone"/"cobblestone", ores ("coal", "iron", "diamond"), "dirt", "sand"... Picks the right tool and collects the drops. Waits up to a minute.',
    inputSchema: { type: 'object', properties: { block: { type: 'string' }, count: { type: 'number', description: 'How many (1-64).' } }, required: ['block'] },
    run: (b, a) => b.collect(a.block, a.count),
  },
  {
    name: 'body_craft', description: 'Craft items (count = how many he should end up with) from his inventory, e.g. "oak_planks", "stick", "crafting_table", "wooden_pickaxe", "stone_sword", "torch", "furnace". Uses or places a crafting table when needed. Fails with the missing ingredients.',
    inputSchema: { type: 'object', properties: { item: { type: 'string' }, count: { type: 'number' } }, required: ['item'] },
    run: (b, a) => b.craft(a.item, a.count),
  },
  {
    name: 'body_smelt', description: 'Smelt in a furnace (uses a nearby one or places one from his inventory), e.g. "raw_iron", "beef", "sand". Needs fuel in his inventory.',
    inputSchema: { type: 'object', properties: { item: { type: 'string' }, count: { type: 'number' } }, required: ['item'] },
    run: (b, a) => b.smelt(a.item, a.count),
  },
  {
    name: 'body_place', description: 'Place a block from his inventory, at coordinates or (without them) in the nearest free spot.',
    inputSchema: { type: 'object', properties: { block: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } }, required: ['block'] },
    run: (b, a) => b.place(a.block, a.x, a.y, a.z),
  },
  {
    name: 'body_give', description: 'Walk to a player and toss them items from his inventory.',
    inputSchema: { type: 'object', properties: { item: { type: 'string' }, count: { type: 'number' }, ...nameProp }, required: ['item'] },
    run: (b, a) => b.give(a.item, a.count, a.player),
  },
  { name: 'body_hunt', description: 'Hunt and kill the nearest mob of a type, e.g. "cow", "pig", "sheep", "zombie", "skeleton".', inputSchema: { type: 'object', properties: { mob: { type: 'string' } }, required: ['mob'] }, run: (b, a) => b.hunt(a.mob) },
  { name: 'body_go_to_block', description: 'Walk to the nearest block of a type, e.g. "crafting_table", "chest", "water", "wood".', inputSchema: { type: 'object', properties: { block: { type: 'string' } }, required: ['block'] }, run: (b, a) => b.goToBlock(a.block) },
  { name: 'body_equip', description: 'Hold or wear an item from his inventory (tool, weapon, armour).', inputSchema: { type: 'object', properties: { item: { type: 'string' } }, required: ['item'] }, run: (b, a) => b.equipItem(a.item) },
  { name: 'body_eat', description: 'Eat food from his inventory (best food if none named). He also eats by himself when hungry.', inputSchema: { type: 'object', properties: { item: { type: 'string' } } }, run: (b, a) => b.eat(a.item) },
  { name: 'body_pickup', description: 'Pick up dropped items lying nearby.', inputSchema: { type: 'object', properties: {} }, run: (b) => b.pickup() },
  {
    name: 'body_chest', description: 'Use the nearest chest: put items in ("put") or take them out ("take"). Count omitted = all.',
    inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['put', 'take'] }, item: { type: 'string' }, count: { type: 'number' } }, required: ['action', 'item'] },
    run: (b, a) => (a.action === 'take' ? b.chestTake(a.item, a.count) : b.chestPut(a.item, a.count)),
  },
  { name: 'body_sleep', description: 'Go to the nearest bed and sleep (night only).', inputSchema: { type: 'object', properties: {} }, run: (b) => b.sleepInBed() },
  { name: 'body_craftable', description: 'List what he can craft right now from his inventory.', inputSchema: { type: 'object', properties: {} }, run: (b) => b.craftable() },
  {
    name: 'body_chat', description: 'Type a message into the Minecraft chat (for coordinates, lists or names the player should read).',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    run: (b, a) => b.say(a.text),
  },
];

/** Minimal stateless MCP (streamable HTTP, JSON responses) for Hermes. */
export async function handleMcp(body, message) {
  const reply = (result) => ({ jsonrpc: '2.0', id: message.id, result });
  const fail = (code, text) => ({ jsonrpc: '2.0', id: message.id, error: { code, message: text } });
  switch (message.method) {
    case 'initialize':
      return reply({
        protocolVersion: message.params?.protocolVersion || '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'omo-body', version: '0.1.0' },
        instructions: 'Tools that move and speak for the Omo player inside the user\'s Minecraft world.',
      });
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: BODY_TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case 'tools/call': {
      const tool = BODY_TOOLS.find((t) => t.name === message.params?.name);
      if (!tool) return fail(-32602, `unknown tool ${message.params?.name}`);
      try {
        const value = await tool.run(body, message.params?.arguments || {});
        return reply({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] });
      } catch (error) {
        return reply({ content: [{ type: 'text', text: error.message }], isError: true });
      }
    }
    default:
      if (message.id === undefined) return null; // notification, e.g. notifications/initialized
      return fail(-32601, `method not found: ${message.method}`);
  }
}
