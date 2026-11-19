// ===== LAST CIRCLE · deterministic match setup (plane path, zones, loot, care drops) =====
import { mulberry32, rand, weightedPick, clamp, lerp } from './util.js';
import { ZONE_PHASES, ZONE_START, ZONE_R0, LOOT_TABLE, LOOT_WEAPONS, LOOT_ATTACH, LOOT_ARMOR, LOOT_HEAL, LOOT_BOOST, LOOT_THROW, CARE_LOOT, WEAPONS, AMMO } from './data.js';

export function makePlane(seed) {
  const rng = mulberry32(seed ^ 0xa11);
  const a = rng() * Math.PI * 2; const dx = Math.cos(a), dz = Math.sin(a);
  const off = (rng() - 0.5) * 700; const px = -dz, pz = dx;
  const L = 1180;
  const sx = -dx * L + px * off, sz = -dz * L + pz * off, ex = dx * L + px * off, ez = dz * L + pz * off;
  const speed = 88, alt = 430;
  return { sx, sz, ex, ez, dx, dz, speed, alt, dur: (2 * L) / speed, len: 2 * L };
}
export function planePos(P, t) { const k = clamp((t * P.speed) / P.len, 0, 1.05); return [lerp(P.sx, P.ex, k), P.alt, lerp(P.sz, P.ez, k)]; }

export function makeZones(seed, speed, world) {
  const rng = mulberry32(seed ^ 0x2017);
  let pc = [0, 0], pr = ZONE_R0; let T = ZONE_START * speed;
  const out = [];
  ZONE_PHASES.forEach(([wait, shrink, r, dps], i) => {
    let c = pc;
    for (let k = 0; k < 40; k++) {
      const maxD = i === 0 ? 380 : Math.max(0, pr - r) * 0.92;
      const a = rng() * Math.PI * 2, d = Math.sqrt(rng()) * maxD;
      const cx = (i === 0 ? 0 : pc[0]) + Math.cos(a) * d, cz = (i === 0 ? 0 : pc[1]) + Math.sin(a) * d;
      if (world.heightAt(cx, cz) > 1.5 || k === 39) { c = [cx, cz]; break; }
    }
    const w = wait * speed, s = shrink * speed;
    out.push({ tStart: T, tShrink: T + w, tEnd: T + w + s, c0: pc, r0: pr, c1: c, r1: r, dps });
    pc = c; pr = r; T += w + s;
  });
  return out;
}
export function zoneAt(Z, t) {
  if (t < Z[0].tStart) return { bc: Z[0].c0, br: Z[0].r0, wc: null, wr: 0, shrinking: false, timeTo: Z[0].tStart - t, dps: 0.4, phase: 0, pre: true };
  for (let i = 0; i < Z.length; i++) {
    const p = Z[i];
    if (t < p.tShrink) return { bc: p.c0, br: p.r0, wc: p.c1, wr: p.r1, shrinking: false, timeTo: p.tShrink - t, dps: i ? Z[i - 1].dps : 0.4, phase: i + 1 };
    if (t < p.tEnd) {
      const k = (t - p.tShrink) / (p.tEnd - p.tShrink);
      return { bc: [lerp(p.c0[0], p.c1[0], k), lerp(p.c0[1], p.c1[1], k)], br: lerp(p.r0, p.r1, k), wc: p.c1, wr: p.r1, shrinking: true, timeTo: p.tEnd - t, dps: p.dps, phase: i + 1 };
    }
  }
  const L = Z[Z.length - 1];
  return { bc: L.c1, br: 0, wc: L.c1, wr: 0, shrinking: false, timeTo: 0, dps: L.dps * 1.5, phase: Z.length + 1, final: true };
}

const AMMO_FOR_LOOT = [['a556', 10], ['a762', 8], ['a9', 8], ['a45', 5], ['a12', 4]];
export function makeLoot(seed, points) {
  const rng = mulberry32(seed ^ 0x10075);
  const items = []; let n = 0;
  const add = (type, qty, x, y, z) => items.push({ id: 'L' + n++, type, qty, x, y, z });
  for (const p of points) {
    if (rng() > 0.6) continue;
    const kind = weightedPick(rng, LOOT_TABLE);
    const [x, y, z] = p;
    switch (kind) {
      case 'weapon': {
        const w = weightedPick(rng, LOOT_WEAPONS); add(w, 1, x, y, z);
        const am = WEAPONS[w].ammo; const st = AMMO[am].stack;
        add(am, st, x + 0.45, y, z + 0.2); if (rng() < 0.6) add(am, st, x - 0.4, y, z + 0.3);
        break;
      }
      case 'ammo': { const a = weightedPick(rng, AMMO_FOR_LOOT); add(a, AMMO[a].stack, x, y, z); if (rng() < 0.4) add(a, AMMO[a].stack, x + 0.35, y, z - 0.25); break; }
      case 'attach': add(weightedPick(rng, LOOT_ATTACH), 1, x, y, z); break;
      case 'armor': add(weightedPick(rng, LOOT_ARMOR), 1, x, y, z); break;
      case 'heal': { const h = weightedPick(rng, LOOT_HEAL); add(h, h === 'bandage' ? 5 : 1, x, y, z); break; }
      case 'boost': add(weightedPick(rng, LOOT_BOOST), 1, x, y, z); break;
      case 'throw': add(weightedPick(rng, LOOT_THROW), 1, x, y, z); break;
    }
  }
  return items;
}

export function makeCare(seed, zones, world) {
  const rng = mulberry32(seed ^ 0xca2e);
  const out = [];
  [1, 2, 3, 4].forEach((pi, i) => {
    const ph = zones[pi]; if (!ph) return;
    const t = ph.tStart + (ph.tShrink - ph.tStart) * 0.3;
    let x = ph.c1[0], z = ph.c1[1];
    for (let k = 0; k < 30; k++) {
      const a = rng() * Math.PI * 2, d = Math.sqrt(rng()) * ph.r1 * 0.85;
      const cx = ph.c1[0] + Math.cos(a) * d, cz = ph.c1[1] + Math.sin(a) * d;
      if (world.heightAt(cx, cz) > 1.5) { x = cx; z = cz; break; }
    }
    const items = [];
    const nItems = 3 + Math.floor(rng() * 3);
    const used = new Set();
    for (let k = 0; k < nItems; k++) {
      const it = weightedPick(rng, CARE_LOOT); if (used.has(it)) continue; used.add(it);
      items.push([it, 1]);
      if (WEAPONS[it]) items.push([WEAPONS[it].ammo, WEAPONS[it].ammo === 'a300' ? 20 : 60]);
    }
    const gy = world.groundAt(x, z, 999);
    out.push({ id: 'cp' + i, t, x, z, gy, startY: gy + 280, items });
  });
  return out;
}
