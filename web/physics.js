// Scribble race physics: one rigid body (torso+head) with motor-driven drawn limbs.
(function(root){
const C={UPK:150, UPD:15, IM:6000, MOTOR:5.2}; const G = 1400, MU = 0.95, HIP = {x:0,y:18}, SHOULDER = {x:0,y:-16};
function rng(seed){ let s = seed>>>0 || 1; return ()=>{ s^=s<<13; s^=s>>>17; s^=s<<5; return ((s>>>0)%100000)/100000; }; }
// terrain as polyline points [x,y], y down. Steps are near-vertical (2px wide).
// A vertical course: long climb, staggered ledges, hurdles and short ravines.
// Terrain is deterministic per stage, so every racer sees the same course.
function makeTrack(stage){
  const r = rng(7919 + Math.imul(stage + 1, 104729));
  const pts = [[-400, 400], [300, 400]], hazards = [];
  let x = 300, y = 400;
  const sections = 7 + Math.min(3, Math.floor(stage / 2000));
  const kind = stage % 3; // climb / hurdles / mixed
  for (let i = 0; i < sections; i++) {
    // A sloping climb to a higher shelf. Camera tracks height rather than pinning y.
    const climb = (kind === 0 ? 68 : 46) + r() * 24;
    const run = 250 + r() * 100;
    for (let j = 1; j <= 8; j++) pts.push([x + run * j / 8, y - climb * j / 8]);
    x += run; y -= climb;
    const shelf = 115 + r() * 75; x += shelf; pts.push([x,y]);
    // Hurdles are part of the collision surface, not decorative sprites.
    // A short flat lead-in makes a timed jump useful without being mandatory.
    if (kind !== 0 || i % 2 === 1) {
      const h = 33 + r() * 12, width = 38 + r() * 22;
      hazards.push({ x, y, h, type: 'hurdle' });
      pts.push([x + 2, y - h], [x + width, y - h], [x + width + 2, y]);
      x += width + 2;
      x += 130; pts.push([x, y]);
    }
    if (kind === 2 && i % 2 === 0) {
      const gap = 55 + r() * 18;
      hazards.push({ x, y, w: gap, type: 'gap' });
      pts.push([x + 2, y + 90], [x + gap, y + 90], [x + gap + 2, y]);
      x += gap + 2; x += 100; pts.push([x,y]);
    }
  }
  x += 220; pts.push([x,y]);
  const finish = x - 85;
  pts.push([x + 900,y]);
  return {pts, hazards, finish, start:{x:120,y:330}, theme:stage, dif:Math.min(4,1.5 + stage/3000), climb:400-y};
}
function groundAt(track, px){ // returns y of surface (top) at x (highest among segments covering x)
  const p = track.pts; let lo=0, hi=p.length-1;
  while (hi-lo>1){ const m=(lo+hi)>>1; if (p[m][0] <= px) lo=m; else hi=m; }
  const a=p[lo], b=p[hi]; const t = (b[0]-a[0])>1e-6 ? (px-a[0])/(b[0]-a[0]) : 0;
  return {y: a[1]+(b[1]-a[1])*Math.max(0,Math.min(1,t)), i:lo};
}
function contact(track, px, py){ // if below surface: nearest segment normal+depth
  const g = groundAt(track, px); if (py < g.y - 0.5) return null;
  const p = track.pts; let best=null;
  for (let k=Math.max(0,g.i-3); k<Math.min(p.length-1,g.i+4); k++){
    const a=p[k], b=p[k+1], dx=b[0]-a[0], dy=b[1]-a[1], L2=dx*dx+dy*dy; if (L2<1e-6) continue;
    let t=((px-a[0])*dx+(py-a[1])*dy)/L2; t=Math.max(0,Math.min(1,t));
    const cx=a[0]+dx*t, cy=a[1]+dy*t, ddx=px-cx, ddy=py-cy, d=Math.hypot(ddx,ddy);
    const L=Math.sqrt(L2); const nx=dy/L, ny=-dx/L; // left normal, points up for rightward segments
    if (!best || d<best.d) best={d, nx, ny};
  }
  if (!best) return null; const depth = Math.max(best.d, 0.5);
  return {nx:best.nx, ny:best.ny, depth};
}
function resample(stroke, step){ // stroke points relative to joint
  const out=[stroke[0]]; let acc=0;
  for (let i=1;i<stroke.length;i++){ let a=out[out.length-1], b=stroke[i], d=Math.hypot(b.x-a.x,b.y-a.y);
    while (d>=step){ const t=step/d; a={x:a.x+(b.x-a.x)*t, y:a.y+(b.y-a.y)*t}; out.push(a); d=Math.hypot(b.x-a.x,b.y-a.y); } }
  return out;
}
function defaultLimb(){ return [{x:0,y:0},{x:0,y:14},{x:0,y:28},{x:6,y:40}]; }
class Runner{
  constructor(start){ this.x=start.x; this.y=start.y; this.a=0; this.vx=0; this.vy=0; this.w=0; this.ma=0;
    this.arm=defaultLimb(); this.leg=defaultLimb(); this.time=0; this.finished=false; this.grounded=false; this.jumpQueued=false; this.jumpCooldown=0; this.m=6; this.I=6*C.IM; }
  setLimb(which, pts){ this[which]=pts.length>1?pts:defaultLimb(); }
  bodyPoints(){ // local points with joint info: [lx,ly,jx,jy,motorFlag]
    const P=[]; for (let y=-18;y<=18;y+=6) P.push([0,y,0,0,0]);
    for (let k=0;k<10;k++){ const t=k/10*Math.PI*2; P.push([Math.cos(t)*10, -30+Math.sin(t)*10,0,0,0]); }
    for (const [limb,J] of [[this.arm,SHOULDER],[this.leg,HIP]]) for (const ph of [0,Math.PI]){
      const c=Math.cos(this.ma+ph), s=Math.sin(this.ma+ph);
      for (let i=1;i<limb.length;i++){ const q=limb[i]; P.push([J.x+q.x*c-q.y*s, J.y+q.x*s+q.y*c, J.x, J.y, 1]); }
    }
    return P;
  }
  jump(){ this.jumpQueued = true; }
  step(track, dt){
    this.jumpCooldown = Math.max(0, this.jumpCooldown - dt);
    if (this.jumpQueued && this.grounded && this.jumpCooldown === 0) {
      this.vy = -560; this.vx += 125; this.jumpCooldown = 0.42; this.grounded = false;
    }
    this.jumpQueued = false;
    if (!this.finished) this.time += dt;
    this.ma += C.MOTOR*dt; this.vy += G*dt;
    this.vx*=0.9995;
    { let a=Math.atan2(Math.sin(this.a),Math.cos(this.a)); this.w += (-a*C.UPK - this.w*C.UPD)*dt; }
    const c=Math.cos(this.a), s=Math.sin(this.a), P=this.bodyPoints(), invM=1/this.m, invI=1/this.I;
    const W=P.map(p=>{ const rx=p[0]*c-p[1]*s, ry=p[0]*s+p[1]*c; const jx=p[2]*c-p[3]*s, jy=p[2]*s+p[3]*c;
      return {rx, ry, mvx: p[4]? -C.MOTOR*(ry-jy):0, mvy: p[4]? C.MOTOR*(rx-jx):0}; });
    let push={x:0,y:0,d:0}; const cts=[]; this.grounded=false;
    for (const q of W){ const ct=contact(track, this.x+q.rx, this.y+q.ry); if (ct){ if (ct.ny < -0.45 && ct.depth < 30) this.grounded=true; cts.push([q,ct]); if (ct.depth>push.d) push={x:ct.nx,y:ct.ny,d:ct.depth}; } }
    for (let it=0; it<6; it++) for (const [q,ct] of cts){
      const {rx,ry}=q, nx=ct.nx, ny=ct.ny;
      let vpx=this.vx - this.w*ry + q.mvx, vpy=this.vy + this.w*rx + q.mvy;
      const vn=vpx*nx+vpy*ny; if (vn>0) continue;
      const rn=rx*ny-ry*nx, jn=-vn/(invM+rn*rn*invI);
      this.vx+=jn*nx*invM; this.vy+=jn*ny*invM; this.w+=rn*jn*invI;
      vpx=this.vx - this.w*ry + q.mvx; vpy=this.vy + this.w*rx + q.mvy;
      const tx=-ny, ty=nx, vt=vpx*tx+vpy*ty, rt=rx*ty-ry*tx;
      let jt=-vt/(invM+rt*rt*invI); const mx=MU*jn; jt=Math.max(-mx,Math.min(mx,jt));
      this.vx+=jt*tx*invM; this.vy+=jt*ty*invM; this.w+=rt*jt*invI;
    }
    const sp=Math.hypot(this.vx,this.vy); if (sp>1400){ this.vx*=1400/sp; this.vy*=1400/sp; }
    this.w=Math.max(-14,Math.min(14,this.w));
    this.x+=this.vx*dt; this.y+=this.vy*dt; this.a+=this.w*dt;
    if (push.d>0){ const k=Math.min(push.d,8)*0.6; this.x+=push.x*k; this.y+=push.y*k; }
    if (this.x>=track.finish && !this.finished) this.finished=true;
    if (this.y>groundAt(track,this.x).y+420){ const g=groundAt(track,Math.max(120,this.x-150)); this.x=Math.max(120,this.x-150); this.y=g.y-80; this.vx=this.vy=this.w=0; this.a=0; }
  }
}
const api={makeTrack, groundAt, Runner, resample, SHOULDER, HIP, C};
if (typeof module!=='undefined') module.exports=api; else root.Phys=api;
})(this);
