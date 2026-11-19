// ===== LAST CIRCLE · visual effects (particles, tracers, flashes, zone wall) =====
import * as THREE from 'three';

function softTex() {
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); return t;
}
const TEXS = {};

class Particles {
  constructor(scene, max, additive) {
    this.max = max; this.n = 0;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max); this.grow = new Float32Array(max); this.drag = new Float32Array(max); this.a0 = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3); this.aCol = new THREE.BufferAttribute(this.col, 4); this.aSize = new THREE.BufferAttribute(this.size, 1);
    this.aPos.setUsage(THREE.DynamicDrawUsage); this.aCol.setUsage(THREE.DynamicDrawUsage); this.aSize.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos); g.setAttribute('color', this.aCol); g.setAttribute('size', this.aSize);
    TEXS.soft = TEXS.soft || softTex();
    this.uniforms = { uScale: { value: 600 }, uTex: { value: TEXS.soft } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: `attribute float size; attribute vec4 color; varying vec4 vC; uniform float uScale;
        void main(){ vC = color; vec4 mv = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*mv; gl_PointSize = size*uScale/max(0.1,-mv.z); }`,
      fragmentShader: `varying vec4 vC; uniform sampler2D uTex; void main(){ vec4 t = texture2D(uTex, gl_PointCoord); gl_FragColor = vec4(vC.rgb, vC.a*t.a); if(gl_FragColor.a<0.004) discard; }`,
    });
    g.setDrawRange(0, 0);
    this.points = new THREE.Points(g, m); this.points.frustumCulled = false;
    scene.add(this.points);
  }
  spawn(x, y, z, vx, vy, vz, size, r, g, b, a, life, grav = 0, grow = 0, drag = 0) {
    let i = this.n < this.max ? this.n++ : Math.floor(Math.random() * this.max);
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b; this.col[i * 4 + 3] = a; this.a0[i] = a;
    this.size[i] = size; this.life[i] = life; this.maxLife[i] = life; this.grav[i] = grav; this.grow[i] = grow; this.drag[i] = drag;
  }
  update(dt) {
    let n = this.n;
    for (let i = 0; i < n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { // swap remove
        n--; if (i !== n) this.copy(n, i); i--; continue;
      }
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= d; this.vel[i * 3 + 2] *= d; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      const k = this.life[i] / this.maxLife[i];
      this.col[i * 4 + 3] = this.a0[i] * Math.min(1, k * 2.2) * Math.min(1, (1 - k) * 12 + 0.25);
    }
    this.n = n;
    this.points.geometry.setDrawRange(0, n);
    this.aPos.needsUpdate = true; this.aCol.needsUpdate = true; this.aSize.needsUpdate = true;
  }
  copy(s, d) {
    for (let k = 0; k < 3; k++) { this.pos[d * 3 + k] = this.pos[s * 3 + k]; this.vel[d * 3 + k] = this.vel[s * 3 + k]; }
    for (let k = 0; k < 4; k++) this.col[d * 4 + k] = this.col[s * 4 + k];
    this.size[d] = this.size[s]; this.life[d] = this.life[s]; this.maxLife[d] = this.maxLife[s]; this.grav[d] = this.grav[s]; this.grow[d] = this.grow[s]; this.drag[d] = this.drag[s]; this.a0[d] = this.a0[s];
  }
}

export function glintMaterial() {
  if (TEXS.glintMat) return TEXS.glintMat;
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,240,200,0.9)'); g.addColorStop(0.15, 'rgba(255,220,150,0.35)'); g.addColorStop(1, 'rgba(255,220,150,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  x.strokeStyle = 'rgba(255,245,220,0.7)'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(32, 6); x.lineTo(32, 58); x.moveTo(6, 32); x.lineTo(58, 32); x.stroke();
  TEXS.glintMat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.6 });
  return TEXS.glintMat;
}
export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.smoke = new Particles(scene, 3500, false);
    this.glow = new Particles(scene, 1500, true);
    // tracers
    this.MAXT = 220; this.tr = [];
    const tg = new THREE.BufferGeometry(); this.tPos = new Float32Array(this.MAXT * 6); this.tCol = new Float32Array(this.MAXT * 6);
    this.taPos = new THREE.BufferAttribute(this.tPos, 3); this.taCol = new THREE.BufferAttribute(this.tCol, 3);
    tg.setAttribute('position', this.taPos); tg.setAttribute('color', this.taCol);
    this.tracerLines = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.tracerLines.frustumCulled = false; scene.add(this.tracerLines);
    // muzzle flash light
    this.flash = new THREE.PointLight(0xffb060, 0, 9, 2); scene.add(this.flash); this.flashT = 0;
    this.smokes = []; // active smoke grenade clouds {x,y,z,t,dur}
    // bullet hole decals
    const dc = document.createElement('canvas'); dc.width = dc.height = 64; const dx = dc.getContext('2d');
    const gr = dx.createRadialGradient(32, 32, 0, 32, 32, 30); gr.addColorStop(0, 'rgba(10,8,6,1)'); gr.addColorStop(0.25, 'rgba(20,16,12,0.95)'); gr.addColorStop(0.5, 'rgba(40,34,28,0.5)'); gr.addColorStop(1, 'rgba(40,34,28,0)');
    dx.fillStyle = gr; dx.fillRect(0, 0, 64, 64);
    const dTex = new THREE.CanvasTexture(dc);
    this.DEC = 220; this.decI = 0;
    this.decals = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ map: dTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 1 }), this.DEC);
    this.decals.count = 0; this.decals.frustumCulled = false; this.decals.receiveShadow = true; scene.add(this.decals);
    this._dm = new THREE.Matrix4(); this._dq = new THREE.Quaternion(); this._dn = new THREE.Vector3(); this._dp = new THREE.Vector3(); this._ds = new THREE.Vector3(); this._z = new THREE.Vector3(0, 0, 1);
    this.emitters = []; // continuous emitters
    // zone wall
    const zg = new THREE.CylinderGeometry(1, 1, 1, 96, 1, true);
    this.zoneU = { uTime: { value: 0 }, uR: { value: 1000 } };
    const zm = new THREE.ShaderMaterial({
      uniforms: this.zoneU, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: 'varying vec2 vU; varying float vY; varying vec3 vWP; void main(){ vU = uv; vY = position.y; vWP = (modelMatrix*vec4(position,1.0)).xyz; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `varying vec2 vU; varying float vY; varying vec3 vWP; uniform float uTime; uniform float uR;
        void main(){
          float dist = length(cameraPosition - vWP);
          float near = 1.0 - smoothstep(60.0, 520.0, dist);
          float s = sin((vU.x*uR*0.35 + vU.y*30.0 - uTime*2.0))*0.5+0.5;
          float aa = 1.0 - smoothstep(0.15, 0.6, fwidth(vU.y*160.0));
          float s2 = mix(0.5, sin(vU.y*160.0 + uTime*3.0)*0.5+0.5, aa);
          float a = (0.16 + 0.12*s*s2) * smoothstep(1.0, 0.6, vU.y) * (0.25 + 0.75*near);
          gl_FragColor = vec4(0.25,0.45,1.0, a); }`,
    });
    this.zoneWall = new THREE.Mesh(zg, zm); this.zoneWall.renderOrder = 5; this.zoneWall.visible = false; scene.add(this.zoneWall);
  }
  setScale(h, fovDeg) { const s = h / (2 * Math.tan((fovDeg * Math.PI / 180) / 2)); this.smoke.uniforms.uScale.value = s; this.glow.uniforms.uScale.value = s; }
  tracer(x, y, z, dx, dy, dz, speed, maxD, color = [1, 0.75, 0.35]) {
    if (this.tr.length >= this.MAXT) this.tr.shift();
    this.tr.push({ x, y, z, dx, dy, dz, v: speed, d: 0, max: maxD, c: color, len: Math.min(14, speed * 0.016) });
  }
  muzzle(p, dir, big = 1, light = true) {
    for (let i = 0; i < 4; i++) {
      const s = (0.12 + Math.random() * 0.2) * big; const k = i * 0.12;
      this.glow.spawn(p.x + dir.x * k, p.y + dir.y * k, p.z + dir.z * k, dir.x * 2, dir.y * 2, dir.z * 2, s * 1.6, 1, 0.7, 0.35, 0.9, 0.05);
    }
    this.smoke.spawn(p.x, p.y, p.z, dir.x * 1.5, 0.4, dir.z * 1.5, 0.3, 0.75, 0.75, 0.75, 0.25, 0.8, -0.2, 0.8, 1.5);
    if (light) { this.flash.position.copy(p); this.flash.intensity = 6 * big; this.flashT = 0.05; }
  }
  impact(x, y, z, nx, ny, nz, kind) {
    if (kind === 'water') {
      for (let i = 0; i < 10; i++) this.smoke.spawn(x, y, z, (Math.random() - 0.5) * 1.5, 3 + Math.random() * 3, (Math.random() - 0.5) * 1.5, 0.18, 0.85, 0.9, 0.95, 0.7, 0.7, 9, 0.2);
      return;
    }
    if (kind === 'flesh') {
      for (let i = 0; i < 10; i++) this.smoke.spawn(x, y, z, (Math.random() - 0.5) * 2.4, Math.random() * 1.6, (Math.random() - 0.5) * 2.4, 0.1 + Math.random() * 0.08, 0.5, 0.04, 0.04, 0.85, 0.35 + Math.random() * 0.2, 6, 0.3);
      this.smoke.spawn(x, y, z, 0, 0.3, 0, 0.35, 0.45, 0.05, 0.05, 0.35, 0.5, 0, 0.8);
      return;
    }
    if (kind === 'box' || kind === 'terrain') {
      this._dn.set(nx, ny, nz); this._dq.setFromUnitVectors(this._z, this._dn);
      const q2 = new THREE.Quaternion().setFromAxisAngle(this._dn, Math.random() * 6.28); this._dq.premultiply(q2);
      const sc = kind === 'box' ? 0.09 + Math.random() * 0.04 : 0.16;
      this._dm.compose(this._dp.set(x + nx * 0.01, y + ny * 0.01, z + nz * 0.01), this._dq, this._ds.set(sc, sc, sc));
      this.decals.setMatrixAt(this.decI, this._dm); this.decI = (this.decI + 1) % this.DEC; this.decals.count = Math.max(this.decals.count, this.decI === 0 ? this.DEC : this.decI);
      this.decals.instanceMatrix.needsUpdate = true;
    }
    const dust = kind === 'terrain' ? [0.55, 0.48, 0.38] : [0.62, 0.6, 0.57];
    for (let i = 0; i < 6; i++) this.smoke.spawn(x + nx * 0.05, y + ny * 0.05, z + nz * 0.05, nx * 1.5 + (Math.random() - 0.5) * 1.5, ny * 1.5 + Math.random(), nz * 1.5 + (Math.random() - 0.5) * 1.5, 0.15, dust[0], dust[1], dust[2], 0.7, 0.9, 1.5, 0.6, 2);
    if (kind === 'box') for (let i = 0; i < 5; i++) this.glow.spawn(x, y, z, nx * 4 + (Math.random() - 0.5) * 5, ny * 4 + Math.random() * 3, nz * 4 + (Math.random() - 0.5) * 5, 0.05, 1, 0.75, 0.4, 1, 0.25, 9);
  }
  glass(x, y, z) {
    for (let i = 0; i < 26; i++) this.glow.spawn(x + (Math.random() - 0.5) * 0.9, y + (Math.random() - 0.5) * 0.8, z + (Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 3.5, Math.random() * 2, (Math.random() - 0.5) * 3.5, 0.04 + Math.random() * 0.05, 0.75, 0.88, 1.0, 0.9, 0.7 + Math.random() * 0.5, 9.8, 0, 0.5);
    for (let i = 0; i < 6; i++) this.smoke.spawn(x, y, z, (Math.random() - 0.5) * 1.5, Math.random(), (Math.random() - 0.5) * 1.5, 0.25, 0.85, 0.9, 0.95, 0.25, 0.6, 0, 0.6, 1);
  }
  explosion(x, y, z) {
    for (let i = 0; i < 30; i++) this.glow.spawn(x, y + 0.5, z, (Math.random() - 0.5) * 14, Math.random() * 10, (Math.random() - 0.5) * 14, 0.8 + Math.random(), 1, 0.6, 0.25, 1, 0.35, 6, 2, 3);
    for (let i = 0; i < 30; i++) this.smoke.spawn(x, y + 0.5, z, (Math.random() - 0.5) * 6, Math.random() * 4, (Math.random() - 0.5) * 6, 1.6, 0.25, 0.23, 0.2, 0.75, 3 + Math.random() * 2, -0.3, 1.8, 1.2);
    this.flash.position.set(x, y + 1, z); this.flash.intensity = 40; this.flash.distance = 30; this.flashT = 0.15;
  }
  smokeGrenade(x, y, z, dur = 26) { this.smokes.push({ x, y, z, t: 0, dur, acc: 0 }); }
  emitter(x, y, z, kind, dur) { const e = { x, y, z, kind, t: 0, dur, acc: 0 }; this.emitters.push(e); return e; }
  inSmoke(x, y, z) {
    for (const s of this.smokes) { const r = Math.min(7, s.t * 2.5); if (s.t < s.dur - 3 && (x - s.x) ** 2 + (y - s.y - 1.5) ** 2 + (z - s.z) ** 2 < r * r) return true; }
    return false;
  }
  segSmoke(ax, ay, az, bx, by, bz) { // does a segment cross a smoke cloud?
    for (const s of this.smokes) {
      const r = Math.min(7, s.t * 2.5); if (r < 2 || s.t > s.dur - 3) continue;
      const dx = bx - ax, dy = by - ay, dz = bz - az; const l2 = dx * dx + dy * dy + dz * dz;
      let t = ((s.x - ax) * dx + (s.y + 1.5 - ay) * dy + (s.z - az) * dz) / l2; t = Math.max(0, Math.min(1, t));
      const cx = ax + dx * t - s.x, cy = ay + dy * t - s.y - 1.5, cz = az + dz * t - s.z;
      if (cx * cx + cy * cy + cz * cz < r * r * 0.8) return true;
    }
    return false;
  }
  setZone(cx, cz, r, visible) {
    this.zoneWall.visible = visible && r > 1;
    this.zoneWall.position.set(cx, 150, cz); this.zoneWall.scale.set(Math.max(1, r), 420, Math.max(1, r)); this.zoneU.uR.value = r;
  }
  update(dt) {
    this.zoneU.uTime.value += dt;
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) { this.flash.intensity = 0; this.flash.distance = 9; } }
    // tracers
    let k = 0;
    for (let i = this.tr.length - 1; i >= 0; i--) {
      const t = this.tr[i]; t.d += t.v * dt;
      if (t.d > t.max) { this.tr.splice(i, 1); continue; }
    }
    for (const t of this.tr) {
      if (k >= this.MAXT) break;
      const hd = t.d, tl = Math.max(0, t.d - t.len);
      const o = k * 6;
      this.tPos[o] = t.x + t.dx * tl; this.tPos[o + 1] = t.y + t.dy * tl; this.tPos[o + 2] = t.z + t.dz * tl;
      this.tPos[o + 3] = t.x + t.dx * hd; this.tPos[o + 4] = t.y + t.dy * hd; this.tPos[o + 5] = t.z + t.dz * hd;
      this.tCol[o] = t.c[0] * 0.15; this.tCol[o + 1] = t.c[1] * 0.12; this.tCol[o + 2] = t.c[2] * 0.1;
      this.tCol[o + 3] = t.c[0]; this.tCol[o + 4] = t.c[1]; this.tCol[o + 5] = t.c[2];
      k++;
    }
    this.tracerLines.geometry.setDrawRange(0, k * 2); this.taPos.needsUpdate = true; this.taCol.needsUpdate = true;
    // smoke grenades
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i]; s.t += dt; s.acc += dt;
      if (s.t > s.dur) { this.smokes.splice(i, 1); continue; }
      const rate = s.t < 3 ? 0.03 : 0.12;
      while (s.acc > rate && s.t < s.dur - 4) {
        s.acc -= rate; const r = Math.min(6, s.t * 2.4);
        this.smoke.spawn(s.x + (Math.random() - 0.5) * r, s.y + 0.3 + Math.random() * r * 0.5, s.z + (Math.random() - 0.5) * r, (Math.random() - 0.5) * 1.2, 0.35, (Math.random() - 0.5) * 1.2, 3.5 + Math.random() * 2, 0.86, 0.87, 0.88, 0.9, 6 + Math.random() * 3, -0.02, 0.5, 0.5);
      }
      if (s.t >= s.dur - 4) s.acc = 0;
    }
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const e = this.emitters[i]; e.t += dt; e.acc += dt;
      if (e.t > e.dur) { this.emitters.splice(i, 1); continue; }
      while (e.acc > 0.12) { e.acc -= 0.12; this.smoke.spawn(e.x + (Math.random() - 0.5) * 0.3, e.y + 0.5, e.z + (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.6 + 0.6, 3 + Math.random(), (Math.random() - 0.5) * 0.6, 1.2, 0.85, 0.15, 0.12, 0.8, 7, -0.15, 1.1, 0.3); }
    }
    this.smoke.update(dt); this.glow.update(dt);
  }
}
