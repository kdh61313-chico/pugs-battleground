// ===== LAST CIRCLE · game core: lobby/net sync, match lifecycle, items, bullets, grenades =====
import * as THREE from 'three';
import { GAME_VER, WEAPONS, AMMO, ATTACH, ITEMS, itemInfo, botName, PLAYER_COLORS } from './data.js';
import { Actor, ST, STI, WIDS } from './actor.js';
import { makePlane, planePos, makeZones, zoneAt, makeLoot, makeCare } from './match.js';
import { itemModel, crateModel, careChuteModel, planeModel, weaponModel } from './models.js';
import { clamp, lerp, mulberry32 } from './util.js';
import { LocalNet } from './net.js';
import { glintMaterial } from './effects.js';
import { PlayerMixin, newMe } from './player.js';
import { BotManager } from './bots.js';

const SEND_DT = 1 / 15, LOBBY_SEND_DT = 0.4;
const INTERP = 140; // ms
const ITEM_GRID = 25;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

export class Game {
  constructor(app) {
    Object.assign(this, app); // renderer, scene, camera, world, audio, fx, hud, settings, net
    this.mode = 'menu';
    this.actors = new Map();
    this.items = new Map(); this.crates = new Map(); this.itemGrid = new Map(); this.itemMeshes = new Map();
    this.bullets = []; this.grenades = [];
    this.ev = []; this.evSeq = Math.floor(Math.random() * 1000); this.lastSeen = {};
    this.match = null; this.g = null;
    this.me = newMe();
    this.sendT = 0; this.itemScanT = 0;
    this.joinTime = Date.now(); this.creator = false; this.ready = false; this.myTeamNum = 1;
    this.bots = new BotManager(this);
    this.plane = planeModel(); this.plane.visible = false; this.scene.add(this.plane);
    this.knownPeers = new Set();
    this.chatLog = [];
    this.spec = { id: null };
  }

  // ===================== networking / lobby =====================
  get myPeer() { return this.net.myPeer; }
  get offline() { return this.net instanceof LocalNet; }
  lobbyPeers() {
    const out = [];
    for (const p of this.net.peers()) {
      const s = p.presence || {};
      if (s.v !== GAME_VER) continue;
      out.push({ peer: p.peer, isMe: p.sameTab, name: String(s.n || '플레이어').slice(0, 16), color: (s.k | 0) % PLAYER_COLORS.length, team: clamp(s.tm | 0 || 1, 1, 4), ready: !!s.rd, cr: !!s.cr, jt: +s.jt || 0, gid: s.gid, s, guest: p.guest });
    }
    return out;
  }
  hostPeer() {
    const L = this.lobbyPeers(); if (!L.length) return this.myPeer;
    L.sort((a, b) => (b.cr - a.cr) || (a.jt - b.jt) || (a.peer < b.peer ? -1 : 1));
    return L[0].peer;
  }
  get isHost() { return this.offline || this.hostPeer() === this.myPeer; }
  hostState() {
    if (this.isHost) return this.g;
    const hp = this.hostPeer();
    for (const p of this.net.peers()) if (p.peer === hp) return (p.presence || {}).g || null;
    return null;
  }

  async enterRoom(code, creator) {
    this.creator = creator; this.joinTime = Date.now(); this.ready = false; this.myTeamNum = 1;
    this.net.onPeers = (ch) => this.onPeers(ch);
    await this.net.join(code);
    this.code = code; this.mode = 'lobby';
    this.g = { ph: 'lobby', mode: 4, nb: 24, sp: 1, df: 1 };
    this.lastSeen = {}; this.knownPeers.clear();
    this.hud.showScreen('lobby');
    this.sendNow();
    this.hud.updateLobby();
  }
  async leaveRoom() {
    this.endLocalMatch();
    await this.net.leave();
    this.mode = 'menu'; this.g = null; this.code = null;
    this.hud.showScreen('menu');
  }
  startPractice(cfg) {
    this.net = new LocalNet(); this.creator = true; this.code = null;
    this.g = { ph: 'lobby', mode: 1, nb: cfg.nb, sp: cfg.sp, df: cfg.df };
    this.mode = 'lobby';
    this.hostStart();
  }
  setLobbyCfg(k, v) { if (!this.isHost || !this.g) return; this.g[k] = v; this.sendNow(); this.hud.updateLobby(); }
  hostStart() {
    if (!this.isHost) return;
    const seed = (Math.random() * 2 ** 31) | 0;
    this.g = { ...this.g, ph: 'play', id: 'm' + seed.toString(36), seed, t: 0 };
    this.beginMatch(this.g, false);
    this.sendNow();
  }
  hostBackToLobby() {
    if (!this.isHost) return;
    this.g = { ph: 'lobby', mode: this.g.mode, nb: this.g.nb, sp: this.g.sp, df: this.g.df };
    if (this.offline) { this.endLocalMatch(); this.mode = 'menu'; this.hud.showScreen('menu'); this.net = this.realNet; return; }
    this.endLocalMatch(); this.mode = 'lobby'; this.hud.showScreen('lobby'); this.sendNow();
  }
  sendChat(text) {
    text = String(text).replace(/[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202f\u2060-\u206f\ufeff]/g, '').trim().slice(0, 80); if (!text) return;
    this.emit('ch', text);
    this.addChat(this.settings.name, text);
  }
  addChat(name, text) { this.chatLog.push({ name, text }); if (this.chatLog.length > 40) this.chatLog.shift(); this.hud.chat(name, text); }

  onPeers(ch) {
    if (ch.joined && this.mode !== 'menu') for (const p of ch.joined) if (!p.sameTab && (p.presence || {}).v === GAME_VER) this.audio.ui('join');
    for (const p of ch.left || []) {
      const a = this.actors.get(p.peer);
      if (a) { this.removeActor(p.peer); this.hud.feedText(`${a.name} 님이 나갔습니다`); }
      delete this.lastSeen[p.peer]; this.knownPeers.delete(p.peer);
    }
    this.processPeers();
    if (this.mode === 'lobby') this.hud.updateLobby();
    if (this.app && this.app.bgTick) this.app.bgTick();
  }
  processPeers() {
    const now = performance.now();
    const hp = this.hostPeer();
    for (const p of this.net.peers()) {
      if (p.sameTab) continue;
      const s = p.presence || {};
      if (s.v !== GAME_VER) continue;
      // events
      const ev = Array.isArray(s.ev) ? s.ev : [];
      if (!this.knownPeers.has(p.peer)) {
        this.knownPeers.add(p.peer);
        let mx = 0; for (const e of ev) if (Array.isArray(e) && e[0] > mx) mx = e[0];
        this.lastSeen[p.peer] = mx;
      } else {
        let last = this.lastSeen[p.peer] || 0, mx = last;
        for (const e of ev) {
          if (!Array.isArray(e) || typeof e[0] !== 'number') continue;
          if (e[0] > last) { try { this.handleEvent(p.peer, e); } catch (err) { console.warn('ev', err); } if (e[0] > mx) mx = e[0]; }
        }
        this.lastSeen[p.peer] = mx;
      }
      // host control
      if (p.peer === hp && s.g) this.onHostState(s.g, s.b, now);
      // player state
      if (this.match && s.gid === this.match.id && Array.isArray(s.p)) this.updateRemote(p.peer, s, now);
    }
  }
  onHostState(g, b, now) {
    if (this.isHost) return;
    this.g = g;
    if (g.ph === 'play') {
      if (!this.match || this.match.id !== g.id) {
        if (this.mode === 'lobby' || this.mode === 'match') this.beginMatch(g, (g.t || 0) > 25);
      } else {
        // time sync
        const est = (g.t || 0);
        const d = est - this.match.t;
        if (Math.abs(d) > 1.5) this.match.t = est; else this.match.t += d * 0.08;
        if (Array.isArray(b)) this.decodeBots(b, now);
      }
    } else if (g.ph === 'end') {
      if (this.match && this.match.id === g.id && !this.match.ended) this.onMatchEnd(g.win);
      if (Array.isArray(b) && this.match) this.decodeBots(b, now);
    } else if (g.ph === 'lobby') {
      if (this.mode === 'match') { this.endLocalMatch(); this.mode = 'lobby'; this.hud.showScreen('lobby'); this.sendNow(); }
    }
  }
  teamOf(peer, s) { return this.match && this.match.mode > 1 ? 't' + clamp(s.tm | 0 || 1, 1, 4) : 'p:' + peer; }
  get myTeam() { return this.match && this.match.mode > 1 ? 't' + this.myTeamNum : 'p:' + this.myPeer; }
  updateRemote(peer, s, now) {
    let a = this.actors.get(peer);
    if (!a) {
      a = new Actor(peer, { name: String(s.n || '플레이어').slice(0, 16), team: this.teamOf(peer, s), colorIdx: s.k | 0, skin: (s.k | 0) % 5, hair: (s.k | 0) % 4 });
      this.addActor(a);
    }
    a.name = String(s.n || a.name).slice(0, 16); a.team = this.teamOf(peer, s);
    const p = s.p, r = s.r || [0, 0];
    a.pushSnap({ t: now, x: p[0] / 10, y: p[1] / 10, z: p[2] / 10, yaw: r[0] / 100, pitch: r[1] / 100, st: ST[s.s | 0] || 'ground' });
    a.flags = s.a | 0; a.speed = (s.sp | 0) / 10; a.w = WEAPONS[s.w] ? s.w : null; a.wb = WEAPONS[s.wb] ? s.wb : null;
    a.hp = +s.hp || 0; a.kh = +s.kh || 0; a.gear = Array.isArray(s.g3) ? s.g3.map((x) => x | 0) : [0, 0, 0]; a.kills = s.kl | 0;
    a.mk = Array.isArray(s.mk) ? s.mk : null;
    if (typeof s.wa === 'string' && s.wa.length < 60) { const q = s.wa.split(','); a.att = { s: q[0] || null, m: q[1] || null, g: q[2] || null, x: q[3] || null }; } else a.att = null;
    if ((a.flags & 32) && !a.reloadT) a.reloadT = 0.001; else if (!(a.flags & 32)) a.reloadT = 0;
    const sq = s.sq | 0;
    if (a.sq >= 0 && sq > a.sq) a.pendingShots = Math.min(6, a.pendingShots + (sq - a.sq));
    a.sq = sq; a.quiet = !!(a.flags & 16);
  }
  addActor(a) { this.actors.set(a.id, a); this.scene.add(a.char.group); }
  removeActor(id) { const a = this.actors.get(id); if (!a) return; this.scene.remove(a.char.group); a.char.dispose(); this.actors.delete(id); }
  decodeBots(b, now) {
    for (let i = 0; i < b.length; i++) {
      const e = b[i]; if (!Array.isArray(e)) continue;
      const id = 'b' + i;
      let a = this.actors.get(id);
      if (!a) { a = new Actor(id, { isBot: true, name: botName(this.match.seed, i), team: id, colorIdx: (i * 3 + 1) % 8, skin: i % 5, hair: i % 4, pants: [0x56604a, 0x6a5c44, 0x4e5a68][i % 3] }); this.addActor(a); }
      a.pushSnap({ t: now, x: e[0] / 10, y: e[1] / 10, z: e[2] / 10, yaw: e[3] / 100, pitch: e[4] / 100, st: ST[e[5]] || 'ground' });
      a.hp = e[6]; a.w = WIDS[e[7] - 1] || null; const sq = e[8] | 0;
      if (a.sq >= 0 && sq > a.sq) a.pendingShots = Math.min(6, a.pendingShots + (sq - a.sq));
      a.sq = sq; const fl = e[9] | 0; a.flags = fl & 1 ? 1 : 0; a.gear = [(fl >> 1) & 3, (fl >> 3) & 3, (fl >> 5) & 3]; a.speed = ((fl >> 7) & 15);
    }
  }

  // event ring
  emit(type, ...args) {
    this.evSeq++;
    this.ev.push([this.evSeq, type, ...args]); this.evTimes = this.evTimes || []; this.evTimes.push(performance.now());
    this.sendT = Math.max(this.sendT, SEND_DT * 0.6);
    if (!this.sendQueued) { this.sendQueued = true; queueMicrotask(() => { this.sendQueued = false; if (this.net && this.mode !== 'menu') this.sendNow(); }); }
  }
  pruneEvents() {
    const now = performance.now(); const T = this.evTimes || [];
    while (this.ev.length && (now - T[0] > 4000 || this.ev.length > 24)) { this.ev.shift(); T.shift(); }
  }
  handleEvent(peer, e) {
    const type = e[1];
    switch (type) {
      case 'h': { // [id,'h',target,dmg,flags,weapon,shooter]
        const target = e[2], dmg = +e[3] || 0, flags = e[4] | 0, wpn = e[5], shooter = e[6] || peer;
        if (target === this.myPeer) this.takeDamage(Math.min(dmg, 400), flags, wpn, shooter);
        else if (this.isHost && typeof target === 'string' && target[0] === 'b') this.bots.damage(target, Math.min(dmg, 400), flags, wpn, shooter);
        const ta = this.actors.get(target); if (ta && !(flags & 2)) { ta.chest(_v); this.fx.impact(_v.x, _v.y, _v.z, 0, 1, 0, 'flesh'); ta.char.flash(); }
        break;
      }
      case 'k': this.onKill(e[2], e[3], e[4], e[5] | 0, e[6] | 0); break;
      case 'pk': this.removePicked(e[2], e[3]); break;
      case 'dr': this.addItem({ id: String(e[2]), type: e[3], qty: e[4] | 0, x: +e[5], y: +e[6], z: +e[7] }); break;
      case 'cr': this.addCrate({ id: String(e[2]), x: +e[3], y: +e[4], z: +e[5], kind: e[6], items: (e[7] || []).map((it) => ({ type: it[0], qty: it[1] | 0, taken: false })), owner: e[8] }); break;
      case 'gr': this.spawnGrenade(e[2], +e[3], +e[4], +e[5], +e[6], +e[7], +e[8], +e[9], peer); break;
      case 'rv': if (e[2] === this.myPeer) this.gotRevived(peer); break;
      case 'gb': this.shatterGlass(e[2] | 0, false); break;
      case 'ch': { const a = this.lobbyPeers().find((x) => x.peer === peer); this.addChat(a ? a.name : '???', String(e[2]).slice(0, 80)); break; }
    }
  }
  nameOf(id) {
    if (!id) return '???';
    if (id === 'zone') return '자기장'; if (id === 'fall') return '낙하'; if (id === 'self') return '자폭';
    if (id === this.myPeer) return this.settings.name;
    const a = this.actors.get(id); if (a) return a.name;
    if (id[0] === 'b' && this.match) return botName(this.match.seed, +id.slice(1));
    const lp = this.lobbyPeers().find((x) => x.peer === id); return lp ? lp.name : '???';
  }
  onKill(victim, killer, wpn, kind, head) {
    const vn = this.nameOf(victim), kn = this.nameOf(killer);
    const wn = WEAPONS[wpn] ? WEAPONS[wpn].name : wpn === 'frag' ? '수류탄' : wpn === 'fist' ? '주먹' : wpn === 'zone' ? '' : '';
    const mine = killer === this.myPeer, meV = victim === this.myPeer;
    const myTeam = this.actors.get(victim) && this.actors.get(victim).team === this.myTeam;
    this.hud.killFeed({ killer: killer === victim || killer === 'zone' || killer === 'fall' ? null : kn, victim: vn, weapon: wn, kind, head, mine, meV, team: myTeam, special: killer === 'zone' ? '자기장' : killer === 'fall' ? '낙하' : null });
    if (mine && victim !== this.myPeer) {
      if (kind === 1) { this.hud.bigNotice(`${vn} 기절시킴`, 'knock'); }
      else { this.me.kills++; this.hud.bigNotice(`${vn} 처치  ·  ${this.me.kills} 킬`, 'kill'); this.audio.ui('kill'); }
    }
    const a = this.actors.get(victim);
    if (a && kind !== 1) a.deadAt = this.match ? this.match.t : 0;
    if (a && a.team === this.myTeam && victim !== this.myPeer) this.hud.banner(kind === 1 ? `팀원 ${vn} 기절!` : `팀원 ${vn} 사망`, 'warn');
  }

  // build & send my presence
  buildPresence() {
    const S = this.settings, me = this.me;
    const P = { v: GAME_VER, n: S.name, k: S.color, tm: this.myTeamNum, cr: this.creator ? 1 : 0, jt: this.joinTime, rd: this.ready ? 1 : 0 };
    if (this.match) {
      P.gid = this.match.id; P.s = STI[me.st] ?? 3;
      P.p = [Math.round(me.pos.x * 10), Math.round(me.pos.y * 10), Math.round(me.pos.z * 10)];
      P.r = [Math.round(me.yaw * 100), Math.round(me.pitch * 100)];
      const held = this.heldWeapon();
      P.a = (me.crouch || me.mantle ? 1 : 0) | (me.sprinting ? 2 : 0) | (me.ads ? 4 : 0) | (held ? 8 : 0) | (held && held.att.m === 'm_supp' ? 16 : 0) | (me.action && me.action.kind === 'reload' ? 32 : 0) | (me.prone ? 64 : 0);
      if (held) P.wa = [held.att.s, held.att.m, held.att.g, held.att.x].map((x) => x || '').join(',');
      P.sp = Math.round(me.hspeed * 10); P.w = held ? held.id : 0;
      const back = me.slots.find((w, i) => w && i !== me.held && i < 2); P.wb = back ? back.id : 0;
      P.hp = Math.round(me.hp); P.kh = Math.round(me.kh);
      P.g3 = [me.helm ? ITEMS[me.helm.type].lvl : 0, me.vest ? ITEMS[me.vest.type].lvl : 0, me.bag ? ITEMS[me.bag].lvl : 0];
      P.sq = me.shotSeq; P.kl = me.kills; if (me.marker) P.mk = [Math.round(me.marker[0]), Math.round(me.marker[1])];
    }
    this.pruneEvents();
    P.ev = this.ev.slice(-16);
    if (this.isHost && this.g) {
      const g = { ...this.g }; if (this.match && g.ph !== 'lobby') g.t = Math.round(this.match.t * 10) / 10;
      P.g = g;
      if (this.match) P.b = this.bots.encode();
    }
    return P;
  }
  sendNow() { if (this.net) this.net.send(this.buildPresence()); this.sendT = 0; }

  // ===================== match lifecycle =====================
  // compile every shader now (incl. hidden effect/weapon meshes) so the first explosion, first glass break
  // or first gun swap doesn't freeze a frame mid-fight
  prewarm() {
    try {
      const hidden = []; this.scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
      if (!this._warmGuns) { this._warmGuns = new THREE.Group(); for (const id of Object.keys(WEAPONS)) { const m = weaponModel(id, { s: 's_4x', m: 'm_supp', g: null, x: null }); m.position.set(0, -1000, 0); this._warmGuns.add(m); } }
      this.scene.add(this._warmGuns);
      this.renderer.compile(this.scene, this.camera);
      this.scene.remove(this._warmGuns);
      for (const o of hidden) o.visible = false;
    } catch (e) { console.warn('prewarm', e); }
  }
  beginMatch(g, spectator) {
    this.endLocalMatch();
    const W = this.world;
    const m = (this.match = { id: g.id, seed: g.seed, mode: g.mode || 1, nb: g.nb | 0, sp: +g.sp || 1, df: g.df ?? 1, t: +g.t || 0, ended: false, startReal: performance.now() });
    m.plane = makePlane(m.seed);
    m.zones = makeZones(m.seed, m.sp, W);
    m.care = makeCare(m.seed, m.zones, W).map((c) => ({ ...c, state: 'wait' }));
    for (const it of makeLoot(m.seed, W.lootPoints)) this.addItem(it);
    this.me = newMe();
    this.me.st = spectator ? 'spec' : 'plane';
    if (spectator) this.hud.banner('경기가 이미 진행 중입니다 — 관전 모드', 'info');
    if (this.isHost) this.bots.create(m.nb, m.seed);
    this.mode = 'match';
    this.plane.visible = true;
    this.prewarm();
    this.hud.showScreen('game');
    this.hud.onMatchStart();
    this.audio.ui('warn');
    this.zoneNotified = -1;
    this.sendNow();
  }
  endLocalMatch() {
    for (const id of [...this.actors.keys()]) this.removeActor(id);
    for (const [, m] of this.itemMeshes) this.scene.remove(m);
    for (const [, c] of this.crates) if (c.mesh) this.scene.remove(c.mesh);
    this.itemMeshes.clear(); this.items.clear(); this.crates.clear(); this.itemGrid.clear();
    this.bullets = []; this.grenades.forEach((g) => this.scene.remove(g.mesh)); this.grenades = [];
    this.fx.smokes.length = 0; this.fx.emitters.length = 0;
    this.bots.clear();
    this.match = null; this.plane.visible = false;
    this.audio.stopLoops();
    if (this.me.charObj) { this.scene.remove(this.me.charObj.group); }
    this.fx.setZone(0, 0, 0, false);
  }
  onMatchEnd(winTeam) {
    if (!this.match || this.match.ended) return;
    this.match.ended = true;
    const won = winTeam === this.myTeam;
    if (won) { this.audio.ui('win'); this.me.rank = 1; }
    this.hud.showResult({ won, rank: this.me.rank || 1, kills: this.me.kills, dmg: Math.round(this.me.dmg), time: this.me.surviveT || this.match.t, final: true });
  }
  aliveTeams() {
    const set = new Set();
    if (this.me.st !== 'dead' && this.me.st !== 'spec') set.add(this.myTeam);
    for (const a of this.actors.values()) if (a.alive) set.add(a.team);
    return set;
  }
  aliveCount() {
    let n = this.me.st !== 'dead' && this.me.st !== 'spec' ? 1 : 0;
    for (const a of this.actors.values()) if (a.alive) n++;
    return n;
  }
  hostCheckEnd() {
    const m = this.match; if (!m || m.ended || this.g.ph !== 'play') return;
    if (m.t < 8) return;
    const teams = this.aliveTeams();
    if (teams.size <= 1) {
      const win = teams.size ? [...teams][0] : null;
      this.g = { ...this.g, ph: 'end', win };
      this.onMatchEnd(win);
      this.sendNow();
    }
  }

  // ===================== items & crates =====================
  gkey(x, z) { return Math.floor(x / ITEM_GRID) + ',' + Math.floor(z / ITEM_GRID); }
  addItem(it) {
    if (!it || !it.type || this.items.has(it.id)) return;
    if (!WEAPONS[it.type] && !AMMO[it.type] && !ATTACH[it.type] && !ITEMS[it.type]) return;
    if (this.pickedIds && this.pickedIds.has(it.id)) return;
    this.items.set(it.id, it);
    const k = this.gkey(it.x, it.z); let s = this.itemGrid.get(k); if (!s) this.itemGrid.set(k, (s = new Set())); s.add(it.id);
  }
  removeItem(id) {
    const it = this.items.get(id); if (!it) return;
    this.items.delete(id);
    const s = this.itemGrid.get(this.gkey(it.x, it.z)); if (s) s.delete(id);
    const m = this.itemMeshes.get(id); if (m) { this.scene.remove(m); this.itemMeshes.delete(id); }
  }
  addCrate(c) {
    if (this.crates.has(c.id)) return;
    c.mesh = crateModel(c.kind === 'care' ? 'care' : 'death'); c.mesh.position.set(c.x, c.y, c.z);
    this.scene.add(c.mesh); this.crates.set(c.id, c);
  }
  removePicked(id, idx) {
    id = String(id);
    if (idx === -1 || idx === undefined || idx === null) { this.removeItem(id); (this.pickedIds = this.pickedIds || new Set()).add(id); return; }
    const c = this.crates.get(id); if (c && c.items[idx]) c.items[idx].taken = true;
  }
  nearbyItems(p, r = 2.6) {
    const out = [];
    const x0 = Math.floor((p.x - r) / ITEM_GRID), x1 = Math.floor((p.x + r) / ITEM_GRID), z0 = Math.floor((p.z - r) / ITEM_GRID), z1 = Math.floor((p.z + r) / ITEM_GRID);
    for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
      const s = this.itemGrid.get(gx + ',' + gz); if (!s) continue;
      for (const id of s) { const it = this.items.get(id); if (!it) continue; const d = Math.hypot(it.x - p.x, it.z - p.z); if (d < r && Math.abs(it.y - p.y) < 1.7) out.push({ it, d }); }
    }
    for (const c of this.crates.values()) {
      if (c.kind === 'care' && c.falling) continue;
      const d = Math.hypot(c.x - p.x, c.z - p.z);
      if (d < r + 0.4 && Math.abs(c.y - p.y) < 1.8) c.items.forEach((ci, idx) => { if (!ci.taken) out.push({ it: { id: c.id, type: ci.type, qty: ci.qty, x: c.x, y: c.y, z: c.z }, crate: c, idx, d }); });
    }
    out.sort((a, b) => a.d - b.d);
    return out;
  }
  updateItemMeshes(cam) {
    const R = 55; const keep = new Set();
    const x0 = Math.floor((cam.x - R) / ITEM_GRID), x1 = Math.floor((cam.x + R) / ITEM_GRID), z0 = Math.floor((cam.z - R) / ITEM_GRID), z1 = Math.floor((cam.z + R) / ITEM_GRID);
    for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
      const s = this.itemGrid.get(gx + ',' + gz); if (!s) continue;
      for (const id of s) {
        const it = this.items.get(id); if (!it) continue;
        if (Math.hypot(it.x - cam.x, it.z - cam.z) > R) continue;
        keep.add(id);
        if (!this.itemMeshes.has(id)) {
          const m = itemModel(it.type); m.position.set(it.x, it.y, it.z); m.rotation.y = (parseInt(id.replace(/\D/g, '').slice(-4) || '0', 10) % 628) / 100;
          const gl = new THREE.Sprite(glintMaterial()); gl.position.set(0, 0.28, 0); gl.scale.setScalar(0.32); m.add(gl);
          this.scene.add(m); this.itemMeshes.set(id, m);
        }
      }
    }
    for (const [id, m] of this.itemMeshes) if (!keep.has(id)) { this.scene.remove(m); this.itemMeshes.delete(id); }
  }
  newItemId() { return (this.myPeer || 'x').slice(0, 5) + '_' + (++this.evSeq).toString(36); }
  dropItem(type, qty, x, y, z) {
    const id = this.newItemId();
    const gy = this.world.groundAt(x, z, y + 0.4);
    this.addItem({ id, type, qty, x, y: gy + 0.02, z });
    if (this.me) (this.me.autoSkip || (this.me.autoSkip = new Set())).add(id); // never auto-grab what we just dropped
    this.emit('dr', id, type, qty, Math.round(x * 100) / 100, Math.round((gy + 0.02) * 100) / 100, Math.round(z * 100) / 100);
  }
  dropCrate(items, x, y, z, owner) {
    if (!items.length) return;
    const id = 'cr' + this.newItemId();
    const gy = this.world.groundAt(x, z, y + 0.5);
    this.addCrate({ id, x, y: gy, z, kind: 'death', items: items.map(([t, q]) => ({ type: t, qty: q, taken: false })), owner });
    this.emit('cr', id, Math.round(x * 100) / 100, Math.round(gy * 100) / 100, Math.round(z * 100) / 100, 'death', items.slice(0, 22), String(owner || '').slice(0, 16));
  }

  // ===================== care packages =====================
  updateCare(dt) {
    const m = this.match;
    for (const c of m.care) {
      if (m.t < c.t) continue;
      const y = Math.max(c.gy, c.startY - (m.t - c.t) * 8);
      if (c.state === 'wait') {
        c.state = 'fall';
        this.addCrate({ id: c.id, x: c.x, y, z: c.z, kind: 'care', items: c.items.map(([t, q]) => ({ type: t, qty: q, taken: false })) });
        const cr = this.crates.get(c.id); cr.falling = true; cr.chute = careChuteModel(); cr.mesh.add(cr.chute); cr.chute.position.y = 1.0; cr.chute.scale.setScalar(0.9);
        this.hud.banner('보급 상자가 투하되고 있습니다!', 'care');
      }
      const cr = this.crates.get(c.id); if (!cr) continue;
      if (c.state === 'fall') {
        cr.y = y; cr.mesh.position.y = y; cr.mesh.rotation.y += dt * 0.3;
        if (y <= c.gy + 0.01) { c.state = 'landed'; cr.falling = false; if (cr.chute) cr.mesh.remove(cr.chute); this.fx.emitter(c.x, c.gy + 1.2, c.z, 'red', 60); }
      }
    }
  }

  // ===================== grenades =====================
  spawnGrenade(type, x, y, z, vx, vy, vz, fuse, owner) {
    const mesh = itemModel(type); mesh.position.set(x, y, z); this.scene.add(mesh);
    this.grenades.push({ type, p: new THREE.Vector3(x, y, z), v: new THREE.Vector3(vx, vy, vz), fuse: clamp(fuse, 0.05, 6), mesh, owner, rest: false });
  }
  updateGrenades(dt) {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      g.fuse -= dt;
      if (!g.rest) {
        g.v.y -= 9.8 * dt;
        const sp = g.v.length(); const step = sp * dt;
        if (step > 1e-4) {
          const h = this.world.raycast(g.p.x, g.p.y, g.p.z, g.v.x / sp, g.v.y / sp, g.v.z / sp, step + 0.06, true, 1);
          if (h && h.kind === 'glass') { this.shatterGlass(h.pane, false); g.p.addScaledVector(g.v, dt); g.v.multiplyScalar(0.8); }
          else if (h) {
            g.p.addScaledVector(g.v, (h.t - 0.05) / sp);
            const n = _v.set(h.nx, h.ny, h.nz); const vn = g.v.dot(n);
            g.v.addScaledVector(n, -1.55 * vn).multiplyScalar(0.55);
            if (g.v.length() < 1.2 && h.ny > 0.6) { g.rest = true; g.v.set(0, 0, 0); }
          } else g.p.addScaledVector(g.v, dt);
        }
        g.mesh.position.copy(g.p); g.mesh.rotation.x += dt * 8;
      }
      if (g.fuse <= 0) {
        this.scene.remove(g.mesh); this.grenades.splice(i, 1);
        if (g.type === 'frag') this.explode(g.p.x, g.p.y, g.p.z, g.owner);
        else { this.fx.smokeGrenade(g.p.x, g.p.y, g.p.z); this.audio.impact(g.p, 'box'); }
      }
    }
  }
  explode(x, y, z, owner) {
    this.fx.explosion(x, y, z); this.audio.explosion({ x, y, z });
    const P = this.world.glassPanes; for (let i = 0; i < P.length; i++) { const a = P[i]; const cx = (a[0] + a[3]) / 2, cy = (a[1] + a[4]) / 2, cz = (a[2] + a[5]) / 2; if ((cx - x) ** 2 + (cy - y) ** 2 + (cz - z) ** 2 < 49) this.shatterGlass(i, false); }
    const R = 9, me = this.me;
    const dmgAt = (px, py, pz) => {
      const d = Math.hypot(px - x, py - y, pz - z); if (d > R) return 0;
      if (!this.world.los(x, y + 0.3, z, px, py, pz)) return 0;
      return 120 * Math.pow(1 - d / R, 1.25) + 8;
    };
    if (me.st === 'ground' || me.st === 'down' || me.st === 'swim') {
      const d = dmgAt(me.pos.x, me.pos.y + 1.0, me.pos.z);
      if (d > 0) this.takeDamage(d, 2, 'frag', owner === this.myPeer ? 'self' : owner);
      const dd = Math.hypot(me.pos.x - x, me.pos.z - z); if (dd < 30) this.shake = Math.max(this.shake || 0, 1 - dd / 30);
    }
    if (this.isHost) this.bots.explosion(x, y, z, owner, dmgAt);
  }

  // ===================== glass =====================
  shatterGlass(id, broadcast) {
    if (!this.world.breakGlass(id)) return;
    const c = this.world.glassCenter(id);
    this.fx.glass(c.x, c.y, c.z); this.audio.glass(c);
    if (broadcast) this.emit('gb', id);
  }

  // ===================== bullets =====================
  fireBullet(o, dir, def, wid, owner) {
    this.bullets.push({ p: o.clone(), v: dir.clone().multiplyScalar(def.vel), d: 0, def, wid, owner, life: 2.2 });
  }
  updateBullets(dt) {
    const W = this.world;
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i]; b.life -= dt;
      const steps = 2; let done = false;
      for (let s = 0; s < steps && !done; s++) {
        const h = dt / steps;
        b.v.y -= 9.8 * h;
        const sp = b.v.length(); const len = sp * h;
        const dx = b.v.x / sp, dy = b.v.y / sp, dz = b.v.z / sp;
        const ex = b.p.x + dx * len, ey = b.p.y + dy * len, ez = b.p.z + dz * len;
        // actors
        let best = null;
        for (const a of this.actors.values()) {
          if (!a.alive) continue;
          if (a.team === this.myTeam && this.match.mode > 1) continue;
          if (Math.abs(a.pos.x - b.p.x) > len + 3 && Math.abs(a.pos.x - ex) > 3) continue;
          if (Math.abs(a.pos.z - b.p.z) > len + 3 && Math.abs(a.pos.z - ez) > 3) continue;
          const r = a.hitTest(b.p.x, b.p.y, b.p.z, ex, ey, ez);
          if (r && (!best || r.t < best.t)) best = { ...r, a };
        }
        const wh = W.raycast(b.p.x, b.p.y, b.p.z, dx, dy, dz, len, true, 1);
        const wt = wh ? wh.t / len : 2;
        if (wh && wh.kind === 'glass' && !(best && best.t < wt)) {
          // bullet shatters the pane and keeps flying
          this.shatterGlass(wh.pane, true);
          b.p.set(b.p.x + dx * (wh.t + 0.08), b.p.y + dy * (wh.t + 0.08), b.p.z + dz * (wh.t + 0.08)); b.d += wh.t;
          continue;
        }
        if (best && best.t < wt) {
          const hx = b.p.x + dx * len * best.t, hy = b.p.y + dy * len * best.t, hz = b.p.z + dz * len * best.t;
          this.onBulletHit(b, best.a, best.part, hx, hy, hz);
          done = true;
        } else if (wh) {
          const hx = b.p.x + dx * wh.t, hy = b.p.y + dy * wh.t, hz = b.p.z + dz * wh.t;
          this.fx.impact(hx, hy, hz, wh.nx, wh.ny, wh.nz, wh.kind); this.audio.impact({ x: hx, y: hy, z: hz }, wh.kind);
          done = true;
        } else { b.p.set(ex, ey, ez); b.d += len; }
      }
      if (done || b.life <= 0 || b.d > 1100) this.bullets.splice(i, 1);
    }
  }
  onBulletHit(b, a, part, x, y, z) {
    const def = b.def; const dist = b.d;
    let f = 1;
    if (dist > def.range) f = def.cat === 'SG' ? Math.max(0.12, 1 - (dist - def.range) / 22) : Math.max(0.5, 1 - (dist - def.range) / (def.range * 3));
    let dmg = def.dmg * f * (part === 'head' ? def.head : part === 'leg' ? 0.9 : 1);
    const flags = (part === 'head' ? 1 : 0) | (part === 'leg' ? 8 : 0);
    this.fx.impact(x, y, z, 0, 1, 0, 'flesh'); a.char.flash();
    // predicted damage for marker
    const helm = a.gear[0], vest = a.gear[1];
    const red = part === 'head' ? [0, 0.3, 0.4, 0.55][helm] : part === 'body' ? [0, 0.3, 0.4, 0.55][vest] : 0;
    this.me.dmg += dmg * (1 - red);
    const predictedDead = a.st === 'down' ? false : a.hp - dmg * (1 - red) <= 0;
    this.hud.hitMarker(part === 'head' ? 'head' : 'body', predictedDead);
    this.audio.ui(part === 'head' ? 'head' : 'hit');
    if (a.isBot && this.isHost) this.bots.damage(a.id, dmg, flags, b.wid, this.myPeer);
    else this.emit('h', a.id, Math.round(dmg * 10) / 10, flags, b.wid, this.myPeer);
  }
  // remote / bot shot visuals
  spawnShotVisual(a) {
    const def = WEAPONS[a.w]; if (!def) return;
    const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw); const rx = -fz, rz = fx;
    const base = a.crouch ? 1.15 : 1.45;
    const o = _v.set(a.pos.x + fx * 0.75 + rx * 0.12, a.pos.y + base, a.pos.z + fz * 0.75 + rz * 0.12);
    const cp = Math.cos(a.pitch);
    const n = def.pellets || 1;
    for (let k = 0; k < n; k++) {
      const sp = (def.pellets ? 3.5 : 0.6) * Math.PI / 180;
      const yaw = a.yaw + (Math.random() - 0.5) * sp * 2, pitch = a.pitch + (Math.random() - 0.5) * sp * 2;
      const dx = Math.sin(yaw) * Math.cos(pitch), dy = Math.sin(pitch), dz = Math.cos(yaw) * Math.cos(pitch);
      const hit = this.world.raycast(o.x, o.y, o.z, dx, dy, dz, 700, true);
      const maxD = hit ? hit.t : 700;
      if (k < 3) this.fx.tracer(o.x, o.y, o.z, dx, dy, dz, def.vel, maxD);
      if (hit && k === 0 && hit.t < 200) { const hx = o.x + dx * hit.t, hy = o.y + dy * hit.t, hz = o.z + dz * hit.t; setTimeout(() => this.fx.impact(hx, hy, hz, hit.nx, hit.ny, hit.nz, hit.kind), (hit.t / def.vel) * 1000); }
      // near-miss whiz
      if (k === 0 && this.me.st !== 'dead' && this.me.st !== 'spec') {
        const m = this.me.pos; const px = m.x - o.x, py = m.y + 1.5 - o.y, pz = m.z - o.z;
        const t = px * dx + py * dy + pz * dz;
        if (t > 5 && t < maxD) { const cx = px - dx * t, cy = py - dy * t, cz = pz - dz * t; if (cx * cx + cy * cy + cz * cz < 9) { const wp = { x: o.x + dx * t, y: o.y + dy * t, z: o.z + dz * t }; setTimeout(() => this.audio.whiz(wp), (t / def.vel) * 1000); } }
      }
    }
    _v2.set(Math.sin(a.yaw) * cp, Math.sin(a.pitch), Math.cos(a.yaw) * cp);
    const dist = Math.hypot(a.pos.x - this.camera.position.x, a.pos.z - this.camera.position.z);
    if (!a.quiet) this.fx.muzzle(o, _v2, 1, dist < 60);
    this.audio.gun(def.cat, o, { quiet: a.quiet });
  }

  // ===================== zone =====================
  updateZone(dt) {
    const m = this.match; const z = (m.zoneNow = zoneAt(m.zones, m.t));
    this.fx.setZone(z.bc[0], z.bc[1], z.br, !z.pre);
    if (z.phase !== this.zoneNotified) {
      if (this.zoneNotified !== -1 || z.phase > 0) {
        if (z.phase === 1) this.hud.banner('자기장 위치가 공개되었습니다. 안전구역으로 이동하세요', 'zone');
        else if (z.phase > 1 && !z.final) this.hud.banner(`${z.phase - 1}단계 자기장 종료 · 다음 안전구역 공개`, 'zone');
      }
      this.zoneNotified = z.phase;
    }
    if (z.shrinking !== this.zoneShrinkNotified) { if (z.shrinking) { this.hud.banner('자기장이 줄어들고 있습니다!', 'warn'); this.audio.ui('warn'); } this.zoneShrinkNotified = z.shrinking; }
    return z;
  }
  outsideZone(x, z) { const Z = this.match.zoneNow; if (!Z) return false; return Math.hypot(x - Z.bc[0], z - Z.bc[1]) > Z.br; }

  // ===================== frame =====================
  update(dt) {
    const now = performance.now();
    if (this.mode === 'lobby') { this.sendT += dt; if (this.sendT > LOBBY_SEND_DT) this.sendNow(); return; }
    if (this.mode !== 'match' || !this.match) return;
    const m = this.match;
    if (this.isHost || !this.g || this.g.ph === 'play') m.t += dt;
    const P = planePos(m.plane, m.t);
    this.plane.position.set(P[0], P[1], P[2]); this.plane.rotation.y = Math.atan2(m.plane.dx, m.plane.dz);
    this.plane.visible = m.t < m.plane.dur + 8;
    this.plane.children.forEach((c) => { if (c.name === 'prop') c.rotation.z += dt * 40; });
    this.updateZone(dt);
    this.updateCare(dt);
    this.updatePlayer(dt);
    if (this.isHost) { this.bots.update(dt); this.hostCheckEnd(); }
    this.updateBullets(dt);
    this.updateGrenades(dt);
    // actors
    for (const a of this.actors.values()) {
      if (!(a.isBot && this.isHost)) a.interp(now, INTERP);
      if (a.pendingShots > 0) { a.shotT -= dt; if (a.shotT <= 0) { a.pendingShots--; a.shotT = WEAPONS[a.w] ? Math.min(0.12, 60 / WEAPONS[a.w].rpm) : 0.1; this.spawnShotVisual(a); } }
      const ch = a.char;
      a.char.group.position.copy(a.pos); a.char.group.rotation.y = a.yaw;
      const d2 = a.pos.distanceToSquared(this.camera.position);
      a.char.group.visible = a.st !== 'plane' && d2 < 700 * 700;
      if (a.char.group.visible) {
        const vxw = (a.pos.x - a.prevPos.x) / Math.max(dt, 1e-3), vzw = (a.pos.z - a.prevPos.z) / Math.max(dt, 1e-3);
        a.prevPos.copy(a.pos);
        a.vs = a.vs || [0, 0]; a.vs[0] += (vxw - a.vs[0]) * Math.min(1, dt * 10); a.vs[1] += (vzw - a.vs[1]) * Math.min(1, dt * 10);
        const hs = Math.min(9, Math.hypot(a.vs[0], a.vs[1]));
        const spd = a.isBot && this.isHost ? a.speed : hs;
        const c = Math.cos(a.yaw), sn = Math.sin(a.yaw);
        const lvx = a.isBot && this.isHost && a.brain ? a.brain.vel.x * c - a.brain.vel.z * sn : a.vs[0] * c - a.vs[1] * sn;
        const lvz = a.isBot && this.isHost && a.brain ? a.brain.vel.x * sn + a.brain.vel.z * c : a.vs[0] * sn + a.vs[1] * c;
        if (a.reloadT > 0) a.reloadT += dt;
        const rel = a.reloadT > 0 && WEAPONS[a.w] ? Math.min(1, a.reloadT / WEAPONS[a.w].reload) : -1;
        ch.setGear(a.gear[0], a.gear[1], a.gear[2]); ch.setGun(a.w, a.att); ch.setBack(a.wb);
        if (d2 < 260 * 260 || a.st !== ch.lastSt) ch.animate(dt, { st: a.st, speed: spd, vx: lvx, vz: lvz, crouch: a.crouch, prone: a.prone, sprint: a.sprint, pitch: a.pitch, armed: !!a.w, ads: !!(a.flags & 4), reload: rel });
        ch.lastSt = a.st;
        // footsteps
        if (a.st === 'ground' && spd > 1.5 && d2 < 45 * 45) { a.stepT -= dt * spd; if (a.stepT <= 0) { a.stepT = 2.1; this.audio.step(a.pos, a.sprint ? 0.9 : a.crouch ? 0.2 : 0.55); } }
      }
    }
    const gm = glintMaterial(); gm.opacity = 0.35 + 0.3 * Math.sin(performance.now() / 300);
    this.itemScanT -= dt;
    if (this.itemScanT <= 0) { this.itemScanT = 0.3; this.updateItemMeshes(this.camera.position); }
    // net
    this.sendT += dt;
    if (this.sendT >= SEND_DT) this.sendNow();
  }
}
Object.assign(Game.prototype, PlayerMixin);
