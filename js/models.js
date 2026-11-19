// ===== LAST CIRCLE · procedural models (characters w/ IK, weapons, gear, items, plane) =====
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { WEAPONS, ITEMS, AMMO, ATTACH } from './data.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const DOWN = V(0, -1, 0);

// ---------- geometry merging with vertex colors ----------
export class Parts {
  constructor() { this.list = []; }
  add(geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, tag = 0) {
    _m.compose(_v1.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _v2.set(sx, sy, sz));
    this.list.push({ geo, color: new THREE.Color(color), matrix: _m.clone(), tag });
    return this;
  }
  build(extra) {
    const pos = [], nor = [], col = [], ex = [];
    const nm = new THREE.Matrix3(), p = new THREE.Vector3(), n = new THREE.Vector3();
    for (const it of this.list) {
      const g = it.geo.index ? it.geo.toNonIndexed() : it.geo;
      const P = g.attributes.position, N = g.attributes.normal;
      nm.getNormalMatrix(it.matrix);
      for (let i = 0; i < P.count; i++) {
        p.fromBufferAttribute(P, i).applyMatrix4(it.matrix); n.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
        pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z); col.push(it.color.r, it.color.g, it.color.b);
        if (extra) ex.push(...extra(it, p));
      }
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    out.computeBoundingSphere();
    return { geo: out, ex };
  }
}
const RB = (w, h, d, r = 0.02, s = 2) => new RoundedBoxGeometry(w, h, d, s, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
const CAP = (r, l, rs = 10) => new THREE.CapsuleGeometry(r, l, 3, rs);
const CYL = (r1, r2, h, s = 12, open = false) => new THREE.CylinderGeometry(r1, r2, h, s, 1, open);
const SPH = (r, w = 14, h = 10, ps = 0, pl = Math.PI * 2, ts = 0, tl = Math.PI) => new THREE.SphereGeometry(r, w, h, ps, pl, ts, tl);
const BOX = (w, h, d) => new THREE.BoxGeometry(w, h, d);

// ---------- humanoid ----------
const BONES = ['root', 'hips', 'spine', 'chest', 'neck', 'head', 'uaL', 'faL', 'hdL', 'uaR', 'faR', 'hdR', 'thL', 'shL', 'ftL', 'thR', 'shR', 'ftR'];
const PARENT = { hips: 'root', spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck', uaL: 'chest', faL: 'uaL', hdL: 'faL', uaR: 'chest', faR: 'uaR', hdR: 'faR', thL: 'hips', shL: 'thL', ftL: 'shL', thR: 'hips', shR: 'thR', ftR: 'shR' };
const J = { root: [0, 0, 0], hips: [0, 0.97, 0], spine: [0, 1.08, 0], chest: [0, 1.26, 0], neck: [0, 1.5, 0], head: [0, 1.58, 0], uaL: [0.19, 1.45, 0], faL: [0.19, 1.165, 0], hdL: [0.19, 0.9, 0], uaR: [-0.19, 1.45, 0], faR: [-0.19, 1.165, 0], hdR: [-0.19, 0.9, 0], thL: [0.1, 0.94, 0], shL: [0.1, 0.52, 0], ftL: [0.1, 0.09, 0], thR: [-0.1, 0.94, 0], shR: [-0.1, 0.52, 0], ftR: [-0.1, 0.09, 0] };
const UA = 0.285, FA = 0.265;
// color slots: 0 skin 1 shirt 2 pants 3 boots 4 gloves 5 hair 6 belt 7 eyes 8 shirtDark 9 pads
let humanCache = null;
function humanGeometry() {
  if (humanCache) return humanCache;
  const bi = Object.fromEntries(BONES.map((b, i) => [b, i]));
  const parts = [];
  const add = (geo, bone, slot, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => parts.push({ geo, bone, slot, m: new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), V(sx, sy, sz)) });
  add(RB(0.33, 0.2, 0.22, 0.06), 'hips', 2, 0, 0.97, 0);
  add(RB(0.345, 0.05, 0.235, 0.02), 'hips', 6, 0, 1.055, 0);
  add(RB(0.06, 0.04, 0.02, 0.01), 'hips', 3, 0, 1.055, 0.12);
  add(RB(0.31, 0.22, 0.2, 0.07), 'spine', 1, 0, 1.16, 0);
  add(RB(0.38, 0.27, 0.235, 0.09), 'chest', 1, 0, 1.345, 0);
  add(RB(0.16, 0.06, 0.18, 0.025), 'chest', 8, 0, 1.47, 0.01); // collar
  for (const s of [1, -1]) add(SPH(0.078, 12, 8), 'chest', 1, 0.18 * s, 1.43, 0);
  add(CYL(0.05, 0.055, 0.12, 10), 'neck', 0, 0, 1.53, 0);
  add(SPH(0.108, 18, 14), 'head', 0, 0, 1.67, 0.005, 0, 0, 0, 0.93, 1.1, 1.0);
  add(RB(0.15, 0.08, 0.13, 0.035), 'head', 0, 0, 1.6, 0.03);
  add(BOX(0.024, 0.04, 0.035), 'head', 0, 0, 1.655, 0.112, -0.25, 0, 0);
  for (const s of [1, -1]) {
    add(SPH(0.026, 8, 6), 'head', 0, 0.101 * s, 1.665, 0.0, 0, 0, 0, 0.5, 1, 0.8);
    add(BOX(0.03, 0.013, 0.01), 'head', 7, 0.04 * s, 1.684, 0.1);
    add(BOX(0.045, 0.011, 0.012), 'head', 5, 0.041 * s, 1.703, 0.101, 0, 0, -0.08 * s);
  }
  add(SPH(0.116, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.52), 'head', 5, 0, 1.675, -0.012, -0.18, 0, 0, 0.95, 1.05, 1.02);
  for (const s of [1, -1]) {
    const b = s > 0 ? 'L' : 'R';
    add(CAP(0.053, 0.19), 'ua' + b, 1, 0.19 * s, 1.31, 0);
    add(CYL(0.056, 0.056, 0.035, 10), 'ua' + b, 8, 0.19 * s, 1.185, 0);
    add(CAP(0.046, 0.17), 'fa' + b, 1, 0.19 * s, 1.035, 0);
    add(RB(0.07, 0.1, 0.045, 0.018), 'hd' + b, 4, 0.19 * s, 0.85, 0.005);
    add(RB(0.03, 0.06, 0.03, 0.012), 'hd' + b, 4, 0.19 * s - 0.035 * s, 0.865, 0.03, 0.3, 0, 0);
    add(CAP(0.079, 0.28), 'th' + b, 2, 0.1 * s, 0.735, 0);
    add(RB(0.06, 0.05, 0.035, 0.01), 'th' + b, 6, 0.1 * s + 0.07 * s, 0.75, 0.0); // thigh pocket
    add(CAP(0.063, 0.3), 'sh' + b, 2, 0.1 * s, 0.31, 0);
    add(RB(0.105, 0.11, 0.05, 0.02), 'sh' + b, 9, 0.1 * s, 0.51, 0.065);
    add(CYL(0.068, 0.07, 0.12, 10), 'sh' + b, 3, 0.1 * s, 0.14, 0);
    add(RB(0.115, 0.1, 0.28, 0.035), 'ft' + b, 3, 0.1 * s, 0.05, 0.04);
    add(RB(0.12, 0.025, 0.29, 0.01), 'ft' + b, 6, 0.1 * s, 0.0125, 0.04);
  }
  const pos = [], nor = [], skI = [], skW = [], slot = [];
  const nm = new THREE.Matrix3(), p = new THREE.Vector3(), n = new THREE.Vector3();
  for (const it of parts) {
    const g = it.geo.index ? it.geo.toNonIndexed() : it.geo;
    const P = g.attributes.position, N = g.attributes.normal; nm.getNormalMatrix(it.m);
    for (let i = 0; i < P.count; i++) {
      p.fromBufferAttribute(P, i).applyMatrix4(it.m); n.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
      pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z); skI.push(bi[it.bone], 0, 0, 0); skW.push(1, 0, 0, 0); slot.push(it.slot);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skI, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skW, 4));
  humanCache = { g, slot };
  return humanCache;
}
const SKINS = [0xe9c4a6, 0xd9a882, 0xc08a64, 0x8d5d40, 0xf1d3bd];
const HAIRS = [0x2a1e16, 0x4a3020, 0x141414, 0x7a5a32, 0x5a3a2a];

// ---------- gear (separate rigid meshes on bones) ----------
const gearCache = {};
function gearGeo(key) {
  if (gearCache[key]) return gearCache[key];
  const P = new Parts();
  const [kind, lvl] = [key.slice(0, -1), +key.slice(-1)];
  if (kind === 'helm') {
    const c = [0, 0x5d6b45, 0x4b5638, 0x2c3129][lvl];
    if (lvl === 1) { P.add(SPH(0.128, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), c, 0, 0.09, -0.005, 0, 0, 0, 1, 0.9, 1.05); P.add(CYL(0.135, 0.14, 0.02, 16), 0x3f4a30, 0, 0.088, 0); }
    if (lvl === 2) { P.add(SPH(0.135, 16, 9, 0, Math.PI * 2, 0, Math.PI * 0.55), c, 0, 0.085, -0.005, 0, 0, 0, 1, 0.95, 1.08); P.add(CYL(0.15, 0.155, 0.02, 18), c, 0, 0.07, -0.01); P.add(RB(0.08, 0.05, 0.02, 0.008), 0x22261c, 0, 0.13, 0.13); }
    if (lvl === 3) { P.add(SPH(0.133, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), c, 0, 0.088, -0.008, 0, 0, 0, 1, 0.92, 1.06); for (const s of [1, -1]) P.add(RB(0.015, 0.04, 0.12, 0.005), 0x1a1c1e, 0.125 * s, 0.1, 0); P.add(RB(0.05, 0.05, 0.04, 0.01), 0x1a1c1e, 0, 0.17, 0.12); P.add(RB(0.08, 0.035, 0.025, 0.01), 0x1a1c1e, 0, 0.12, 0.135); }
  } else if (kind === 'vest') {
    const c = [0, 0x8a8668, 0x4e5a52, 0x2d3238][lvl];
    P.add(RB(0.42, 0.33, 0.29, 0.06), c, 0, 0.06, 0.005);
    if (lvl >= 2) { for (let i = -1; i <= 1; i++) P.add(RB(0.085, 0.11, 0.05, 0.015), lvl === 3 ? 0x23272c : 0x3e4840, i * 0.095, 0.0, 0.16); P.add(RB(0.12, 0.06, 0.04, 0.01), 0x2a2a2a, -0.1, 0.15, 0.155); P.add(RB(0.3, 0.04, 0.3, 0.01), 0x2a2e2a, 0, -0.1, 0); }
    if (lvl === 3) { for (const s of [1, -1]) P.add(RB(0.13, 0.05, 0.16, 0.03), c, 0.2 * s, 0.17, 0, 0, 0, -0.35 * s); P.add(RB(0.2, 0.08, 0.06, 0.02), c, 0, 0.18, 0.1); }
    if (lvl === 1) P.add(RB(0.2, 0.05, 0.02, 0.01), 0xd8d8d0, 0, 0.12, 0.15);
  } else if (kind === 'bag') {
    const c = [0, 0x6a5a3a, 0x4a5636, 0x3a3f4a][lvl];
    const h = [0, 0.32, 0.42, 0.55][lvl], w = [0, 0.3, 0.34, 0.38][lvl], d = [0, 0.14, 0.18, 0.22][lvl];
    P.add(RB(w, h, d, 0.05), c, 0, 0.02 - h * 0.1, -0.12 - d / 2);
    P.add(RB(w * 0.8, h * 0.35, 0.05, 0.02), new THREE.Color(c).multiplyScalar(0.8), 0, -h * 0.25, -0.12 - d - 0.02);
    for (const s of [1, -1]) P.add(BOX(0.04, h * 0.9, 0.02), 0x222222, 0.1 * s, 0.03, -0.13);
    if (lvl >= 2) P.add(CYL(0.065, 0.065, w * 1.05, 12), 0x5a4a32, 0, h * 0.42, -0.12 - d / 2, 0, 0, Math.PI / 2);
  }
  gearCache[key] = P.build().geo;
  return gearCache[key];
}
const gearMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.05 });

export class Character {
  constructor(opts = {}) {
    const H = humanGeometry();
    const g = H.g.clone();
    this.slot = H.slot;
    this.col = [new THREE.Color(SKINS[(opts.skin ?? 0) % SKINS.length]), new THREE.Color(opts.shirt ?? 0x777777), new THREE.Color(opts.pants ?? 0x3a3f46), new THREE.Color(0x2b241e),
      new THREE.Color(0x2a2a2a), new THREE.Color(HAIRS[(opts.hair ?? 0) % HAIRS.length]), new THREE.Color(0x26282a), new THREE.Color(0x1a1410), new THREE.Color(opts.shirt ?? 0x777777).multiplyScalar(0.65), new THREE.Color(0x2e3236)];
    const cols = new Float32Array(this.slot.length * 3);
    for (let i = 0; i < this.slot.length; i++) { const c = this.col[this.slot[i]]; cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    this.geo = g;
    this.bones = {}; const list = [];
    for (const b of BONES) { const bone = new THREE.Bone(); bone.name = b; this.bones[b] = bone; list.push(bone); }
    for (const b of BONES) {
      const j = J[b];
      if (PARENT[b]) { const pj = J[PARENT[b]]; this.bones[b].position.set(j[0] - pj[0], j[1] - pj[1], j[2] - pj[2]); this.bones[PARENT[b]].add(this.bones[b]); }
      else this.bones[b].position.set(...j);
    }
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.02 });
    const mesh = new THREE.SkinnedMesh(g, this.mat);
    mesh.add(this.bones.root); mesh.bind(new THREE.Skeleton(list));
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    this.mesh = mesh;
    this.group = new THREE.Group(); this.group.add(mesh);
    // gear holders
    this.helmet = new THREE.Mesh(undefined, gearMat); this.helmet.castShadow = true; this.bones.head.add(this.helmet); this.helmet.position.set(0, 0.03, 0); this.helmet.visible = false;
    this.vest = new THREE.Mesh(undefined, gearMat); this.vest.castShadow = true; this.bones.chest.add(this.vest); this.vest.position.set(0, 0.04, 0); this.vest.visible = false;
    this.bag = new THREE.Mesh(undefined, gearMat); this.bag.castShadow = true; this.bones.chest.add(this.bag); this.bag.position.set(0, 0.1, 0); this.bag.visible = false;
    this.gear = [0, 0, 0];
    // weapon in aim space (child of group), back weapon on chest
    this.aim = new THREE.Group(); this.group.add(this.aim);
    this.gunHolder = new THREE.Group(); this.aim.add(this.gunHolder);
    this.backHolder = new THREE.Group(); this.bones.chest.add(this.backHolder);
    this.backHolder.position.set(0.02, 0.12, -0.2); this.backHolder.rotation.set(0, Math.PI / 2, Math.PI * 0.27);
    this.gunKey = null; this.backKey = null; this.gun = null;
    this.chute = null;
    this.phase = Math.random() * 10; this.hipYaw = 0; this.flashT = 0; this.deadT = 0;
    this.tq = {}; for (const b of BONES) this.tq[b] = new THREE.Quaternion();
    this.rootY = 0; this.rootPitch = 0;
  }
  setGear(h, v, b) {
    if (h !== this.gear[0]) { this.helmet.visible = h > 0; if (h > 0) this.helmet.geometry = gearGeo('helm' + h); }
    if (v !== this.gear[1]) { this.vest.visible = v > 0; if (v > 0) this.vest.geometry = gearGeo('vest' + v); }
    if (b !== this.gear[2]) { this.bag.visible = b > 0; if (b > 0) this.bag.geometry = gearGeo('bag' + b); }
    this.gear = [h, v, b];
  }
  setGun(id, att) {
    const key = id ? id + '|' + attKey(att) : null;
    if (key === this.gunKey) return; this.gunKey = key;
    this.gunHolder.clear(); this.gun = null;
    if (id && WEAPONS[id]) { this.gun = weaponModel(id, att); this.gunHolder.add(this.gun); }
  }
  setBack(id) {
    if (id === this.backKey) return; this.backKey = id; this.backHolder.clear();
    if (id && WEAPONS[id]) { const m = weaponModel(id); m.position.set(0, 0, -0.1); this.backHolder.add(m); }
  }
  showChute(on, color = 0xd94a3b) {
    if (on && !this.chute) { this.chute = parachuteModel(color); this.group.add(this.chute); }
    if (this.chute) this.chute.visible = on;
  }
  flash() { this.flashT = 0.12; }
  // s: { st, speed, vx, vz (local m/s, +z fwd), crouch, prone, sprint, pitch, armed, ads, reload (0..1|-1), punch, lean }
  animate(dt, s) {
    const B = this.bones, T = this.tq; const st = s.st;
    const k = 1 - Math.exp(-dt * (st === 'dead' ? 7 : 16));
    // hit flash
    if (this.flashT > 0) { this.flashT -= dt; this.mat.emissive.setRGB(0.6, 0.05, 0.05); } else if (this.mat.emissive.r) this.mat.emissive.setRGB(0, 0, 0);
    this.showChute(st === 'chute');
    const E = {}; // target eulers
    const e = (b, x = 0, y = 0, z = 0) => (E[b] = [x, y, z]);
    for (const b of BONES) e(b);
    let hipsY = 0.97, rootRx = 0, rootY = 0, rootZ = 0;
    const sp = s.speed || 0;
    const armed = s.armed && st === 'ground' || (s.armed && (st === 'down' ? false : st === 'swim' ? false : false));
    let aimMode = null; // 'aim' | 'low' | null
    if (st === 'fall') {
      rootRx = 1.2; rootY = 0.85; rootZ = -0.35;
      const w = Math.sin(this.phase += dt * 5) * 0.06;
      e('uaL', 0.2, 0, 1.9 + w); e('uaR', 0.2, 0, -1.9 - w); e('faL', 0, 0, 0.5); e('faR', 0, 0, -0.5);
      e('thL', 0.3, 0, 0.25); e('thR', 0.3, 0, -0.25); e('shL', 0.9); e('shR', 0.9); e('head', -0.9);
    } else if (st === 'chute') {
      this.phase += dt * 2;
      e('uaL', 0, 0, 2.6); e('uaR', 0, 0, -2.6); e('faL', 0, 0, 0.45); e('faR', 0, 0, -0.45);
      e('thL', -0.25 + Math.sin(this.phase) * 0.1); e('thR', 0.05 - Math.sin(this.phase) * 0.1); e('shL', 0.35); e('shR', 0.5);
    } else if (st === 'dead') {
      rootRx = -1.5; rootY = 0.12; rootZ = -0.85;
      e('uaL', 0.3, 0, 1.3); e('uaR', -0.2, 0, -0.5); e('faR', -0.6); e('head', 0.1, 0.6); e('thL', 0, 0, 0.18); e('shL', 0.25); e('thR', -0.2); e('shR', 0.3);
    } else if (st === 'down') {
      hipsY = 0.36; this.phase += dt * (1 + sp * 4);
      const c = Math.sin(this.phase * 2.2) * Math.min(1, sp);
      e('spine', 0.9); e('chest', 0.25); e('head', -0.9);
      e('thL', -1.55 + c * 0.35); e('thR', -1.55 - c * 0.35); e('shL', 1.75); e('shR', 1.75);
      e('uaL', -1.15 - c * 0.35, 0, 0.15); e('uaR', -1.15 + c * 0.35, 0, -0.15); e('faL', -0.5); e('faR', -0.5);
    } else if (st === 'swim') {
      rootRx = 1.15; rootY = 1.05; rootZ = -0.45; this.phase += dt * 3;
      e('head', -1.0); e('uaL', -2.5 + Math.sin(this.phase) * 0.9, 0, 0.3); e('uaR', -2.5 - Math.sin(this.phase) * 0.9, 0, -0.3);
      e('thL', Math.sin(this.phase * 2) * 0.35); e('thR', -Math.sin(this.phase * 2) * 0.35);
    } else if (s.prone) {
      rootRx = 1.5; rootY = 0.17; rootZ = -0.85; this.phase += dt * sp * 3;
      const c = Math.sin(this.phase) * Math.min(1, sp);
      e('head', -1.25 - (s.pitch || 0) * 0.3); e('chest', -0.15);
      e('thL', 0.05 + c * 0.3, 0, 0.15); e('thR', 0.05 - c * 0.3, 0, -0.15); e('shL', 0.1 + Math.max(0, c) * 0.8); e('shR', 0.1 + Math.max(0, -c) * 0.8);
      if (armed) aimMode = 'prone'; else { e('uaL', -2.6 + c * 0.4, 0, 0.3); e('uaR', -2.6 - c * 0.4, 0, -0.3); e('faL', -0.6); e('faR', -0.6); }
    } else {
      // ---- locomotion (ground) ----
      const vx = s.vx || 0, vz = s.vz || 0;
      const mvAng = sp > 0.3 ? Math.atan2(vx, vz) : 0; // 0 fwd, +-PI/2 strafe
      const back = Math.abs(mvAng) > Math.PI * 0.6;
      let hipTarget = back ? mvAng - Math.sign(mvAng) * Math.PI : mvAng;
      hipTarget = Math.max(-0.9, Math.min(0.9, hipTarget));
      if (sp < 0.3) hipTarget = 0;
      this.hipYaw += (hipTarget - this.hipYaw) * Math.min(1, dt * 8);
      const stride = s.crouch ? 0.55 : sp > 5.5 ? 1.25 : 0.9;
      this.phase += (sp * dt / stride) * Math.PI * (back ? -1 : 1);
      const run = Math.min(1, sp / 6.5), walk = Math.min(1, sp / 2);
      const ph = this.phase;
      const sw = Math.sin(ph) * (0.42 + run * 0.38) * walk;
      const knee = (o) => Math.max(0, Math.sin(ph + o)) * (0.55 + run * 0.95) * walk;
      e('hips', 0, this.hipYaw); e('spine', 0, -this.hipYaw * 0.55); e('chest', 0, -this.hipYaw * 0.45);
      if (s.crouch) {
        hipsY = 0.64;
        e('thL', -1.2 + sw * 0.55, 0, 0.06); e('thR', -0.85 - sw * 0.55, 0, -0.06);
        e('shL', 1.6 - knee(0.5) * 0.35); e('shR', 1.45 - knee(0.5 + Math.PI) * 0.35);
        e('ftL', -0.35); e('ftR', -0.5);
        E.spine[0] += 0.28;
      } else {
        hipsY = 0.97 - Math.abs(Math.cos(ph)) * 0.035 * walk - run * 0.03;
        e('thL', -sw - run * 0.1, E.thL[1], 0.02); e('thR', sw - run * 0.1, E.thR[1], -0.02);
        e('shL', knee(Math.PI + 0.7) + 0.06); e('shR', knee(0.7) + 0.06);
        e('ftL', -Math.max(0, -Math.sin(ph)) * 0.3 * walk); e('ftR', -Math.max(0, Math.sin(ph)) * 0.3 * walk);
        E.spine[0] += run * 0.14 * (s.sprint ? 1.6 : 1);
      }
      if (armed) aimMode = s.sprint ? 'low' : 'aim';
      else {
        e('uaL', sw * 0.85, 0, 0.1); e('uaR', -sw * 0.85, 0, -0.1);
        e('faL', -0.25 - run * 0.9); e('faR', -0.25 - run * 0.9);
        if (s.punch > 0) { e('uaR', -1.55 * s.punch, 0, -0.1); e('faR', -0.15); E.chest[1] = 0.35 * s.punch; }
      }
      if (s.lean) E.spine[2] = -s.lean * 0.32;
    }
    // aiming torso
    const pitch = s.pitch || 0;
    if (aimMode === 'aim') { E.chest[0] += -pitch * 0.55; E.spine[0] += -pitch * 0.2 + (s.crouch ? 0 : 0.03); E.head[0] += -pitch * 0.25; E.chest[1] += 0.18; E.head[1] -= 0.15; E.neck[1] -= 0.05; }
    if (aimMode === 'low') { E.chest[0] += 0.05; E.chest[1] += 0.2; }
    // apply smoothed rotations
    for (const b of BONES) {
      const t = E[b]; _q.setFromEuler(_e.set(t[0], t[1], t[2]));
      B[b].quaternion.slerp(_q, b === 'root' ? 1 : k);
    }
    this.rootPitch += (rootRx - this.rootPitch) * k;
    B.root.quaternion.setFromEuler(_e.set(this.rootPitch, 0, 0));
    this.rootY += (rootY - this.rootY) * k;
    B.root.position.set(0, this.rootY, rootZ * Math.min(1, Math.abs(this.rootPitch) / 1.4));
    B.hips.position.y += (hipsY - B.hips.position.y) * k;
    // ---- weapon pose + arm IK ----
    this.gunHolder.visible = !!(aimMode && this.gun);
    if (aimMode && this.gun) this.poseGun(aimMode, s, pitch);
  }
  poseGun(mode, s, pitch) {
    const G = this.gun.userData; const pistol = G.pistol;
    const B = this.bones;
    // aim pivot (character local space)
    const crouchDrop = s.crouch ? 0.33 : 0;
    if (mode === 'prone') {
      this.aim.position.set(-0.05, 0.25, 0.75); this.aim.rotation.set(-pitch * 0.6, 0, 0);
      this.gunHolder.position.set(0, 0, 0); this.gunHolder.rotation.set(0, 0, 0);
    } else if (mode === 'low') {
      this.aim.position.set(-0.06, 1.3 - crouchDrop, 0.12); this.aim.rotation.set(0.55, 0.55, 0.15);
      this.gunHolder.position.set(0, -0.04, 0.12); this.gunHolder.rotation.set(0, 0, 0);
    } else {
      const ads = s.ads ? 1 : 0;
      this.aim.position.set(pistol ? 0 : -0.11, 1.44 - crouchDrop - (s.lean ? 0 : 0), 0.02);
      this.aim.rotation.set(-pitch, 0, 0);
      if (pistol) this.gunHolder.position.set(0.0, 0.04 + ads * 0.06, 0.44);
      else this.gunHolder.position.set(0, -0.05 + ads * 0.035, 0.2);
      this.gunHolder.rotation.set(0, 0, s.lean ? -s.lean * 0.3 : 0);
    }
    // world targets
    this.group.updateWorldMatrix(true, true);
    const gripW = _v1.copy(G.grip).applyMatrix4(this.gun.matrixWorld);
    let foreL = G.fore.clone();
    if (s.reload >= 0 && s.reload <= 1) { // left hand to magazine & belt and back
      const r = s.reload; const a = Math.sin(Math.min(1, r * 1.25) * Math.PI);
      foreL = G.fore.clone().lerp(G.mag, Math.min(1, a * 1.6)).add(V(0, -0.25 * Math.max(0, Math.sin(r * Math.PI * 2)), -0.1 * a));
    }
    const foreW = _v2.copy(foreL).applyMatrix4(this.gun.matrixWorld);
    this.ik('R', gripW, V(-0.6, -1, -0.25));
    this.ik('L', foreW, V(0.7, -1, -0.1));
  }
  ik(side, targetW, poleLocal) {
    const ua = this.bones['ua' + side], fa = this.bones['fa' + side], hd = this.bones['hd' + side], chest = this.bones.chest;
    chest.updateWorldMatrix(true, false);
    const T = _v3.copy(targetW); chest.worldToLocal(T);
    const S = ua.position;
    const dir = _v4.subVectors(T, S); let d = dir.length();
    d = Math.min(Math.max(d, 0.05), UA + FA - 0.002); dir.normalize();
    const cosA = (UA * UA + d * d - FA * FA) / (2 * UA * d); const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const pole = poleLocal.clone().normalize(); pole.addScaledVector(dir, -pole.dot(dir)).normalize();
    const elbow = S.clone().addScaledVector(dir, UA * cosA).addScaledVector(pole, UA * sinA);
    const uDir = elbow.clone().sub(S).normalize();
    ua.quaternion.setFromUnitVectors(DOWN, uDir);
    const handPos = S.clone().addScaledVector(dir, d);
    const fDir = handPos.sub(elbow).normalize().applyQuaternion(ua.quaternion.clone().invert());
    fa.quaternion.setFromUnitVectors(DOWN, fDir);
    hd.quaternion.identity();
  }
  dispose() { this.geo.dispose(); this.mat.dispose(); }
}
function attKey(att) { return att ? [att.s, att.m, att.g, att.x].map((x) => x || '').join(',') : ''; }

// ---------- weapons (origin = right-hand grip, barrel along +Z) ----------
const wCache = {};
export function weaponModel(id, att) {
  const key = id + '|' + attKey(att);
  if (!wCache[key]) wCache[key] = buildWeapon(id, att || {});
  const src = wCache[key];
  const m = new THREE.Mesh(src.geo, weaponMat); m.castShadow = true;
  m.userData = src.ud;
  const g = new THREE.Group(); g.add(m); g.userData = src.ud;
  return g;
}
const weaponMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.45 });
function buildWeapon(id, att) {
  const w = WEAPONS[id]; const P = new Parts();
  const BLK = 0x1c1d20, MET = 0x3b3d42, GRP = 0x262420, body = new THREE.Color(w.color);
  const wood = w.color;
  const cat = w.cat;
  const ud = { grip: V(0, 0, 0), fore: V(0, -0.01, 0.25), mag: V(0, -0.08, 0.1), muzzle: V(0, 0.04, 0.6), sightY: 0.085, sightZ: 0.05, pistol: cat === 'PST', len: 0.8 };
  if (cat === 'PST') {
    P.add(RB(0.03, 0.035, 0.19, 0.008), MET, 0, 0.075, 0.07);
    P.add(RB(0.028, 0.03, 0.17, 0.006), BLK, 0, 0.045, 0.06);
    P.add(RB(0.028, 0.105, 0.045, 0.01), GRP, 0, -0.0, -0.005, 0.22);
    P.add(BOX(0.004, 0.012, 0.004), BLK, 0, 0.098, 0.15); P.add(BOX(0.02, 0.01, 0.006), BLK, 0, 0.097, -0.02);
    P.add(BOX(0.012, 0.03, 0.03), BLK, 0, 0.022, 0.035);
    ud.fore = V(0.01, -0.03, 0.0); ud.mag = V(0, -0.06, 0); ud.muzzle = V(0, 0.075, 0.17); ud.sightY = 0.1; ud.sightZ = 0.0; ud.len = 0.22;
  } else {
    const L = { AR: 0.86, SMG: 0.62, DMR: 1.0, SR: 1.12, SG: 0.98, LMG: 1.05 }[cat];
    const recv = cat === 'SMG' ? 0.26 : 0.32;
    // receiver
    P.add(RB(0.056, 0.075, recv, 0.012), cat === 'SR' || cat === 'SG' ? MET : body, 0, 0.05, 0.08);
    P.add(RB(0.05, 0.03, recv * 0.9, 0.006), MET, 0, 0.095, 0.08);
    // top rail
    for (let i = 0; i < 10; i++) P.add(BOX(0.034, 0.008, 0.012), BLK, 0, 0.112, -0.03 + i * (recv + 0.12) / 10);
    // handguard
    const hgL = L * 0.33;
    P.add(RB(0.054, 0.058, hgL, 0.014), cat === 'SG' || (cat === 'AR' && w.ammo === 'a762') || cat === 'SR' ? wood : BLK, 0, 0.045, 0.08 + recv / 2 + hgL / 2);
    if (cat !== 'SR' && cat !== 'SG') for (let i = 0; i < 4; i++) P.add(BOX(0.058, 0.012, 0.03), MET, 0, 0.04, 0.1 + recv / 2 + i * hgL / 4);
    // barrel
    const bz0 = 0.08 + recv / 2 + hgL;
    const bl = Math.max(0.08, L - bz0 - 0.1);
    P.add(CYL(0.011, 0.012, bl, 10), MET, 0, 0.055, bz0 + bl / 2 - 0.02, Math.PI / 2);
    let mz = bz0 + bl - 0.02;
    // front sight post
    if (!att.s) { P.add(BOX(0.006, 0.04, 0.01), BLK, 0, 0.1, bz0 - 0.02); P.add(BOX(0.03, 0.03, 0.012), BLK, 0, 0.115, 0.0); }
    // muzzle device
    if (att.m === 'm_supp') { P.add(CYL(0.02, 0.02, 0.17, 12), BLK, 0, 0.055, mz + 0.085, Math.PI / 2); mz += 0.17; }
    else if (att.m === 'm_comp') { P.add(CYL(0.016, 0.016, 0.06, 10), MET, 0, 0.055, mz + 0.03, Math.PI / 2); P.add(BOX(0.03, 0.008, 0.04), BLK, 0, 0.068, mz + 0.03); mz += 0.06; }
    else if (att.m === 'm_flash') { P.add(CYL(0.014, 0.012, 0.05, 6), BLK, 0, 0.055, mz + 0.025, Math.PI / 2); mz += 0.05; }
    else P.add(CYL(0.014, 0.014, 0.03, 8), BLK, 0, 0.055, mz + 0.015, Math.PI / 2);
    // pistol grip
    P.add(RB(0.034, 0.11, 0.045, 0.01), GRP, 0, -0.035, 0.0, 0.32);
    P.add(BOX(0.012, 0.035, 0.05), BLK, 0, 0.0, 0.05); // trigger guard
    // stock
    if (cat === 'SMG') { P.add(BOX(0.015, 0.05, 0.22), BLK, 0, 0.03, -0.14); P.add(RB(0.03, 0.09, 0.03, 0.008), BLK, 0, 0.01, -0.25); }
    else if (cat === 'SR' || cat === 'SG' || (cat === 'AR' && w.ammo === 'a762')) { P.add(RB(0.045, 0.085, 0.3, 0.02), wood, 0, 0.02, -0.17, 0.12); }
    else { P.add(CYL(0.016, 0.016, 0.16, 8), BLK, 0, 0.05, -0.09, Math.PI / 2); P.add(RB(0.045, 0.1, 0.18, 0.015), body, 0, 0.03, -0.22); }
    // magazine
    if (cat === 'LMG') { P.add(RB(0.1, 0.11, 0.12, 0.02), BLK, -0.035, -0.04, 0.14); ud.mag = V(-0.04, -0.06, 0.14); }
    else if (cat === 'SG') { P.add(CYL(0.017, 0.017, hgL * 1.1, 8), MET, 0, 0.012, 0.08 + recv / 2 + hgL / 2, Math.PI / 2); if (w.pump) P.add(RB(0.06, 0.05, 0.15, 0.015), GRP, 0, 0.005, 0.08 + recv / 2 + hgL * 0.5); ud.mag = V(0, 0.0, 0.12); }
    else if (w.bolt) { P.add(RB(0.035, 0.05, 0.08, 0.008), BLK, 0, -0.0, 0.11); P.add(CYL(0.006, 0.006, 0.06, 6), MET, -0.04, 0.085, 0.03, 0, 0, Math.PI / 2); P.add(SPH(0.012, 8, 6), MET, -0.07, 0.085, 0.03); ud.mag = V(0, -0.03, 0.11); }
    else {
      const ext = att.x === 'x_ext' || att.x === 'x_eq';
      const mh = (cat === 'SMG' ? 0.17 : w.ammo === 'a762' ? 0.15 : 0.14) * (ext ? 1.3 : 1);
      const curve = w.ammo === 'a762' && cat === 'AR' ? 0.35 : 0.12;
      P.add(RB(0.026, mh * 0.55, 0.06, 0.006), BLK, 0, 0.02 - mh * 0.27, 0.13, curve * 0.5);
      P.add(RB(0.026, mh * 0.55, 0.06, 0.006), BLK, 0, 0.02 - mh * 0.72, 0.13 + Math.sin(curve) * mh * 0.45, curve * 1.3);
      ud.mag = V(0, -mh * 0.5, 0.15);
    }
    // grip attachment
    ud.fore = V(0, -0.0, 0.08 + recv / 2 + hgL * 0.55);
    if (att.g === 'g_vert') { P.add(RB(0.028, 0.08, 0.03, 0.008), GRP, 0, -0.02, ud.fore.z); ud.fore = V(0, -0.04, ud.fore.z); }
    else if (att.g === 'g_ang') { P.add(RB(0.026, 0.045, 0.08, 0.008), GRP, 0, 0.0, ud.fore.z - 0.02, -0.5); ud.fore = V(0, -0.005, ud.fore.z - 0.04); }
    // charging handle
    P.add(BOX(0.02, 0.012, 0.025), MET, 0.035, 0.07, 0.12);
    ud.muzzle = V(0, 0.055, mz); ud.len = mz + 0.25;
    ud.sightY = att.s ? 0.165 : 0.125; ud.sightZ = 0.05;
    // optics
    if (att.s) {
      const S = att.s; const y0 = 0.125;
      P.add(RB(0.035, 0.018, 0.06, 0.004), BLK, 0, 0.122, 0.04);
      if (S === 's_red') { P.add(CYL(0.022, 0.024, 0.06, 14, true), BLK, 0, y0 + 0.04, 0.04, Math.PI / 2); P.add(RB(0.03, 0.02, 0.03, 0.006), BLK, 0, y0 + 0.01, 0.04); ud.sightY = y0 + 0.04; }
      else if (S === 's_holo') { P.add(RB(0.05, 0.04, 0.09, 0.008), BLK, 0, y0 + 0.008, 0.04); for (const s of [1, -1]) P.add(BOX(0.006, 0.05, 0.08), BLK, 0.024 * s, y0 + 0.045, 0.04); P.add(BOX(0.05, 0.006, 0.08), BLK, 0, y0 + 0.07, 0.04); ud.sightY = y0 + 0.045; }
      else {
        const sl = S === 's_2x' ? 0.12 : S === 's_4x' ? 0.2 : 0.28, sr = S === 's_8x' ? 0.022 : 0.019;
        P.add(CYL(sr, sr, sl, 14), BLK, 0, y0 + 0.045, 0.04, Math.PI / 2);
        P.add(CYL(sr + 0.008, sr, 0.04, 14), BLK, 0, y0 + 0.045, 0.04 + sl / 2, Math.PI / 2);
        P.add(CYL(sr + 0.006, sr, 0.035, 14), BLK, 0, y0 + 0.045, 0.04 - sl / 2, -Math.PI / 2);
        if (S !== 's_2x') { P.add(CYL(0.01, 0.01, 0.03, 8), BLK, 0, y0 + 0.08, 0.04); P.add(CYL(0.01, 0.01, 0.03, 8), BLK, 0.035, y0 + 0.045, 0.04, 0, 0, Math.PI / 2); }
        for (const z of [-0.04, 0.08]) P.add(RB(0.02, 0.035, 0.02, 0.004), BLK, 0, y0 + 0.02, z);
        ud.sightY = y0 + 0.045;
      }
    }
  }
  return { geo: P.build().geo, ud };
}

// ---------- parachute (original ram-air canopy) ----------
function parachuteModel(color) {
  const g = new THREE.Group();
  const P = new Parts(); const cells = 9;
  for (let i = 0; i < cells; i++) {
    const a = (i / (cells - 1) - 0.5) * 1.6; const x = Math.sin(a) * 3.2, y = Math.cos(a) * 1.1 + 3.2;
    P.add(RB(0.72, 0.28, 1.9, 0.12), i % 2 ? color : 0xf0f0ea, x, y, 0.1, 0, 0, -a);
  }
  const canopy = new THREE.Mesh(P.build().geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }));
  canopy.castShadow = true; g.add(canopy);
  const pts = [];
  for (let i = 0; i < cells; i++) { const a = (i / (cells - 1) - 0.5) * 1.6; for (const z of [-0.7, 0.8]) { pts.push(V(Math.sign(i - 4) * 0.15, 1.45, 0), V(Math.sin(a) * 3.2, Math.cos(a) * 1.1 + 3.05, z)); } }
  g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.55 })));
  return g;
}
export function careChuteModel() { const c = parachuteModel(0x2a5aa8); c.scale.setScalar(0.8); c.position.y = -0.6; return c; }

// ---------- transport plane ----------
export function planeModel() {
  const P = new Parts(); const hull = 0xb8c0c6, dark = 0x4b5258, stripe = 0x2f4f6f;
  P.add(CAP(2.3, 26, 16), hull, 0, 0, 0, Math.PI / 2);
  P.add(CYL(2.32, 2.32, 26, 16, true), stripe, 0, 0, 0, Math.PI / 2, 0, 0, 1, 1, 1);
  P.add(RB(42, 0.6, 5.5, 0.25), hull, 0, 1.5, 1.5);
  P.add(RB(15, 0.4, 3, 0.15), hull, 0, 1.9, -15.8);
  P.add(RB(0.4, 7, 4.5, 0.15), hull, 0, 5.1, -15.8);
  for (let i = -5; i <= 5; i++) if (i) P.add(RB(0.5, 0.45, 0.02, 0.05), 0x1a2a3a, 2.31 * Math.sign(i), 0.6, i * 1.8, 0, 0, 0);
  P.add(RB(2.8, 0.8, 1.2, 0.2), 0x1a2a3a, 0, 1.0, 14.3, -0.3);
  for (const x of [-8.5, -15, 8.5, 15]) { P.add(CYL(0.95, 0.85, 3.8, 14), dark, x, 1.0, 3.0, Math.PI / 2); P.add(SPH(0.5, 10, 8), dark, x, 1.0, 5.0); }
  P.add(RB(3, 0.3, 6, 0.1), dark, 0, -2.2, -6); // rear ramp
  const mesh = new THREE.Mesh(P.build().geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.2 }));
  mesh.castShadow = true;
  const g = new THREE.Group(); g.add(mesh);
  for (const x of [-8.5, -15, 8.5, 15]) { const prop = new THREE.Mesh(BOX(4.4, 0.25, 0.06), new THREE.MeshStandardMaterial({ color: 0x2a2a2a, transparent: true, opacity: 0.55 })); prop.position.set(x, 1.0, 5.3); prop.name = 'prop'; g.add(prop); }
  return g;
}

// ---------- world items ----------
const iCache = {};
const itemMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2 });
export function itemModel(type) {
  const IT = ITEMS[type];
  if (IT && (IT.kind === 'helm' || IT.kind === 'vest' || IT.kind === 'bag')) {
    const m = new THREE.Mesh(gearGeo(IT.kind + IT.lvl), gearMat); m.castShadow = true;
    if (IT.kind === 'helm') m.position.set(0, -0.06, 0);
    if (IT.kind === 'vest') { m.rotation.x = -Math.PI / 2; m.position.set(0, 0.15, 0.06); }
    if (IT.kind === 'bag') { m.rotation.x = -Math.PI / 2; m.position.set(0, 0.25, 0.1); }
    const g = new THREE.Group(); g.add(m); return g;
  }
  if (WEAPONS[type]) { const g = new THREE.Group(); const w = weaponModel(type); w.rotation.set(0, 0, Math.PI / 2); w.position.set(0.03, 0.04, 0); g.add(w); return g; }
  if (!iCache[type]) {
    const P = new Parts();
    if (AMMO[type]) {
      P.add(RB(0.26, 0.13, 0.17, 0.015), 0x4a5638, 0, 0.065, 0);
      P.add(RB(0.265, 0.05, 0.12, 0.01), AMMO[type].color, 0, 0.075, 0);
      P.add(RB(0.08, 0.03, 0.04, 0.008), 0x2a2a2a, 0, 0.14, 0);
    } else if (ATTACH[type]) {
      const a = ATTACH[type];
      if (a.slot === 's') { const l = a.scope ? 0.24 : 0.09; P.add(CYL(0.03, 0.03, l, 14), 0x1c1d20, 0, 0.05, 0, Math.PI / 2); P.add(RB(0.04, 0.03, 0.06, 0.008), 0x1c1d20, 0, 0.018, 0); }
      else if (a.slot === 'm') P.add(CYL(0.022, 0.022, type === 'm_supp' ? 0.2 : 0.07, 12), 0x2a2c30, 0, 0.025, 0, Math.PI / 2);
      else if (a.slot === 'g') P.add(RB(0.03, 0.1, 0.035, 0.01), 0x262420, 0, 0.05, 0);
      else P.add(RB(0.03, type === 'x_quick' ? 0.15 : 0.2, 0.06, 0.008), 0x1c1d20, 0, 0.03, 0, Math.PI / 2 - 0.2);
      P.add(RB(0.22, 0.012, 0.18, 0.005), 0x3e6e86, 0, 0.006, 0);
    } else if (ITEMS[type]) {
      const it = ITEMS[type];
      if (it.kind === 'heal') {
        const s = type === 'medkit' ? [0.42, 0.16, 0.3] : type === 'firstaid' ? [0.28, 0.12, 0.2] : [0.08, 0.06, 0.12];
        P.add(RB(...s, 0.02), type === 'bandage' ? 0xe8e2d0 : 0xeeeeea, 0, s[1] / 2, 0);
        P.add(BOX(s[0] * 0.42, s[1] + 0.004, s[2] * 0.14), 0xd62a2a, 0, s[1] / 2, 0); P.add(BOX(s[0] * 0.14, s[1] + 0.005, s[2] * 0.5), 0xd62a2a, 0, s[1] / 2, 0);
      } else if (it.kind === 'boost') {
        if (type === 'energy') { P.add(CYL(0.035, 0.035, 0.16, 14), it.color, 0, 0.08, 0); P.add(CYL(0.03, 0.035, 0.015, 14), 0xcccccc, 0, 0.165, 0); }
        else { P.add(CYL(0.016, 0.016, 0.16, 10), 0xf0f0f0, 0, 0.02, 0, 0, 0, Math.PI / 2); P.add(CYL(0.018, 0.018, 0.05, 10), it.color, 0.05, 0.02, 0, 0, 0, Math.PI / 2); }
      } else if (it.kind === 'throw') {
        if (type === 'frag') { P.add(SPH(0.055, 12, 10), it.color, 0, 0.06, 0, 0, 0, 0, 1, 1.15, 1); P.add(CYL(0.018, 0.018, 0.03, 8), 0x888888, 0, 0.13, 0); P.add(BOX(0.012, 0.06, 0.02), 0x888888, 0.025, 0.11, 0); }
        else { P.add(CYL(0.04, 0.04, 0.15, 14), it.color, 0, 0.075, 0); P.add(CYL(0.041, 0.041, 0.03, 14), 0xd8d8d0, 0, 0.1, 0); }
      }
    }
    if (!P.list.length) P.add(BOX(0.2, 0.2, 0.2), 0xff00ff, 0, 0.1, 0);
    const geo = P.build().geo;
    iCache[type] = geo;
  }
  const m = new THREE.Mesh(iCache[type], itemMat); m.castShadow = true;
  const g = new THREE.Group(); g.add(m); return g;
}
export function crateModel(kind) {
  const P = new Parts();
  if (kind === 'care') {
    P.add(RB(1.4, 1.1, 1.4, 0.06), 0x2a5aa8, 0, 0.55, 0); P.add(RB(1.44, 0.16, 1.44, 0.04), 0xd8d8d0, 0, 0.62, 0);
    for (const s of [1, -1]) { P.add(RB(0.08, 1.12, 1.42, 0.02), 0x1e4282, 0.62 * s, 0.55, 0); }
  } else {
    P.add(RB(0.9, 0.5, 0.62, 0.04), 0x6a5a3a, 0, 0.26, 0); P.add(RB(0.94, 0.07, 0.66, 0.02), 0x3a3a3a, 0, 0.52, 0);
    for (const s of [1, -1]) P.add(RB(0.06, 0.52, 0.64, 0.01), 0x4a3f2a, 0.38 * s, 0.26, 0);
  }
  const m = new THREE.Mesh(P.build().geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 })); m.castShadow = true; m.receiveShadow = true;
  const g = new THREE.Group(); g.add(m); return g;
}
