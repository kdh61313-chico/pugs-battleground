// ===== LAST CIRCLE · synthesized audio (WebAudio) =====
export class Audio {
  constructor() { this.ctx = null; this.vol = 0.8; this.listener = { x: 0, y: 0, z: 0, yaw: 0 }; this.loops = {}; }
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain(); this.master.gain.value = this.vol; this.master.connect(this.ctx.destination);
      const comp = this.ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6;
      this.bus = this.ctx.createGain(); this.bus.connect(comp); comp.connect(this.master);
      const len = this.ctx.sampleRate * 2; const b = this.ctx.createBuffer(1, len, this.ctx.sampleRate); const d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = b;
    } catch (e) { this.ctx = null; }
  }
  setVolume(v) { this.vol = v; if (this.master) this.master.gain.value = v; }
  setListener(x, y, z, yaw) { this.listener.x = x; this.listener.y = y; this.listener.z = z; this.listener.yaw = yaw; }
  spatial(x, y, z) {
    // returns [gain, pan, dist]
    if (x === undefined) return [1, 0, 0];
    const L = this.listener; const dx = x - L.x, dy = y - L.y, dz = z - L.z;
    const d = Math.hypot(dx, dy, dz);
    // forward vector of listener: (sin yaw, cos yaw); right = (-cos yaw, sin yaw)?  right of facing +z is -x
    const fx = Math.sin(L.yaw), fz = Math.cos(L.yaw);
    const rx = -fz, rz = fx; // right-hand vector
    const pan = d > 0.5 ? Math.max(-1, Math.min(1, -(dx * rx + dz * rz) / d)) : 0;
    return [1 / (1 + d * 0.045 + d * d * 0.00002), pan, d];
  }
  out(pan) {
    const p = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    if (p) { p.pan.value = pan; p.connect(this.bus); return p; }
    return this.bus;
  }
  noiseSrc() { const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.loop = true; s.loopStart = Math.random(); return s; }

  reverbNode() {
    if (this.rev) return this.rev;
    const c = this.ctx, len = Math.floor(c.sampleRate * 2.2); const ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) { const t = i / len; d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3.2) * (i < 400 ? i / 400 : 1); } }
    const cv = c.createConvolver(); cv.buffer = ir; const g = c.createGain(); g.gain.value = 0.55; cv.connect(g); g.connect(this.bus);
    this.rev = cv; return cv;
  }
  gun(cat, pos, opts = {}) {
    if (!this.ctx) return;
    const [g0, pan, d] = this.spatial(pos?.x, pos?.y, pos?.z);
    if (d > 1000) return;
    const c = this.ctx;
    const t = c.currentTime + (d > 25 ? d / 343 : 0); // sound travels ~343 m/s
    const quiet = opts.quiet;
    // [crack lowpass, crack length, thump freq, body len]
    const P = { AR: [7000, 0.09, 95, 0.16], SMG: [8000, 0.06, 130, 0.1], DMR: [6000, 0.12, 80, 0.22], SR: [5200, 0.16, 62, 0.32], SG: [4200, 0.16, 55, 0.3], LMG: [6800, 0.1, 90, 0.17], PST: [8500, 0.06, 150, 0.1] }[cat] || [7000, 0.09, 95, 0.16];
    const gain = g0 * (quiet ? 0.22 : 1) * (opts.self ? 0.85 : 1.5);
    const far = Math.min(1, d / 500);
    const o = this.out(pan);
    const rv = this.reverbNode();
    const send = c.createGain(); send.gain.value = (0.18 + far * 0.6) * (quiet ? 0.4 : 1); send.connect(rv);
    // 1) mechanical click / transient
    if (d < 60) {
      const n0 = this.noiseSrc(); const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3500;
      const g = c.createGain(); g.gain.setValueAtTime(gain * 0.5, t); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.015);
      n0.connect(hp); hp.connect(g); g.connect(o); n0.start(t, Math.random()); n0.stop(t + 0.03);
    }
    // 2) blast (noise, lowpassed with distance)
    const n = this.noiseSrc();
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime((quiet ? 1800 : P[0]) * (1 - far * 0.85) + 250, t); f.frequency.exponentialRampToValueAtTime(400, t + P[1] * 2);
    const gN = c.createGain(); gN.gain.setValueAtTime(gain, t); gN.gain.exponentialRampToValueAtTime(gain * 0.25, t + P[1] * 0.4); gN.gain.exponentialRampToValueAtTime(0.0005, t + P[1] * (2.2 + far * 2));
    n.connect(f); f.connect(gN); gN.connect(o); gN.connect(send); n.start(t, Math.random()); n.stop(t + P[1] * 5 + 0.2);
    // 3) low body
    if (!quiet) {
      const os = c.createOscillator(); os.type = 'sine'; os.frequency.setValueAtTime(P[2] * 2.2, t); os.frequency.exponentialRampToValueAtTime(P[2] * 0.6, t + P[3]);
      const gO = c.createGain(); gO.gain.setValueAtTime(gain * 1.1 * (1 - far * 0.4), t); gO.gain.exponentialRampToValueAtTime(0.0005, t + P[3] + far * 0.3);
      const ws = c.createWaveShaper(); const curve = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 2.5); } ws.curve = curve;
      os.connect(ws); ws.connect(gO); gO.connect(o); gO.connect(send); os.start(t); os.stop(t + P[3] + 0.5);
    }
    // 4) far-away rolling echo
    if (d > 80 && !quiet) {
      const n2 = this.noiseSrc(); const f2 = c.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = 700;
      const g2 = c.createGain(); g2.gain.setValueAtTime(0, t + 0.04); g2.gain.linearRampToValueAtTime(gain * 0.35, t + 0.15); g2.gain.exponentialRampToValueAtTime(0.0005, t + 1.4);
      n2.connect(f2); f2.connect(g2); g2.connect(o); n2.start(t); n2.stop(t + 1.5);
    }
    setTimeout(() => { try { send.disconnect(); } catch (e) {} }, (t - c.currentTime + 3) * 1000);
  }
  glass(pos) {
    if (!this.ctx) return;
    const [g0, pan, d] = this.spatial(pos.x, pos.y, pos.z); if (d > 120) return;
    const c = this.ctx, o = this.out(pan);
    for (let k = 0; k < 7; k++) {
      const t = c.currentTime + k * 0.025 + Math.random() * 0.03;
      const n = this.noiseSrc(); const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 3000 + Math.random() * 5000; f.Q.value = 6;
      const g = c.createGain(); g.gain.setValueAtTime(g0 * (k ? 0.35 : 0.8), t); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.08 + Math.random() * 0.15);
      n.connect(f); f.connect(g); g.connect(o); n.start(t, Math.random()); n.stop(t + 0.3);
    }
  }
  explosion(pos) {
    if (!this.ctx) return;
    const [g0, pan, d] = this.spatial(pos.x, pos.y, pos.z); const c = this.ctx, t = c.currentTime; const o = this.out(pan);
    const n = this.noiseSrc(); const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(3000 * (1 - Math.min(0.8, d / 400)), t); f.frequency.exponentialRampToValueAtTime(120, t + 1.2);
    const g = c.createGain(); g.gain.setValueAtTime(g0 * 3, t); g.gain.exponentialRampToValueAtTime(0.0005, t + 1.6);
    n.connect(f); f.connect(g); g.connect(o); n.start(t); n.stop(t + 1.7);
    const os = c.createOscillator(); os.frequency.setValueAtTime(90, t); os.frequency.exponentialRampToValueAtTime(30, t + 0.6);
    const go = c.createGain(); go.gain.setValueAtTime(g0 * 2.5, t); go.gain.exponentialRampToValueAtTime(0.0005, t + 0.8);
    os.connect(go); go.connect(o); os.start(t); os.stop(t + 0.9);
  }
  step(pos, loud = 0.5, surface = 'grass') {
    if (!this.ctx) return;
    const [g0, pan, d] = this.spatial(pos?.x, pos?.y, pos?.z); if (d > 45) return;
    const c = this.ctx, t = c.currentTime; const o = this.out(pan);
    const n = this.noiseSrc(); const f = c.createBiquadFilter(); f.type = 'bandpass';
    f.frequency.value = surface === 'hard' ? 1800 : surface === 'wood' ? 900 : 600; f.Q.value = surface === 'hard' ? 3 : 1.2;
    const g = c.createGain(); g.gain.setValueAtTime(g0 * loud * 0.55, t); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.09);
    n.connect(f); f.connect(g); g.connect(o); n.start(t, Math.random()); n.stop(t + 0.12);
  }
  ui(kind) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const tone = (fr, dur, type = 'sine', v = 0.12, at = 0) => {
      const os = c.createOscillator(); os.type = type; os.frequency.value = fr; const g = c.createGain();
      g.gain.setValueAtTime(0, t + at); g.gain.linearRampToValueAtTime(v, t + at + 0.005); g.gain.exponentialRampToValueAtTime(0.0005, t + at + dur);
      os.connect(g); g.connect(this.bus); os.start(t + at); os.stop(t + at + dur + 0.02);
    };
    switch (kind) {
      case 'hit': tone(1900, 0.05, 'square', 0.05); break;
      case 'head': tone(2600, 0.06, 'square', 0.06); tone(3400, 0.05, 'square', 0.04, 0.03); break;
      case 'kill': tone(900, 0.12, 'triangle', 0.16); tone(1350, 0.18, 'triangle', 0.14, 0.08); break;
      case 'pick': tone(700, 0.05, 'sine', 0.08); tone(1050, 0.06, 'sine', 0.06, 0.04); break;
      case 'click': tone(1200, 0.03, 'square', 0.03); break;
      case 'empty': tone(300, 0.04, 'square', 0.05); break;
      case 'reload': tone(500, 0.04, 'square', 0.05); tone(380, 0.05, 'square', 0.05, 0.18); break;
      case 'reload2': tone(620, 0.05, 'square', 0.06); break;
      case 'warn': tone(660, 0.18, 'sawtooth', 0.06); tone(660, 0.18, 'sawtooth', 0.06, 0.32); break;
      case 'hurt': tone(140, 0.12, 'sawtooth', 0.1); break;
      case 'heal': tone(520, 0.1, 'sine', 0.06); tone(780, 0.15, 'sine', 0.06, 0.1); break;
      case 'win': [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.5, 'triangle', 0.12, i * 0.14)); break;
      case 'lose': [440, 370, 311].forEach((f, i) => tone(f, 0.45, 'triangle', 0.1, i * 0.18)); break;
      case 'join': tone(880, 0.08, 'sine', 0.08); tone(1320, 0.1, 'sine', 0.06, 0.07); break;
      case 'bolt': tone(260, 0.05, 'square', 0.06, 0.25); tone(330, 0.05, 'square', 0.06, 0.5); break;
      case 'chute': { const n = this.noiseSrc(); const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900; const g = c.createGain(); g.gain.setValueAtTime(0.4, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.5); n.connect(f); f.connect(g); g.connect(this.bus); n.start(t); n.stop(t + 0.6); break; }
    }
  }
  whiz(pos) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime; const [, pan] = this.spatial(pos.x, pos.y, pos.z); const o = this.out(pan);
    const n = this.noiseSrc(); const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.setValueAtTime(5000, t); f.frequency.exponentialRampToValueAtTime(1500, t + 0.12); f.Q.value = 4;
    const g = c.createGain(); g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    n.connect(f); f.connect(g); g.connect(o); n.start(t); n.stop(t + 0.15);
  }
  impact(pos, kind) {
    if (!this.ctx) return;
    const [g0, pan, d] = this.spatial(pos.x, pos.y, pos.z); if (d > 80) return;
    const c = this.ctx, t = c.currentTime; const o = this.out(pan);
    const n = this.noiseSrc(); const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = kind === 'box' ? 2600 : kind === 'water' ? 900 : 1200; f.Q.value = 1.5;
    const g = c.createGain(); g.gain.setValueAtTime(g0 * 0.35, t); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.08);
    n.connect(f); f.connect(g); g.connect(o); n.start(t, Math.random()); n.stop(t + 0.1);
  }
  // continuous loops: wind, plane, zone
  loop(name, level, freq) {
    if (!this.ctx) return;
    let L = this.loops[name];
    if (!L) {
      const c = this.ctx; const g = c.createGain(); g.gain.value = 0; g.connect(this.bus);
      if (name === 'plane') {
        const o1 = c.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 52; const o2 = c.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 55.5;
        const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 380; o1.connect(f); o2.connect(f);
        const n = this.noiseSrc(); const fn = c.createBiquadFilter(); fn.type = 'lowpass'; fn.frequency.value = 600; n.connect(fn); const gn = c.createGain(); gn.gain.value = 0.4; fn.connect(gn); gn.connect(f);
        f.connect(g); o1.start(); o2.start(); n.start();
        L = { g, f };
      } else if (name === 'zone') {
        const o1 = c.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 110; const lfo = c.createOscillator(); lfo.frequency.value = 7; const lg = c.createGain(); lg.gain.value = 30; lfo.connect(lg); lg.connect(o1.frequency);
        const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 2; o1.connect(f); f.connect(g); o1.start(); lfo.start();
        L = { g, f };
      } else {
        const n = this.noiseSrc(); const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500; n.connect(f); f.connect(g); n.start();
        L = { g, f };
      }
      this.loops[name] = L;
    }
    const t = this.ctx.currentTime;
    L.g.gain.setTargetAtTime(level, t, 0.15);
    if (freq) L.f.frequency.setTargetAtTime(freq, t, 0.2);
  }
  stopLoops() { for (const k in this.loops) this.loop(k, 0); }
}
