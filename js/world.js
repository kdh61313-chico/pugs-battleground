// ===== LAST CIRCLE · world (island terrain, towns, vegetation, collision) =====
import * as THREE from 'three';
import { makeNoise, mulberry32, clamp, smoothstep, lerp, segPointDist2, rand, randInt, pick } from './util.js';
import { TOWNS, ROADS, MAP_SEED } from './data.js';

export const HALF = 1000, SIZE = 2000, N = 401, CELL = SIZE / (N - 1);
const TEX = 1024, TEXG = 2048;
const GRID = 20, GN = SIZE / GRID; // collision hash
export const STEP = 0.45;

const C = (hex) => new THREE.Color(hex);

// ---------- geometry builder (merged boxes w/ vertex colors) ----------
class Builder {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.mat = []; this.cur = 0; }
  box(x0, y0, z0, x1, y1, z1, color) {
    const c = color;
    const P = this.pos, Nn = this.nor, Cc = this.col;
    const quad = (ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, nx, ny, nz, shade) => {
      P.push(ax, ay, az, bx, by, bz, cx, cy, cz, ax, ay, az, cx, cy, cz, dx, dy, dz);
      for (let i = 0; i < 6; i++) { Nn.push(nx, ny, nz); Cc.push(c.r * shade, c.g * shade, c.b * shade); this.mat.push(this.cur); }
    };
    // +Y
    quad(x0, y1, z0, x0, y1, z1, x1, y1, z1, x1, y1, z0, 0, 1, 0, 1.0);
    // -Y
    quad(x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1, 0, -1, 0, 0.85);
    // +X
    quad(x1, y0, z0, x1, y1, z0, x1, y1, z1, x1, y0, z1, 1, 0, 0, 0.92);
    // -X
    quad(x0, y0, z1, x0, y1, z1, x0, y1, z0, x0, y0, z0, -1, 0, 0, 0.92);
    // +Z
    quad(x1, y0, z1, x1, y1, z1, x0, y1, z1, x0, y0, z1, 0, 0, 1, 0.96);
    // -Z
    quad(x0, y0, z0, x0, y1, z0, x1, y1, z0, x1, y0, z0, 0, 0, -1, 0.96);
  }
  tri(a, b, c, color) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    this.pos.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) { this.nor.push(nx, ny, nz); this.col.push(color.r, color.g, color.b); this.mat.push(this.cur); }
  }
  geo(geometry, matrix, color) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    const p = g.attributes.position, n = g.attributes.normal;
    const v = new THREE.Vector3(), nn = new THREE.Vector3();
    const nm = new THREE.Matrix3().getNormalMatrix(matrix);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(matrix);
      nn.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      this.pos.push(v.x, v.y, v.z); this.nor.push(nn.x, nn.y, nn.z); this.col.push(color.r, color.g, color.b); this.mat.push(this.cur);
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aMat', new THREE.Float32BufferAttribute(this.mat, 1));
    g.computeBoundingSphere();
    return g;
  }
  get empty() { return this.pos.length === 0; }
}

// ---------- local frame for 90° rotated buildings ----------
class Frame {
  constructor(x, y, z, k) { this.x = x; this.y = y; this.z = z; this.k = ((k % 4) + 4) % 4; }
  pt(lx, lz) {
    switch (this.k) {
      case 0: return [this.x + lx, this.z + lz];
      case 1: return [this.x - lz, this.z + lx];
      case 2: return [this.x - lx, this.z - lz];
      default: return [this.x + lz, this.z - lx];
    }
  }
  aabb(lx0, ly0, lz0, lx1, ly1, lz1) {
    const a = this.pt(lx0, lz0), b = this.pt(lx1, lz1);
    return [Math.min(a[0], b[0]), this.y + ly0, Math.min(a[1], b[1]), Math.max(a[0], b[0]), this.y + ly1, Math.max(a[1], b[1])];
  }
}

export class World {
  constructor() {
    this.noise = makeNoise(MAP_SEED);
    this.H = new Float32Array(N * N);
    this.boxes = []; // flat array, 6 per box
    this.lootPoints = []; this.glassPanes = [];
    this.towns = TOWNS.map((t) => ({ ...t }));
    this.roads = [];
    this.footprints = [];
    this.time = 0;
  }

  // ---------- terrain ----------
  rawHeight(x, z, flatten = true) {
    const n = this.noise;
    const warp = n.fbm(x * 0.0012 + 11, z * 0.0012 - 7, 3) * 0.2;
    const r = Math.hypot(x, z * 1.06) / 860 + warp;
    let land = 1 - smoothstep(0.76, 1.0, r);
    for (const t of this.towns) {
      const d = Math.hypot(x - t.x, z - t.z);
      if (d < t.r * 2.4) land = Math.max(land, 1 - smoothstep(t.r * 1.15, t.r * 2.3, d));
    }
    const hills = n.fbm(x * 0.0024, z * 0.0024, 5);
    const ridgeN = 1 - Math.abs(n.n2(x * 0.0019 + 3.3, z * 0.0019 - 1.7));
    const mm = smoothstep(-0.05, 0.45, n.n2(x * 0.0009 - 5.1, z * 0.0009 + 2.3));
    let h = 7.5 + hills * 13 + Math.pow(ridgeN, 4) * 52 * mm + n.fbm(x * 0.013, z * 0.013, 3) * 1.4;
    h = h * land + (land - 1) * 22;
    if (flatten) {
      for (const t of this.towns) {
        const d = Math.hypot(x - t.x, z - t.z);
        if (d < t.r * 1.4) {
          const w = 1 - smoothstep(t.r * 0.82, t.r * 1.35, d);
          h = lerp(h, t.base, w);
        }
      }
    }
    return h;
  }

  heightAt(x, z) {
    const fx = (x + HALF) / CELL, fz = (z + HALF) / CELL;
    let i = Math.floor(fx), j = Math.floor(fz);
    if (i < 0 || j < 0 || i >= N - 1 || j >= N - 1) return -22;
    const u = fx - i, v = fz - j;
    const H = this.H;
    const ha = H[j * N + i], hb = H[j * N + i + 1], hc = H[(j + 1) * N + i], hd = H[(j + 1) * N + i + 1];
    if (u + v <= 1) return ha + (hb - ha) * u + (hc - ha) * v;
    return hd + (hc - hd) * (1 - u) + (hb - hd) * (1 - v);
  }
  normalAt(x, z, out) {
    const e = 1.5;
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    out = out || new THREE.Vector3();
    return out.set(-hx, 2 * e, -hz).normalize();
  }
  isWater(x, z) { return this.heightAt(x, z) < -0.2; }

  // ---------- build all ----------
  async build(scene, renderer, quality, progress = () => {}) {
    this.scene = scene; this.quality = quality;
    const tick = () => new Promise((r) => setTimeout(r, 0));
    progress(0.05, '지형 생성 중');
    for (const t of this.towns) t.base = clamp(this.rawHeight(t.x, t.z, false), 3.5, 36);
    const H = this.H;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) H[j * N + i] = this.rawHeight(-HALF + i * CELL, -HALF + j * CELL);
    await tick();
    this.makeRoads();
    progress(0.2, '건물 배치 중');
    await tick();
    this.buildTowns();
    progress(0.45, '지면 텍스처 생성 중');
    await tick();
    this.paintGround();
    progress(0.6, '바다와 하늘 생성 중');
    await tick();
    this.buildTerrainMesh(renderer);
    this.buildWater();
    this.buildSky();
    progress(0.7, '숲 생성 중');
    await tick();
    this.buildVegetation();
    progress(0.85, '충돌 데이터 정리 중');
    await tick();
    this.finalizeCollision();
    this.buildGlass();
    this.buildMapCanvas();
    this.buildGrass();
    progress(1, '완료');
  }

  makeRoads() {
    const byId = Object.fromEntries(this.towns.map((t) => [t.id, t]));
    const rng = mulberry32(MAP_SEED ^ 0x51);
    for (const [a, b] of ROADS) {
      const A = byId[a], B = byId[b];
      const pts = [];
      const len = Math.hypot(B.x - A.x, B.z - A.z);
      const nSeg = Math.max(4, Math.floor(len / 40));
      const px = -(B.z - A.z) / len, pz = (B.x - A.x) / len;
      const ph = rng() * 10;
      for (let i = 0; i <= nSeg; i++) {
        const t = i / nSeg;
        const off = Math.sin(t * Math.PI) * (this.noise.n2(ph + t * 2.3, ph) * 70);
        pts.push([lerp(A.x, B.x, t) + px * off, lerp(A.z, B.z, t) + pz * off]);
      }
      this.roads.push(pts);
    }
  }
  roadDist2(x, z) {
    let best = 1e12;
    for (const r of this.roads) for (let i = 0; i < r.length - 1; i++) {
      const a = r[i], b = r[i + 1];
      if (Math.abs(x - a[0]) > 120 && Math.abs(x - b[0]) > 120) continue;
      const d = segPointDist2(a[0], a[1], b[0], b[1], x, z);
      if (d < best) best = d;
    }
    return best;
  }

  // ---------- collision boxes ----------
  addCol(b, glass = -1) { this.boxes.push(b[0], b[1], b[2], b[3], b[4], b[5]); (this.boxGlassL || (this.boxGlassL = [])).push(glass); }
  // ---------- breakable glass ----------
  addGlass(a) { // a = world AABB of a pane
    const id = this.glassPanes.length; this.glassPanes.push(a); this.addCol(a, id); return id;
  }
  buildGlass() {
    const n = this.glassPanes.length; this.glassBroken = new Uint8Array(n);
    if (!n) return;
    const mat = new THREE.MeshStandardMaterial({ color: 0x9fc4d8, transparent: true, opacity: 0.34, roughness: 0.05, metalness: 0.5, depthWrite: false });
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, n);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    // visual pane is inset from the opening (so it never shares a plane with reveals/frames) and paper-thin
    this.glassPanes.forEach((a, i) => { const sx = a[3] - a[0], sy = a[4] - a[1], sz = a[5] - a[2]; const thinX = sx < sz;
      m4.compose(new THREE.Vector3((a[0] + a[3]) / 2, (a[1] + a[4]) / 2, (a[2] + a[5]) / 2), q, new THREE.Vector3(thinX ? 0.012 : sx - 0.03, sy - 0.03, thinX ? sz - 0.03 : 0.012)); im.setMatrixAt(i, m4); });
    im.instanceMatrix.needsUpdate = true; im.renderOrder = 3;
    this.scene.add(im); this.glassMesh = im;
  }
  isGlassBox(i) { return this.boxGlass && this.boxGlass[i] >= 0; }
  glassBlocks(i) { const g = this.boxGlass[i]; return g < 0 || !this.glassBroken[g]; }
  breakGlass(id) {
    if (id < 0 || !this.glassBroken || this.glassBroken[id]) return false;
    this.glassBroken[id] = 1;
    if (this.glassMesh) { this.glassMesh.setMatrixAt(id, new THREE.Matrix4().makeScale(0, 0, 0)); this.glassMesh.instanceMatrix.needsUpdate = true; }
    return true;
  }
  glassCenter(id) { const a = this.glassPanes[id]; return { x: (a[0] + a[3]) / 2, y: (a[1] + a[4]) / 2, z: (a[2] + a[5]) / 2 }; }

  finalizeCollision() {
    const B = (this.boxArr = new Float32Array(this.boxes));
    const nb = B.length / 6;
    this.nBoxes = nb;
    this.stamp = new Uint32Array(nb); this.stampId = 1;
    this.boxGlass = Int32Array.from(this.boxGlassL); this.boxGlassL = null;
    const cells = new Array(GN * GN);
    for (let i = 0; i < nb; i++) {
      const o = i * 6;
      const cx0 = clamp(Math.floor((B[o] + HALF) / GRID), 0, GN - 1), cx1 = clamp(Math.floor((B[o + 3] + HALF) / GRID), 0, GN - 1);
      const cz0 = clamp(Math.floor((B[o + 2] + HALF) / GRID), 0, GN - 1), cz1 = clamp(Math.floor((B[o + 5] + HALF) / GRID), 0, GN - 1);
      for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) {
        const k = cz * GN + cx;
        (cells[k] || (cells[k] = [])).push(i);
      }
    }
    this.cells = cells;
    this.boxes = null;
  }
  forBoxes(x0, z0, x1, z1, fn) {
    const cx0 = clamp(Math.floor((x0 + HALF) / GRID), 0, GN - 1), cx1 = clamp(Math.floor((x1 + HALF) / GRID), 0, GN - 1);
    const cz0 = clamp(Math.floor((z0 + HALF) / GRID), 0, GN - 1), cz1 = clamp(Math.floor((z1 + HALF) / GRID), 0, GN - 1);
    const sid = ++this.stampId; const st = this.stamp;
    for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) {
      const c = this.cells[cz * GN + cx]; if (!c) continue;
      for (let k = 0; k < c.length; k++) { const i = c[k]; if (st[i] === sid) continue; st[i] = sid; fn(i * 6); }
    }
  }
  // ground under (x,z) for something whose feet are at footY
  groundAt(x, z, footY, r = 0.25) {
    let g = this.heightAt(x, z);
    const B = this.boxArr;
    this.forBoxes(x - r, z - r, x + r, z + r, (o) => {
      if (x + r * 0.6 < B[o] || x - r * 0.6 > B[o + 3] || z + r * 0.6 < B[o + 2] || z - r * 0.6 > B[o + 5]) return;
      if (this.boxGlass[o / 6] >= 0) return;
      const top = B[o + 4];
      if (top <= footY + STEP && top > g) g = top;
    });
    return g;
  }
  // circle-vs-AABB push out; mutates p (Vector3: feet position)
  collide(p, r, height) {
    const B = this.boxArr;
    for (let it = 0; it < 3; it++) {
      let moved = false;
      this.forBoxes(p.x - r, p.z - r, p.x + r, p.z + r, (o) => {
        if (B[o + 4] <= p.y + STEP || B[o + 1] >= p.y + height) return;
        if (!this.glassBlocks(o / 6)) return;
        const cx = clamp(p.x, B[o], B[o + 3]), cz = clamp(p.z, B[o + 2], B[o + 5]);
        let dx = p.x - cx, dz = p.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) return;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2); const push = r - d;
          p.x += (dx / d) * push; p.z += (dz / d) * push;
        } else { // inside: push along min axis
          const l = p.x - B[o], rr = B[o + 3] - p.x, f = p.z - B[o + 2], bk = B[o + 5] - p.z;
          const m = Math.min(l, rr, f, bk);
          if (m === l) p.x = B[o] - r; else if (m === rr) p.x = B[o + 3] + r; else if (m === f) p.z = B[o + 2] - r; else p.z = B[o + 5] + r;
        }
        moved = true;
      });
      if (!moved) break;
    }
    p.x = clamp(p.x, -HALF + 2, HALF - 2); p.z = clamp(p.z, -HALF + 2, HALF - 2);
  }
  ceilingAbove(x, z, y, r = 0.25) {
    let c = Infinity; const B = this.boxArr;
    this.forBoxes(x - r, z - r, x + r, z + r, (o) => {
      if (x < B[o] || x > B[o + 3] || z < B[o + 2] || z > B[o + 5]) return;
      if (this.boxGlass[o / 6] >= 0) return;
      if (B[o + 1] >= y && B[o + 1] < c) c = B[o + 1];
    });
    return c;
  }

  // Ray: returns {t, kind, nx,ny,nz} or null
  raycast(ox, oy, oz, dx, dy, dz, maxD, terrain = true, glass = 0) {
    let best = maxD, kind = null, nx = 0, ny = 0, nz = 0, pane = -1;
    // boxes via 2D DDA
    const B = this.boxArr;
    const sid = ++this.stampId; const st = this.stamp;
    let gx = Math.floor((ox + HALF) / GRID), gz = Math.floor((oz + HALF) / GRID);
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tdx = Math.abs(dx) > 1e-9 ? GRID / Math.abs(dx) : Infinity;
    const tdz = Math.abs(dz) > 1e-9 ? GRID / Math.abs(dz) : Infinity;
    let tmx = Math.abs(dx) > 1e-9 ? ((dx > 0 ? (gx + 1) * GRID - (ox + HALF) : (ox + HALF) - gx * GRID) / Math.abs(dx)) : Infinity;
    let tmz = Math.abs(dz) > 1e-9 ? ((dz > 0 ? (gz + 1) * GRID - (oz + HALF) : (oz + HALF) - gz * GRID) / Math.abs(dz)) : Infinity;
    let tc = 0, guard = 0;
    const idx = 1 / dx, idy = 1 / dy, idz = 1 / dz;
    while (tc <= best && guard++ < 400) {
      if (gx >= 0 && gz >= 0 && gx < GN && gz < GN) {
        const c = this.cells[gz * GN + gx];
        if (c) for (let k = 0; k < c.length; k++) {
          const i = c[k]; if (st[i] === sid) continue; st[i] = sid;
          const gi = this.boxGlass[i];
          if (gi >= 0 && (!glass || this.glassBroken[gi])) continue;
          const o = i * 6;
          let t1 = (B[o] - ox) * idx, t2 = (B[o + 3] - ox) * idx;
          let tmin = Math.min(t1, t2), tmax = Math.max(t1, t2), ax = 0;
          t1 = (B[o + 1] - oy) * idy; t2 = (B[o + 4] - oy) * idy;
          let a = Math.min(t1, t2), b = Math.max(t1, t2);
          if (a > tmin) { tmin = a; ax = 1; } if (b < tmax) tmax = b;
          t1 = (B[o + 2] - oz) * idz; t2 = (B[o + 5] - oz) * idz;
          a = Math.min(t1, t2); b = Math.max(t1, t2);
          if (a > tmin) { tmin = a; ax = 2; } if (b < tmax) tmax = b;
          if (tmax >= Math.max(tmin, 0) && tmin < best && tmin >= 0) {
            best = tmin; kind = gi >= 0 ? 'glass' : 'box'; pane = gi;
            nx = ax === 0 ? -Math.sign(dx) : 0; ny = ax === 1 ? -Math.sign(dy) : 0; nz = ax === 2 ? -Math.sign(dz) : 0;
          }
        }
      }
      if (tmx < tmz) { tc = tmx; tmx += tdx; gx += stepX; } else { tc = tmz; tmz += tdz; gz += stepZ; }
      if ((gx < -1 || gx > GN || gz < -1 || gz > GN)) break;
    }
    if (terrain) {
      let t = 0, prevT = 0, prevAbove = oy - this.heightAt(ox, oz);
      if (prevAbove < 0) return { t: 0, kind: 'terrain', nx: 0, ny: 1, nz: 0 };
      while (t < best) {
        const above = prevAbove;
        const stp = Math.max(0.6, above * 0.45);
        t = Math.min(best, t + stp);
        const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
        const h = this.heightAt(x, z);
        if (y < 0 && h < 0) { // water surface
          const tw = dy < 0 ? (0 - oy) / dy : t;
          if (tw < best) { best = tw; kind = 'water'; nx = 0; ny = 1; nz = 0; }
          break;
        }
        const ab = y - h;
        if (ab < 0) {
          let lo = prevT, hi = t;
          for (let k = 0; k < 10; k++) { const m = (lo + hi) / 2; const yy = oy + dy * m; if (yy - this.heightAt(ox + dx * m, oz + dz * m) < 0) hi = m; else lo = m; }
          best = hi; kind = 'terrain';
          const nn = this.normalAt(ox + dx * hi, oz + dz * hi); nx = nn.x; ny = nn.y; nz = nn.z;
          break;
        }
        prevT = t; prevAbove = ab;
        if (t >= best) break;
      }
    }
    if (!kind) return null;
    return { t: best, kind, nx, ny, nz, pane: kind === 'glass' ? pane : -1 };
  }
  los(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az; const d = Math.hypot(dx, dy, dz);
    if (d < 0.01) return true;
    const h = this.raycast(ax, ay, az, dx / d, dy / d, dz / d, d - 0.3, true);
    return !h;
  }

  // ---------- towns ----------
  buildTowns() {
    this.bList = []; this.gList = [];
    const newChunk = () => { this.bMain = new Builder(); this.bGlass = new Builder(); this.bList.push(this.bMain); this.gList.push(this.bGlass); };
    const cellB = {};
    this.useCell = (x, z) => { const k = Math.floor((x + HALF) / 400) + ',' + Math.floor((z + HALF) / 400); if (!cellB[k]) { newChunk(); cellB[k] = [this.bMain, this.bGlass]; } [this.bMain, this.bGlass] = cellB[k]; };
    newChunk();
    const rng = mulberry32(MAP_SEED ^ 0x7a11);
    const PAL = {
      city: [0xd8cdb8, 0xb9b4aa, 0xa9b8c4, 0xb46a52, 0xcfc29a, 0x9aa39a, 0xe2ddd2],
      village: [0xeee7d6, 0xe0d3b4, 0x9c7a56, 0xc9b79a, 0xd8d0c0],
      harbor: [0xa9b8c4, 0xd8cdb8, 0x8e9aa4, 0xc4a17a],
      military: [0x6d7556, 0x7a7d66, 0x5e6650],
      industrial: [0x8e969c, 0xa4a8a8, 0x7d8a92],
      school: [0xc9a27a, 0xd8cdb8],
      farm: [0xa8432f, 0xe9e1cf, 0xc9b79a],
      quarry: [0xb9ad98, 0x8e8270],
    };
    const ROOF = [0x8a3a2a, 0x4a4f57, 0x2f5a46, 0x6a4a3a, 0x3d4250];
    for (const t of this.towns) {
      const cellSz = t.style === 'city' ? 27 : 32;
      const cand = [];
      const nC = Math.ceil(t.r / cellSz);
      for (let gz = -nC; gz <= nC; gz++) for (let gx = -nC; gx <= nC; gx++) {
        const x = t.x + gx * cellSz + (rng() - 0.5) * 3, z = t.z + gz * cellSz + (rng() - 0.5) * 3;
        if (Math.hypot(x - t.x, z - t.z) > t.r * 0.92) continue;
        cand.push([x, z, Math.hypot(x - t.x, z - t.z)]);
      }
      cand.sort((a, b) => a[2] - b[2] + (rng() - 0.5) * 30);
      const pal = PAL[t.style] || PAL.village;
      newChunk();
      let made = 0;
      for (const [x, z] of cand) {
        if (made >= t.n) break;
        const k = randInt(rng, 0, 3);
        const wall = C(pick(rng, pal)), roof = C(pick(rng, ROOF));
        const type = this.pickType(t.style, made, rng);
        this.placeBuilding(type, x, z, k, wall, roof, rng, t);
        made++;
      }
      this.townExtras(t, rng);
    }
    // scattered houses in the wild
    for (let i = 0; i < 70; i++) {
      const x = rand(rng, -720, 720), z = rand(rng, -720, 720);
      const h = this.heightAt(x, z) || this.rawHeight(x, z);
      if (this.rawHeight(x, z) < 3) continue;
      if (this.towns.some((t) => Math.hypot(x - t.x, z - t.z) < t.r + 40)) continue;
      const n = this.normalAtRaw(x, z); if (n < 0.9) continue;
      const type = rng() < 0.55 ? 'house1' : rng() < 0.6 ? 'house2' : 'shed';
      this.useCell(x, z);
      this.placeBuilding(type, x, z, randInt(rng, 0, 3), C(pick(rng, PAL.village)), C(pick(rng, ROOF)), rng, null);
    }
  }
  normalAtRaw(x, z) {
    const e = 4; const hx = this.rawHeight(x + e, z) - this.rawHeight(x - e, z), hz = this.rawHeight(x, z + e) - this.rawHeight(x, z - e);
    return 2 * e / Math.hypot(hx, 2 * e, hz);
  }
  pickType(style, i, rng) {
    const r = rng();
    switch (style) {
      case 'city': return r < 0.38 ? 'apt' : r < 0.7 ? 'house2' : r < 0.88 ? 'house1' : 'warehouse';
      case 'harbor': return r < 0.35 ? 'warehouse' : r < 0.6 ? 'containers' : r < 0.85 ? 'house2' : 'house1';
      case 'military': return i === 0 || i === 1 ? 'warehouse' : r < 0.45 ? 'barracks' : r < 0.7 ? 'containers' : r < 0.85 ? 'tower' : 'shed';
      case 'industrial': return i === 0 || i === 1 ? 'cooling' : r < 0.4 ? 'warehouse' : r < 0.65 ? 'tanks' : r < 0.85 ? 'containers' : 'shed';
      case 'school': return i === 0 ? 'school' : i === 1 ? 'warehouse' : r < 0.6 ? 'house2' : 'house1';
      case 'farm': return i === 0 ? 'barn' : i === 1 ? 'silo' : r < 0.4 ? 'house2g' : r < 0.7 ? 'house1g' : r < 0.85 ? 'barn' : 'shed';
      case 'quarry': return r < 0.5 ? 'shed' : r < 0.8 ? 'house1' : 'warehouse';
      default: return r < 0.45 ? 'house1g' : r < 0.8 ? 'house2g' : 'shed';
    }
  }

  placeBuilding(type, x, z, k, wall, roof, rng, town) {
    const fp = { house1: [9, 11], house1g: [9, 11], house2: [11, 13], house2g: [11, 13], apt: [13, 15], warehouse: [19, 29], barracks: [9, 22], shed: [7, 7], containers: [14, 14], tower: [5, 5], cooling: [26, 26], tanks: [18, 18], school: [28, 15], barn: [15, 22], silo: [8, 8] }[type] || [10, 10];
    const hw = (k % 2 === 0 ? fp[0] : fp[1]) / 2, hd = (k % 2 === 0 ? fp[1] : fp[0]) / 2;
    let ymax = -1e9, ymin = 1e9;
    for (const [cx, cz] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd], [0, 0]]) {
      const h = this.rawHeight(x + cx, z + cz); ymax = Math.max(ymax, h); ymin = Math.min(ymin, h);
    }
    if (ymin < 0.6 && type !== 'containers') return;
    const f = new Frame(x, ymax + 0.05, z, k);
    f.ymin = ymin;
    this.footprints.push([x - hw, z - hd, x + hw, z + hd, type]);
    const gable = type.endsWith('g') || type === 'barn';
    switch (type) {
      case 'house1': case 'house1g': this.block(f, { w: 8, d: 10, floors: 1, wall, roof, gable, rng, wmat: gable ? (rng() < 0.4 ? 4 : 1) : undefined }); break;
      case 'house2': case 'house2g': this.block(f, { w: 10, d: 12, floors: 2, wall, roof, gable, rng, wmat: gable ? (rng() < 0.3 ? 4 : 1) : undefined }); break;
      case 'apt': this.block(f, { w: 12, d: 14, floors: rng() < 0.5 ? 3 : 4, wall, roof, gable: false, rng, parapet: true, wmat: pick(rng, [1, 2, 3]) }); break;
      case 'barracks': this.block(f, { w: 8, d: 20, floors: 1, wall, roof: C(0x4a4f3a), gable: false, rng, parapet: true, nPart: 3, wmat: 3 }); break;
      case 'school': this.block(f, { w: 26, d: 13, floors: 2, wall, roof: C(0x5a5f66), gable: false, rng, parapet: true, nPart: 3, wmat: 2 }); break;
      case 'warehouse': this.warehouse(f, { w: 18, d: 28, h: 7, wall, roof, rng }); break;
      case 'barn': this.warehouse(f, { w: 14, d: 20, h: 6, wall: C(0xa8432f), roof: C(0x4a3a30), rng, barn: true }); break;
      case 'shed': this.shed(f, wall, roof, rng); break;
      case 'containers': this.containerYard(f, rng); break;
      case 'tower': this.watchTower(f); break;
      case 'cooling': this.coolingTower(f); break;
      case 'tanks': this.tanks(f, rng); break;
      case 'silo': this.silo(f); break;
    }
  }

  M(id) { if (this.bMain) this.bMain.cur = id; }
  // box helper in local frame: add visual (+ collision)
  lbox(f, x0, y0, z0, x1, y1, z1, color, col = true, glass = false) {
    const a = f.aabb(x0, y0, z0, x1, y1, z1);
    (glass ? this.bGlass : this.bMain).box(a[0], a[1], a[2], a[3], a[4], a[5], color);
    if (col) this.addCol(a);
  }
  // wall along local x (axis 'x') at z=c, or along z at x=c
  wall(f, axis, a0, a1, c, t, y0, h, openings, color) {
    const ops = openings.filter((o) => o[1] > a0 && o[0] < a1).sort((p, q) => p[0] - q[0]);
    const seg = (s0, s1, yb, yt) => {
      if (s1 - s0 < 0.01 || yt - yb < 0.01) return;
      if (axis === 'x') this.lbox(f, s0, y0 + yb, c - t / 2, s1, y0 + yt, c + t / 2, color);
      else this.lbox(f, c - t / 2, y0 + yb, s0, c + t / 2, y0 + yt, s1, color);
    };
    let cur = a0;
    for (const o of ops) {
      seg(cur, o[0], 0, h);
      seg(o[0], o[1], 0, o[2]);
      seg(o[0], o[1], o[3], h);
      if (o[4] || o[2] === 0) { // frames + sills
        const prev = this.bMain.cur; this.M(4);
        const fc = this.frameColor || C(0xe8e4dc), ft = t + 0.04, fw = 0.07;
        const fr = (a0, b0, a1, b1) => { if (axis === 'x') this.lbox(f, a0, y0 + b0, c - ft / 2, a1, y0 + b1, c + ft / 2, fc, false); else this.lbox(f, c - ft / 2, y0 + b0, a0, c + ft / 2, y0 + b1, a1, fc, false); };
        // frames reach 12mm into the opening so their faces never coincide with the wall's reveal faces (no flicker)
        const ii = 0.012;
        fr(o[0] - fw, o[2] - (o[4] ? fw : 0), o[0] + ii, o[3] + fw); fr(o[1] - ii, o[2] - (o[4] ? fw : 0), o[1] + fw, o[3] + fw); fr(o[0] + ii, o[3] - ii, o[1] - ii, o[3] + fw);
        if (o[4]) { fr(o[0] + ii, o[2] - fw, o[1] - ii, o[2] + ii); const sw = t + 0.16; if (axis === 'x') this.lbox(f, o[0] - 0.1, y0 + o[2] - 0.09, c - sw / 2, o[1] + 0.1, y0 + o[2] - 0.03, c + sw / 2, C(0xb8b4ac), false); else this.lbox(f, c - sw / 2, y0 + o[2] - 0.09, o[0] - 0.1, c + sw / 2, y0 + o[2] - 0.03, o[1] + 0.1, C(0xb8b4ac), false);
          // mullion
          const mid = (o[0] + o[1]) / 2; fr(mid - 0.025, o[2], mid + 0.025, o[3]); }
        this.M(prev);
      }
      if (o[4]) { // breakable glass pane (blocks bullets & people until broken)
        if (axis === 'x') this.addGlass(f.aabb(o[0], y0 + o[2], c - 0.03, o[1], y0 + o[3], c + 0.03));
        else this.addGlass(f.aabb(c - 0.03, y0 + o[2], o[0], c + 0.03, y0 + o[3], o[1]));
      }
      cur = o[1];
    }
    seg(cur, a1, 0, h);
  }
  windows(len, from, skip = []) {
    const n = Math.max(1, Math.floor(len / 3.2)); const out = [];
    const sp = len / n;
    for (let i = 0; i < n; i++) {
      const c = from + sp * (i + 0.5);
      if (skip.some(([s0, s1]) => c + 0.7 > s0 && c - 0.7 < s1)) continue;
      out.push([c - 0.6, c + 0.6, 1.0, 2.15, true]);
    }
    return out;
  }
  slab(f, x0, z0, x1, z1, y0, y1, color, hole) {
    if (!hole) { this.lbox(f, x0, y0, z0, x1, y1, z1, color); return; }
    const [hx0, hz0, hx1, hz1] = hole;
    this.lbox(f, x0, y0, z0, x1, y1, hz0, color);
    this.lbox(f, x0, y0, hz1, x1, y1, z1, color);
    this.lbox(f, x0, y0, hz0, hx0, y1, hz1, color);
    this.lbox(f, hx1, y0, hz0, x1, y1, hz1, color);
  }

  block(f, o) {
    const { w, d, floors, wall, roof, gable, rng } = o;
    const fh = 3.2, t = 0.25, hw = w / 2, hd = d / 2;
    const trim = wall.clone().multiplyScalar(0.72), floorC = C(0x8a7a66), concrete = C(0x9a968e);
    const ground = 0.25;
    const wm = o.wmat ?? (o.rng() < 0.45 ? 2 : 1);
    const fm = o.rng() < 0.5 ? 7 : 8;
    this.frameColor = wm === 2 ? C(0xe9e6df) : C(pick(o.rng, [0xf2efe8, 0x4a4038, 0x5a6a5a, 0x3a4a5a]));
    if (wm === 2) wall.setHex(pick(o.rng, [0xa45a44, 0x8c4a3a, 0xb8735a, 0x9a6a54]));
    // foundation
    this.M(3);
    this.lbox(f, -hw - 0.15, f.ymin - f.y - 1.2, -hd - 0.15, hw + 0.15, ground, hd + 0.15, concrete);
    const laneW = 1.2, run = 3.2;
    const laneA = [hw - t / 2 - laneW, hw - t / 2], laneB = [hw - t / 2 - 2 * laneW, hw - t / 2 - laneW];
    const zS = hd - t / 2 - 1.5 - run;
    const stairZone = [laneB[0] - 0.2, zS - 1.3, hw, hd];
    for (let fl = 0; fl < floors; fl++) {
      const y0 = ground + fl * fh;
      // walls (front has door on floor 0)
      const frontOps = this.windows(w - 1, -hw + 0.5, fl === 0 ? [[-0.9, 0.9]] : []);
      if (fl === 0) frontOps.push([-0.7, 0.7, 0, 2.3]);
      const backOps = this.windows(w - 1, -hw + 0.5, fl === 0 ? [[-0.9, 0.9]] : []);
      if (fl === 0 && w > 9) backOps.push([-0.7, 0.7, 0, 2.3]);
      this.M(wm);
      this.wall(f, 'x', -hw, hw, -hd + t / 2, t, y0, fh, frontOps, wall);
      this.wall(f, 'x', -hw, hw, hd - t / 2, t, y0, fh, backOps, wall);
      this.wall(f, 'z', -hd + t, hd - t, -hw + t / 2, t, y0, fh, this.windows(d - 1, -hd + 0.5), wall);
      const rightOps = this.windows(d - 1, -hd + 0.5, [[zS - 0.5, hd]]);
      this.wall(f, 'z', -hd + t, hd - t, hw - t / 2, t, y0, fh, rightOps, wall);
      // floor slab of this level (fl>0) with hole for stairs coming from below
      this.M(fm);
      if (fl > 0) {
        const lane = (fl - 1) % 2 === 0 ? laneA : laneB;
        this.slab(f, -hw + t, -hd + t, hw - t, hd - t, y0 - 0.25, y0, floorC, [lane[0] - 0.05, zS - 0.15, lane[1] + 0.05, zS + run + 0.1]);
      } else {
        this.lbox(f, -hw + t, ground - 0.01, -hd + t, hw - t, ground + 0.012, hd - t, floorC, false); // sits 12mm proud of the foundation (no flicker)
      }
      // interior partition walls
      this.M(1);
      const px = -hw + w * 0.38;
      this.wall(f, 'z', -hd + t, hd - t, px, 0.15, y0, fh - 0.01, [[-hd * 0.5 - 0.5, -hd * 0.5 + 0.5, 0, 2.2], [hd * 0.45 - 0.5, hd * 0.45 + 0.5, 0, 2.2]], trim);
      const pz = (o.nPart && d > 15) ? -hd * 0.1 : -hd + d * 0.42;
      if (laneB[0] - 0.3 > px + 0.2) this.wall(f, 'x', px + 0.08, laneB[0] - 0.3, pz, 0.15, y0, fh - 0.01, [[(px + laneB[0]) / 2 - 0.5, (px + laneB[0]) / 2 + 0.5, 0, 2.2]], trim);
      // stairs flight fl -> fl+1
      if (fl < floors - 1 || (fl === floors - 1 && !gable)) { // last flight leads onto the flat roof
        this.M(3);
        const even = fl % 2 === 0; const lane = even ? laneA : laneB;
        for (let s = 0; s < 10; s++) {
          const top = y0 + (s + 1) * 0.32;
          const za = even ? zS + s * 0.32 : zS + run - (s + 1) * 0.32;
          this.lbox(f, lane[0], y0, za, lane[1], top, za + 0.32, C(0x6e6458));
        }
      }
      // furniture & loot
      this.M(0);
      this.furnish(f, -hw + t, -hd + t, hw - t, hd - t, y0, rng, floors > 1 || !gable ? stairZone : null, px);
    }
    const yTop = ground + floors * fh;
    this.M(gable ? 1 : 9);
    if (gable) this.lbox(f, -hw - 0.2, yTop - 0.02, -hd - 0.2, hw + 0.2, yTop + 0.25, hd + 0.2, trim);
    else {
      // flat roof with a stairwell opening above the last flight + safety rail around it
      const lane = (floors - 1) % 2 === 0 ? laneA : laneB, even = (floors - 1) % 2 === 0;
      const hx0 = lane[0] - 0.05, hx1 = lane[1] + 0.05, hz0 = zS - 0.15, hz1 = zS + run + 0.1;
      this.slab(f, -hw - 0.2, -hd - 0.2, hw + 0.2, hd + 0.2, yTop - 0.02, yTop + 0.25, C(0x77736c), [hx0, hz0, hx1, hz1]);
      const rc = C(0x55595e), ry = yTop + 0.25;
      this.M(0);
      if (hx0 > -hw + 0.3) this.lbox(f, hx0 - 0.06, ry, hz0, hx0, ry + 1.0, hz1, rc);
      this.lbox(f, hx0 - 0.06, ry, even ? hz0 - 0.06 : hz1, hx1, ry + 1.0, even ? hz0 : hz1 + 0.06, rc);
      // little roof-access hut roof over the opening so it reads as a stairwell
      this.lbox(f, hx0 - 0.1, ry + 2.3, hz0 - 0.1, hx1 + 0.1, ry + 2.42, hz1 + 0.1, C(0x5a5f66), false);
      for (const [px2, pz2] of [[hx0 - 0.06, hz0 - 0.06], [hx0 - 0.06, hz1], [hx1 - 0.02, hz0 - 0.06], [hx1 - 0.02, hz1]]) this.lbox(f, px2, ry, pz2, px2 + 0.08, ry + 2.3, pz2 + 0.08, rc);
      this.M(9);
    }
    if (o.parapet || !gable) {
      const pc = trim; this.M(3);
      this.lbox(f, -hw - 0.2, yTop + 0.25, -hd - 0.2, hw + 0.2, yTop + 0.8, -hd + 0.05, pc);
      this.lbox(f, -hw - 0.2, yTop + 0.25, hd - 0.05, hw + 0.2, yTop + 0.8, hd + 0.2, pc);
      this.lbox(f, -hw - 0.2, yTop + 0.25, -hd + 0.05, -hw + 0.05, yTop + 0.8, hd - 0.05, pc);
      this.lbox(f, hw - 0.05, yTop + 0.25, -hd + 0.05, hw + 0.2, yTop + 0.8, hd - 0.05, pc);
      if (rng() < 0.5) this.lbox(f, -1.2, yTop + 0.25, -1.2, 1.2, yTop + 1.6, 1.2, C(0x8c8c88)); // AC unit / roof box
      this.lootPoints.push(this.lpt(f, rand(rng, -hw + 1, hw - 1), yTop + 0.3, rand(rng, -hd + 1, hd - 1)));
    } else this.gableRoof(f, hw, hd, yTop + 0.25, roof);
    // entrance steps + canopy
    this.M(3);
    this.lbox(f, -1.1, -0.05, -hd - 0.75, 1.1, 0.12, -hd - 0.15, C(0x9a968e));
    this.lbox(f, -1.3, 2.75, -hd - 1.0, 1.3, 2.85, -hd, C(0x5a5f66), false);
    // wall base trim
    this.M(3); this.lbox(f, -hw - 0.03, ground - 0.1, -hd - 0.03, hw + 0.03, ground + 0.35, -hd + 0.2, C(0x8a867e), false);
    this.M(0);
  }
  gableRoof(f, hw, hd, y0, color) {
    const rise = Math.min(2.4, hw * 0.45), oh = 0.4;
    const A = (lx, ly, lz) => { const p = f.pt(lx, lz); return [p[0], f.y + ly, p[1]]; };
    const x0 = -hw - oh, x1 = hw + oh, z0 = -hd - oh, z1 = hd + oh;
    const dark = color.clone().multiplyScalar(0.8);
    // ridge along local z
    const a = A(x0, y0, z0), b = A(0, y0 + rise, z0), c = A(0, y0 + rise, z1), d = A(x0, y0, z1);
    const e = A(x1, y0, z0), g = A(x1, y0, z1);
    const flip = f.k === 1 || f.k === 3 ? false : false;
    const T = (p, q, r, col) => this.bMain.tri(p, q, r, col);
    this.M(5);
    T(a, d, c, color); T(a, c, b, color);
    T(e, b, c, dark); T(e, c, g, dark);
    T(b, d, a, color); T(c, d, b, color); // backfaces (double-side look)
    T(b, e, g, dark); T(c, b, g, dark);
    // gables
    this.M(1);
    const wc = C(0xd8d0c0);
    const ga = A(-hw, y0, -hd + 0.01), gb = A(0, y0 + rise - 0.2, -hd + 0.01), gc = A(hw, y0, -hd + 0.01);
    T(ga, gb, gc, wc); T(gc, gb, ga, wc);
    const ha = A(-hw, y0, hd - 0.01), hb = A(0, y0 + rise - 0.2, hd - 0.01), hc = A(hw, y0, hd - 0.01);
    T(ha, hb, hc, wc); T(hc, hb, ha, wc);
    // stepped collision
    const steps = 4;
    for (let s = 0; s < steps; s++) {
      const fx = (s + 1) / steps; const yy = y0 + rise * (1 - (s + 0.5) / steps);
      const xa = hw * (s / steps), xb = hw * fx;
      this.addCol(f.aabb(-xb - oh * fx, y0, z0, -xa, yy, z1));
      this.addCol(f.aabb(xa, y0, z0, xb + oh * fx, yy, z1));
    }
  }
  lpt(f, lx, ly, lz) { const p = f.pt(lx, lz); return [p[0], f.y + ly, p[1]]; }
  furnish(f, x0, z0, x1, z1, y0, rng, avoid, px) {
    const inAvoid = (x, z, m = 0.8) => avoid && x > avoid[0] - m && z > avoid[1] - m;
    const wood = C(0x7a5a3c), dark = C(0x4a4a4a), fabric = C(pick(rng, [0x6a7a8a, 0x8a5a5a, 0x5a7a5a, 0x7a6a8a]));
    const n = Math.floor(((x1 - x0) * (z1 - z0)) / 30) + 1;
    for (let i = 0; i < n; i++) {
      const lx = rand(rng, x0 + 1.2, x1 - 1.2), lz = rand(rng, z0 + 1.2, z1 - 1.2);
      if (inAvoid(lx, lz, 1.5) || Math.abs(lx - px) < 1.2 || Math.abs(lz - z0) < 2.5) continue;
      const r = rng();
      if (r < 0.35) { // table
        this.lbox(f, lx - 0.7, y0 + 0.7, lz - 0.45, lx + 0.7, y0 + 0.78, lz + 0.45, wood);
        this.lbox(f, lx - 0.65, y0, lz - 0.4, lx - 0.55, y0 + 0.7, lz - 0.3, wood, false);
        this.lbox(f, lx + 0.55, y0, lz + 0.3, lx + 0.65, y0 + 0.7, lz + 0.4, wood, false);
        this.lbox(f, lx + 0.55, y0, lz - 0.4, lx + 0.65, y0 + 0.7, lz - 0.3, wood, false);
        this.lbox(f, lx - 0.65, y0, lz + 0.3, lx - 0.55, y0 + 0.7, lz + 0.4, wood, false);
        this.lootPoints.push(this.lpt(f, lx, 0.8 + (y0 - 0), lz));
      } else if (r < 0.55) { // couch / bed
        this.lbox(f, lx - 1, y0, lz - 0.45, lx + 1, y0 + 0.45, lz + 0.45, fabric);
        this.lbox(f, lx - 1, y0 + 0.45, lz + 0.25, lx + 1, y0 + 0.9, lz + 0.45, fabric.clone().multiplyScalar(0.8));
      } else if (r < 0.75) { // shelf
        this.lbox(f, lx - 0.8, y0, lz - 0.25, lx + 0.8, y0 + 1.9, lz + 0.25, dark);
      } else { // crates
        this.lbox(f, lx - 0.5, y0, lz - 0.5, lx + 0.5, y0 + 1.0, lz + 0.5, C(0x8a6a3a));
      }
    }
    // loot points on floor
    const m = Math.max(2, Math.floor(((x1 - x0) * (z1 - z0)) / 22));
    for (let i = 0; i < m; i++) {
      const lx = rand(rng, x0 + 0.6, x1 - 0.6), lz = rand(rng, z0 + 0.6, z1 - 0.6);
      if (inAvoid(lx, lz, 0.4)) continue;
      this.lootPoints.push(this.lpt(f, lx, y0 + 0.02, lz));
    }
  }
  warehouse(f, o) {
    const { w, d, h, wall, rng } = o; const hw = w / 2, hd = d / 2, t = 0.3;
    const concrete = C(0x8e8a84);
    this.M(3);
    this.lbox(f, -hw - 0.2, f.ymin - f.y - 1.2, -hd - 0.2, hw + 0.2, 0.2, hd + 0.2, concrete);
    const y0 = 0.2;
    this.frameColor = C(0x4a4f55);
    this.M(o.barn ? 4 : 6);
    const hi = (len, from) => { const out = []; const n = Math.floor(len / 4); for (let i = 0; i < n; i++) { const c = from + (len / n) * (i + 0.5); out.push([c - 1, c + 1, 4.2, 5.6, true]); } return out; };
    this.wall(f, 'x', -hw, hw, -hd + t / 2, t, y0, h, [[-2.6, 2.6, 0, 5]], wall);
    this.wall(f, 'x', -hw, hw, hd - t / 2, t, y0, h, [[-2.6, 2.6, 0, 5]], wall);
    this.wall(f, 'z', -hd + t, hd - t, -hw + t / 2, t, y0, h, [...hi(d - 2, -hd + 1), [-1, 1, 0, 2.4]], wall);
    this.wall(f, 'z', -hd + t, hd - t, hw - t / 2, t, y0, h, hi(d - 2, -hd + 1), wall);
    // roof
    this.M(o.barn ? 5 : 6);
    if (o.barn) this.gableRoof(f, hw, hd, y0 + h, o.roof);
    else {
      this.lbox(f, -hw - 0.3, y0 + h, -hd - 0.3, hw + 0.3, y0 + h + 0.3, hd + 0.3, C(0x6a6e72));
      // corrugated ribs
      for (let z = -hd; z < hd; z += 2) this.lbox(f, -hw - 0.3, y0 + h + 0.3, z, hw + 0.3, y0 + h + 0.38, z + 0.3, C(0x5a5e62), false);
    }
    if (!o.barn) { // outside staircase along the left wall up to the roof
      this.M(3); const top = y0 + h + 0.3, nS = Math.ceil(top / 0.31), rise = top / nS, zs0 = -hd + 1.5;
      for (let i = 0; i < nS; i++) { const za = zs0 + i * 0.31; this.lbox(f, -hw - 1.5, Math.max(f.ymin - f.y - 0.5, rise * i - 0.5), za, -hw - 0.3, rise * (i + 1), za + 0.31, C(0x6e6a64)); }
      const ze = zs0 + nS * 0.31;
      this.lbox(f, -hw - 1.5, top - 0.3, ze, -hw - 0.3, top, ze + 1.4, C(0x6e6a64)); // landing next to the roof edge
      const rc = C(0x4a4f55); this.M(0);
      for (let i = 0; i < nS; i++) { const za = zs0 + i * 0.31; this.lbox(f, -hw - 1.56, rise * (i + 1) + 0.92, za, -hw - 1.5, rise * (i + 1) + 1.0, za + 0.31, rc, false); if (i % 4 === 0) this.lbox(f, -hw - 1.56, rise * (i + 1), za, -hw - 1.5, rise * (i + 1) + 0.95, za + 0.05, rc, false); }
      this.lbox(f, -hw - 1.56, top, ze, -hw - 1.5, top + 1.0, ze + 1.4, rc); // landing rail
    }
    // interior: crate stacks + catwalk
    this.M(0);
    const crate = C(0x8a6a3a), metal = C(0x4f5a66);
    for (let i = 0; i < 7; i++) {
      const lx = rand(rng, -hw + 2, hw - 2), lz = rand(rng, -hd + 4, hd - 4);
      if (Math.abs(lx) < 2.5) continue;
      const s = rand(rng, 1.1, 1.6), hh = rng() < 0.4 ? 2 * s : s;
      this.lbox(f, lx - s / 2, y0, lz - s / 2, lx + s / 2, y0 + hh, lz + s / 2, rng() < 0.5 ? crate : metal);
      this.lootPoints.push(this.lpt(f, lx + s / 2 + 0.5, y0 + 0.02, lz));
      if (rng() < 0.4) this.lootPoints.push(this.lpt(f, lx, y0 + hh + 0.02, lz));
    }
    // mezzanine with stairs along the left wall
    if (!o.barn) {
      const my = y0 + 3.2, mx0 = -hw + t, mx1 = -hw + t + 4;
      this.lbox(f, mx0, my - 0.2, -hd + 6, mx1, my, hd - 2, C(0x5a5f66));
      for (let s = 0; s < 10; s++) {
        const top = y0 + (s + 1) * 0.32; const za = -hd + 2.6 + s * 0.34;
        this.lbox(f, mx1, y0, za, mx1 + 1.2, top, za + 0.34, metal);
      }
      // railing
      this.lbox(f, mx1 - 0.08, my, -hd + 9.6, mx1, my + 1, hd - 2, metal);
      for (let i = 0; i < 4; i++) this.lootPoints.push(this.lpt(f, rand(rng, mx0 + 0.7, mx1 - 0.7), my + 0.02, rand(rng, -hd + 7, hd - 3)));
    }
    for (let i = 0; i < 5; i++) this.lootPoints.push(this.lpt(f, rand(rng, -hw + 1.5, hw - 1.5), y0 + 0.02, rand(rng, -hd + 1.5, hd - 1.5)));
  }
  shed(f, wall, roof, rng) {
    const hw = 3, hd = 3, h = 2.8, t = 0.2, y0 = 0.15;
    this.M(3); this.frameColor = C(0x5a4a3a);
    this.lbox(f, -hw - 0.1, f.ymin - f.y - 1, -hd - 0.1, hw + 0.1, y0, hd + 0.1, C(0x8e8a84));
    this.M(4);
    this.wall(f, 'x', -hw, hw, -hd + t / 2, t, y0, h, [[-1.8, 1.8, 0, 2.4]], wall);
    this.wall(f, 'x', -hw, hw, hd - t / 2, t, y0, h, [[-0.6, 0.6, 1.1, 1.9, true]], wall);
    this.wall(f, 'z', -hd + t, hd - t, -hw + t / 2, t, y0, h, [], wall);
    this.wall(f, 'z', -hd + t, hd - t, hw - t / 2, t, y0, h, [[-0.6, 0.6, 1.1, 1.9, true]], wall);
    this.M(6);
    this.lbox(f, -hw - 0.3, y0 + h, -hd - 0.3, hw + 0.3, y0 + h + 0.2, hd + 0.3, roof);
    this.M(0);
    this.lbox(f, 1.2, y0, 1.2, 2.6, y0 + 0.9, 2.6, C(0x6a5a3a));
    for (let i = 0; i < 3; i++) this.lootPoints.push(this.lpt(f, rand(rng, -2.3, 2.3), y0 + 0.02, rand(rng, -2.3, 0.5)));
  }
  containerYard(f, rng) {
    this.M(6);
    const cols = [0xb8452f, 0x2f6fb8, 0x3a8a4a, 0xc8a03a, 0x6a6a6a, 0x8a3a6a];
    for (let i = 0; i < 4; i++) {
      const lx = -4.5 + (i % 2) * 9 + rand(rng, -0.5, 0.5), lz = -3.5 + Math.floor(i / 2) * 7;
      const y = Math.max(this.rawHeight(...f.pt(lx, lz)) - f.y, -0.3);
      const c = C(pick(rng, cols));
      if (rng() < 0.45) { // open container with loot
        const x0 = lx - 1.25, x1 = lx + 1.25, z0 = lz - 3, z1 = lz + 3;
        this.lbox(f, x0, y, z0, x1, y + 0.1, z1, c.clone().multiplyScalar(0.6));
        this.lbox(f, x0, y, z0, x0 + 0.1, y + 2.6, z1, c);
        this.lbox(f, x1 - 0.1, y, z0, x1, y + 2.6, z1, c);
        this.lbox(f, x0, y + 2.5, z0, x1, y + 2.6, z1, c);
        this.lbox(f, x0, y, z1 - 0.1, x1, y + 2.6, z1, c);
        this.lootPoints.push(this.lpt(f, lx, y + 0.12, lz + 1.5));
        this.lootPoints.push(this.lpt(f, lx, y + 0.12, lz - 0.5));
      } else {
        this.lbox(f, lx - 1.25, y, lz - 3, lx + 1.25, y + 2.6, lz + 3, c);
        for (let r = -2.7; r < 3; r += 0.6) this.lbox(f, lx - 1.3, y + 0.15, lz + r, lx + 1.3, y + 2.45, lz + r + 0.08, c.clone().multiplyScalar(0.8), false);
        if (rng() < 0.4) this.lbox(f, lx - 1.25, y + 2.6, lz - 3, lx + 1.25, y + 5.2, lz + 3, C(pick(rng, cols)));
        this.lootPoints.push(this.lpt(f, lx + 1.8, y + 0.02, lz));
      }
    }
  }
  watchTower(f) {
    this.M(4);
    const wood = C(0x6a5034), y0 = 0, top = 6.4;
    for (const [x, z] of [[-1.8, -1.8], [1.8, -1.8], [-1.8, 1.8], [1.8, 1.8]]) this.lbox(f, x - 0.15, f.ymin - f.y - 0.5, z - 0.15, x + 0.15, top + 2.6, z + 0.15, wood);
    this.lbox(f, -2.2, top - 0.2, -2.2, 2.2, top, 2.2, wood);
    this.lbox(f, -2.2, top, -2.2, 2.2, top + 1.1, -2.05, wood); this.lbox(f, -2.2, top, 2.05, 2.2, top + 1.1, 2.2, wood);
    this.lbox(f, -2.2, top, -2.05, -2.05, top + 1.1, 2.05, wood);
    this.lbox(f, -2.5, top + 2.6, -2.5, 2.5, top + 2.8, 2.5, C(0x3a3f2a));
    // stairs from ground on +x side (outside)
    for (let s = 0; s < 20; s++) {
      const tp = y0 + (s + 1) * 0.32; const zz = 2.2 - s * 0.32 - 0.32 + 6.4 - 6.4;
      this.lbox(f, 2.2, Math.max(y0, tp - 0.32), 8.6 - s * 0.32 - 0.32 - 2.2, 3.3, tp, 8.6 - s * 0.32 - 2.2, wood);
    }
    this.lbox(f, 2.2, top - 0.2, -2.2, 3.3, top, -0.4, wood);
    this.lootPoints.push(this.lpt(f, 0, top + 0.02, 0));
  }
  coolingTower(f) {
    this.M(3);
    const geo = new THREE.CylinderGeometry(8, 11, 30, 20, 1, true);
    const m = new THREE.Matrix4().makeTranslation(...this.lpt(f, 0, 15, 0));
    this.bMain.geo(geo, m, C(0xb4b0a8));
    const geo2 = new THREE.CylinderGeometry(7.8, 10.8, 30, 20, 1, true);
    geo2.scale(-1, 1, 1); // inner faces
    this.bMain.geo(geo2, m, C(0x8a8680));
    this.addCol(f.aabb(-8, 0, -8, 8, 30, 8));
    this.lbox(f, -11.5, f.ymin - f.y - 1, -11.5, 11.5, 0.3, 11.5, C(0x8e8a84));
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.6; this.lootPoints.push(this.lpt(f, Math.cos(a) * 12.5, 0.32, Math.sin(a) * 12.5)); }
  }
  tanks(f, rng) {
    this.M(0);
    for (let i = 0; i < 3; i++) {
      const lx = -5 + i * 5, lz = rand(rng, -3, 3), r = rand(rng, 1.8, 2.4), h = rand(rng, 4, 7);
      const g = new THREE.CylinderGeometry(r, r, h, 16);
      const p = this.lpt(f, lx, h / 2, lz);
      this.bMain.geo(g, new THREE.Matrix4().makeTranslation(p[0], p[1], p[2]), C(pick(rng, [0xd8d8d0, 0xb8c0c4, 0x9aa4a8])));
      this.addCol(f.aabb(lx - r * 0.75, 0, lz - r * 0.75, lx + r * 0.75, h, lz + r * 0.75));
      this.lootPoints.push(this.lpt(f, lx, 0.05, lz + r + 1.2));
    }
    this.lbox(f, -9, f.ymin - f.y - 1, -8, 9, 0.05, 8, C(0x8e8a84));
  }
  silo(f) {
    this.M(6);
    const g = new THREE.CylinderGeometry(3, 3, 14, 18);
    const p = this.lpt(f, 0, 7, 0);
    this.bMain.geo(g, new THREE.Matrix4().makeTranslation(p[0], p[1] + f.ymin - f.y, p[2]), C(0xb8bcc0));
    const cap = new THREE.SphereGeometry(3, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    this.bMain.geo(cap, new THREE.Matrix4().makeTranslation(p[0], p[1] + 7 + f.ymin - f.y, p[2]), C(0x8a8e92));
    this.addCol(f.aabb(-2.3, f.ymin - f.y, -2.3, 2.3, 14 + f.ymin - f.y, 2.3));
  }
  townExtras(t, rng) {
    this.M(3);
    if (t.style === 'military') { // perimeter wall
      const R = t.r * 0.98, segs = 28, cc = C(0x8e8a80);
      for (let i = 0; i < segs; i++) {
        if (i % 7 === 0) continue; // gates
        const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
        const x0 = t.x + Math.cos(a0) * R, z0 = t.z + Math.sin(a0) * R, x1 = t.x + Math.cos(a1) * R, z1 = t.z + Math.sin(a1) * R;
        const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 2.2);
        for (let j = 0; j < n; j++) {
          const x = lerp(x0, x1, (j + 0.5) / n), z = lerp(z0, z1, (j + 0.5) / n);
          const y = this.rawHeight(x, z);
          this.bMain.box(x - 1.15, y - 1, z - 1.15, x + 1.15, y + 2.4, z + 1.15, cc);
          this.addCol([x - 1.15, y - 1, z - 1.15, x + 1.15, y + 2.4, z + 1.15]);
        }
      }
    }
    if (t.style === 'harbor') { // pier into the sea
      let sx = t.x, sz = t.z;
      for (let d = 0; d < 260; d += 4) { if (this.rawHeight(t.x, t.z + d) < 0.5) { sz = t.z + d; break; } }
      const wood = C(0x7a5a3c); this.M(4);
      this.bMain.box(sx - 3, 1.0, sz - 30, sx + 3, 1.4, sz + 70, wood); this.addCol([sx - 3, 1.0, sz - 30, sx + 3, 1.4, sz + 70]);
      for (let z = sz - 28; z < sz + 70; z += 6) for (const x of [sx - 2.8, sx + 2.8]) this.bMain.box(x - 0.2, -6, z - 0.2, x + 0.2, 1.0, z + 0.2, wood.clone().multiplyScalar(0.7));
      for (let i = 0; i < 5; i++) this.lootPoints.push([sx + rand(rng, -2, 2), 1.42, sz + rand(rng, -10, 60)]);
      this.bMain.box(sx + 4, -1.2, sz + 30, sx + 7, 1.2, sz + 44, C(0xd8d8d0)); // boat
      this.addCol([sx + 4, -1.2, sz + 30, sx + 7, 1.2, sz + 44]);
    }
    if (t.style === 'quarry') {
      this.M(0);
      for (let i = 0; i < 14; i++) {
        const a = rng() * Math.PI * 2, d = rand(rng, 10, t.r * 0.9);
        const x = t.x + Math.cos(a) * d, z = t.z + Math.sin(a) * d, s = rand(rng, 2, 5);
        const g = new THREE.DodecahedronGeometry(s, 0);
        const y = this.rawHeight(x, z);
        this.bMain.geo(g, new THREE.Matrix4().compose(new THREE.Vector3(x, y + s * 0.4, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rng(), rng() * 6, rng())), new THREE.Vector3(1, rand(rng, 0.6, 1.2), 1)), C(0x9a9284));
        this.addCol([x - s * 0.7, y - 2, z - s * 0.7, x + s * 0.7, y + s * 1.0, z + s * 0.7]);
      }
    }
    if (t.style === 'farm') { // hay bales
      for (let i = 0; i < 12; i++) {
        const x = t.x + rand(rng, -t.r, t.r), z = t.z + rand(rng, -t.r, t.r); const y = this.rawHeight(x, z);
        if (this.footprints.some((b) => x > b[0] - 2 && x < b[2] + 2 && z > b[1] - 2 && z < b[3] + 2)) continue;
        const g = new THREE.CylinderGeometry(0.75, 0.75, 1.4, 12); g.rotateZ(Math.PI / 2);
        this.bMain.geo(g, new THREE.Matrix4().makeTranslation(x, y + 0.75, z), C(0xd8b860));
        this.addCol([x - 0.7, y, z - 0.6, x + 0.7, y + 1.5, z + 0.6]);
      }
    }
  }

  // ---------- ground texture ----------
  paintGround() {
    const cv = document.createElement('canvas'); cv.width = cv.height = TEX;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(TEX, TEX); const d = img.data;
    const n = this.noise; const nv = new THREE.Vector3();
    for (let py = 0; py < TEX; py++) {
      const z = -HALF + (py + 0.5) / TEX * SIZE;
      for (let px = 0; px < TEX; px++) {
        const x = -HALF + (px + 0.5) / TEX * SIZE;
        const h = this.heightAt(x, z);
        this.normalAt(x, z, nv);
        const ny = nv.y;
        const v1 = n.n2(x * 0.01, z * 0.01), v2 = n.n2(x * 0.045 + 9, z * 0.045 - 4), v3 = n.n2(x * 0.0035 - 3, z * 0.0035 + 8);
        let r, g, b;
        // grass
        const dry = smoothstep(-0.1, 0.5, v3) * 0.7;
        r = lerp(78, 140, dry) + v1 * 14 + v2 * 10; g = lerp(116, 140, dry) + v1 * 16 + v2 * 10; b = lerp(52, 78, dry) + v1 * 8;
        // forest floor darker on high moisture
        if (v1 > 0.25) { const k = smoothstep(0.25, 0.5, v1) * 0.3; r *= 1 - k; g *= 1 - k * 0.6; b *= 1 - k; }
        // rock
        const rock = smoothstep(0.86, 0.72, ny) + smoothstep(38, 55, h) * 0.6;
        if (rock > 0) { const k = clamp(rock, 0, 1); r = lerp(r, 128 + v2 * 20, k); g = lerp(g, 122 + v2 * 18, k); b = lerp(b, 112 + v2 * 16, k); }
        // beach
        const sand = smoothstep(2.6, 1.2, h);
        if (sand > 0) { r = lerp(r, 214 + v2 * 12, sand); g = lerp(g, 198 + v2 * 10, sand); b = lerp(b, 150 + v2 * 8, sand); }
        if (h < -0.5) { const k = smoothstep(-0.5, -12, h); r = lerp(196, 70, k); g = lerp(184, 92, k); b = lerp(140, 90, k); }
        const o = (py * TEX + px) * 4; d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // upscale biome layer to a sharper canvas for roads / fields / pavement
    const cv2 = document.createElement('canvas'); cv2.width = cv2.height = TEXG;
    const ctx2 = cv2.getContext('2d'); ctx2.imageSmoothingEnabled = true; ctx2.imageSmoothingQuality = 'high'; ctx2.drawImage(cv, 0, 0, TEXG, TEXG);
    return this.paintDetails(cv2, ctx2);
  }
  paintDetails(cv, ctx) {
    const S = TEXG / SIZE; const W = (x) => (x + HALF) * S;
    // farm fields
    for (const t of this.towns) if (t.style === 'farm') {
      const rng = mulberry32(77);
      for (let i = 0; i < 6; i++) {
        const fx = t.x + rand(rng, -t.r * 1.6, t.r * 1.2), fz = t.z + rand(rng, -t.r * 1.6, t.r * 1.2), fw = rand(rng, 40, 90), fd = rand(rng, 40, 90);
        ctx.fillStyle = pick(rng, ['#b8a250', '#8fa04a', '#a88e48', '#7e9a46']);
        ctx.fillRect(W(fx), W(fz), fw * S, fd * S);
        ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 1;
        for (let k = 0; k < fw; k += 4) { ctx.beginPath(); ctx.moveTo(W(fx + k), W(fz)); ctx.lineTo(W(fx + k), W(fz + fd)); ctx.stroke(); }
      }
    }
    // roads
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const pass of [[9.5, 'rgba(80,70,50,0.35)'], [7, 'rgba(118,100,74,0.85)'], [5.5, '#8f7b5e'], [1.6, 'rgba(150,135,110,0.35)']]) {
      ctx.lineWidth = pass[0] * S; ctx.strokeStyle = pass[1];
      for (const r of this.roads) { ctx.beginPath(); r.forEach((p, i) => (i ? ctx.lineTo(W(p[0]), W(p[1])) : ctx.moveTo(W(p[0]), W(p[1])))); ctx.stroke(); }
    }
    // town pavements
    for (const t of this.towns) {
      const paved = ['city', 'harbor', 'military', 'industrial', 'school'].includes(t.style);
      if (paved) {
        const full = t.style === 'city';
        const grd = ctx.createRadialGradient(W(t.x), W(t.z), 0, W(t.x), W(t.z), t.r * S * 1.05);
        if (full) { grd.addColorStop(0, '#8a8883'); grd.addColorStop(0.85, '#8e8b85'); grd.addColorStop(1, 'rgba(142,139,133,0)'); }
        else { grd.addColorStop(0, 'rgba(128,116,96,0.55)'); grd.addColorStop(0.75, 'rgba(128,116,96,0.4)'); grd.addColorStop(1, 'rgba(128,116,96,0)'); }
        ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(W(t.x), W(t.z), t.r * S * 1.05, 0, Math.PI * 2); ctx.fill();
        if (!full) { // concrete yards around each building + gravel lanes to the center
          ctx.fillStyle = '#8c8a85';
          for (const b of this.footprints) { const cx = (b[0] + b[2]) / 2, cz = (b[1] + b[3]) / 2; if (Math.hypot(cx - t.x, cz - t.z) > t.r * 1.1) continue; const m = 4.5; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(W(b[0] - m), W(b[1] - m), (b[2] - b[0] + 2 * m) * S, (b[3] - b[1] + 2 * m) * S, 2 * S) : ctx.rect(W(b[0] - m), W(b[1] - m), (b[2] - b[0] + 2 * m) * S, (b[3] - b[1] + 2 * m) * S); ctx.fill(); }
          ctx.strokeStyle = 'rgba(120,112,98,0.9)'; ctx.lineWidth = 5 * S; ctx.lineCap = 'round';
          for (const b of this.footprints) { const cx = (b[0] + b[2]) / 2, cz = (b[1] + b[3]) / 2; if (Math.hypot(cx - t.x, cz - t.z) > t.r * 1.1) continue; ctx.beginPath(); ctx.moveTo(W(cx), W(cz)); ctx.lineTo(W(t.x), W(cz)); ctx.lineTo(W(t.x), W(t.z)); ctx.stroke(); }
        }
        if (t.style === 'city') { // street grid: sidewalk + asphalt + center dashes
          ctx.lineCap = 'butt';
          for (const [wd, col, dash] of [[10, '#a8a49c', null], [7.5, '#4b4d50', null], [0.3, 'rgba(235,225,180,0.85)', [3 * S, 3 * S]]]) {
            ctx.strokeStyle = col; ctx.lineWidth = wd * S; ctx.setLineDash(dash || []);
            for (let k = -t.r; k <= t.r; k += 27) {
              ctx.beginPath(); ctx.moveTo(W(t.x - t.r * 0.95), W(t.z + k + 13.5)); ctx.lineTo(W(t.x + t.r * 0.95), W(t.z + k + 13.5)); ctx.stroke();
              ctx.beginPath(); ctx.moveTo(W(t.x + k + 13.5), W(t.z - t.r * 0.95)); ctx.lineTo(W(t.x + k + 13.5), W(t.z + t.r * 0.95)); ctx.stroke();
            }
          }
          ctx.setLineDash([]); ctx.lineCap = 'round';
        }
      } else {
        ctx.fillStyle = 'rgba(150,130,96,0.45)'; ctx.beginPath(); ctx.arc(W(t.x), W(t.z), t.r * 0.7 * S, 0, Math.PI * 2); ctx.fill();
      }
    }
    // building pads
    ctx.fillStyle = 'rgba(110,105,98,0.9)';
    for (const b of this.footprints) ctx.fillRect(W(b[0]) - 1, W(b[1]) - 1, (b[2] - b[0]) * S + 2, (b[3] - b[1]) * S + 2);
    this.groundCanvas = cv;
    this.groundCtxData = ctx.getImageData(0, 0, TEXG, TEXG).data;
  }
  groundColorAt(x, z) {
    const px = clamp(Math.floor((x + HALF) / SIZE * TEXG), 0, TEXG - 1), py = clamp(Math.floor((z + HALF) / SIZE * TEXG), 0, TEXG - 1);
    const o = (py * TEXG + px) * 4; const d = this.groundCtxData; return [d[o], d[o + 1], d[o + 2]];
  }

  buildTerrainMesh(renderer) {
    const pos = new Float32Array(N * N * 3), uv = new Float32Array(N * N * 2);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i;
      pos[k * 3] = -HALF + i * CELL; pos[k * 3 + 1] = this.H[k]; pos[k * 3 + 2] = -HALF + j * CELL;
      uv[k * 2] = i / (N - 1); uv[k * 2 + 1] = j / (N - 1);
    }
    const idx = new Uint32Array((N - 1) * (N - 1) * 6); let p = 0;
    for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
      const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
      idx[p++] = a; idx[p++] = c; idx[p++] = b; idx[p++] = b; idx[p++] = c; idx[p++] = d;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    const tex = new THREE.CanvasTexture(this.groundCanvas);
    tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
    const detail = makeDetailTexture();
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.96, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uDetail = { value: detail };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix*vec4(transformed,1.0)).xyz; vWN = normal;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN; uniform sampler2D uDetail;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          vec3 nW = normalize(vWN);
          float dA = texture2D(uDetail, vWP.xz*0.31).r;
          float dB = texture2D(uDetail, vWP.xz*0.043).g;
          float dC = texture2D(uDetail, vWP.xz*1.7).b;
          float dD = texture2D(uDetail, vWP.xz*0.011).r;
          vec3 base = diffuseColor.rgb;
          float green = clamp((base.g - max(base.r, base.b)) * 6.0, 0.0, 1.0);
          // grass: clumpy variation + yellowish dry patches
          vec3 grass = base * (0.72 + 0.32*dA + 0.2*dB + 0.12*dC);
          grass = mix(grass, grass*vec3(1.12,1.05,0.8), smoothstep(0.55,0.8,dD)*green*0.6);
          grass = mix(grass, grass*vec3(0.78,0.9,0.75), smoothstep(0.6,0.85,dB)*green*0.5);
          // rock (triplanar) on slopes
          vec3 bw = pow(abs(nW), vec3(4.0)); bw /= (bw.x+bw.y+bw.z);
          float rx = texture2D(uDetail, vWP.zy*0.22).r, ry = texture2D(uDetail, vWP.xz*0.22).r, rz = texture2D(uDetail, vWP.xy*0.22).r;
          float rr = rx*bw.x + ry*bw.y + rz*bw.z;
          float rx2 = texture2D(uDetail, vWP.zy*0.9).b, rz2 = texture2D(uDetail, vWP.xy*0.9).b;
          vec3 rock = vec3(0.46,0.44,0.41) * (0.62 + 0.55*rr + 0.15*(rx2*bw.x + rz2*bw.z + dC*bw.y));
          float rockM = smoothstep(0.2, 0.42, 1.0 - nW.y);
          diffuseColor.rgb = mix(grass, rock, rockM);`);
    };
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    this.scene.add(mesh); this.terrain = mesh;
    // buildings
    const bm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.02 });
    bm.onBeforeCompile = (sh) => {
      sh.uniforms.uDetail = { value: detail };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aMat; varying float vMat; varying vec3 vWP; varying vec3 vWN;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix*vec4(transformed,1.0)).xyz; vWN = normal; vMat = aMat;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 vWP; varying vec3 vWN; varying float vMat; uniform sampler2D uDetail;
        float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          vec3 an = abs(normalize(vWN));
          vec2 uvp = an.y > 0.5 ? vWP.xz : (an.x > 0.5 ? vec2(vWP.z, vWP.y) : vec2(vWP.x, vWP.y));
          float hz = an.y > 0.5 ? vWP.x : (an.x > 0.5 ? vWP.z : vWP.x);
          float n1 = texture2D(uDetail, uvp*0.45).r, n2 = texture2D(uDetail, uvp*0.08).g, n3 = texture2D(uDetail, uvp*1.9).b;
          float m = floor(vMat + 0.5);
          vec3 c = diffuseColor.rgb; float f = 1.0;
          if (m < 0.5) { f = 0.9 + 0.15*n1; }
          else if (m < 1.5) { f = 0.86 + 0.14*n1 + 0.1*n2 + 0.05*n3; if (an.y < 0.5) f *= 0.9 + 0.1*smoothstep(0.0, 0.6, fract((vWP.y+0.15)/3.2)); }
          else if (m < 2.5) {
            vec2 b = uvp / vec2(0.24, 0.075); float row = floor(b.y); b.x += mod(row, 2.0)*0.5;
            vec2 fr = fract(b); float mortar = clamp(step(fr.x, 0.07) + step(fr.y, 0.14), 0.0, 1.0);
            float v = h21(floor(b))*0.24 - 0.12;
            float aa = smoothstep(0.005, 0.022, length(fwidth(uvp)));
            vec3 avg = mix(c*0.95, vec3(0.6,0.58,0.54), 0.2);
            c = mix(mix(c*(1.0+v)*(0.88+0.18*n3), vec3(0.6,0.58,0.54)*(0.9+0.1*n1), mortar), avg, aa);
            f = 0.92 + 0.12*n2;
          }
          else if (m < 3.5) { vec2 gg = fract(uvp / vec2(1.6, 1.2)); float seam = clamp(step(gg.x, 0.012) + step(gg.y, 0.016), 0.0, 1.0); f = (0.84 + 0.14*n1 + 0.1*n3) * (1.0 - 0.28*seam); }
          else if (m < 4.5) {
            float coord = an.y > 0.5 ? vWP.z : vWP.y; float pl = coord / 0.17; float fr = fract(pl); float id = floor(pl);
            float grain = sin(hz*26.0 + h21(vec2(id,1.0))*20.0 + n3*5.0)*0.5+0.5;
            float aa = smoothstep(0.02, 0.07, length(fwidth(uvp))); f = (0.84 + 0.08*grain + (h21(vec2(id,3.0))-0.5)*0.2*(1.0-aa)) * (1.0 - 0.38*(1.0-aa)*step(fr, 0.07)) * (1.0 - 0.06*aa);
          }
          else if (m < 5.5) { float row = vWP.y / 0.19; float fr = fract(row); float cl = fract(hz / 0.28 + floor(row)*0.5); float aa = smoothstep(0.03, 0.1, length(fwidth(vec2(hz, vWP.y)))); f = mix((0.68 + 0.36*fr) * (1.0 - 0.3*step(cl, 0.06)), 0.82, aa) * (0.88 + 0.18*n1); }
          else if (m < 6.5) { float aa = 1.0 - smoothstep(0.02, 0.08, fwidth(hz)); f = (0.88 + 0.12*aa*sin(hz*41.9)) * (0.88 + 0.16*n2); c = mix(c, vec3(0.42,0.27,0.17), smoothstep(0.6,0.85,n2)*0.4); }
          else if (m < 7.5) { float pl = vWP.x/0.14; float fr = fract(pl); float id = floor(pl); f = (0.82 + (h21(vec2(id,7.0))-0.5)*0.22 + 0.08*n3) * (1.0 - 0.3*step(fr,0.05)); c *= vec3(1.08,0.95,0.82); }
          else if (m < 8.5) { vec2 gg = fract(vWP.xz/0.5); float gr = clamp(step(gg.x,0.03)+step(gg.y,0.03),0.,1.); float id = h21(floor(vWP.xz/0.5)); c = mix(vec3(0.8,0.78,0.74)*(0.92+id*0.12), vec3(0.38), gr); }
          else { f = 0.72 + 0.22*n3 + 0.1*n1; }
          diffuseColor.rgb = c * f;`);
    };
    const gm = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.32, roughness: 0.05, metalness: 0.4, depthWrite: false });
    this.buildingMeshes = [];
    for (const B of this.bList) { if (B.empty) continue; const bmesh = new THREE.Mesh(B.build(), bm); bmesh.castShadow = true; bmesh.receiveShadow = true; this.scene.add(bmesh); this.buildingMeshes.push(bmesh); }
    for (const B of this.gList) { if (B.empty) continue; this.scene.add(new THREE.Mesh(B.build(), gm)); }
    this.bList = this.gList = null;
    this.bMain = this.bGlass = null;
    this.detailTex = detail;
  }

  buildWater() {
    // height texture for shoreline effects
    const HS = 512, hd = new Uint8Array(HS * HS);
    for (let j = 0; j < HS; j++) for (let i = 0; i < HS; i++) { const h = this.heightAt(-HALF + (i + 0.5) / HS * SIZE, -HALF + (j + 0.5) / HS * SIZE); hd[j * HS + i] = clamp(Math.round((h + 24) / 48 * 255), 0, 255); }
    const ht = new THREE.DataTexture(hd, HS, HS, THREE.RedFormat, THREE.UnsignedByteType); ht.magFilter = ht.minFilter = THREE.LinearFilter; ht.needsUpdate = true;
    const g = new THREE.PlaneGeometry(9000, 9000, 1, 1); g.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0x1b5a75, roughness: 0.06, metalness: 0.0, transparent: true, opacity: 0.9 });
    this.waterUniforms = { uTime: { value: 0 }, uH: { value: ht }, uDetail: { value: this.detailTex } };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.waterUniforms);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix*vec4(transformed,1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; uniform float uTime; uniform sampler2D uH; uniform sampler2D uDetail;')
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          vec2 q = vWP.xz;
          float w1 = sin(q.x*0.21 + uTime*1.3) * cos(q.y*0.17 - uTime*0.9);
          float w2 = sin(q.x*0.53 - q.y*0.41 + uTime*2.1);
          float w3 = texture2D(uDetail, q*0.05 + vec2(uTime*0.012, uTime*0.008)).r - 0.5;
          float w4 = texture2D(uDetail, q*0.13 - vec2(uTime*0.02, -uTime*0.015)).g - 0.5;
          float wfade = 1.0 - smoothstep(120.0, 700.0, length(cameraPosition.xz - vWP.xz));
          vec3 pn = normalize(vec3((w1*0.06 + w2*0.04) * (0.4 + 0.6*wfade) + (w3*0.35 + w4*0.25) * wfade, 1.0, (w2*0.05 - w1*0.05) * (0.4 + 0.6*wfade) + (w4*0.35 - w3*0.2) * wfade));
          normal = normalize((viewMatrix * vec4(pn, 0.0)).xyz);`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          vec2 huv = (vWP.xz + 1000.0) / 2000.0;
          float inMap = step(0.0, huv.x) * step(huv.x, 1.0) * step(0.0, huv.y) * step(huv.y, 1.0);
          float th = mix(-24.0, texture2D(uH, huv).r * 48.0 - 24.0, inMap);
          float depth = max(0.0, -th);
          vec3 shallow = vec3(0.16, 0.52, 0.52), deep = vec3(0.03, 0.17, 0.27);
          vec3 wc = mix(shallow, deep, smoothstep(0.3, 9.0, depth));
          float fres = pow(1.0 - clamp(dot(normalize(cameraPosition - vWP), vec3(0.0,1.0,0.0)), 0.0, 1.0), 4.0);
          wc = mix(wc, vec3(0.62,0.76,0.86), fres*0.6);
          float fn = texture2D(uDetail, vWP.xz*0.35 + vec2(uTime*0.03, 0.0)).b;
          float foam = smoothstep(0.9, 0.0, depth) * smoothstep(0.35, 0.75, fn + 0.25*sin(depth*9.0 - uTime*2.2));
          wc = mix(wc, vec3(0.92,0.95,0.95), foam*0.85);
          diffuseColor.rgb = wc;
          diffuseColor.a = clamp(0.55 + depth*0.12 + fres*0.4 + foam, 0.0, 0.97);`);
    };
    const m = new THREE.Mesh(g, mat); m.position.y = 0; m.receiveShadow = true; m.renderOrder = 2;
    this.scene.add(m); this.water = m;
  }

  buildSky() {
    const g = new THREE.SphereGeometry(5000, 48, 24);
    this.sunDir = new THREE.Vector3(-0.45, 0.62, -0.38).normalize();
    // tileable cloud noise
    const cc = document.createElement('canvas'); cc.width = cc.height = 256;
    const cx = cc.getContext('2d'); const id = cx.createImageData(256, 256);
    const nz = makeNoise(5150);
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      const a = (x / 256) * Math.PI * 2, b = (y / 256) * Math.PI * 2;
      const P = [Math.cos(a) * 1.2, Math.sin(a) * 1.2, Math.cos(b) * 1.2, Math.sin(b) * 1.2];
      const f = nz.fbm(P[0] + P[2] * 0.7 + 5, P[1] + P[3] * 0.7, 5) * 0.6 + nz.fbm(P[2] * 2 + 1, P[3] * 2 + P[0], 4) * 0.4;
      const o = (y * 256 + x) * 4; const v = clamp(f * 0.5 + 0.5, 0, 1) * 255; id.data[o] = id.data[o + 1] = id.data[o + 2] = v; id.data[o + 3] = 255;
    }
    cx.putImageData(id, 0, 0);
    const ct = new THREE.CanvasTexture(cc); ct.wrapS = ct.wrapT = THREE.RepeatWrapping; ct.colorSpace = THREE.NoColorSpace;
    this.skyU = { uSun: { value: this.sunDir }, uCloud: { value: ct }, uTime: { value: 0 }, uHor: { value: new THREE.Color(0xb8cbdb) } };
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false, uniforms: this.skyU,
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); gl_Position.z = gl_Position.w; }',
      fragmentShader: `varying vec3 vD; uniform vec3 uSun; uniform sampler2D uCloud; uniform float uTime; uniform vec3 uHor;
        void main(){
          vec3 d = normalize(vD); float h = d.y;
          vec3 top = vec3(0.13,0.32,0.68), hor = uHor, low = uHor;
          vec3 c = h > 0.0 ? mix(hor, top, pow(clamp(h,0.0,1.0), 0.45)) : low;
          float s = max(dot(d, uSun), 0.0);
          c += vec3(1.0,0.82,0.55)*pow(s, 6.0)*0.25 + vec3(1.0,0.92,0.8)*pow(s, 64.0)*0.4;
          // clouds on a virtual plane
          if (h > 0.08) {
            vec2 uv = d.xz / (h + 0.3) * 0.42 + vec2(uTime*0.004, uTime*0.0016);
            float lb = (1.0 - smoothstep(0.0, 0.45, h)) * 5.0; float n = texture2D(uCloud, uv, lb).r*0.65 + texture2D(uCloud, uv*2.7 + 0.31, lb + 1.0).r*0.35;
            float cov = smoothstep(0.5, 0.78, n) * (1.0 - smoothstep(0.004, 0.02, length(fwidth(uv))));
            float fade = smoothstep(0.08, 0.32, h);
            float lit = 0.75 + 0.25*smoothstep(0.4, 1.0, n) + pow(s, 4.0)*0.3;
            vec3 cloudC = mix(vec3(0.72,0.76,0.82), vec3(1.0,0.98,0.95), lit - 0.5);
            c = mix(c, cloudC, cov*fade*0.92);
          }
          c += vec3(1.0,0.96,0.88)*smoothstep(0.9993, 0.9997, s)*18.0; // sun disk (bloom catches it)
          gl_FragColor = vec4(c,1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const sky = new THREE.Mesh(g, mat); sky.renderOrder = -10; sky.frustumCulled = false;
    this.scene.add(sky); this.sky = sky;
  }

  // ---------- vegetation ----------
  buildVegetation() {
    const rng = mulberry32(MAP_SEED ^ 0x1234);
    const types = makeTreeGeometries();
    const chunks = 8, cs = SIZE / chunks;
    const buckets = types.map(() => Array.from({ length: chunks * chunks }, () => []));
    const nv = new THREE.Vector3();
    const nearTown = (x, z, m) => this.towns.some((t) => Math.hypot(x - t.x, z - t.z) < t.r + m);
    const onFoot = (x, z, m) => this.footprints.some((b) => x > b[0] - m && x < b[2] + m && z > b[1] - m && z < b[3] + m);
    this.treeList = [];
    const stepT = this.quality === 'low' ? 11 : 8.5;
    for (let z = -HALF + 5; z < HALF - 5; z += stepT) for (let x = -HALF + 5; x < HALF - 5; x += stepT) {
      const px = x + (rng() - 0.5) * stepT, pz = z + (rng() - 0.5) * stepT;
      const h = this.heightAt(px, pz);
      if (h < 2.2) continue;
      const dens = this.noise.fbm(px * 0.006 + 40, pz * 0.006 - 20, 3);
      const nk = rng();
      let type = -1;
      if (dens > 0.18 && nk < 0.85) type = h > 28 || dens > 0.45 ? 0 : (rng() < 0.6 ? 1 : 2);
      else if (nk < 0.05) type = rng() < 0.5 ? 1 : 0;
      else if (nk < 0.13) type = 3; // bush
      else if (nk < 0.145) type = 4; // rock
      if (type < 0) continue;
      this.normalAt(px, pz, nv);
      if (nv.y < (type === 4 ? 0.5 : 0.78)) continue;
      if (type !== 4 && nearTown(px, pz, type === 3 ? 4 : 14)) continue;
      if (onFoot(px, pz, 3)) continue;
      if (this.roadDist2(px, pz) < (type === 3 ? 30 : 64)) continue;
      const s = type === 4 ? rand(rng, 0.8, 2.6) : type === 3 ? rand(rng, 0.7, 1.4) : rand(rng, 0.8, 1.35);
      const ci = Math.floor((px + HALF) / cs) + Math.floor((pz + HALF) / cs) * chunks;
      buckets[type][ci].push([px, h - 0.15, pz, s, rng() * Math.PI * 2]);
      if (type <= 2) { const tr = 0.32 * s; this.addCol([px - tr, h - 1, pz - tr, px + tr, h + 7 * s, pz + tr]); this.treeList.push([px, pz, type, s]); }
      if (type === 4) this.addCol([px - s * 0.75, h - 1, pz - s * 0.75, px + s * 0.75, h + s * 0.95, pz + s * 0.75]);
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pv = new THREE.Vector3(), col = new THREE.Color();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
    this.vegMeshes = [];
    types.forEach((geo, ti) => buckets[ti].forEach((list) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((t, i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t[4]);
        sc.set(t[3], t[3] * (ti === 4 ? rand(rng, 0.55, 1.0) : 1), t[3]);
        pv.set(t[0], t[1], t[2]);
        m4.compose(pv, q, sc); im.setMatrixAt(i, m4);
        const v = 0.85 + rng() * 0.3; col.setRGB(v * (0.95 + rng() * 0.1), v, v * (0.9 + rng() * 0.15)); im.setColorAt(i, col);
      });
      im.castShadow = ti !== 3; im.receiveShadow = true;
      im.computeBoundingSphere();
      this.scene.add(im); this.vegMeshes.push(im);
    }));
  }

  buildGrass() {
    if (this.quality === 'low') return;
    const blade = new THREE.BufferGeometry();
    // a tuft of 3 crossed blades
    const P = [], Cc = [];
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI;
      const cx = Math.cos(a) * 0.09, cz = Math.sin(a) * 0.09;
      P.push(-cx, 0, -cz, cx, 0, cz, cz * 0.6, 0.42, -cx * 0.6);
      Cc.push(0.2, 0.3, 0.1, 0.2, 0.3, 0.1, 0.5, 0.62, 0.28);
    }
    blade.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    blade.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3));
    blade.computeVertexNormals();
    const COUNT = this.quality === 'high' ? 24000 : 11000;
    this.grassUniforms = { uTime: { value: 0 } };
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.grassUniforms.uTime;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vec4 ip = instanceMatrix * vec4(0.0,0.0,0.0,1.0);
          float sway = sin(uTime*1.7 + ip.x*0.35 + ip.z*0.27) * 0.12 * position.y;
          transformed.x += sway; transformed.z += sway*0.6;`);
      sh.vertexShader = sh.vertexShader.replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0,1.0,0.0);');
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', 'float faceDirection = 1.0; vec3 normal = normalize( vNormal ); vec3 nonPerturbedNormal = normal;');
    };
    const im = new THREE.InstancedMesh(blade, mat, COUNT);
    im.frustumCulled = false; im.receiveShadow = true;
    this.scene.add(im); this.grass = im; this.grassCount = COUNT; this.grassCenter = [1e9, 1e9];
  }
  // Grass around the camera is rebuilt as you move. The rebuild is spread over several frames
  // (it used to run in one go and caused a visible hitch every ~8 m while running).
  updateGrass(cx, cz) {
    if (!this.grass) return;
    if (this.grassJob) { this.grassJob.next(); return; }
    if (Math.hypot(cx - this.grassCenter[0], cz - this.grassCenter[1]) < 8) return;
    this.grassJob = this.grassBuild(cx, cz); this.grassJob.next();
  }
  *grassBuild(cx, cz) {
    const R = 46, CELLG = 0.62; const N = this.grassCount;
    const mats = this.grassStageM || (this.grassStageM = new Float32Array(N * 16));
    const cols = this.grassStageC || (this.grassStageC = new Float32Array(N * 3));
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    let n = 0, work = 0;
    const x0 = Math.floor((cx - R) / CELLG), x1 = Math.floor((cx + R) / CELLG), z0 = Math.floor((cz - R) / CELLG), z1 = Math.floor((cz + R) / CELLG);
    for (let gz = z0; gz <= z1 && n < N; gz++) {
      for (let gx = x0; gx <= x1 && n < N; gx++) {
        let hsh = (gx * 73856093) ^ (gz * 19349663); hsh = Math.imul(hsh ^ (hsh >>> 13), 0x5bd1e995); const r1 = ((hsh >>> 0) % 1000) / 1000;
        if (r1 > 0.42) continue;
        const x = (gx + ((hsh >>> 10) % 100) / 100) * CELLG, z = (gz + ((hsh >>> 17) % 100) / 100) * CELLG;
        const dd = Math.hypot(x - cx, z - cz); if (dd > R) continue;
        if (dd > R * 0.6 && r1 > 0.42 * (1 - (dd - R * 0.6) / (R * 0.4))) continue;
        const gc = this.groundColorAt(x, z);
        if (!(gc[1] > gc[0] * 1.05 && gc[1] > gc[2] * 1.3)) continue;
        const h = this.heightAt(x, z);
        if (h < 2) continue;
        p.set(x, h - 0.03, z); q.setFromAxisAngle(up, r1 * 40);
        const sc = 0.55 + ((hsh >>> 5) % 100) / 100 * 0.7; s.set(sc, sc * (0.7 + r1), sc);
        m4.compose(p, q, s); m4.toArray(mats, n * 16);
        cols[n * 3] = gc[0] / 175; cols[n * 3 + 1] = gc[1] / 165; cols[n * 3 + 2] = gc[2] / 140;
        n++;
      }
      if (++work % 14 === 0) yield; // ~14 rows of cells per frame
    }
    // swap in one go
    this.grass.instanceMatrix.array.set(mats.subarray(0, n * 16));
    if (!this.grass.instanceColor) this.grass.setColorAt(0, new THREE.Color(1, 1, 1));
    this.grass.instanceColor.array.set(cols.subarray(0, n * 3));
    this.grass.count = n;
    this.grass.instanceMatrix.needsUpdate = true; this.grass.instanceColor.needsUpdate = true;
    this.grassCenter = [cx, cz];
    this.grassJob = null;
  }

  buildMapCanvas() {
    const cv = document.createElement('canvas'); cv.width = cv.height = TEX;
    const ctx = cv.getContext('2d');
    ctx.drawImage(this.groundCanvas, 0, 0, TEX, TEX);
    // hillshade-ish contour tint
    const img = ctx.getImageData(0, 0, TEX, TEX); const d = img.data;
    for (let py = 0; py < TEX; py += 1) for (let px = 0; px < TEX; px += 1) {
      const x = -HALF + (px + 0.5) / TEX * SIZE, z = -HALF + (py + 0.5) / TEX * SIZE;
      const h = this.heightAt(x, z);
      const o = (py * TEX + px) * 4;
      if (h < -0.2) { const k = clamp(-h / 14, 0, 1); d[o] = lerp(70, 34, k); d[o + 1] = lerp(130, 78, k); d[o + 2] = lerp(150, 110, k); continue; }
      const hs = (this.heightAt(x - 2, z - 2) - this.heightAt(x + 2, z + 2)) * 0.09;
      const f = clamp(1 + hs, 0.72, 1.25);
      d[o] = clamp(d[o] * f, 0, 255); d[o + 1] = clamp(d[o + 1] * f, 0, 255); d[o + 2] = clamp(d[o + 2] * f, 0, 255);
    }
    ctx.putImageData(img, 0, 0);
    const S = TEX / SIZE; const W = (x) => (x + HALF) * S;
    ctx.fillStyle = 'rgba(26,62,30,0.28)';
    for (const t of this.treeList) { ctx.fillRect(W(t[0]) - 1, W(t[1]) - 1, 2, 2); }
    for (const b of this.footprints) {
      ctx.fillStyle = '#6b6862'; ctx.fillRect(W(b[0]), W(b[1]), (b[2] - b[0]) * S, (b[3] - b[1]) * S);
      ctx.strokeStyle = '#3e3c38'; ctx.lineWidth = 0.6; ctx.strokeRect(W(b[0]), W(b[1]), (b[2] - b[0]) * S, (b[3] - b[1]) * S);
    }
    this.mapCanvas = cv;
    this.treeList = null; this.groundCanvas = null;
  }

  update(dt, cam) {
    this.time += dt;
    if (this.waterUniforms) this.waterUniforms.uTime.value = this.time;
    if (this.grassUniforms) this.grassUniforms.uTime.value = this.time;
    if (this.skyU) { this.skyU.uTime.value = this.time; if (this.scene.fog) this.skyU.uHor.value.copy(this.scene.fog.color); }
    if (this.sky) this.sky.position.copy(cam);
  }
}

function makeDetailTexture() {
  const S = 256; const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const ctx = cv.getContext('2d'); const img = ctx.createImageData(S, S);
  const rng = mulberry32(99);
  const layer = (cells) => {
    const g = new Float32Array(cells * cells).map(() => rng());
    return (x, y) => {
      const fx = (x / S) * cells, fy = (y / S) * cells; const ix = Math.floor(fx), iy = Math.floor(fy);
      const u = fx - ix, v = fy - iy; const s = (t) => t * t * (3 - 2 * t);
      const G = (a, b) => g[((b % cells + cells) % cells) * cells + ((a % cells + cells) % cells)];
      return lerp(lerp(G(ix, iy), G(ix + 1, iy), s(u)), lerp(G(ix, iy + 1), G(ix + 1, iy + 1), s(u)), s(v));
    };
  };
  const L = [layer(8), layer(16), layer(32), layer(64), layer(128)];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const a = L[1](x, y) * 0.4 + L[2](x, y) * 0.3 + L[3](x, y) * 0.2 + L[4](x, y) * 0.1;
    const b = L[0](x, y) * 0.6 + L[1](x, y) * 0.4;
    const c = L[4](x, y) * 0.5 + rng() * 0.5;
    const o = (y * S + x) * 4; img.data[o] = a * 255; img.data[o + 1] = b * 255; img.data[o + 2] = c * 255; img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace;
  return t;
}

function colorize(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.attributes.position.count; const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = color.r; c[i * 3 + 1] = color.g; c[i * 3 + 2] = color.b; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}
function merge(geos) {
  let n = 0; for (const g of geos) n += g.attributes.position.count;
  const p = new Float32Array(n * 3), nn = new Float32Array(n * 3), c = new Float32Array(n * 3); let o = 0;
  for (const g of geos) { p.set(g.attributes.position.array, o * 3); nn.set(g.attributes.normal.array, o * 3); c.set(g.attributes.color.array, o * 3); o += g.attributes.position.count; }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(p, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nn, 3)); out.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return out;
}
function jiggle(geo, amt, seed) {
  if (geo.index) geo = geo.toNonIndexed();
  const rng = mulberry32(seed); const p = geo.attributes.position;
  const map = new Map();
  for (let i = 0; i < p.count; i++) {
    const k = p.getX(i).toFixed(3) + ',' + p.getY(i).toFixed(3) + ',' + p.getZ(i).toFixed(3);
    if (!map.has(k)) map.set(k, [(rng() - 0.5) * amt, (rng() - 0.5) * amt, (rng() - 0.5) * amt]);
    const o = map.get(k); p.setXYZ(i, p.getX(i) + o[0], p.getY(i) + o[1], p.getZ(i) + o[2]);
  }
  geo.computeVertexNormals();
  return geo;
}
export function makeTreeGeometries() {
  const trunkC = new THREE.Color(0x5a4030), pineC = new THREE.Color(0x2f5a32), pineC2 = new THREE.Color(0x3a6a3a);
  const oakC = new THREE.Color(0x4a7a36), oakC2 = new THREE.Color(0x5d8a3e), birchT = new THREE.Color(0xd8d4c8), birchL = new THREE.Color(0x7a9a42);
  // 0 pine
  const pine = [];
  const tr = new THREE.CylinderGeometry(0.16, 0.28, 3.2, 6); tr.translate(0, 1.6, 0); pine.push(colorize(tr, trunkC));
  for (let i = 0; i < 4; i++) {
    const c = new THREE.ConeGeometry(2.3 - i * 0.48, 2.6, 7); c.translate(0, 2.6 + i * 1.35, 0);
    pine.push(colorize(jiggle(c, 0.25, 10 + i), i % 2 ? pineC : pineC2));
  }
  // 1 oak
  const oak = [];
  const tr2 = new THREE.CylinderGeometry(0.2, 0.34, 3.4, 6); tr2.translate(0, 1.7, 0); oak.push(colorize(tr2, trunkC));
  [[0, 4.6, 0, 2.4], [1.3, 4.0, 0.4, 1.6], [-1.2, 4.2, -0.5, 1.7], [0.2, 5.6, -0.6, 1.5]].forEach(([x, y, z, r], i) => {
    const s = new THREE.IcosahedronGeometry(r, 1); s.translate(x, y, z);
    oak.push(colorize(jiggle(s, 0.35, 30 + i), i % 2 ? oakC : oakC2));
  });
  // 2 birch
  const birch = [];
  const tr3 = new THREE.CylinderGeometry(0.12, 0.18, 5, 6); tr3.translate(0, 2.5, 0); birch.push(colorize(tr3, birchT));
  [[0, 5.2, 0, 1.5], [0.5, 4.2, 0.3, 1.1], [-0.4, 6.0, -0.2, 1.0]].forEach(([x, y, z, r], i) => {
    const s = new THREE.IcosahedronGeometry(r, 0); s.translate(x, y, z);
    birch.push(colorize(jiggle(s, 0.3, 50 + i), birchL));
  });
  // 3 bush
  const bush = [];
  [[0, 0.5, 0, 0.9], [0.6, 0.4, 0.2, 0.6], [-0.5, 0.45, -0.3, 0.65]].forEach(([x, y, z, r], i) => {
    const s = new THREE.IcosahedronGeometry(r, 0); s.translate(x, y, z);
    bush.push(colorize(jiggle(s, 0.2, 70 + i), i ? oakC : pineC2));
  });
  // 4 rock
  const rock = jiggle(new THREE.DodecahedronGeometry(1, 0), 0.35, 90); rock.translate(0, 0.35, 0);
  return [merge(pine), merge(oak), merge(birch), merge(bush), colorize(rock, new THREE.Color(0x8e8a82))];
}
