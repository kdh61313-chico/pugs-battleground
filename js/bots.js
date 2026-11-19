// ===== LAST CIRCLE · bot AI (simulated by the room host only) =====
import * as THREE from 'three';
import { WEAPONS, botName, ITEMS } from './data.js';
import { Actor, STI, WIDS } from './actor.js';
import { planePos } from './match.js';
import { mulberry32, clamp, damp, dampAngle, angDiff, pick, rand, weightedPick } from './util.js';

const G = 20;
const BOT_WEAPONS = [['m5c', 10], ['kv47', 9], ['sable', 5], ['stinger', 8], ['vex', 6], ['breacher', 5], ['ranger', 3], ['hawk', 4], ['longbow', 3], ['p9', 4]];
const _v = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();

export class BotManager {
  constructor(game) { this.g = game; this.list = []; }
  clear() { this.list = []; }
  create(n, seed) {
    const game = this.g; this.list = [];
    const rng = (this.rng = mulberry32(seed ^ 0xb075));
    const P = game.match.plane;
    const diff = game.match.df; // 0 easy 1 normal 2 hard
    for (let i = 0; i < n; i++) {
      const id = 'b' + i;
      const a = new Actor(id, { isBot: true, name: botName(seed, i), team: id, colorIdx: (i * 3 + 1) % 8, skin: i % 5, hair: i % 4, pants: [0x3a3f46, 0x4a4030, 0x2e3a2e][i % 3] });
      a.st = 'plane'; a.hp = 100; a.sq = 0;
      let jt = rand(rng, 3, P.dur - 3);
      for (let k = 0; k < 30; k++) { const pp = planePos(P, jt); if (game.world.heightAt(pp[0], pp[2]) > 3) break; jt = rand(rng, 3, P.dur - 3); }
      a.brain = {
        jumpT: jt, vel: new THREE.Vector3(), mode: 'loot', modeT: 0, target: null, think: 0,
        dest: null, stuck: 0, lastPos: new THREE.Vector3(), cool: 0, burst: 0, aimErr: 1, seenT: 0, mag: 30,
        helm: 0, vest: 0, armDur: [0, 0], reaction: [0.9, 0.55, 0.32][diff], acc: [0.18, 0.3, 0.42][diff], strafe: 0, strafeT: 0,
        lootUntil: 0, lootDelay: rand(rng, 14, 38), onGround: false, jumpCD: 0, skill: rand(rng, 0.75, 1.25), crouch: false,
      };
      game.addActor(a); this.list.push(a);
    }
  }
  encode() {
    return this.list.map((a) => {
      const B = a.brain;
      const fl = (B.crouch ? 1 : 0) | (B.helm << 1) | (B.vest << 3) | (clamp(Math.round(a.speed), 0, 15) << 7);
      return [Math.round(a.pos.x * 10), Math.round(a.pos.y * 10), Math.round(a.pos.z * 10), Math.round(a.yaw * 100), Math.round(a.pitch * 100), STI[a.st], Math.round(a.hp), a.w ? WIDS.indexOf(a.w) + 1 : 0, a.sq, fl];
    });
  }
  // targets: everyone alive except self
  targets() {
    const g = this.g, out = [];
    const me = g.me;
    if (me.st === 'ground' || me.st === 'down' || me.st === 'swim' || me.st === 'chute') out.push({ id: g.myPeer, team: g.myTeam, pos: me.pos, st: me.st, crouch: me.crouch || me.prone, prone: me.prone, moving: me.hspeed > 1, me: true });
    for (const a of g.actors.values()) if (a.alive && a.st !== 'plane' && a.st !== 'fall') out.push({ id: a.id, team: a.team, pos: a.pos, st: a.st, crouch: a.crouch || a.prone, prone: a.prone, moving: a.speed > 1, actor: a });
    return out;
  }
  update(dt) {
    const g = this.g, m = g.match, W = g.world;
    if (!m) return;
    const tg = this.targets();
    const Z = m.zoneNow;
    for (const a of this.list) {
      const B = a.brain;
      if (a.st === 'dead') continue;
      if (a.st === 'plane') {
        const P = planePos(m.plane, m.t); a.pos.set(P[0], P[1] - 4, P[2]);
        if (m.t >= B.jumpT) { a.st = 'fall'; B.vel.set(m.plane.dx * 30, -5, m.plane.dz * 30); a.yaw = Math.atan2(m.plane.dx, m.plane.dz); B.dest = this.pickLanding(a); }
        continue;
      }
      if (a.st === 'fall' || a.st === 'chute') {
        const gy = W.groundAt(a.pos.x, a.pos.z, a.pos.y);
        const dx = B.dest[0] - a.pos.x, dz = B.dest[1] - a.pos.z, dd = Math.hypot(dx, dz);
        a.yaw = dampAngle(a.yaw, Math.atan2(dx, dz), 2, dt);
        if (a.st === 'fall') {
          B.vel.y = damp(B.vel.y, -55, 1.6, dt);
          const hs = dd > 30 ? 20 : dd * 0.5;
          B.vel.x = damp(B.vel.x, Math.sin(a.yaw) * hs, 0.9, dt); B.vel.z = damp(B.vel.z, Math.cos(a.yaw) * hs, 0.9, dt);
          if (a.pos.y - Math.max(gy, 0) < 140) a.st = 'chute';
        } else {
          B.vel.y = damp(B.vel.y, -6.5, 2, dt);
          const hs = Math.min(13, dd * 0.4);
          B.vel.x = damp(B.vel.x, Math.sin(a.yaw) * hs, 1, dt); B.vel.z = damp(B.vel.z, Math.cos(a.yaw) * hs, 1, dt);
        }
        a.pos.addScaledVector(B.vel, dt);
        a.pos.x = clamp(a.pos.x, -985, 985); a.pos.z = clamp(a.pos.z, -985, 985);
        const g2 = W.groundAt(a.pos.x, a.pos.z, a.pos.y + 1);
        if (a.pos.y <= Math.max(g2, -1.35)) {
          a.pos.y = Math.max(g2, -1.35); a.st = 'ground'; B.vel.set(0, 0, 0); B.landT = m.t; B.mode = 'loot'; B.lootUntil = m.t + rand(this.rng, 18, 45); B.dest = null;
        }
        a.speed = Math.hypot(B.vel.x, B.vel.z);
        continue;
      }
      // ===== ground =====
      // zone damage
      if (g.outsideZone(a.pos.x, a.pos.z)) { a.hp -= Z.dps * dt; if (a.hp <= 0) { this.kill(a, 'zone', 'zone', 0); continue; } }
      B.cool -= dt; B.think -= dt; B.jumpCD -= dt; B.strafeT -= dt;
      // equip after looting time
      if (!a.w && B.landT !== undefined && m.t > B.landT + B.lootDelay) this.equip(a);
      // perception
      if (B.think <= 0) {
        B.think = 0.4 + this.rng() * 0.3;
        const eye = _a.set(a.pos.x, a.pos.y + (B.crouch ? 1.15 : 1.6), a.pos.z);
        let best = null, bd = 1e9;
        const range = a.w ? (WEAPONS[a.w].cat === 'SR' || WEAPONS[a.w].cat === 'DMR' ? 260 : 170) : 40;
        for (const t of tg) {
          if (t.id === a.id || t.team === a.team) continue;
          const d = a.pos.distanceTo(t.pos); if (d > range) continue;
          if (t.actor && t.actor.isBot && d > (m.t - B.landT < 70 ? 30 : range * 0.7)) continue;
          // facing check (wider when close / when already engaged)
          const ang = Math.abs(angDiff(a.yaw, Math.atan2(t.pos.x - a.pos.x, t.pos.z - a.pos.z)));
          if (ang > (d < 25 || B.target === t.id ? 2.6 : 1.3)) continue;
          const ty = t.prone ? 0.25 : t.st === 'down' ? 0.45 : t.crouch ? 1.0 : 1.3;
          _b.set(t.pos.x, t.pos.y + ty, t.pos.z);
          if (!W.los(eye.x, eye.y, eye.z, _b.x, _b.y, _b.z)) continue;
          if (g.fx.segSmoke(eye.x, eye.y, eye.z, _b.x, _b.y, _b.z)) continue;
          const score = d * (t.st === 'down' ? 1.6 : 1);
          if (score < bd) { bd = score; best = t; }
        }
        if (best) { if (B.target !== best.id) { B.seenT = m.t; B.aimErr = 1; } B.target = best.id; B.tpos = best.pos.clone(); B.tst = best; B.lostT = 0; }
        else if (B.target) { B.lostT = (B.lostT || 0) + 0.5; if (B.lostT > 4) { B.target = null; B.tst = null; } else B.tst = null; }
      }
      // decide movement goal
      let wish = null; let spd = 4.6; let faceYaw = null;
      const tgt = B.tst;
      if (tgt && a.w) {
        const def = WEAPONS[a.w];
        const dx = tgt.pos.x - a.pos.x, dz = tgt.pos.z - a.pos.z, d = Math.hypot(dx, dz);
        const ty = tgt.st === 'down' ? 0.45 : tgt.crouch ? 1.0 : 1.3;
        const wantYaw = Math.atan2(dx, dz);
        const wantPitch = Math.atan2(tgt.pos.y + ty - (a.pos.y + 1.45), d);
        a.yaw = dampAngle(a.yaw, wantYaw, 9, dt); a.pitch = damp(a.pitch, wantPitch, 9, dt);
        faceYaw = wantYaw;
        if (B.strafeT <= 0) { B.strafeT = rand(this.rng, 0.6, 1.6); B.strafe = this.rng() < 0.5 ? -1 : 1; B.crouch = d > 60 && this.rng() < 0.5; }
        const rx = -Math.cos(wantYaw), rz = Math.sin(wantYaw);
        const ideal = def.cat === 'SG' || def.cat === 'SMG' ? 12 : def.cat === 'SR' || def.cat === 'DMR' ? 90 : 35;
        let push = d > ideal * 1.4 ? 1 : d < ideal * 0.5 ? -0.6 : 0;
        if (a.hp < 35 && !B.healed) { push = -1; B.crouch = false; if (!B.retreatT) B.retreatT = m.t; if (m.t - B.retreatT > 3) { a.hp = Math.min(100, a.hp + 35); B.healed = true; B.retreatT = 0; } }
        wish = [Math.sin(wantYaw) * push + rx * B.strafe * 0.8, Math.cos(wantYaw) * push + rz * B.strafe * 0.8];
        spd = B.crouch ? 2.2 : 3.4;
        // fire
        const engaged = m.t - B.seenT > B.reaction;
        if (engaged && B.cool <= 0 && Math.abs(angDiff(a.yaw, wantYaw)) < 0.12 && d < (def.cat === 'SG' ? 35 : 400)) {
          if (B.mag <= 0) { B.mag = def.mag; B.cool = def.reload * 1.1; }
          else this.fire(a, tgt, d, def, dt);
        }
      } else if (tgt && !a.w && a.pos.distanceTo(tgt.pos) < 35) {
        const dx = a.pos.x - tgt.pos.x, dz = a.pos.z - tgt.pos.z, d = Math.hypot(dx, dz) || 1;
        wish = [dx / d, dz / d]; spd = 6.0; a.yaw = dampAngle(a.yaw, Math.atan2(dx, dz), 6, dt); a.pitch = damp(a.pitch, 0, 4, dt); B.crouch = false;
      } else {
        // roam / loot / zone
        const outside = g.outsideZone(a.pos.x, a.pos.z);
        const wc = Z.wc || Z.bc;
        if (!B.dest || Math.hypot(B.dest[0] - a.pos.x, B.dest[1] - a.pos.z) < 3 || (outside && B.mode !== 'zone')) {
          if (outside || (Z.wc && Math.hypot(a.pos.x - wc[0], a.pos.z - wc[1]) > (Z.wr || Z.br) * 0.9 && Z.timeTo < 60)) {
            B.mode = 'zone';
            const ang = this.rng() * Math.PI * 2, r = Math.sqrt(this.rng()) * Math.max(5, (Z.wr || Z.br) * 0.6);
            B.dest = [wc[0] + Math.cos(ang) * r, wc[1] + Math.sin(ang) * r];
          } else if (m.t < B.lootUntil) {
            B.mode = 'loot';
            const lp = g.world.lootPoints; let p = null;
            for (let k = 0; k < 12; k++) { const c = lp[Math.floor(this.rng() * lp.length)]; if (Math.hypot(c[0] - a.pos.x, c[2] - a.pos.z) < 70) { p = c; break; } }
            B.dest = p ? [p[0], p[2]] : [a.pos.x + rand(this.rng, -30, 30), a.pos.z + rand(this.rng, -30, 30)];
          } else {
            B.mode = 'roam';
            const ang = this.rng() * Math.PI * 2, r = 20 + this.rng() * 60;
            let nx = a.pos.x + Math.cos(ang) * r, nz = a.pos.z + Math.sin(ang) * r;
            if (Z.wc) { const dd = Math.hypot(nx - wc[0], nz - wc[1]); if (dd > (Z.wr || Z.br) * 0.85) { nx = (nx + wc[0]) / 2; nz = (nz + wc[1]) / 2; } }
            B.dest = [nx, nz];
          }
          if (W.heightAt(B.dest[0], B.dest[1]) < 0.5) B.dest = [wc[0], wc[1]];
        }
        const dx = B.dest[0] - a.pos.x, dz = B.dest[1] - a.pos.z, d = Math.hypot(dx, dz) || 1;
        wish = [dx / d, dz / d];
        spd = B.mode === 'zone' ? 6.2 : B.mode === 'loot' ? 3.8 : 4.7;
        a.yaw = dampAngle(a.yaw, Math.atan2(dx, dz), 5, dt); a.pitch = damp(a.pitch, 0, 4, dt);
        B.crouch = false;
        if (B.target && B.tpos && !tgt) { // investigate last seen
          const ex = B.tpos.x - a.pos.x, ez = B.tpos.z - a.pos.z; const ed = Math.hypot(ex, ez) || 1;
          wish = [ex / ed, ez / ed]; spd = 3.2; a.yaw = dampAngle(a.yaw, Math.atan2(ex, ez), 6, dt);
        }
      }
      // heal when calm
      if (!tgt && a.hp < 70 && this.rng() < dt * 0.15) { a.hp = Math.min(100, a.hp + 30); B.healed = false; }
      // move
      B.vel.x = damp(B.vel.x, wish[0] * spd, 10, dt); B.vel.z = damp(B.vel.z, wish[1] * spd, 10, dt);
      B.vel.y -= G * dt;
      const np = _v.copy(a.pos).addScaledVector(B.vel, dt);
      W.collide(np, 0.32, 1.8);
      const gy = W.groundAt(np.x, np.z, np.y, 0.3);
      if (np.y <= gy) { np.y = gy; B.vel.y = 0; B.onGround = true; }
      else if (B.onGround && np.y - gy < 0.5) { np.y = gy; B.vel.y = 0; }
      else B.onGround = false;
      if (W.heightAt(np.x, np.z) < -1.3 && gy < -1.3 && np.y < -1.35) { np.y = -1.35; B.vel.y = 0; B.onGround = true; a.st = 'swim'; } else if (a.st === 'swim') a.st = 'ground';
      // stuck detection
      const moved = Math.hypot(np.x - a.pos.x, np.z - a.pos.z);
      if (moved < spd * dt * 0.25 && spd > 1) {
        B.stuck += dt;
        if (B.stuck > 0.6 && B.onGround && B.jumpCD <= 0) { B.vel.y = 6.3; B.jumpCD = 1.2; }
        if (B.stuck > 1.6) { B.stuck = 0; const ang = this.rng() * Math.PI * 2; B.dest = [a.pos.x + Math.cos(ang) * 15, a.pos.z + Math.sin(ang) * 15]; }
      } else B.stuck = Math.max(0, B.stuck - dt);
      a.pos.copy(np);
      a.speed = Math.hypot(B.vel.x, B.vel.z);
      a.flags = B.crouch ? 1 : 0;
      a.gear = [B.helm, B.vest, a.w ? 1 + (a.i || 0) % 2 : 0];
    }
  }
  pickLanding(a) {
    const g = this.g, lp = g.world.lootPoints; let best = null, bd = 1e9;
    for (let k = 0; k < 40; k++) {
      const c = lp[Math.floor(this.rng() * lp.length)];
      const d = Math.hypot(c[0] - a.pos.x, c[2] - a.pos.z);
      if (d < 420 && d < bd + this.rng() * 150) { bd = d; best = c; }
    }
    if (best) return [best[0], best[2]];
    // fallback: head toward the island centre
    const d = Math.hypot(a.pos.x, a.pos.z) || 1; return [a.pos.x - a.pos.x / d * 300, a.pos.z - a.pos.z / d * 300];
  }
  equip(a) {
    const B = a.brain;
    a.w = weightedPick(this.rng, BOT_WEAPONS); B.mag = WEAPONS[a.w].mag;
    const r = this.rng(); B.helm = r < 0.35 ? 1 : r < 0.6 ? 2 : r < 0.66 ? 3 : 0;
    const r2 = this.rng(); B.vest = r2 < 0.35 ? 1 : r2 < 0.62 ? 2 : r2 < 0.67 ? 3 : 0;
  }
  fire(a, t, d, def, dt) {
    const g = this.g, B = a.brain; const m = g.match;
    B.mag--; a.sq++;
    B.cool = 60 / def.rpm * (def.modes[0] === 'auto' ? (d > 60 ? 2.6 : 1.15) : 1.3 + this.rng() * 0.6);
    if (def.modes[0] === 'auto' && this.rng() < 0.12) B.cool += 0.5;
    // accuracy model
    const settle = clamp((m.t - B.seenT - B.reaction) / 2.5, 0, 1);
    let p = B.acc * B.skill * (0.6 + settle * 0.6);
    const eff = def.cat === 'SG' ? 14 : def.cat === 'SMG' ? 40 : def.cat === 'SR' ? 300 : def.cat === 'DMR' ? 220 : 110;
    p *= clamp(1.25 - d / eff, 0.08, 1.1);
    if (t.moving) p *= 0.75; if (t.crouch) p *= 0.85; if (t.prone) p *= 0.6; if (t.st === 'down') p *= 1.2;
    if (B.crouch) p *= 1.1;
    if (t.actor && t.actor.isBot) p *= 0.5;
    if (B.landT !== undefined && m.t - B.landT < 60) p *= 0.65; // bots duel each other less effectively, leaving fights for humans
    const shots = def.pellets ? def.pellets : 1;
    for (let k = 0; k < shots; k++) {
      if (this.rng() > p * (def.pellets ? 0.9 : 1)) continue;
      const head = this.rng() < (def.cat === 'SR' ? 0.25 : 0.1);
      let f = 1; if (d > def.range) f = def.cat === 'SG' ? Math.max(0.12, 1 - (d - def.range) / 22) : Math.max(0.5, 1 - (d - def.range) / (def.range * 3));
      const dmg = def.dmg * f * (head ? def.head : 1);
      const flags = head ? 1 : 0;
      if (t.me) g.takeDamage(dmg, flags, a.w, a.id);
      else if (t.actor && t.actor.isBot) this.damage(t.actor.id, dmg, flags, a.w, a.id);
      else g.emit('h', t.id, Math.round(dmg * 10) / 10, flags, a.w, a.id);
      if (def.pellets) continue; else break;
    }
    // host visual for own bots
    a.pendingShots = Math.min(6, a.pendingShots + 1);
  }
  damage(id, raw, flags, wpn, from) {
    const a = this.g.actors.get(id); if (!a || !a.brain || a.st === 'dead') return;
    const B = a.brain;
    if (a.st === 'plane') return;
    let dmg = raw;
    if (flags & 1 && B.helm) { dmg *= 1 - [0, 0.3, 0.4, 0.55][B.helm]; if (this.rng() < 0.1) B.helm = 0; }
    else if (!(flags & 8) && !(flags & 1) && B.vest) dmg *= 1 - [0, 0.3, 0.4, 0.55][B.vest] * (flags & 2 ? 0.6 : 1);
    a.hp -= dmg;
    // react: turn to attacker
    const src = from === this.g.myPeer ? { pos: this.g.me.pos } : this.g.actors.get(from);
    if (src && src.pos) { B.tpos = src.pos.clone(); if (!B.target) { B.target = from; B.seenT = this.g.match.t; } a.yaw = dampAngle(a.yaw, Math.atan2(src.pos.x - a.pos.x, src.pos.z - a.pos.z), 4, 0.25); B.think = Math.min(B.think, 0.1); }
    if (!a.w && B.landT !== undefined && this.g.match.t > B.landT + B.lootDelay * 0.6) this.equip(a);
    if (a.hp <= 0) this.kill(a, from, wpn, flags & 1);
  }
  explosion(x, y, z, owner, dmgAt) {
    for (const a of this.list) { if (a.st !== 'ground' && a.st !== 'swim') continue; const d = dmgAt(a.pos.x, a.pos.y + 1, a.pos.z); if (d > 0) this.damage(a.id, d, 2, 'frag', owner); }
  }
  kill(a, from, wpn, head) {
    const g = this.g; a.st = 'dead'; a.hp = 0;
    g.emit('k', a.id, from, wpn || '', 0, head ? 1 : 0); g.onKill(a.id, from, wpn || '', 0, head);
    const items = [];
    if (a.w) { items.push([a.w, 1]); items.push([WEAPONS[a.w].ammo, 30 + Math.floor(this.rng() * 40)]); }
    if (a.brain.helm) items.push(['helm' + a.brain.helm, 1]);
    if (a.brain.vest) items.push(['vest' + a.brain.vest, 1]);
    if (this.rng() < 0.6) items.push(['bandage', 3 + Math.floor(this.rng() * 5)]);
    if (this.rng() < 0.35) items.push(['firstaid', 1]);
    if (this.rng() < 0.25) items.push(['energy', 1]);
    if (this.rng() < 0.2) items.push([pick(this.rng, ['s_red', 's_2x', 's_holo', 'x_ext', 'm_comp', 'g_vert']), 1]);
    g.dropCrate(items, a.pos.x, a.pos.y, a.pos.z, a.name);
  }
}
