(() => {
const P = window.Phys, $ = id => document.getElementById(id);
const COLORS = ['#ff5a4e', '#35c2ff', '#7be07b', '#ffcf5a'];
const STAGE_NAMES = ['גבעות', 'מדרגות', 'תהום'];
const MAX_INK = 90; // world units per limb
const world = $('world'), wctx = world.getContext('2d');
const pad = $('pad'), pctx = pad.getContext('2d');
let W = 0, H = 0, DPR = 1;
const store = {
  get(k, d) { try { const v = localStorage.getItem('scr_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('scr_' + k, JSON.stringify(v)); } catch (e) {} }
};

// ---------- state ----------
const S = {
  mode: 'menu', // menu | solo | multi
  stage: 0, track: null, me: null, running: false, countdown: 0, raceStart: 0,
  remotes: {}, // id -> {name,color,x,y,a,ma,arm,leg,fin,time,tx,ty,ta}
  ghost: null, rec: [], recT: 0, myId: 'me', myColor: COLORS[0], name: store.get('name', ''),
  finishOrder: [], sendT: 0, limbDirty: true, t: 0, sky: 0
};

// ---------- sizing ----------
function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = innerWidth; H = innerHeight;
  world.width = W * DPR; world.height = H * DPR;
  const r = pad.getBoundingClientRect();
  pad.width = Math.max(10, r.width * DPR); pad.height = Math.max(10, r.height * DPR);
  drawPad();
}
addEventListener('resize', resize);

// ---------- drawing pad ----------
const padState = { strokes: { arm: null, leg: null }, cur: null, which: null };
function padGeom() {
  const w = pad.width / DPR, h = pad.height / DPR, sc = Math.min(1.6, h / 120);
  return { w, h, sc, cx: w * 0.5, cy: h * 0.48 };
}
function jointPad(which) {
  const g = padGeom(), J = which === 'arm' ? P.SHOULDER : P.HIP;
  return { x: g.cx + J.x * g.sc, y: g.cy + J.y * g.sc };
}
function drawPad() {
  const g = padGeom(); pctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  pctx.clearRect(0, 0, g.w, g.h);
  // figure
  pctx.lineCap = 'round'; pctx.lineJoin = 'round';
  pctx.strokeStyle = '#1b1433'; pctx.lineWidth = 3;
  pctx.beginPath(); pctx.moveTo(g.cx, g.cy - 18 * g.sc); pctx.lineTo(g.cx, g.cy + 18 * g.sc); pctx.stroke();
  pctx.beginPath(); pctx.arc(g.cx, g.cy - 30 * g.sc, 10 * g.sc, 0, 7); pctx.fillStyle = '#fff'; pctx.fill(); pctx.stroke();
  for (const which of ['arm', 'leg']) {
    const pts = padState.strokes[which], j = jointPad(which);
    if (pts) {
      pctx.strokeStyle = S.myColor; pctx.lineWidth = 6;
      pctx.beginPath(); pts.forEach((p, i) => { const x = j.x + p.x * g.sc, y = j.y + p.y * g.sc; i ? pctx.lineTo(x, y) : pctx.moveTo(x, y); }); pctx.stroke();
    }
    pctx.fillStyle = S.myColor; pctx.beginPath(); pctx.arc(j.x, j.y, 6, 0, 7); pctx.fill();
  }
  if (padState.cur) {
    pctx.strokeStyle = S.myColor; pctx.globalAlpha = 0.45; pctx.lineWidth = 6;
    pctx.beginPath(); padState.cur.forEach((p, i) => i ? pctx.lineTo(p.x, p.y) : pctx.moveTo(p.x, p.y)); pctx.stroke(); pctx.globalAlpha = 1;
  }
}
function padPos(e) { const r = pad.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
function strokeLen(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); return L; }
pad.addEventListener('pointerdown', e => {
  e.preventDefault(); pad.setPointerCapture(e.pointerId);
  const p = padPos(e), a = jointPad('arm'), l = jointPad('leg');
  padState.which = Math.hypot(p.x - a.x, p.y - a.y) < Math.hypot(p.x - l.x, p.y - l.y) ? 'arm' : 'leg';
  padState.cur = [p]; drawPad(); updateInk();
});
pad.addEventListener('pointermove', e => {
  if (!padState.cur) return; e.preventDefault();
  const g = padGeom(), p = padPos(e), last = padState.cur[padState.cur.length - 1];
  if (Math.hypot(p.x - last.x, p.y - last.y) < 3) return;
  if (strokeLen(padState.cur) / g.sc > MAX_INK) return;
  padState.cur.push(p); drawPad(); updateInk();
});
function endStroke() {
  const cur = padState.cur; padState.cur = null; if (!cur) return;
  const g = padGeom();
  if (cur.length < 2 || strokeLen(cur) < 8) { drawPad(); updateInk(); return; }
  const o = cur[0];
  const rel = cur.map(p => ({ x: (p.x - o.x) / g.sc, y: (p.y - o.y) / g.sc }));
  const limb = P.resample(rel, 6).map(p => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }));
  padState.strokes[padState.which] = limb;
  if (S.me) { S.me.setLimb(padState.which, limb); S.limbDirty = true; }
  drawPad(); updateInk(); buzz(12);
}
pad.addEventListener('pointerup', endStroke); pad.addEventListener('pointercancel', endStroke);
function updateInk() {
  const g = padGeom(); const used = padState.cur ? strokeLen(padState.cur) / g.sc : 0;
  $('inkBar').style.width = Math.max(0, 100 - used / MAX_INK * 100) + '%';
}
function buzz(ms) { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} }

// ---------- screens ----------
function show(id) { for (const s of ['menu', 'lobby', 'result']) $(s).classList.toggle('hidden', s !== id); }
function raceUI(on) { $('hud').classList.toggle('hidden', !on); $('padWrap').classList.toggle('hidden', !on); if (on) setTimeout(resize, 0); }
function fmt(t) { return t.toFixed(2); }
function renderBests() {
  const b = store.get('best', {});
  const parts = [0, 1, 2].map(i => b[i] ? `שלב ${i + 1}: ${fmt(b[i])} שנ׳` : null).filter(Boolean);
  $('bests').textContent = parts.length ? 'שיאים: ' + parts.join(' · ') : '';
}

// ---------- race control ----------
function startRace(stage, countdown = 3) {
  S.stage = stage; S.track = P.makeTrack(stage);
  S.me = new P.Runner(S.track.start);
  for (const w of ['arm', 'leg']) if (padState.strokes[w]) S.me.setLimb(w, padState.strokes[w]);
  S.limbDirty = true; S.rec = []; S.recT = 0; S.finishOrder = [];
  for (const id in S.remotes) { const r = S.remotes[id]; Object.assign(r, { x: S.track.start.x, y: S.track.start.y, a: 0, ma: 0, fin: false, time: 0, tx: S.track.start.x, ty: S.track.start.y, ta: 0 }); }
  S.ghost = S.mode === 'solo' ? store.get('ghost' + stage, null) : null;
  S.countdown = countdown; S.running = false;
  $('hudStage').textContent = `שלב ${stage + 1}/3 · ${STAGE_NAMES[stage]}`;
  $('hudTime').textContent = '0.00';
  show(null); raceUI(true); $('countdown').classList.remove('hidden');
}
function finishMe() {
  const t = S.me.time; buzz([30, 40, 60]);
  if (S.mode === 'solo') {
    const best = store.get('best', {}); const nb = !best[S.stage] || t < best[S.stage];
    if (nb) { best[S.stage] = t; store.set('best', best); store.set('ghost' + S.stage, { rec: S.rec, arm: S.me.arm, leg: S.me.leg }); }
    showResult(nb ? 'שיא חדש!' : 'הגעת לקו הסיום!', t, [{ name: S.name || 'אני', time: t, color: S.myColor }].concat(S.ghost ? [{ name: 'הרוח (שיא קודם)', time: S.ghost.rec.length / 10, color: '#aaa' }] : []));
  } else {
    Net.send({ t: 'fin', id: S.myId, time: t });
    addFinish(S.myId, t);
  }
}
function addFinish(id, time) {
  if (S.finishOrder.find(f => f.id === id)) return;
  S.finishOrder.push({ id, time });
  if (id !== S.myId && S.remotes[id]) { S.remotes[id].fin = true; S.remotes[id].time = time; }
  if (S.me && S.me.finished) showMultiResult();
  if (S.finishOrder.length === 1 && S.mode === 'multi') setTimeout(() => { if (S.running && S.me && !S.me.finished) { S.me.finished = true; showMultiResult(true); } }, 45000);
}
function showMultiResult(timedOut) {
  const list = Object.values(Net.players).map(p => {
    const f = S.finishOrder.find(x => x.id === p.id); return { name: p.name, color: p.color, time: f ? f.time : null };
  }).sort((a, b) => (a.time ?? 1e9) - (b.time ?? 1e9));
  const myRank = list.findIndex(x => x.name === S.name && x.color === S.myColor) + 1;
  const mine = S.finishOrder.find(f => f.id === S.myId);
  showResult(timedOut ? 'נגמר הזמן' : (myRank === 1 ? 'ניצחת! 🏆' : `מקום ${myRank}`), mine ? mine.time : null, list);
}
function showResult(title, time, list) {
  S.running = false; raceUI(false); show('result');
  $('resTitle').textContent = title;
  $('resSub').textContent = `שלב ${S.stage + 1}/3 · ${STAGE_NAMES[S.stage]}`;
  $('resTime').textContent = time == null ? '—' : fmt(time) + 's';
  $('ranks').innerHTML = '';
  for (const r of list) { const li = document.createElement('li'); li.innerHTML = `<span class="dot" style="background:${r.color}"></span><span></span><span class="t">${r.time == null ? 'לא סיים' : fmt(r.time) + 's'}</span>`; li.children[1].textContent = r.name; $('ranks').appendChild(li); }
  const host = S.mode === 'multi' ? Net.isHost : true;
  $('btnNext').classList.toggle('hidden', !(host && S.stage < 2));
  $('btnAgain').classList.toggle('hidden', !host);
  $('btnAgain').textContent = S.mode === 'multi' ? 'עוד סיבוב' : 'שוב';
  $('btnHome').textContent = S.mode === 'multi' ? 'חזרה לחדר' : 'לתפריט';
}

// ---------- rendering ----------
const cam = { x: 0, y: 0, z: 1 };
function drawWorld(dt) {
  const c = wctx; c.setTransform(DPR, 0, 0, DPR, 0, 0);
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#1b1433'); g.addColorStop(0.45, '#5a2d6e'); g.addColorStop(0.75, '#e8646a'); g.addColorStop(1, '#ffb36b');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  // stars
  c.fillStyle = 'rgba(255,248,238,.7)';
  for (let i = 0; i < 40; i++) { const x = ((i * 137.5 - cam.x * 0.02) % W + W) % W, y = (i * 71) % (H * 0.35); c.fillRect(x, y, 1.6, 1.6); }
  // sun
  c.fillStyle = 'rgba(255,207,90,.85)'; c.beginPath(); c.arc(W * 0.8, H * 0.47, Math.min(W, H) * 0.08, 0, 7); c.fill();
  // far dunes
  dunes(c, 0.15, H * 0.5, 50, '#8a3f6b', 0.004);
  dunes(c, 0.3, H * 0.56, 36, '#5b2a5c', 0.007);
  if (!S.track) return;
  const playH = S.running || S.countdown > 0 ? H * 0.66 : H;
  cam.z = Math.min(1.25, Math.max(0.6, W / 520));
  S.t += dt; const tx = S.me ? S.me.x - W * 0.35 / cam.z : S.t * 40, ty = S.me ? S.me.y - playH * 0.52 / cam.z : 400 - H * 0.8 / cam.z;
  cam.x += S.me ? (tx - cam.x) * Math.min(1, dt * 6) : (tx - cam.x); cam.y += (ty - cam.y) * Math.min(1, dt * 4);
  c.save(); c.scale(cam.z, cam.z); c.translate(-cam.x, -cam.y);
  const vx0 = cam.x - 50, vx1 = cam.x + W / cam.z + 50, bottom = cam.y + H / cam.z + 50;
  // ground
  const pts = S.track.pts; c.beginPath(); let started = false;
  for (let i = 0; i < pts.length; i++) { const p = pts[i]; if (p[0] < vx0 - 400 || p[0] > vx1 + 400) continue; if (!started) { c.moveTo(p[0], bottom); started = true; } c.lineTo(p[0], p[1]); }
  c.lineTo(vx1 + 400, bottom); c.closePath();
  const gg = c.createLinearGradient(0, cam.y, 0, bottom); gg.addColorStop(0, '#2a2140'); gg.addColorStop(1, '#130e22');
  c.fillStyle = gg; c.fill();
  c.save(); c.clip(); c.fillStyle = 'rgba(255,255,255,.035)';
  for (let x = Math.floor(vx0 / 60) * 60; x < vx1; x += 60) c.fillRect(x, cam.y - 100, 28, H / cam.z + 300);
  c.restore();
  c.strokeStyle = '#ffcf5a'; c.lineWidth = 3; c.beginPath(); started = false;
  for (const p of pts) { if (p[0] < vx0 - 400 || p[0] > vx1 + 400) continue; started ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]); started = true; } c.stroke();
  // finish
  const fx = S.track.finish, fy = P.groundAt(S.track, fx).y;
  for (let k = 0; k < 10; k++) for (let j = 0; j < 2; j++) { c.fillStyle = (k + j) % 2 ? '#fff8ee' : '#1b1433'; c.fillRect(fx + j * 8, fy - 160 + k * 16, 8, 16); }
  c.fillStyle = '#ff5a4e'; c.beginPath(); c.moveTo(fx + 16, fy - 160); c.lineTo(fx + 60, fy - 145); c.lineTo(fx + 16, fy - 130); c.fill();
  // distance markers
  c.fillStyle = 'rgba(255,248,238,.35)'; c.font = 'bold 14px sans-serif'; c.textAlign = 'center';
  for (let m = 500; m < fx; m += 500) if (m > vx0 && m < vx1) { const gy = P.groundAt(S.track, m).y; c.fillRect(m - 1, gy - 26, 2, 26); c.fillText(Math.round(m / 10) + 'מ׳', m, gy - 32); }
  // ghost
  if (S.ghost && S.ghost.rec.length) {
    const i = Math.min(S.ghost.rec.length - 1, Math.floor((S.me ? S.me.time : 0) * 10)); const g0 = S.ghost.rec[i];
    drawRunner(c, { x: g0[0], y: g0[1], a: g0[2], ma: g0[3], arm: S.ghost.arm, leg: S.ghost.leg }, 'rgba(255,248,238,.45)', 'רוח', true);
  }
  for (const id in S.remotes) { const r = S.remotes[id]; if (!r.arm) continue; r.x += (r.tx - r.x) * Math.min(1, dt * 10); r.y += (r.ty - r.y) * Math.min(1, dt * 10); r.a += (r.ta - r.a) * Math.min(1, dt * 10); r.ma += P.C.MOTOR * dt; drawRunner(c, r, r.color, r.name, true); }
  if (S.me) drawRunner(c, S.me, S.myColor, null, false);
  c.restore();
}
function dunes(c, par, base, amp, col, f) {
  c.fillStyle = col; c.beginPath(); c.moveTo(0, H);
  for (let x = 0; x <= W + 10; x += 10) { const wx = x + cam.x * par; c.lineTo(x, base + Math.sin(wx * f) * amp + Math.sin(wx * f * 2.3 + 1) * amp * 0.4); }
  c.lineTo(W, H); c.fill();
}
function drawRunner(c, r, color, label, faded) {
  c.save(); c.translate(r.x, r.y); c.rotate(r.a); c.lineCap = 'round'; c.lineJoin = 'round';
  for (const [limb, J] of [[r.leg, P.HIP], [r.arm, P.SHOULDER]]) for (const ph of [Math.PI, 0]) {
    c.save(); c.translate(J.x, J.y); c.rotate(r.ma + ph);
    c.strokeStyle = color; c.lineWidth = ph ? 6 : 8; c.globalAlpha = ph ? 0.75 : 1;
    c.beginPath(); limb.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)); c.stroke(); c.restore();
  }
  c.globalAlpha = 1; c.strokeStyle = faded ? color : '#1b1433'; c.lineWidth = 5;
  c.beginPath(); c.moveTo(0, -18); c.lineTo(0, 18); c.stroke();
  c.fillStyle = '#fff8ee'; c.lineWidth = 3; c.beginPath(); c.arc(0, -30, 10, 0, 7); c.fill(); c.stroke();
  c.fillStyle = '#1b1433'; c.beginPath(); c.arc(4, -31, 2.6, 0, 7); c.fill();
  c.restore();
  if (label) { c.fillStyle = color; c.font = 'bold 14px sans-serif'; c.textAlign = 'center'; c.fillText(label, r.x, r.y - 52); }
}
function updateProgress() {
  const dots = $('progDots'); const all = [{ id: 'me', x: S.me ? S.me.x : 0, color: S.myColor }];
  for (const id in S.remotes) all.push({ id, x: S.remotes[id].tx, color: S.remotes[id].color });
  if (S.ghost && S.ghost.rec.length) { const i = Math.min(S.ghost.rec.length - 1, Math.floor(S.me.time * 10)); all.push({ id: 'ghost', x: S.ghost.rec[i][0], color: 'rgba(255,248,238,.5)' }); }
  const w = dots.parentElement.clientWidth;
  for (const d of all) {
    let el = dots.querySelector(`[data-id="${d.id}"]`);
    if (!el) { el = document.createElement('div'); el.className = 'pd'; el.dataset.id = d.id; dots.appendChild(el); }
    el.style.background = d.color; const f = Math.max(0, Math.min(1, (d.x - S.track.start.x) / (S.track.finish - S.track.start.x)));
    el.style.left = (f * w) + 'px'; el.style.zIndex = d.id === 'me' ? 2 : 1;
  }
  for (const el of [...dots.children]) if (!all.find(d => d.id === el.dataset.id)) el.remove();
}

// ---------- loop ----------
let last = performance.now(), acc = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (S.countdown > 0) {
    const before = Math.ceil(S.countdown); S.countdown -= dt; const after = Math.ceil(S.countdown);
    $('countdown').textContent = after > 0 ? after : 'צא!';
    if (before !== after) buzz(after > 0 ? 20 : 60);
    if (S.countdown <= 0) { S.running = true; setTimeout(() => $('countdown').classList.add('hidden'), 500); }
  }
  if (S.running && S.me) {
    acc += dt; while (acc >= 1 / 120) { S.me.step(S.track, 1 / 120); acc -= 1 / 120;
      S.recT += 1 / 120; if (S.recT >= 0.1 && !S.me.finished) { S.recT -= 0.1; S.rec.push([Math.round(S.me.x), Math.round(S.me.y), +S.me.a.toFixed(2), +S.me.ma.toFixed(2)]); } }
    $('hudTime').textContent = fmt(S.me.time);
    if (S.me.finished && !S.me._done) { S.me._done = true; finishMe(); }
    if (S.mode === 'multi') { S.sendT += dt; if (S.sendT > 0.066) { S.sendT = 0; Net.send({ t: 's', id: S.myId, x: Math.round(S.me.x), y: Math.round(S.me.y), a: +S.me.a.toFixed(2) }); }
      if (S.limbDirty) { S.limbDirty = false; Net.send({ t: 'limb', id: S.myId, arm: S.me.arm, leg: S.me.leg }); } }
    updateProgress();
  } else acc = 0;
  drawWorld(dt);
  requestAnimationFrame(frame);
}

// ---------- networking (PeerJS WebRTC, free public broker) ----------
const SERVER = new URLSearchParams(location.search).get('server') || 'wss://scribble-race-server.gamal-hametzaits.workers.dev';
const Net = {
  peer: null, ws: null, mode: 'server', hostId: null, conns: {}, isHost: false, code: '', players: {}, hostConn: null,
  prefix: 'scribble-race-oz-',
  mkCode() { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; let s = ''; for (let i = 0; i < 4; i++) s += A[Math.floor(Math.random() * A.length)]; return s; },
  opts() { return { debug: 0, config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }] } }; },
  hostP2P() {
    this.reset(); this.mode = 'p2p'; this.isHost = true; this.hostId = 'h'; this.code = this.mkCode(); S.myId = 'h'; S.myColor = COLORS[0];
    lobbyMsg('מתחבר לשרת…');
    this.peer = new Peer(this.prefix + this.code, this.opts());
    this.peer.on('open', () => { this.players = { h: { id: 'h', name: S.name, color: COLORS[0] } }; showLobby(); lobbyMsg('ממתין לשחקנים…'); });
    this.peer.on('connection', conn => {
      conn.on('open', () => {
        const used = Object.values(this.players).map(p => p.color); const free = COLORS.find(c => !used.includes(c));
        if (!free || S.running) { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 300); return; }
        const id = 'p' + Math.random().toString(36).slice(2, 7); conn._id = id; this.conns[id] = conn;
        conn.on('data', d => this.onHostData(conn, d));
        conn.on('close', () => { delete this.conns[id]; delete this.players[id]; delete S.remotes[id]; this.broadcastPlayers(); renderPlayers(); });
        conn.send({ t: 'welcome', id, color: free, code: this.code });
        this.players[id] = { id, name: '...', color: free };
      });
    });
    this.peer.on('error', e => { if (e.type === 'unavailable-id') return this.hostP2P(); lobbyMsg('שגיאת חיבור: ' + e.type); menuMsg('שגיאת חיבור: ' + e.type); });
    this.peer.on('disconnected', () => { try { this.peer.reconnect(); } catch (e) {} });
  },
  onHostData(conn, d) {
    if (d.t === 'hello') { this.players[conn._id].name = String(d.name || 'שחקן').slice(0, 12); this.broadcastPlayers(); renderPlayers(); return; }
    if (d.id !== conn._id) return;
    this.relay(d, conn._id); onData(d);
  },
  relay(d, except) { for (const id in this.conns) if (id !== except) try { this.conns[id].send(d); } catch (e) {} },
  broadcastPlayers() { this.relay({ t: 'players', players: this.players }); syncRemotes(); },
  joinP2P(code) {
    this.reset(); this.mode = 'p2p'; this.isHost = false; this.hostId = 'h'; this.code = code;
    menuMsg('מתחבר לחדר ' + code + '…');
    this.peer = new Peer(this.opts());
    const fail = setTimeout(() => menuMsg('לא הצלחתי להתחבר. בדוק את הקוד, או נסו שניכם על אותה רשת Wi-Fi.'), 12000);
    this.peer.on('open', () => {
      const conn = this.peer.connect(this.prefix + code, { reliable: true }); this.hostConn = conn;
      conn.on('open', () => { clearTimeout(fail); conn.send({ t: 'hello', name: S.name }); });
      conn.on('data', d => {
        if (d.t === 'welcome') { S.myId = d.id; S.myColor = d.color; showLobby(); return; }
        if (d.t === 'full') { menuMsg('החדר מלא או שהמרוץ כבר התחיל'); return; }
        if (d.t === 'players') { this.players = d.players; syncRemotes(); renderPlayers(); return; }
        onData(d);
      });
      conn.on('close', () => { if (S.mode === 'multi') { leaveToMenu(); menuMsg('המארח סגר את החדר'); } });
    });
    this.peer.on('error', e => { clearTimeout(fail); menuMsg(e.type === 'peer-unavailable' ? 'לא נמצא חדר עם הקוד הזה' : 'שגיאת חיבור: ' + e.type); });
  },
  // ---- online server (Cloudflare Worker + Durable Object) ----
  wsConnect(code, create, onFail) {
    this.reset(); this.mode = 'server'; this.code = code;
    let opened = false, welcomed = false;
    const ws = new WebSocket(SERVER + '/room/' + code + (create ? '?create=1' : ''));
    this.ws = ws;
    const t = setTimeout(() => { if (!welcomed) { try { ws.close(); } catch (e) {} onFail('timeout'); } }, 7000);
    ws.onopen = () => { opened = true; ws.send(JSON.stringify({ t: 'hello', name: S.name })); };
    ws.onmessage = ev => {
      let d; try { d = JSON.parse(ev.data); } catch (e) { return; }
      if (d.t === 'taken' || d.t === 'noroom' || d.t === 'full' || d.t === 'busy') { clearTimeout(t); welcomed = true; this.ws = null; onFail(d.t); return; }
      if (d.t === 'welcome') { clearTimeout(t); welcomed = true; S.myId = d.id; S.myColor = d.color; return; }
      if (d.t === 'players') { this.players = d.players; this.hostId = d.host; this.isHost = d.host === S.myId; syncRemotes(); if (S.mode !== 'multi' || !$('lobby').classList.contains('hidden')) showLobby(); else renderPlayers(); return; }
      if (d.t === 'pong') return;
      onData(d);
    };
    ws.onclose = () => { if (this.ws === ws && welcomed && S.mode === 'multi') { leaveToMenu(); menuMsg('החיבור לשרת נותק'); } else if (!welcomed) { clearTimeout(t); onFail('neterr'); } };
    this.pingT = setInterval(() => { if (ws.readyState === 1) ws.send('{"t":"ping"}'); }, 25000);
  },
  host(tries = 0) {
    lobbyMsg(''); menuMsg('מתחבר לשרת…');
    this.wsConnect(this.mkCode(), true, why => {
      if (why === 'taken' && tries < 5) return this.host(tries + 1);
      menuMsg('השרת לא זמין, עובר לחיבור ישיר…'); this.hostP2P();
    });
  },
  join(code) {
    menuMsg('מתחבר לחדר ' + code + '…');
    this.wsConnect(code, false, why => {
      if (why === 'noroom') { menuMsg('בודק חדר בחיבור ישיר…'); return this.joinP2P(code); }
      if (why === 'full' || why === 'busy') return menuMsg('החדר מלא או שהמרוץ כבר התחיל');
      menuMsg('השרת לא זמין, מנסה חיבור ישיר…'); this.joinP2P(code);
    });
  },
  send(d) { if (this.mode === 'server') { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(d)); return; } if (this.isHost) this.relay(d); else if (this.hostConn && this.hostConn.open) this.hostConn.send(d); },
  reset() { try { this.peer && this.peer.destroy(); } catch (e) {} try { this.ws && this.ws.close(); } catch (e) {} this.ws = null; clearInterval(this.pingT); this.peer = null; this.conns = {}; this.players = {}; this.hostConn = null; S.remotes = {}; }
};
function syncRemotes() {
  for (const id in Net.players) if (id !== S.myId && !S.remotes[id]) S.remotes[id] = { x: 0, y: 0, a: 0, ma: 0, tx: 0, ty: 0, ta: 0, arm: null, leg: null };
  for (const id in S.remotes) { if (!Net.players[id]) { delete S.remotes[id]; continue; } S.remotes[id].name = Net.players[id].name; S.remotes[id].color = Net.players[id].color; }
}
function onData(d) {
  if (d.t === 'start') { startRace(d.stage, 3); S.limbDirty = true; return; }
  if (d.t === 'lobby') { raceUI(false); S.running = false; S.track = null; showLobby(); return; }
  const r = S.remotes[d.id]; if (!r) return;
  if (d.t === 's') { r.tx = d.x; r.ty = d.y; r.ta = d.a; if (!r.arm) { r.x = d.x; r.y = d.y; } }
  else if (d.t === 'limb') { r.arm = d.arm; r.leg = d.leg; }
  else if (d.t === 'fin') addFinish(d.id, d.time);
}
function showLobby() {
  S.mode = 'multi'; show('lobby'); $('roomCode').textContent = Net.code; renderPlayers();
  $('netMode').textContent = Net.mode === 'server' ? '🌐 אונליין דרך השרת · אפשר לשחק מכל מקום' : '📡 חיבור ישיר (השרת לא זמין)';
  $('btnStart').classList.toggle('hidden', !Net.isHost); $('stagePick').classList.toggle('hidden', !Net.isHost);
  if (!Net.isHost) lobbyMsg('ממתין שהמארח יתחיל…');
}
function renderPlayers() {
  const ul = $('players'); ul.innerHTML = '';
  if (Net.isHost && S.mode === 'multi') lobbyMsg(Object.keys(Net.players).length >= 2 ? 'כולם כאן? לחץ התחל' : 'ממתין לשחקנים…');
  for (const p of Object.values(Net.players)) { const li = document.createElement('li'); li.innerHTML = `<span class="dot" style="background:${p.color}"></span><span></span>`; li.children[1].textContent = p.name + (p.id === S.myId ? ' (אני)' : '') + (p.id === Net.hostId ? ' · מארח' : ''); ul.appendChild(li); }
}
function lobbyMsg(t) { $('lobbyMsg').textContent = t; }
function menuMsg(t) { $('menuMsg').textContent = t; }
function leaveToMenu() { Net.reset(); S.mode = 'menu'; S.running = false; S.track = null; S.me = null; raceUI(false); show('menu'); renderBests(); }

// ---------- buttons ----------
function needName() { const n = $('nameIn').value.trim(); if (!n) { $('nameIn').focus(); menuMsg('מה השם שלך?'); return false; } S.name = n; store.set('name', n); return true; }
$('nameIn').value = S.name;
$('btnSolo').onclick = () => { if (!needName()) return; S.mode = 'solo'; S.myColor = COLORS[0]; startRace(0); };
$('btnHost').onclick = () => { if (!needName()) return; Net.host(); };
$('btnJoinOpen').onclick = () => { $('joinBox').classList.toggle('hidden'); $('codeIn').focus(); };
$('btnJoin').onclick = () => { if (!needName()) return; const c = $('codeIn').value.trim().toUpperCase(); if (c.length !== 4) return menuMsg('הקוד הוא 4 אותיות'); Net.join(c); };
let pickedStage = 0;
document.querySelectorAll('.st').forEach(b => b.onclick = () => { pickedStage = +b.dataset.s; document.querySelectorAll('.st').forEach(x => x.classList.toggle('on', x === b)); });
$('btnStart').onclick = () => { if (Object.keys(Net.players).length < 2) { lobbyMsg('צריך לפחות עוד שחקן אחד'); return; } Net.send({ t: 'start', stage: pickedStage }); startRace(pickedStage, 3); };
$('btnLeave').onclick = leaveToMenu;
$('hudExit').onclick = () => { if (S.mode === 'multi') { if (Net.isHost) { Net.send({ t: 'lobby' }); onData({ t: 'lobby' }); } else leaveToMenu(); } else leaveToMenu(); };
$('btnNext').onclick = () => { const s = Math.min(2, S.stage + 1); if (S.mode === 'multi') { Net.send({ t: 'start', stage: s }); } startRace(s); };
$('btnAgain').onclick = () => { if (S.mode === 'multi') Net.send({ t: 'start', stage: S.stage }); startRace(S.stage); };
$('btnHome').onclick = () => { if (S.mode === 'multi') { if (Net.isHost) Net.send({ t: 'lobby' }); onData({ t: 'lobby' }); } else leaveToMenu(); };
window.addEventListener('scribble-back', () => { if (S.running || S.countdown > 0) $('hudExit').click(); else if (!$('lobby').classList.contains('hidden')) leaveToMenu(); else if (S.mode !== 'menu') $('btnHome').click(); });

// menu background: demo track
S.track = P.makeTrack(0); S.me = null;
resize(); renderBests(); requestAnimationFrame(frame);
window.__S = S; window.__Net = Net;
})();
