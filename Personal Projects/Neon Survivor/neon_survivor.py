# ==========================================================
#  NEON SURVIVOR  -  a top-down arcade shooter for Google Colab
#  Paste this whole thing into ONE Colab cell and press Run.
#  Then CLICK on the game to give it keyboard focus.
# ==========================================================
from IPython.display import HTML, display

GAME_HTML = r"""
<div id="ns-wrap" style="display:flex;flex-direction:column;align-items:center;background:#05060f;padding:12px;border-radius:12px;font-family:monospace;color:#9fe9ff">
  <canvas id="ns-c" width="960" height="600" tabindex="0"
    style="width:100%;max-width:960px;aspect-ratio:16/10;background:#05060f;border:2px solid #1de9ff;border-radius:8px;box-shadow:0 0 25px #1de9ff66;outline:none;cursor:none"></canvas>
  <div style="margin-top:8px;font-size:13px;text-align:center;opacity:.85">
    Move: <b>WASD / Arrows</b> &nbsp;|&nbsp; Aim: <b>Mouse</b> &nbsp;|&nbsp; Shoot: <b>Hold Click</b> (or <b>F</b> = auto-fire)
    &nbsp;|&nbsp; Dash: <b>Space / Shift</b> &nbsp;|&nbsp; Pause: <b>P</b> &nbsp;|&nbsp; Sound: <b>M</b>
  </div>
</div>
<script>
(() => {
const cv = document.getElementById('ns-c'), ctx = cv.getContext('2d');
const W = 960, H = 600, TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

// ---------------- input ----------------
let keys = {}, mouse = { x: W / 2, y: H / 2, down: false };
function pos(e) { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height }; }
cv.addEventListener('mousemove', e => { const p = pos(e); mouse.x = p.x; mouse.y = p.y; });
cv.addEventListener('mousedown', e => { cv.focus(); audioInit(); const p = pos(e); mouse.x = p.x; mouse.y = p.y; mouse.down = true; onClick(p); e.preventDefault(); });
window.addEventListener('mouseup', () => mouse.down = false);
cv.addEventListener('contextmenu', e => e.preventDefault());
const BLOCK = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'Tab'];
cv.addEventListener('keydown', e => { if (BLOCK.includes(e.code)) e.preventDefault(); if (!keys[e.code]) onKey(e.code); keys[e.code] = true; });
cv.addEventListener('keyup', e => keys[e.code] = false);
cv.addEventListener('blur', () => { keys = {}; mouse.down = false; if (state === 'play') state = 'paused'; });

// ---------------- audio ----------------
let AC = null, muted = false; const lastS = {};
function audioInit() { if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } if (AC && AC.state === 'suspended') AC.resume(); }
const SND = { shoot: ['square', 900, 420, .05, .025], hit: ['triangle', 320, 120, .07, .06], boom: ['sawtooth', 170, 35, .28, .12],
  pick: ['sine', 900, 1600, .07, .05], lvl: ['triangle', 440, 1400, .4, .12], hurt: ['sawtooth', 220, 50, .35, .15],
  dash: ['sine', 300, 1100, .14, .08], eshot: ['square', 500, 250, .08, .03], wave: ['triangle', 220, 880, .5, .1] };
function sfx(n) {
  if (!AC || muted) return; const t = AC.currentTime;
  if (lastS[n] && t - lastS[n] < 0.035) return; lastS[n] = t;
  const [w, f1, f2, d, v] = SND[n], o = AC.createOscillator(), g = AC.createGain();
  o.type = w; o.frequency.setValueAtTime(f1, t); o.frequency.exponentialRampToValueAtTime(f2, t + d);
  g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(.0001, t + d);
  o.connect(g); g.connect(AC.destination); o.start(t); o.stop(t + d + .02);
}

// ---------------- data ----------------
const ET = {
  chaser:   { r: 11, hp: 20,   spd: 125, col: '#ff3e8a', xp: 1,  sc: 10,   dmg: 12 },
  dasher:   { r: 10, hp: 16,   spd: 80,  col: '#ffd23e', xp: 2,  sc: 20,   dmg: 15 },
  shooter:  { r: 13, hp: 30,   spd: 90,  col: '#b46cff', xp: 3,  sc: 30,   dmg: 10 },
  splitter: { r: 16, hp: 40,   spd: 80,  col: '#3eff9b', xp: 2,  sc: 25,   dmg: 14 },
  mini:     { r: 8,  hp: 10,   spd: 160, col: '#3eff9b', xp: 1,  sc: 5,    dmg: 8 },
  tank:     { r: 22, hp: 120,  spd: 55,  col: '#ff8a2e', xp: 5,  sc: 50,   dmg: 25 },
  boss:     { r: 50, hp: 1400, spd: 45,  col: '#ff2e4d', xp: 40, sc: 1000, dmg: 35 },
};
const UPS = [
  { id: 'dmg',    name: 'Overcharge',      desc: ['+30% damage'],                     fn: () => P.dmg *= 1.3 },
  { id: 'rate',   name: 'Rapid Fire',      desc: ['+20% fire rate'],                  fn: () => P.fire *= 0.83 },
  { id: 'multi',  name: 'Split Shot',      desc: ['+1 projectile'],                   fn: () => P.multi++, ok: () => P.multi < 7 },
  { id: 'pierce', name: 'Piercing Rounds', desc: ['Bullets pass through', '+1 enemy'],fn: () => P.pierce++ },
  { id: 'spd',    name: 'Thrusters',       desc: ['+12% move speed'],                 fn: () => P.spd *= 1.12, ok: () => P.spd < 450 },
  { id: 'hp',     name: 'Hull Plating',    desc: ['+25 max HP', 'and full repair'],   fn: () => { P.maxHp += 25; P.hp = P.maxHp; } },
  { id: 'drone',  name: 'Orbit Drone',     desc: ['Drone circles you,', 'shreds enemies', '& blocks bullets'], fn: () => P.drones++, ok: () => P.drones < 6 },
  { id: 'magnet', name: 'Tractor Beam',    desc: ['+50% pickup range'],               fn: () => P.magnet *= 1.5, ok: () => P.magnet < 500 },
  { id: 'crit',   name: 'Targeting AI',    desc: ['+8% crit chance', '(crits deal 2x)'], fn: () => P.crit += 0.08, ok: () => P.crit < 0.6 },
  { id: 'regen',  name: 'Nanobots',        desc: ['Regenerate', '+1.5 HP / second'],  fn: () => P.regen += 1.5 },
  { id: 'dash',   name: 'Blink Core',      desc: ['-25% dash cooldown'],              fn: () => P.dashCd *= 0.75, ok: () => P.dashCd > 0.4 },
  { id: 'bspd',   name: 'Railgun Coils',   desc: ['+25% bullet speed', '& range'],    fn: () => P.bspd *= 1.25, ok: () => P.bspd < 1500 },
];

// ---------------- state ----------------
let state = 'menu', P, bullets, ebullets, enemies, parts, gems, texts, wave, toSpawn, spawnT, waveWait, score, kills, shake = 0, time = 0, flash = 0;
let banner = '', bannerT = 0, choices = [], pendingLv = 0, autoFire = false, newBest = false, best = 0;
parts = []; texts = [];
try { best = +localStorage.getItem('neon_survivor_best') || 0; } catch (e) {}
const stars = [...Array(140)].map(() => ({ x: rand(0, W), y: rand(0, H), z: rand(0.2, 1) }));

function reset() {
  P = { x: W / 2, y: H / 2, vx: 0, vy: 0, r: 12, hp: 100, maxHp: 100, spd: 260, fire: 0.16, fcd: 0, dmg: 10, bspd: 640, multi: 1, pierce: 0,
        inv: 0, dash: 0, dashCd: 1.3, dashT: 0, xp: 0, next: 8, lvl: 1, magnet: 90, drones: 0, regen: 0, crit: 0.05, ang: 0, recoil: 0, ups: {} };
  bullets = []; ebullets = []; enemies = []; parts = []; gems = []; texts = [];
  wave = 0; score = 0; kills = 0; shake = 0; flash = 0; pendingLv = 0; time = 0;
  nextWave();
}
function nextWave() {
  wave++; const boss = wave % 5 === 0;
  toSpawn = boss ? 4 + wave : 6 + wave * 3; spawnT = 1; waveWait = 0;
  banner = boss ? 'BOSS WAVE ' + wave : 'WAVE ' + wave; bannerT = 2.2; sfx('wave');
  if (boss) spawnEnemy('boss', W / 2, -60);
}
function pickType() {
  const pool = [['chaser', 1]];
  if (wave >= 2) pool.push(['dasher', .5]);
  if (wave >= 3) pool.push(['shooter', .4]);
  if (wave >= 4) pool.push(['splitter', .45]);
  if (wave >= 6) pool.push(['tank', .3 + wave * 0.01]);
  let x = Math.random() * pool.reduce((a, b) => a + b[1], 0);
  for (const [n, w] of pool) { x -= w; if (x <= 0) return n; }
  return 'chaser';
}
function spawnEnemy(type, x, y) {
  const t = ET[type];
  if (x === undefined) {
    const s = Math.random() * 4 | 0, m = 40;
    [x, y] = s === 0 ? [rand(0, W), -m] : s === 1 ? [W + m, rand(0, H)] : s === 2 ? [rand(0, W), H + m] : [-m, rand(0, H)];
  }
  const hpS = type === 'boss' ? 1 + (wave / 5 - 1) * 0.8 : 1 + (wave - 1) * 0.13;
  const e = { type, x, y, vx: 0, vy: 0, r: t.r, hp: t.hp * hpS, maxHp: t.hp * hpS, spd: t.spd * (1 + Math.min(wave, 25) * 0.015),
              col: t.col, xp: t.xp, sc: t.sc, dmg: t.dmg, t: rand(0, 1.2), hitT: 0, cd: rand(1, 2), lx: 0, ly: 0, pat: 0, droneT: 0 };
  enemies.push(e); return e;
}

// ---------------- fx ----------------
function burst(x, y, col, n, sp) {
  for (let i = 0; i < n && parts.length < 1800; i++) {
    const a = rand(0, TAU), s = rand(sp * 0.2, sp);
    parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(.3, .8), max: .8, col, size: rand(1.5, 3.5) });
  }
}
function popText(x, y, s, c) { texts.push({ x, y, s, c, t: 0.7 }); }

// ---------------- combat ----------------
function shoot() {
  const n = P.multi, spread = 0.11;
  for (let i = 0; i < n; i++) {
    const a = P.ang + (i - (n - 1) / 2) * spread + rand(-0.02, 0.02);
    bullets.push({ x: P.x + Math.cos(a) * 16, y: P.y + Math.sin(a) * 16, vx: Math.cos(a) * P.bspd, vy: Math.sin(a) * P.bspd, life: 0.9, pierce: P.pierce, hit: new Set() });
  }
  P.recoil = 1; sfx('shoot');
}
function hurtEnemy(e, d, kx, ky) {
  if (e.dead) return;
  const crit = Math.random() < P.crit; if (crit) d *= 2;
  e.hp -= d; e.hitT = 0.08;
  if (e.type !== 'boss') { e.vx += kx; e.vy += ky; }
  popText(e.x + rand(-6, 6), e.y - e.r, Math.round(d) + (crit ? '!' : ''), crit ? '#ffe14d' : '#ffffff');
  burst(e.x, e.y, e.col, 3, 140); sfx('hit');
  if (e.hp <= 0) killEnemy(e);
}
function killEnemy(e) {
  e.dead = true; kills++;
  const pts = e.sc * (1 + Math.floor(wave / 5)); score += pts;
  const big = e.type === 'boss';
  burst(e.x, e.y, e.col, big ? 120 : 20, big ? 500 : 280); burst(e.x, e.y, '#ffffff', big ? 40 : 5, big ? 300 : 150);
  shake = Math.max(shake, big ? 25 : e.type === 'tank' ? 8 : 4); sfx('boom');
  for (let i = 0; i < e.xp; i++) gems.push({ x: e.x, y: e.y, vx: rand(-120, 120), vy: rand(-120, 120), kind: 'xp', t: 0 });
  if (Math.random() < 0.035 || big) gems.push({ x: e.x, y: e.y, vx: rand(-60, 60), vy: rand(-60, 60), kind: 'hp', t: 0 });
  if (e.type === 'splitter') for (let k = 0; k < 3; k++) spawnEnemy('mini', e.x + rand(-12, 12), e.y + rand(-12, 12));
  if (big) { popText(e.x, e.y - 60, 'BOSS DESTROYED  +' + pts, '#ff2e4d'); flash = 0.4; }
}
function damagePlayer(d) {
  if (P.inv > 0 || state !== 'play') return;
  P.hp -= d; P.inv = 0.8; shake = Math.max(shake, 12); flash = 0.3; sfx('hurt');
  burst(P.x, P.y, '#1de9ff', 25, 260);
  if (P.hp <= 0) { P.hp = 0; gameOver(); }
}
function gameOver() {
  state = 'over'; burst(P.x, P.y, '#1de9ff', 200, 600); burst(P.x, P.y, '#ffffff', 80, 400); shake = 30;
  newBest = score > best;
  if (newBest) { best = score; try { localStorage.setItem('neon_survivor_best', best); } catch (e) {} }
}
function fireE(x, y, a, s) { ebullets.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 5 }); sfx('eshot'); }
function gainXp(v) {
  P.xp += v;
  while (P.xp >= P.next) { P.xp -= P.next; P.lvl++; P.next = Math.floor(P.next * 1.3 + 4); pendingLv++; }
}
function openLevelUp() {
  const avail = UPS.filter(u => !u.ok || u.ok()); choices = [];
  while (choices.length < 3 && avail.length) choices.push(avail.splice(Math.random() * avail.length | 0, 1)[0]);
  state = 'levelup'; sfx('lvl'); mouse.down = false;
}
function choose(i) {
  const u = choices[i]; if (!u) return;
  u.fn(); P.ups[u.id] = (P.ups[u.id] || 0) + 1; pendingLv--;
  popText(P.x, P.y - 30, u.name + '!', '#1de9ff'); burst(P.x, P.y, '#1de9ff', 40, 300);
  if (pendingLv > 0) openLevelUp(); else state = 'play';
}
function doDash() {
  if (P.dash > 0) return;
  let dx = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  let dy = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0);
  if (!dx && !dy) { dx = Math.cos(P.ang); dy = Math.sin(P.ang); }
  const l = Math.hypot(dx, dy); P.vx = dx / l * 820; P.vy = dy / l * 820;
  P.dashT = 0.15; P.inv = Math.max(P.inv, 0.25); P.dash = P.dashCd; sfx('dash');
}

// ---------------- controls ----------------
function onKey(c) {
  if (c === 'KeyM') { muted = !muted; return; }
  if (state === 'menu' && (c === 'Enter' || c === 'Space')) { audioInit(); reset(); state = 'play'; return; }
  if (state === 'over' && (c === 'KeyR' || c === 'Enter')) { reset(); state = 'play'; return; }
  if (state === 'levelup') { const i = { Digit1: 0, Digit2: 1, Digit3: 2, Numpad1: 0, Numpad2: 1, Numpad3: 2 }[c]; if (i !== undefined) choose(i); return; }
  if (c === 'KeyP' || c === 'Escape') { if (state === 'play') state = 'paused'; else if (state === 'paused') state = 'play'; return; }
  if (state !== 'play') return;
  if (c === 'Space' || c === 'ShiftLeft' || c === 'ShiftRight') doDash();
  if (c === 'KeyF') { autoFire = !autoFire; popText(P.x, P.y - 30, 'AUTO-FIRE ' + (autoFire ? 'ON' : 'OFF'), '#ffd23e'); }
}
function cardRect(i) { return { x: W / 2 - 400 + i * 275, y: 200, w: 250, h: 190 }; }
function onClick(p) {
  if (state === 'menu') { reset(); state = 'play'; mouse.down = false; }
  else if (state === 'over') { if (time > 0.8) { reset(); state = 'play'; mouse.down = false; } }
  else if (state === 'paused') { state = 'play'; mouse.down = false; }
  else if (state === 'levelup') {
    for (let i = 0; i < choices.length; i++) { const r = cardRect(i); if (p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h) choose(i); }
    mouse.down = false;
  }
}

// ---------------- update ----------------
function updateFx(dt) {
  time += dt; shake = Math.max(0, shake - dt * 40); flash = Math.max(0, flash - dt);
  for (const p of parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.92; p.vy *= 0.92; p.life -= dt; }
  parts = parts.filter(p => p.life > 0);
  for (const t of texts) { t.y -= 40 * dt; t.t -= dt; }
  texts = texts.filter(t => t.t > 0);
  for (const s of stars) { s.y += s.z * 20 * dt; if (s.y > H) { s.y = 0; s.x = rand(0, W); } }
}
function update(dt) {
  updateFx(dt);
  if (bannerT > 0) bannerT -= dt;

  // waves
  if (toSpawn > 0) {
    spawnT -= dt;
    if (spawnT <= 0) { const n = wave > 8 && Math.random() < .3 ? 2 : 1; for (let i = 0; i < n && toSpawn > 0; i++, toSpawn--) spawnEnemy(pickType()); spawnT = Math.max(0.18, 0.85 - wave * 0.04); }
  } else if (enemies.length === 0) {
    waveWait += dt;
    if (waveWait > 1.5) { score += wave * 100; popText(W / 2, H / 2 + 40, 'WAVE CLEAR  +' + wave * 100, '#3eff9b'); nextWave(); }
  }

  // player
  let ix = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  let iy = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0);
  const il = Math.hypot(ix, iy) || 1; ix /= il; iy /= il;
  if (P.dashT > 0) { P.dashT -= dt; parts.push({ x: P.x, y: P.y, vx: 0, vy: 0, life: .3, max: .3, col: '#1de9ff', size: 6 }); }
  else { const k = Math.min(1, dt * 12); P.vx += (ix * P.spd - P.vx) * k; P.vy += (iy * P.spd - P.vy) * k; }
  P.x = clamp(P.x + P.vx * dt, P.r, W - P.r); P.y = clamp(P.y + P.vy * dt, P.r, H - P.r);
  P.dash = Math.max(0, P.dash - dt); P.inv = Math.max(0, P.inv - dt); P.recoil = Math.max(0, P.recoil - dt * 8);
  if (P.regen) P.hp = Math.min(P.maxHp, P.hp + P.regen * dt);
  P.ang = Math.atan2(mouse.y - P.y, mouse.x - P.x);
  P.fcd -= dt;
  if ((mouse.down || autoFire) && P.fcd <= 0) { P.fcd = P.fire; shoot(); }

  // bullets
  for (const b of bullets) {
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    if (b.x < -20 || b.x > W + 20 || b.y < -20 || b.y > H + 20) b.life = 0;
    if (b.life <= 0) continue;
    for (const e of enemies) {
      if (e.dead || b.hit.has(e)) continue;
      const dx = e.x - b.x, dy = e.y - b.y;
      if (dx * dx + dy * dy < (e.r + 4) ** 2) {
        b.hit.add(e); const s = Math.hypot(b.vx, b.vy);
        hurtEnemy(e, P.dmg, b.vx / s * 90, b.vy / s * 90);
        if (b.pierce-- <= 0) { b.life = 0; break; }
      }
    }
  }
  bullets = bullets.filter(b => b.life > 0);

  // drones
  const drones = [];
  for (let i = 0; i < P.drones; i++) { const a = time * 3 + i * TAU / P.drones; drones.push({ x: P.x + Math.cos(a) * 55, y: P.y + Math.sin(a) * 55 }); }

  // enemies
  for (const e of enemies) {
    if (e.dead) continue;
    e.t += dt; e.hitT -= dt; e.droneT -= dt;
    const dx = P.x - e.x, dy = P.y - e.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
    let tx = ux * e.spd, ty = uy * e.spd, acc = 4;
    if (e.type === 'dasher') {
      const c = e.t % 2.4; e.phase = c < 1.4 ? 0 : c < 1.8 ? 1 : 2;
      if (e.phase === 1) { tx = 0; ty = 0; e.lx = ux; e.ly = uy; acc = 10; }
      else if (e.phase === 2) { tx = e.lx * 560; ty = e.ly * 560; acc = 12; }
    } else if (e.type === 'shooter') {
      if (d < 250) { tx = -ux * e.spd; ty = -uy * e.spd; }
      else if (d < 360) { tx = -uy * e.spd * .7; ty = ux * e.spd * .7; }
      e.cd -= dt;
      if (e.cd <= 0 && d < 520 && e.x > 0 && e.x < W && e.y > 0 && e.y < H) {
        e.cd = Math.max(1, 2 - wave * 0.04); const a = Math.atan2(dy, dx);
        fireE(e.x, e.y, a, 250); if (wave >= 8) { fireE(e.x, e.y, a - .25, 250); fireE(e.x, e.y, a + .25, 250); }
      }
    } else if (e.type === 'boss') {
      e.cd -= dt;
      if (e.y < 120) ty = 80;
      if (e.cd <= 0) {
        e.pat++; const a = Math.atan2(dy, dx);
        if (e.pat % 3 === 1) { const n = 16 + wave; for (let i = 0; i < n; i++) fireE(e.x, e.y, i * TAU / n + time, 190); }
        else if (e.pat % 3 === 2) { for (let i = -3; i <= 3; i++) fireE(e.x, e.y, a + i * 0.13, 300); }
        else { for (let i = 0; i < 3; i++) spawnEnemy('chaser', e.x + rand(-40, 40), e.y + rand(-40, 40)); }
        e.cd = e.hp < e.maxHp / 2 ? 1.1 : 1.7;
      }
    }
    e.vx += (tx - e.vx) * Math.min(1, dt * acc); e.vy += (ty - e.vy) * Math.min(1, dt * acc);
    e.x += e.vx * dt; e.y += e.vy * dt;
    e.x = clamp(e.x, -80, W + 80); e.y = clamp(e.y, -80, H + 80);
    // drone contact
    for (const dr of drones) {
      if (e.droneT <= 0 && (dr.x - e.x) ** 2 + (dr.y - e.y) ** 2 < (e.r + 8) ** 2) { e.droneT = 0.25; hurtEnemy(e, P.dmg * 0.8, 0, 0); }
    }
    // player contact
    if (!e.dead && d < e.r + P.r - 2) {
      damagePlayer(e.dmg);
      if (e.type !== 'boss') { e.vx = -ux * 350; e.vy = -uy * 350; }
    }
  }
  // separation (keeps the swarm from stacking)
  for (let i = 0; i < enemies.length; i++) for (let j = i + 1; j < enemies.length; j++) {
    const a = enemies[i], b = enemies[j], dx = b.x - a.x, dy = b.y - a.y, m = a.r + b.r, d2 = dx * dx + dy * dy;
    if (d2 < m * m && d2 > 0.01) {
      const d = Math.sqrt(d2), push = (m - d) * 0.5, nx = dx / d, ny = dy / d;
      const wa = a.type === 'boss' ? 0 : 1, wb = b.type === 'boss' ? 0 : 1;
      a.x -= nx * push * wa; a.y -= ny * push * wa; b.x += nx * push * wb; b.y += ny * push * wb;
    }
  }
  enemies = enemies.filter(e => !e.dead);

  // enemy bullets
  for (const b of ebullets) {
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    if (b.x < -30 || b.x > W + 30 || b.y < -30 || b.y > H + 30) b.life = 0;
    for (const dr of drones) if ((dr.x - b.x) ** 2 + (dr.y - b.y) ** 2 < 144) { b.life = 0; burst(b.x, b.y, '#ff5ec4', 5, 100); }
    if (b.life > 0 && (P.x - b.x) ** 2 + (P.y - b.y) ** 2 < (P.r + 3) ** 2) { b.life = 0; damagePlayer(10); }
  }
  ebullets = ebullets.filter(b => b.life > 0);

  // pickups
  for (const g of gems) {
    g.t += dt; const dx = P.x - g.x, dy = P.y - g.y, d = Math.hypot(dx, dy) || 1;
    if (d < P.magnet || g.t > 12) { const s = 500 + (P.magnet - d) * 3; g.vx += dx / d * s * dt * 4; g.vy += dy / d * s * dt * 4; g.vx *= .9; g.vy *= .9; }
    else { g.vx *= .94; g.vy *= .94; }
    g.x += g.vx * dt; g.y += g.vy * dt;
    if (d < P.r + 10) {
      g.got = true; sfx('pick');
      if (g.kind === 'xp') gainXp(1);
      else { P.hp = Math.min(P.maxHp, P.hp + 30); popText(P.x, P.y - 25, '+30 HP', '#3eff9b'); }
    }
  }
  gems = gems.filter(g => !g.got);
  if (pendingLv > 0 && state === 'play') openLevelUp();
}

// ---------------- drawing ----------------
function glow(c, b) { ctx.shadowColor = c; ctx.shadowBlur = b; }
function poly(x, y, r, n, rot) { ctx.beginPath(); for (let i = 0; i < n; i++) { const a = rot + i * TAU / n; ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * r, y + Math.sin(a) * r); } ctx.closePath(); }
function txt(s, x, y, size, col, align = 'center', blur = 12) {
  ctx.font = 'bold ' + size + 'px "Trebuchet MS", Verdana, sans-serif'; ctx.textAlign = align; ctx.textBaseline = 'middle';
  glow(col, blur); ctx.fillStyle = col; ctx.fillText(s, x, y); ctx.shadowBlur = 0;
}
function drawBg() {
  ctx.fillStyle = '#05060f'; ctx.fillRect(-50, -50, W + 100, H + 100);
  const ox = P ? -(P.x - W / 2) * 0.05 : 0, oy = P ? -(P.y - H / 2) * 0.05 : 0;
  ctx.strokeStyle = 'rgba(29,233,255,0.07)'; ctx.lineWidth = 1; ctx.beginPath();
  for (let x = (ox % 40) - 40; x < W + 40; x += 40) { ctx.moveTo(x, -50); ctx.lineTo(x, H + 50); }
  for (let y = (oy % 40) - 40; y < H + 40; y += 40) { ctx.moveTo(-50, y); ctx.lineTo(W + 50, y); }
  ctx.stroke();
  for (const s of stars) { ctx.fillStyle = `rgba(180,230,255,${s.z * 0.8})`; ctx.fillRect(s.x + ox * s.z * 3, s.y + oy * s.z * 3, s.z * 2, s.z * 2); }
}
function drawEnemy(e) {
  const c = e.hitT > 0 ? '#ffffff' : e.col, a = Math.atan2(P.y - e.y, P.x - e.x);
  glow(e.col, 15); ctx.strokeStyle = c; ctx.fillStyle = c + '33'; ctx.lineWidth = 2.5;
  switch (e.type) {
    case 'chaser': poly(e.x, e.y, e.r, 3, a); break;
    case 'dasher':
      if (e.phase === 1) { ctx.save(); ctx.strokeStyle = 'rgba(255,210,62,0.35)'; ctx.setLineDash([6, 6]); ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.x + e.lx * 300, e.y + e.ly * 300); ctx.stroke(); ctx.restore(); }
      ctx.beginPath(); const da = e.phase === 2 ? Math.atan2(e.ly, e.lx) : a;
      ctx.moveTo(e.x + Math.cos(da) * e.r * 1.6, e.y + Math.sin(da) * e.r * 1.6);
      ctx.lineTo(e.x + Math.cos(da + 2.5) * e.r, e.y + Math.sin(da + 2.5) * e.r);
      ctx.lineTo(e.x + Math.cos(da - 2.5) * e.r, e.y + Math.sin(da - 2.5) * e.r); ctx.closePath(); break;
    case 'shooter': poly(e.x, e.y, e.r, 4, time * 2); break;
    case 'tank': poly(e.x, e.y, e.r, 6, time * 0.5); break;
    case 'splitter': case 'mini': ctx.beginPath(); ctx.arc(e.x, e.y, e.r * (1 + Math.sin(e.t * 8) * 0.06), 0, TAU); break;
    case 'boss':
      poly(e.x, e.y, e.r, 8, time * 0.6); ctx.fill(); ctx.stroke();
      poly(e.x, e.y, e.r * 0.6, 8, -time * 1.2); ctx.stroke();
      ctx.beginPath(); ctx.arc(e.x, e.y, 10 + Math.sin(time * 6) * 3, 0, TAU); ctx.fillStyle = c; ctx.fill(); ctx.shadowBlur = 0; return;
  }
  ctx.fill(); ctx.stroke(); ctx.shadowBlur = 0;
  if (e.hp < e.maxHp && e.type !== 'mini') {
    ctx.fillStyle = '#222'; ctx.fillRect(e.x - e.r, e.y - e.r - 9, e.r * 2, 3);
    ctx.fillStyle = e.col; ctx.fillRect(e.x - e.r, e.y - e.r - 9, e.r * 2 * e.hp / e.maxHp, 3);
  }
}
function drawPlayer() {
  if (P.inv > 0 && P.dashT <= 0 && Math.floor(time * 20) % 2) return;
  ctx.save(); ctx.translate(P.x, P.y); ctx.rotate(P.ang);
  const k = -P.recoil * 3;
  // thruster flame
  const sp = Math.hypot(P.vx, P.vy);
  if (sp > 30) { glow('#ff8a2e', 15); ctx.fillStyle = '#ff8a2e'; ctx.beginPath(); ctx.moveTo(k - 10, -5); ctx.lineTo(k - 10 - rand(6, 14), 0); ctx.lineTo(k - 10, 5); ctx.fill(); }
  glow('#1de9ff', 20); ctx.strokeStyle = '#1de9ff'; ctx.fillStyle = '#1de9ff33'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(k + 18, 0); ctx.lineTo(k - 12, -12); ctx.lineTo(k - 6, 0); ctx.lineTo(k - 12, 12); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore(); ctx.shadowBlur = 0;
  for (let i = 0; i < P.drones; i++) {
    const a = time * 3 + i * TAU / P.drones, x = P.x + Math.cos(a) * 55, y = P.y + Math.sin(a) * 55;
    glow('#ff5ec4', 14); ctx.fillStyle = '#ff5ec4'; poly(x, y, 7, 4, time * 5); ctx.fill();
  }
  ctx.shadowBlur = 0;
}
function bar(x, y, w, h, v, col, label) {
  ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(x, y, w, h);
  glow(col, 10); ctx.fillStyle = col; ctx.fillRect(x, y, w * clamp(v, 0, 1), h); ctx.shadowBlur = 0;
  ctx.strokeStyle = col + '88'; ctx.lineWidth = 1; ctx.strokeRect(x, y, w, h);
  if (label) txt(label, x + w / 2, y + h / 2 + 1, 11, '#ffffff', 'center', 0);
}
function drawHud() {
  bar(16, 16, 220, 16, P.hp / P.maxHp, P.hp / P.maxHp < 0.3 ? '#ff3e5a' : '#3eff9b', Math.ceil(P.hp) + ' / ' + P.maxHp);
  bar(16, 38, 220, 8, 1 - P.dash / P.dashCd, '#1de9ff');
  txt(P.dash <= 0 ? 'DASH READY' : 'dash', 242, 42, 10, '#1de9ff', 'left', 0);
  txt('SCORE ' + score, W - 16, 22, 20, '#ffd23e', 'right', 10);
  txt('BEST ' + Math.max(best, score), W - 16, 46, 12, '#ffd23e99', 'right', 0);
  txt('WAVE ' + wave, W / 2, 22, 18, '#ff3e8a', 'center', 10);
  bar(0, H - 8, W, 8, P.xp / P.next, '#b46cff');
  txt('LV ' + P.lvl, 16, H - 22, 14, '#b46cff', 'left', 8);
  let s = ''; if (autoFire) s += 'AUTO-FIRE  '; if (muted) s += 'MUTED'; if (s) txt(s, W - 16, H - 22, 11, '#ffd23e', 'right', 0);
  const boss = enemies.find(e => e.type === 'boss');
  if (boss) { bar(W / 2 - 250, 54, 500, 12, boss.hp / boss.maxHp, '#ff2e4d'); txt('DREADNOUGHT', W / 2, 78, 12, '#ff2e4d', 'center', 8); }
}
function overlay(a) { ctx.fillStyle = `rgba(5,6,15,${a})`; ctx.fillRect(0, 0, W, H); }
function drawMenu() {
  overlay(0.55);
  const pulse = 1 + Math.sin(time * 3) * 0.03;
  ctx.save(); ctx.translate(W / 2, 170); ctx.scale(pulse, pulse);
  txt('NEON', 0, -40, 72, '#ff3e8a', 'center', 30); txt('SURVIVOR', 0, 35, 72, '#1de9ff', 'center', 30); ctx.restore();
  txt('Survive endless waves. Level up. Build an unstoppable ship.', W / 2, 270, 18, '#ffffff', 'center', 0);
  const lines = [['WASD / ARROWS', 'move'], ['MOUSE', 'aim'], ['HOLD CLICK  or  F', 'shoot / auto-fire'], ['SPACE / SHIFT', 'dash (brief invincibility)'], ['P  /  M', 'pause / mute']];
  lines.forEach(([k, v], i) => { txt(k, W / 2 - 10, 320 + i * 28, 16, '#ffd23e', 'right', 0); txt(v, W / 2 + 10, 320 + i * 28, 16, '#9fe9ff', 'left', 0); });
  if (Math.floor(time * 2) % 2) txt('>>  CLICK TO PLAY  <<', W / 2, 490, 28, '#3eff9b', 'center', 20);
  if (best) txt('BEST SCORE: ' + best, W / 2, 540, 16, '#ffd23e', 'center', 6);
}
function drawLevelUp() {
  overlay(0.7);
  txt('LEVEL UP!', W / 2, 110, 54, '#b46cff', 'center', 25);
  txt('Choose an upgrade  (click or press 1 / 2 / 3)', W / 2, 160, 16, '#ffffff', 'center', 0);
  choices.forEach((u, i) => {
    const r = cardRect(i), hov = mouse.x > r.x && mouse.x < r.x + r.w && mouse.y > r.y && mouse.y < r.y + r.h;
    const col = hov ? '#3eff9b' : '#1de9ff';
    glow(col, hov ? 30 : 12); ctx.fillStyle = hov ? 'rgba(62,255,155,0.12)' : 'rgba(29,233,255,0.06)'; ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.strokeRect(r.x, r.y, r.w, r.h); ctx.shadowBlur = 0;
    txt('[' + (i + 1) + ']', r.x + 20, r.y + 20, 14, '#ffd23e', 'left', 0);
    const lv = P.ups[u.id] || 0; if (lv) txt('Lv ' + lv + ' -> ' + (lv + 1), r.x + r.w - 14, r.y + 20, 12, '#ffd23e', 'right', 0);
    txt(u.name, r.x + r.w / 2, r.y + 65, 22, col, 'center', 10);
    u.desc.forEach((l, j) => txt(l, r.x + r.w / 2, r.y + 110 + j * 22, 15, '#ffffff', 'center', 0));
  });
}
function draw() {
  ctx.save();
  if (shake > 0) ctx.translate(rand(-shake, shake) * 0.5, rand(-shake, shake) * 0.5);
  drawBg();
  if (P && state !== 'menu') {
    for (const g of gems) {
      const b = 1 + Math.sin(g.t * 6) * 0.2;
      if (g.kind === 'xp') { glow('#b46cff', 10); ctx.fillStyle = '#d6a8ff'; poly(g.x, g.y, 5 * b, 4, 0); ctx.fill(); }
      else { glow('#3eff9b', 15); ctx.fillStyle = '#3eff9b'; ctx.fillRect(g.x - 8, g.y - 3, 16, 6); ctx.fillRect(g.x - 3, g.y - 8, 6, 16); }
    }
    ctx.shadowBlur = 0;
    for (const e of enemies) drawEnemy(e);
    glow('#1de9ff', 10); ctx.strokeStyle = '#bff8ff'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.beginPath();
    for (const b of bullets) { const s = Math.hypot(b.vx, b.vy); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - b.vx / s * 12, b.y - b.vy / s * 12); }
    ctx.stroke();
    glow('#ff5ec4', 12); ctx.fillStyle = '#ff9ad8';
    for (const b of ebullets) { ctx.beginPath(); ctx.arc(b.x, b.y, 4.5, 0, TAU); ctx.fill(); }
    ctx.shadowBlur = 0;
    if (state !== 'over') drawPlayer();
  }
  ctx.globalCompositeOperation = 'lighter';
  for (const p of parts) { ctx.globalAlpha = clamp(p.life / p.max, 0, 1); ctx.fillStyle = p.col; ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size); }
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  for (const t of texts) { ctx.globalAlpha = clamp(t.t / 0.4, 0, 1); txt(t.s, t.x, t.y, 14, t.c, 'center', 6); }
  ctx.globalAlpha = 1;
  ctx.restore();

  if (flash > 0) { ctx.fillStyle = `rgba(255,40,80,${flash * 0.6})`; ctx.fillRect(0, 0, W, H); }
  if (state === 'menu') drawMenu();
  else {
    drawHud();
    if (bannerT > 0 && state === 'play') { ctx.globalAlpha = clamp(bannerT, 0, 1); txt(banner, W / 2, H / 2 - 60, 48, banner.startsWith('BOSS') ? '#ff2e4d' : '#ff3e8a', 'center', 25); ctx.globalAlpha = 1; }
    if (state === 'paused') { overlay(0.6); txt('PAUSED', W / 2, H / 2 - 20, 60, '#1de9ff', 'center', 25); txt('Click or press P to resume', W / 2, H / 2 + 40, 18, '#ffffff', 'center', 0); }
    if (state === 'levelup') drawLevelUp();
    if (state === 'over') {
      overlay(0.65);
      txt('GAME OVER', W / 2, 170, 70, '#ff2e4d', 'center', 30);
      txt('SCORE  ' + score, W / 2, 260, 32, '#ffd23e', 'center', 15);
      if (newBest) txt('*** NEW HIGH SCORE ***', W / 2, 305, 20, '#3eff9b', 'center', 15);
      txt('Wave ' + wave + '   |   Level ' + P.lvl + '   |   Kills ' + kills, W / 2, 350, 18, '#ffffff', 'center', 0);
      txt('Best: ' + best, W / 2, 385, 16, '#ffd23e99', 'center', 0);
      if (Math.floor(time * 2) % 2) txt('Click or press R to play again', W / 2, 460, 22, '#1de9ff', 'center', 15);
    }
  }
  // crosshair
  {
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; glow('#1de9ff', 8); ctx.beginPath();
    ctx.arc(mouse.x, mouse.y, 8, 0, TAU); ctx.moveTo(mouse.x - 13, mouse.y); ctx.lineTo(mouse.x - 4, mouse.y); ctx.moveTo(mouse.x + 4, mouse.y); ctx.lineTo(mouse.x + 13, mouse.y);
    ctx.moveTo(mouse.x, mouse.y - 13); ctx.lineTo(mouse.x, mouse.y - 4); ctx.moveTo(mouse.x, mouse.y + 4); ctx.lineTo(mouse.x, mouse.y + 13); ctx.stroke(); ctx.shadowBlur = 0;
  }
}

// ---------------- main loop ----------------
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.033, (now - last) / 1000); last = now;
  if (state === 'play') update(dt); else updateFx(dt);
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
})();
</script>
"""

display(HTML(GAME_HTML))
print("Click on the game to focus it, then click again to start. Have fun!")
