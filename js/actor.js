// ===== LAST CIRCLE · actors (remote players & bots) + hitboxes =====
import * as THREE from 'three';
import { Character } from './models.js';
import { PLAYER_COLORS } from './data.js';
import { lerp, angDiff } from './util.js';

export const ST = ['plane', 'fall', 'chute', 'ground', 'down', 'dead', 'swim', 'spec'];
export const STI = Object.fromEntries(ST.map((s, i) => [s, i]));
export const WIDS = ['kv47', 'm5c', 'sable', 'ranger', 'hawk', 'longbow', 'wraith', 'stinger', 'vex', 'breacher', 'hailstorm', 'p9'];

export class Actor {
  constructor(id, opts) {
    this.id = id; this.isBot = !!opts.isBot; this.name = opts.name || '???'; this.team = opts.team || id;
    this.colorIdx = opts.colorIdx || 0;
    const shirt = PLAYER_COLORS[this.colorIdx % PLAYER_COLORS.length];
    this.char = new Character({ shirt, pants: opts.pants ?? 0x56604a, skin: opts.skin ?? 0, hair: opts.hair ?? 0 });
    this.snaps = [];
    this.pos = new THREE.Vector3(); this.yaw = 0; this.pitch = 0;
    this.st = 'plane'; this.flags = 0; this.speed = 0; this.w = null; this.wb = null;
    this.hp = 100; this.kh = 0; this.gear = [0, 0, 0]; this.sq = -1; this.pendingShots = 0; this.shotT = 0;
    this.kills = 0; this.mk = null; this.lastSeenT = performance.now();
    this.stepT = 0; this.prevPos = new THREE.Vector3(); this.inMatch = true;
  }
  get crouch() { return (this.flags & 1) !== 0; }
  get sprint() { return (this.flags & 2) !== 0; }
  get prone() { return (this.flags & 64) !== 0; }
  get alive() { return this.st !== 'dead' && this.st !== 'spec'; }
  pushSnap(s) {
    this.snaps.push(s);
    if (this.snaps.length > 30) this.snaps.shift();
    this.lastSeenT = s.t;
  }
  interp(now, delay) {
    const rt = now - delay; const S = this.snaps; if (!S.length) return;
    let a = S[0], b = null;
    for (let i = S.length - 1; i >= 0; i--) { if (S[i].t <= rt) { a = S[i]; b = S[i + 1] || null; break; } }
    if (b && b.t > a.t) {
      const k = Math.min(1, (rt - a.t) / (b.t - a.t));
      const jump = Math.hypot(b.x - a.x, b.z - a.z) > 40;
      this.pos.set(jump ? b.x : lerp(a.x, b.x, k), jump ? b.y : lerp(a.y, b.y, k), jump ? b.z : lerp(a.z, b.z, k));
      this.yaw = a.yaw + angDiff(a.yaw, b.yaw) * k; this.pitch = lerp(a.pitch, b.pitch, k);
      this.st = k > 0.5 ? b.st : a.st;
    } else {
      // extrapolate a little from the last two
      const L = S[S.length - 1], P = S[S.length - 2];
      if (P && L.t > P.t && rt - L.t < 250) {
        const k = (rt - L.t) / (L.t - P.t);
        this.pos.set(L.x + (L.x - P.x) * k * 0.6, L.y + (L.y - P.y) * k * 0.6, L.z + (L.z - P.z) * k * 0.6);
      } else this.pos.set(L.x, L.y, L.z);
      this.yaw = L.yaw; this.pitch = L.pitch; this.st = L.st;
    }
  }
  // hitbox query along segment a->b; returns {t (0..1), part}
  hitTest(ax, ay, az, bx, by, bz) {
    if (this.st === 'dead' || this.st === 'spec' || this.st === 'plane') return null;
    const p = this.pos; const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    let best = null;
    const test = (t, part) => { if (t !== null && (!best || t < best.t)) best = { t, part }; };
    if (this.st === 'fall' || this.st === 'chute') { test(segSphere(ax, ay, az, bx, by, bz, p.x, p.y + 1.0, p.z, 0.55), 'body'); return best; }
    if (this.st === 'down') {
      test(segSphere(ax, ay, az, bx, by, bz, p.x + fx * 0.45, p.y + 0.62, p.z + fz * 0.45, 0.15), 'head');
      test(segCapsule(ax, ay, az, bx, by, bz, p.x - fx * 0.3, p.y + 0.35, p.z - fz * 0.3, p.x + fx * 0.3, p.y + 0.55, p.z + fz * 0.3, 0.27), 'body');
      return best;
    }
    if (this.st === 'swim') { test(segSphere(ax, ay, az, bx, by, bz, p.x, p.y + 1.45, p.z, 0.2), 'head'); return best; }
    if (this.prone) {
      test(segSphere(ax, ay, az, bx, by, bz, p.x + fx * 0.75, p.y + 0.25, p.z + fz * 0.75, 0.14), 'head');
      test(segCapsule(ax, ay, az, bx, by, bz, p.x - fx * 0.2, p.y + 0.18, p.z - fz * 0.2, p.x + fx * 0.55, p.y + 0.2, p.z + fz * 0.55, 0.2), 'body');
      test(segCapsule(ax, ay, az, bx, by, bz, p.x - fx * 1.0, p.y + 0.12, p.z - fz * 1.0, p.x - fx * 0.25, p.y + 0.14, p.z - fz * 0.25, 0.14), 'leg');
      return best;
    }
    const c = this.crouch;
    test(segSphere(ax, ay, az, bx, by, bz, p.x + fx * 0.02, p.y + (c ? 1.2 : 1.66), p.z + fz * 0.02, 0.145), 'head');
    test(segCapsule(ax, ay, az, bx, by, bz, p.x, p.y + (c ? 0.62 : 0.9), p.z, p.x, p.y + (c ? 1.05 : 1.45), p.z, 0.25), 'body');
    test(segCapsule(ax, ay, az, bx, by, bz, p.x, p.y + 0.1, p.z, p.x, p.y + (c ? 0.6 : 0.88), p.z, 0.19), 'leg');
    return best;
  }
  chest(out) { const y = this.prone ? 0.2 : this.st === 'down' ? 0.45 : this.crouch ? 0.9 : 1.25; return out.set(this.pos.x, this.pos.y + y, this.pos.z); }
  head(out) { const y = this.prone ? 0.25 : this.st === 'down' ? 0.62 : this.crouch ? 1.2 : 1.66; return out.set(this.pos.x, this.pos.y + y, this.pos.z); }
}

export function segSphere(ax, ay, az, bx, by, bz, cx, cy, cz, r) {
  const dx = bx - ax, dy = by - ay, dz = bz - az; const fx = ax - cx, fy = ay - cy, fz = az - cz;
  const a = dx * dx + dy * dy + dz * dz; const b = 2 * (fx * dx + fy * dy + fz * dz); const c = fx * fx + fy * fy + fz * fz - r * r;
  const disc = b * b - 4 * a * c; if (disc < 0 || a < 1e-12) return null;
  const s = Math.sqrt(disc); let t = (-b - s) / (2 * a);
  if (t < 0) t = (-b + s) / (2 * a) >= 0 && c < 0 ? 0 : -1;
  return t >= 0 && t <= 1 ? t : null;
}
export function segCapsule(ax, ay, az, bx, by, bz, cx, cy, cz, ex, ey, ez, r) {
  // closest points between segment AB and segment CE
  const d1x = bx - ax, d1y = by - ay, d1z = bz - az, d2x = ex - cx, d2y = ey - cy, d2z = ez - cz;
  const rx = ax - cx, ry = ay - cy, rz = az - cz;
  const a = d1x * d1x + d1y * d1y + d1z * d1z, e = d2x * d2x + d2y * d2y + d2z * d2z, f = d2x * rx + d2y * ry + d2z * rz;
  let s, t;
  const c = d1x * rx + d1y * ry + d1z * rz, b = d1x * d2x + d1y * d2y + d1z * d2z;
  const den = a * e - b * b;
  s = den > 1e-9 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
  t = (b * s + f) / e;
  if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); } else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
  const px = ax + d1x * s - (cx + d2x * t), py = ay + d1y * s - (cy + d2y * t), pz = az + d1z * s - (cz + d2z * t);
  const d2 = px * px + py * py + pz * pz;
  if (d2 > r * r) return null;
  // back off to approximate entry
  const L = Math.sqrt(a); const back = Math.sqrt(Math.max(0, r * r - d2)) / Math.max(L, 1e-6);
  return Math.max(0, s - back);
}
