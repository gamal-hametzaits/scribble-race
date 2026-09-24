// Scribble Race relay server: one Durable Object per room code, WebSocket hibernation.
import { DurableObject } from 'cloudflare:workers';

const COLORS = ['#ff5a4e', '#35c2ff', '#7be07b', '#ffcf5a'];
const MAX = 4;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/room\/([A-Z]{4})$/);
    if (m) {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('websocket required', { status: 426 });
      return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(req);
    }
    if (url.pathname === '/' || url.pathname === '/health') {
      return Response.json({ ok: true, service: 'scribble-race-server', version: '1.1.0' }, { headers: { 'Access-Control-Allow-Origin': '*' } });
    }
    return new Response('not found', { status: 404 });
  }
};

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
