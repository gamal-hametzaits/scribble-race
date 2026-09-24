// Scribble Race relay server: one Durable Object per room code, WebSocket hibernation.
import { DurableObject } from 'cloudflare:workers';

const COLORS = ['#ff5a4e', '#35c2ff', '#7be07b', '#ffcf5a'];
const MAX = 4;

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/room\/([A-Z]{4})$/);
    if (m) {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('websocket required', { status: 426 });
      return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(req);
    }
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === '/scores' || url.pathname === '/score' || url.pathname === '/records' || url.pathname === '/stats') {
      const r = await env.BOARD.get(env.BOARD.idFromName('global')).fetch(req);
      const h = new Headers(r.headers); for (const k in CORS) h.set(k, CORS[k]);
      return new Response(r.body, { status: r.status, headers: h });
    }
    if (url.pathname === '/' || url.pathname === '/health') {
      return Response.json({ ok: true, service: 'scribble-race-server', version: '1.2.0', leaderboard: true }, { headers: CORS });
    }
    return new Response('not found', { status: 404 });
  }
};

// Global leaderboard: one SQLite-backed Durable Object. Best time per player per track.
export class Board extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS best(stage INTEGER NOT NULL, pid TEXT NOT NULL, name TEXT NOT NULL, time REAL NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(stage, pid))');
    this.sql.exec('CREATE INDEX IF NOT EXISTS best_rank ON best(stage, time)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS recs(id INTEGER PRIMARY KEY AUTOINCREMENT, stage INTEGER, name TEXT, time REAL, at INTEGER)');
    this.last = new Map();
  }
  board(stage, pid) {
    const top = this.sql.exec('SELECT pid, name, time, at FROM best WHERE stage = ? ORDER BY time ASC, at ASC LIMIT 10', stage).toArray()
      .map(r => ({ name: r.name, time: r.time, at: r.at, me: !!pid && r.pid === pid }));
    const total = this.sql.exec('SELECT COUNT(*) AS n FROM best WHERE stage = ?', stage).one().n;
    let me = null;
    if (pid) {
      const row = this.sql.exec('SELECT time FROM best WHERE stage = ? AND pid = ?', stage, pid).toArray()[0];
      if (row) me = { time: row.time, rank: this.sql.exec('SELECT COUNT(*) AS n FROM best WHERE stage = ? AND time < ?', stage, row.time).one().n + 1 };
    }
    return { stage, top, total, me };
  }
  async fetch(req) {
    const url = new URL(req.url);
    const bad = (e, s = 400) => Response.json({ error: e }, { status: s });
    if (url.pathname === '/records') {
      const recs = this.sql.exec('SELECT stage, name, time, at FROM recs ORDER BY id DESC LIMIT 15').toArray();
      return Response.json({ recs });
    }
    if (url.pathname === '/stats') {
      const s = this.sql.exec('SELECT COUNT(*) AS scores, COUNT(DISTINCT pid) AS players, COUNT(DISTINCT stage) AS tracks FROM best').one();
      return Response.json(s);
    }
    if (req.method === 'GET') {
      const stage = parseInt(url.searchParams.get('stage'), 10);
      if (!(stage >= 0 && stage < 10000)) return bad('stage');
      const pid = /^[a-z0-9]{8,24}$/.test(url.searchParams.get('pid') || '') ? url.searchParams.get('pid') : null;
      return Response.json(this.board(stage, pid));
    }
    if (req.method !== 'POST' || url.pathname !== '/score') return bad('method', 405);
    let d; try { d = await req.json(); } catch (e) { return bad('json'); }
    const stage = d.stage | 0, time = Math.round(Number(d.time) * 100) / 100, pid = String(d.pid || '');
    const name = String(d.name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12) || 'שחקן';
    if (!(stage >= 0 && stage < 10000)) return bad('stage');
    if (!/^[a-z0-9]{8,24}$/.test(pid)) return bad('pid');
    if (!(time >= 9 && time <= 900)) return bad('time');
    const now = Date.now();
    if (now - (this.last.get(pid) || 0) < 2000) return bad('slow down', 429);
    this.last.set(pid, now); if (this.last.size > 5000) this.last.clear();
    const prevTop = this.sql.exec('SELECT time FROM best WHERE stage = ? ORDER BY time ASC LIMIT 1', stage).toArray()[0];
    const mine = this.sql.exec('SELECT time FROM best WHERE stage = ? AND pid = ?', stage, pid).toArray()[0];
    let improved = false;
    if (!mine || time < mine.time) {
      this.sql.exec('INSERT INTO best(stage, pid, name, time, at) VALUES(?, ?, ?, ?, ?) ON CONFLICT(stage, pid) DO UPDATE SET name = excluded.name, time = excluded.time, at = excluded.at', stage, pid, name, time, now);
      improved = true;
    } else if (mine) this.sql.exec('UPDATE best SET name = ? WHERE stage = ? AND pid = ? AND name != ?', name, stage, pid, name);
    const worldRecord = improved && (!prevTop || time < prevTop.time);
    if (worldRecord) {
      this.sql.exec('INSERT INTO recs(stage, name, time, at) VALUES(?, ?, ?, ?)', stage, name, time, now);
      this.sql.exec('DELETE FROM recs WHERE id <= (SELECT MAX(id) FROM recs) - 50');
    }
    return Response.json({ ...this.board(stage, pid), improved, worldRecord });
  }
}

export class Room extends DurableObject {
  constructor(ctx, env) { super(ctx, env); }

  sockets() { return this.ctx.getWebSockets().filter(ws => { const a = ws.deserializeAttachment(); return a && a.id; }); }
  roster() {
    const list = this.sockets().map(ws => ws.deserializeAttachment()).sort((a, b) => a.joined - b.joined);
    const players = {}; for (const p of list) players[p.id] = { id: p.id, name: p.name, color: p.color };
    return { players, host: list.length ? list[0].id : null };
  }
  async racing() { return (await this.ctx.storage.get('racing')) === true; }

  async fetch(req) {
    const url = new URL(req.url);
    const create = url.searchParams.get('create') === '1';
    const others = this.sockets();
    const pair = new WebSocketPair(); const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    const reject = (t) => { server.send(JSON.stringify({ t })); server.close(1000, t); return new Response(null, { status: 101, webSocket: client }); };
    if (create && others.length) return reject('taken');
    if (!create && !others.length) return reject('noroom');
    if (others.length >= MAX) return reject('full');
    if (!create && await this.racing()) return reject('busy');
    if (create) await this.ctx.storage.put('racing', false);
    const used = others.map(ws => ws.deserializeAttachment().color);
    const color = COLORS.find(c => !used.includes(c));
    const id = 'p' + crypto.randomUUID().slice(0, 6);
    server.serializeAttachment({ id, name: 'שחקן', color, joined: Date.now() });
    const code = url.pathname.slice(-4);
    server.send(JSON.stringify({ t: 'welcome', id, color, code }));
    return new Response(null, { status: 101, webSocket: client });
  }

  broadcast(obj, except) {
    const s = JSON.stringify(obj);
    for (const ws of this.sockets()) if (ws !== except) { try { ws.send(s); } catch (e) {} }
  }
  sendRoster() { this.broadcast({ t: 'players', ...this.roster() }); }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > 8000) return;
    let d; try { d = JSON.parse(raw); } catch (e) { return; }
    const me = ws.deserializeAttachment(); if (!me || !me.id) return;
    if (d.t === 'hello') { me.name = String(d.name || 'שחקן').slice(0, 12); ws.serializeAttachment(me); this.sendRoster(); return; }
    if (d.t === 'ping') { ws.send('{"t":"pong"}'); return; }
    const isHost = this.roster().host === me.id;
    if (d.t === 'start') { if (!isHost) return; await this.ctx.storage.put('racing', true); this.broadcast({ t: 'start', stage: d.stage | 0 }, ws); return; }
    if (d.t === 'lobby') { if (!isHost) return; await this.ctx.storage.put('racing', false); this.broadcast({ t: 'lobby' }, ws); return; }
    if (d.t === 's' || d.t === 'limb' || d.t === 'fin') { d.id = me.id; this.broadcast(d, ws); }
  }
  async webSocketClose(ws) { try { ws.close(); } catch (e) {} this.left(ws); }
  async webSocketError(ws) { this.left(ws); }
  async left(ws) {
    try { ws.serializeAttachment(null); } catch (e) {}
    const r = this.roster();
    if (!r.host) await this.ctx.storage.put('racing', false);
    this.broadcast({ t: 'players', ...r });
  }
}
