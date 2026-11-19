// ===== LAST CIRCLE · local player: movement, combat, inventory, camera =====
import * as THREE from 'three';
import { WEAPONS, AMMO, ATTACH, ITEMS, BASE_CAP, itemWeight, itemInfo, PRIMARY_CATS } from './data.js';
import { Character, weaponModel } from './models.js';
import { planePos } from './match.js';
import { clamp, lerp, damp, dampAngle, angDiff } from './util.js';
import { PLAYER_COLORS } from './data.js';

const G = 20;
const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _d = new THREE.Vector3(), _o = new THREE.Vector3(), _t = new THREE.Vector3(), _q = new THREE.Vector3();

export function newMe() {
  return {
    pos: new THREE.Vector3(0, 430, 0), vel: new THREE.Vector3(), yaw: 0, pitch: 0, kick: 0, kickYaw: 0,
    st: 'plane', hp: 100, boost: 0, kh: 0, knocks: 0, crouch: false, onGround: false, sprinting: false, ads: false, adsK: 0, hspeed: 0,
    slots: [null, null, null], held: -1, throwSel: 'frag', inv: {}, helm: null, vest: null, bag: null,
    action: null, cool: 0, burst: 0, shotSeq: 0, boltT: 0, switchT: 0, fallT: 0, kills: 0, dmg: 0, rank: 0,
    lastAttacker: null, cook: -1, marker: null, lean: 0, stepT: 0, punchT: 0, lastHitT: 0, deathT: 0, fpp: false,
  };
}

export const PlayerMixin = {
  // ---------- weapon helpers ----------
  heldWeapon() { const me = this.me; return me.held >= 0 && me.held <= 2 ? me.slots[me.held] : null; },
  wstats(w) {
    const d = WEAPONS[w.id]; const a = w.att;
    let rv = d.rv, rh = d.rh;
    for (const k of ['m', 'g']) if (a[k] && ATTACH[a[k]]) { rv *= ATTACH[a[k]].rv || 1; rh *= ATTACH[a[k]].rh || 1; }
    const mag = a.x && ATTACH[a.x].ext ? d.ext : d.mag;
    const reload = d.reload * (a.x && ATTACH[a.x].quick ? 0.72 : 1);
    const sight = a.s ? ATTACH[a.s] : null;
    return { d, rv, rh, mag, reload, zoom: sight ? sight.zoom : (d.cat === 'PST' ? 1.1 : 1.2), reticle: sight ? sight.reticle : 'iron', scope: sight ? !!sight.scope : false, quiet: a.m === 'm_supp', noflash: a.m === 'm_flash' || a.m === 'm_supp', adsTime: a.g === 'g_ang' ? 0.14 : 0.22 };
  },
  capacity() { return this.me.bag ? ITEMS[this.me.bag].cap : BASE_CAP; },
  load() { let s = 0; for (const k in this.me.inv) s += itemWeight(k, this.me.inv[k]); return s; },
  invAdd(type, qty) {
    const free = this.capacity() - this.load(); const w1 = itemWeight(type, 1);
    const n = w1 > 0 ? Math.min(qty, Math.floor((free + 1e-6) / w1)) : qty;
    if (n > 0) this.me.inv[type] = (this.me.inv[type] || 0) + n;
    return n;
  },
  invTake(type, qty) { const have = this.me.inv[type] || 0; const n = Math.min(have, qty); if (n > 0) { this.me.inv[type] = have - n; if (!this.me.inv[type]) delete this.me.inv[type]; } return n; },

  // ---------- pick up ----------
  pickup(entry) {
    const me = this.me; const it = entry.it; const type = it.type; const info = itemInfo(type);
    let taken = 0, ok = false;
    const finish = () => {
      if (entry.crate) { this.emit('pk', entry.crate.id, entry.idx); entry.crate.items[entry.idx].taken = true; }
      else { this.emit('pk', it.id, -1); this.removeItem(it.id); }
      this.audio.ui('pick');
    };
    if (info.kind === 'weapon') {
      const d = WEAPONS[type];
      const nw = { id: type, mag: 0, att: { s: null, m: null, g: null, x: null }, mode: 0 };
      let slot;
      if (d.cat === 'PST') slot = 2;
      else if (!me.slots[0]) slot = 0; else if (!me.slots[1]) slot = 1; else slot = me.held === 1 ? 1 : 0;
      if (me.slots[slot]) this.dropWeapon(slot, true);
      me.slots[slot] = nw;
      this.autoAttach(nw);
      if (me.held === -1 || me.held === slot || me.held === 3) this.equip(slot);
      finish(); this.hud.toast(`${d.name} 획득`); ok = true;
    } else if (info.kind === 'ammo' || info.kind === 'heal' || info.kind === 'boost' || info.kind === 'throw') {
      taken = this.invAdd(type, it.qty);
      if (taken <= 0) { this.hud.toast('가방 공간이 부족합니다', 'warn'); return false; }
      if (taken < it.qty) {
        if (entry.crate) entry.crate.items[entry.idx].qty -= taken; // local only; others still see full qty
        else { finish(); this.dropItem(type, it.qty - taken, it.x, it.y, it.z); return true; }
        this.audio.ui('pick'); this.hud.toast(`${info.name} ×${taken}`); return true;
      }
      finish(); this.hud.toast(`${info.name}${it.qty > 1 ? ' ×' + it.qty : ''}`); ok = true;
    } else if (info.kind === 'attach') {
      if (!this.attachToBest(type)) { if (this.invAdd(type, 1) <= 0) { this.hud.toast('가방 공간이 부족합니다', 'warn'); return false; } }
      finish(); this.hud.toast(info.name); ok = true;
    } else if (info.kind === 'helm' || info.kind === 'vest') {
      const cur = me[info.kind];
      if (cur) this.dropItem(cur.type, 1, me.pos.x + 0.3, me.pos.y, me.pos.z + 0.3);
      me[info.kind] = { type, dur: ITEMS[type].dur };
      finish(); this.hud.toast(`${info.name} 착용`); ok = true;
    } else if (info.kind === 'bag') {
      const cur = me.bag;
      if (cur) this.dropItem(cur, 1, me.pos.x + 0.3, me.pos.y, me.pos.z - 0.3);
      me.bag = type; finish(); this.hud.toast(`${info.name} 착용`); ok = true;
    }
    this.hud.refreshInventory();
    return ok;
  },
  autoAttach(w) {
    const d = WEAPONS[w.id];
    for (const slot of d.slots) {
      if (w.att[slot]) continue;
      // best compatible from inventory (prefer scopes by zoom for SR/DMR, low zoom for others)
      const cands = Object.keys(this.me.inv).filter((k) => ATTACH[k] && ATTACH[k].slot === slot);
      if (!cands.length) continue;
      cands.sort((a, b) => this.attachScore(d, b) - this.attachScore(d, a));
      w.att[slot] = cands[0]; this.invTake(cands[0], 1);
    }
  },
  attachScore(d, a) {
    const A = ATTACH[a]; if (A.slot === 's') { const want = d.cat === 'SR' ? 8 : d.cat === 'DMR' ? 4 : d.cat === 'SMG' || d.cat === 'SG' || d.cat === 'PST' ? 1.25 : 2; return 10 - Math.abs(Math.log2(A.zoom / want)) * 3; }
    if (A.slot === 'x') return (A.ext ? 2 : 0) + (A.quick ? 1 : 0);
    if (A.slot === 'm') return a === 'm_comp' ? 3 : a === 'm_supp' ? 2.5 : 1;
    return 1;
  },
  attachToBest(type) {
    const me = this.me; const A = ATTACH[type];
    const order = [me.held, 0, 1, 2].filter((i, k, arr) => i >= 0 && i <= 2 && arr.indexOf(i) === k);
    for (const i of order) {
      const w = me.slots[i]; if (!w) continue; const d = WEAPONS[w.id];
      if (!d.slots.includes(A.slot)) continue;
      if (!w.att[A.slot]) { w.att[A.slot] = type; return true; }
    }
    return false;
  },
  pickupToSlot(entry, slot) {
    const me = this.me; const type = entry.it.type; const d = WEAPONS[type]; if (!d) return false;
    if ((slot === 2) !== (d.cat === 'PST')) return false;
    const finish = () => { if (entry.crate) { this.emit('pk', entry.crate.id, entry.idx); entry.crate.items[entry.idx].taken = true; } else { this.emit('pk', entry.it.id, -1); this.removeItem(entry.it.id); } this.audio.ui('pick'); };
    if (me.slots[slot]) this.dropWeapon(slot, true);
    const nw = { id: type, mag: 0, att: { s: null, m: null, g: null, x: null }, mode: 0 };
    me.slots[slot] = nw; this.autoAttach(nw); finish();
    if (me.held === -1 || me.held === slot) { me.held = -2; this.equip(slot); }
    this.hud.toast(`${d.name} → ${slot === 2 ? '권총' : '주무기 ' + (slot + 1)}`);
    return true;
  },
  swapSlots(a, b) {
    const me = this.me; if (a > 1 || b > 1 || a === b) return;
    [me.slots[a], me.slots[b]] = [me.slots[b], me.slots[a]];
    if (me.held === a) me.held = b; else if (me.held === b) me.held = a;
    this.audio.ui('click');
  },
  attachTo(src, slot) { // src: {from:'bag'|'near'|'att', type, n?, slot?, aslot?}
    const me = this.me; const w = me.slots[slot]; if (!w) return false; const A = ATTACH[src.type]; if (!A || !WEAPONS[w.id].slots.includes(A.slot)) return false;
    if (src.from === 'bag') return this.attachFromInv(src.type, slot);
    if (src.from === 'att') { const from = me.slots[src.slot]; if (!from || from.att[src.aslot] !== src.type) return false; from.att[src.aslot] = null; if (w.att[A.slot]) { const old = w.att[A.slot]; if (WEAPONS[from.id].slots.includes(A.slot)) from.att[A.slot] = old; else if (this.invAdd(old, 1) <= 0) this.dropItem(old, 1, me.pos.x, me.pos.y, me.pos.z); } w.att[A.slot] = src.type; this.audio.ui('click'); return true; }
    if (src.from === 'near') { // straight from the ground onto the gun
      if (w.att[A.slot]) this.detach(slot, A.slot);
      const n = src.n; if (n.crate) { this.emit('pk', n.crate.id, n.idx); n.crate.items[n.idx].taken = true; } else { this.emit('pk', n.it.id, -1); this.removeItem(n.it.id); }
      w.att[A.slot] = src.type; this.audio.ui('pick'); this.hud.toast(`${A.name} 장착`); return true;
    }
    return false;
  },
  detach(slotIdx, aslot) {
    const w = this.me.slots[slotIdx]; if (!w || !w.att[aslot]) return;
    const t = w.att[aslot];
    if (this.invAdd(t, 1) <= 0) this.dropItem(t, 1, this.me.pos.x, this.me.pos.y, this.me.pos.z);
    w.att[aslot] = null;
    if (aslot === 'x') { const s = this.wstats(w); if (w.mag > s.mag) { this.invAdd(WEAPONS[w.id].ammo, w.mag - s.mag); w.mag = s.mag; } }
    this.hud.refreshInventory();
  },
  attachFromInv(type, slotIdx) {
    const w = this.me.slots[slotIdx]; if (!w) return false; const A = ATTACH[type];
    if (!WEAPONS[w.id].slots.includes(A.slot)) return false;
    if (w.att[A.slot]) this.detach(slotIdx, A.slot);
    if (this.invTake(type, 1) <= 0) return false;
    w.att[A.slot] = type; this.hud.refreshInventory(); return true;
  },
  dropWeapon(slot, silent) {
    const me = this.me; const w = me.slots[slot]; if (!w) return;
    if (w.mag > 0) { const n = this.invAdd(WEAPONS[w.id].ammo, w.mag); if (n < w.mag) this.dropItem(WEAPONS[w.id].ammo, w.mag - n, me.pos.x, me.pos.y, me.pos.z + 0.4); }
    for (const k in w.att) if (w.att[k]) { if (this.invAdd(w.att[k], 1) <= 0) this.dropItem(w.att[k], 1, me.pos.x + 0.3, me.pos.y, me.pos.z); }
    const fx = Math.sin(me.yaw), fz = Math.cos(me.yaw);
    this.dropItem(w.id, 1, me.pos.x + fx * 0.8, me.pos.y, me.pos.z + fz * 0.8);
    me.slots[slot] = null;
    if (me.held === slot) { me.held = -1; me.action = null; }
    if (!silent) { this.hud.refreshInventory(); this.audio.ui('click'); }
  },
  dropInv(type, qty) {
    const me = this.me; const n = this.invTake(type, qty ?? (me.inv[type] || 0));
    if (n > 0) { const a = Math.random() * 6.28; this.dropItem(type, n, me.pos.x + Math.cos(a) * 0.6, me.pos.y, me.pos.z + Math.sin(a) * 0.6); }
    this.hud.refreshInventory();
  },
  dropGear(kind) {
    const me = this.me; if (kind === 'bag') { if (!me.bag) return; const t = me.bag; me.bag = null; if (this.load() > this.capacity()) { me.bag = t; this.hud.toast('가방을 비운 뒤 내려놓으세요', 'warn'); return; } this.dropItem(t, 1, me.pos.x, me.pos.y, me.pos.z + 0.5); }
    else { if (!me[kind]) return; this.dropItem(me[kind].type, 1, me.pos.x, me.pos.y, me.pos.z + 0.5); me[kind] = null; }
    this.hud.refreshInventory();
  },
  equip(slot) {
    const me = this.me;
    if (slot === me.held) return;
    if (slot >= 0 && slot <= 2 && !me.slots[slot]) return;
    if (slot === 3 && !(me.inv.frag || me.inv.smoke)) { this.hud.toast('투척 무기가 없습니다', 'warn'); return; }
    if (slot === 3 && !me.inv[me.throwSel]) me.throwSel = me.inv.frag ? 'frag' : 'smoke';
    if (me.action && me.action.kind === 'reload') me.action = null;
    me.held = slot; me.switchT = slot === -1 ? 0 : 0.45; me.ads = false; me.cook = -1;
    this.audio.ui('click');
  },

  // ---------- consumables ----------
  useItem(type) {
    const me = this.me; const it = ITEMS[type];
    if (!it || !(me.inv[type] > 0)) return;
    if (me.st !== 'ground' && me.st !== 'swim') return;
    if (it.kind === 'heal' && me.hp >= it.cap) { this.hud.toast(it.cap < 100 ? `체력 ${it.cap} 이상에서는 사용할 수 없습니다` : '체력이 가득 찼습니다', 'warn'); return; }
    if (it.kind === 'throw') { me.throwSel = type; this.equip(3); return; }
    me.action = { kind: 'use', type, t: 0, dur: it.time, label: it.name + ' 사용 중' };
    me.ads = false;
  },
  smartHeal() {
    const me = this.me; const inv = me.inv;
    if (me.hp < 75 && inv.firstaid) return this.useItem('firstaid');
    if (me.hp < 60 && inv.medkit) return this.useItem('medkit');
    if (me.hp < 75 && inv.bandage) return this.useItem('bandage');
    if (me.boost < 60 && inv.painkiller) return this.useItem('painkiller');
    if (me.boost < 80 && inv.energy) return this.useItem('energy');
    if (me.hp < 100 && inv.medkit) return this.useItem('medkit');
    this.hud.toast('사용할 회복 아이템이 없습니다', 'warn');
  },
  startReload() {
    const me = this.me; const w = this.heldWeapon(); if (!w) return;
    const s = this.wstats(w); const d = s.d;
    if (w.mag >= s.mag || !(me.inv[d.ammo] > 0)) { if (!(me.inv[d.ammo] > 0)) this.hud.toast(`${AMMO[d.ammo].name} 탄약이 없습니다`, 'warn'); return; }
    if (me.action) return;
    me.action = { kind: 'reload', t: 0, dur: s.reload, label: '재장전' }; me.ads = false;
    this.audio.ui('reload');
  },
  finishAction() {
    const me = this.me; const a = me.action; me.action = null;
    if (a.kind === 'reload') {
      const w = this.heldWeapon(); if (!w) return; const s = this.wstats(w);
      const n = this.invTake(s.d.ammo, s.mag - w.mag); w.mag += n; this.audio.ui('reload2');
    } else if (a.kind === 'use') {
      const it = ITEMS[a.type]; if (this.invTake(a.type, 1) <= 0) return;
      if (it.kind === 'heal') me.hp = Math.max(me.hp, Math.min(it.cap, me.hp + it.heal));
      else if (it.kind === 'boost') me.boost = Math.min(100, me.boost + it.boost);
      this.audio.ui('heal');
    } else if (a.kind === 'revive') {
      this.emit('rv', a.target); this.hud.toast('팀원을 일으켰습니다');
    }
    this.hud.refreshInventory();
  },

  // ---------- damage ----------
  takeDamage(raw, flags, wpn, from) {
    const me = this.me;
    if (me.st === 'dead' || me.st === 'spec' || me.st === 'plane') return;
    if (this.match && this.match.ended) return;
    const head = flags & 1, expl = flags & 2, leg = flags & 8;
    let dmg = raw;
    if (from && from !== 'zone' && from !== 'fall') me.lastAttacker = from;
    if (me.st === 'down') {
      me.kh -= dmg * (head ? 1.2 : 1);
      if (me.kh <= 0) this.die(from, wpn, head);
      return;
    }
    if (head && me.helm && !expl) { const H = ITEMS[me.helm.type]; dmg *= 1 - H.red; me.helm.dur -= raw; if (me.helm.dur <= 0) { me.helm = null; this.hud.toast('헬멧이 파괴되었습니다', 'warn'); } }
    else if (!head && !leg && me.vest) { const V = ITEMS[me.vest.type]; dmg *= 1 - V.red * (expl ? 0.6 : 1); me.vest.dur -= raw * (expl ? 0.5 : 1); if (me.vest.dur <= 0) { me.vest = null; this.hud.toast('방탄복이 파괴되었습니다', 'warn'); } }
    me.hp -= dmg; me.lastHitT = performance.now();
    if (me.action && me.action.kind === 'use') me.action = null;
    this.audio.ui('hurt');
    // direction indicator
    const src = this.actors.get(from);
    if (src) { const ang = Math.atan2(src.pos.x - me.pos.x, src.pos.z - me.pos.z); this.hud.damageDir(angDiff(this.camYaw ?? me.yaw, ang)); }
    this.hud.flashDamage(Math.min(1, dmg / 40));
    if (me.hp <= 0) {
      me.hp = 0;
      if (this.match.mode > 1 && this.teammatesUp().length > 0 && from !== 'zone') this.knock(from, wpn, head);
      else this.die(from, wpn, head);
    }
  },
  teammates() { const out = []; if (!this.match || this.match.mode < 2) return out; for (const a of this.actors.values()) if (!a.isBot && a.team === this.myTeam) out.push(a); return out; },
  teammatesUp() { return this.teammates().filter((a) => a.st !== 'dead' && a.st !== 'spec' && a.st !== 'down'); },
  knock(from, wpn, head) {
    const me = this.me; me.st = 'down'; me.knocks++; me.kh = 100; me.hp = 0; me.action = null; me.ads = false; me.crouch = false;
    this.emit('k', this.myPeer, from, wpn, 1, head ? 1 : 0); this.onKill(this.myPeer, from, wpn, 1, head);
    this.hud.banner('기절했습니다! 팀원에게 부활을 요청하세요', 'warn');
  },
  gotRevived(by) { const me = this.me; if (me.st !== 'down') return; me.st = 'ground'; me.hp = 15; me.kh = 0; this.hud.banner(`${this.nameOf(by)} 님이 당신을 일으켰습니다`, 'info'); },
  die(from, wpn, head) {
    const me = this.me; if (me.st === 'dead' || me.st === 'spec') return;
    const killer = from || me.lastAttacker || 'zone';
    me.st = 'dead'; me.deathT = performance.now(); me.hp = 0; me.ads = false; me.action = null;
    me.rank = this.aliveTeams().size + (this.aliveTeams().has(this.myTeam) ? 0 : 1);
    if (me.rank < 1) me.rank = 1;
    me.surviveT = this.match.t;
    this.emit('k', this.myPeer, killer, wpn || '', 0, head ? 1 : 0); this.onKill(this.myPeer, killer, wpn || '', 0, head);
    // drop everything as a crate
    const items = [];
    for (const w of me.slots) if (w) { items.push([w.id, 1]); for (const k in w.att) if (w.att[k]) items.push([w.att[k], 1]); if (w.mag) items.push([WEAPONS[w.id].ammo, w.mag]); }
    for (const k in me.inv) items.push([k, me.inv[k]]);
    if (me.helm) items.push([me.helm.type, 1]); if (me.vest) items.push([me.vest.type, 1]); if (me.bag) items.push([me.bag, 1]);
    this.dropCrate(items, me.pos.x, me.pos.y, me.pos.z, this.settings.name);
    me.slots = [null, null, null]; me.inv = {}; me.helm = me.vest = null; me.bag = null; me.held = -1;
    this.audio.ui('lose');
    const teamAlive = this.teammates().some((a) => a.alive);
    if (!this.match.ended) this.hud.showResult({ won: false, rank: me.rank, kills: me.kills, dmg: Math.round(me.dmg), time: me.surviveT, killer: this.nameOf(killer), canSpectate: true, teamAlive });
    this.spec.id = null;
    this.sendNow();
  },

  // ---------- main update ----------
  updatePlayer(dt) {
    const me = this.me, inp = this.input, W = this.world, m = this.match;
    const S = this.settings;
    const locked = this.hud.captured();
    // look
    if (locked) {
      const sens = 0.0021 * S.sens * (me.ads ? 1 / Math.max(1, this.curZoom || 1) * (S.adsSens || 1) : 1);
      me.yaw -= inp.dx * sens; me.pitch -= inp.dy * sens * (S.invertY ? -1 : 1);
      me.pitch = clamp(me.pitch, -1.45, 1.45);
    }
    inp.dx = inp.dy = 0;
    const key = (c) => locked && inp.down.has(c);
    const press = (c) => locked && inp.pressed.has(c);
    let fwd = (key('KeyW') ? 1 : 0) - (key('KeyS') ? 1 : 0), side = (key('KeyD') ? 1 : 0) - (key('KeyA') ? 1 : 0);
    if (inp.joy && inp.joy.active && locked) { side = inp.joy.x; fwd = inp.joy.y; }
    _f.set(Math.sin(me.yaw), 0, Math.cos(me.yaw)); _r.set(-Math.cos(me.yaw), 0, Math.sin(me.yaw));
    _d.set(0, 0, 0).addScaledVector(_f, fwd).addScaledVector(_r, side); if (_d.lengthSq() > 1) _d.normalize();

    if (press('KeyM')) this.hud.toggleMap();
    if (press('Tab')) this.hud.toggleInventory();
    if (press('KeyV')) { me.fpp = !me.fpp; this.hud.toast(me.fpp ? '1인칭 시점' : '3인칭 시점'); }

    // ===== plane =====
    if (me.st === 'plane') {
      const P = planePos(m.plane, m.t); me.pos.set(P[0], P[1] - 4, P[2]);
      if ((press('KeyF') && m.t > 2) || m.t >= m.plane.dur - 0.5) this.jumpOut();
      this.audio.loop('plane', 0.32, 380); this.audio.loop('wind', 0);
      return this.updateCamera(dt);
    }
    this.audio.loop('plane', m.t < m.plane.dur + 6 ? Math.max(0, 0.25 - this.camera.position.distanceTo(this.plane.position) / 2500) : 0, 300);
    if (me.st === 'dead' || me.st === 'spec') { this.audio.loop('wind', 0); this.audio.loop('zone', 0); this.updateSpectate(dt); return; }

    // ===== zone damage / boost regen =====
    const Z = m.zoneNow;
    const outside = this.outsideZone(me.pos.x, me.pos.z);
    me.outside = outside;
    if (outside && me.st !== 'fall' && me.st !== 'chute') {
      if (me.st === 'down') me.kh -= Z.dps * dt * 2; else { me.hp -= Z.dps * dt; if (me.hp <= 0) { me.hp = 0; this.takeDamage(0.01, 0, 'zone', 'zone'); if (me.st !== 'dead') this.die('zone', 'zone'); } }
      this.audio.loop('zone', 0.05, 900);
    } else this.audio.loop('zone', 0);
    if (me.boost > 0 && me.st !== 'down') { const rate = me.boost >= 90 ? 1.6 : me.boost >= 60 ? 1.2 : me.boost >= 20 ? 0.8 : 0.5; me.hp = Math.min(100, me.hp + rate * dt * 0.75); me.boost = Math.max(0, me.boost - dt * 0.55); }

    // ===== downed bleed =====
    if (me.st === 'down') {
      me.kh -= dt * (3.2 + me.knocks * 1.6);
      if (me.kh <= 0 || this.teammatesUp().length === 0) { this.die(me.lastAttacker || 'zone', ''); return; }
    }

    // ===== freefall / chute =====
    if (me.st === 'fall' || me.st === 'chute') {
      me.fallT += dt;
      const ground = W.groundAt(me.pos.x, me.pos.z, me.pos.y);
      const above = me.pos.y - Math.max(ground, 0);
      if (me.st === 'fall') {
        const dive = clamp(-me.pitch, 0, 1.2) / 1.2;
        me.vel.y = damp(me.vel.y, -(38 + dive * 26), 1.6, dt);
        const hs = (22 - dive * 8) * (fwd > 0 ? 1 : 0.6);
        me.vel.x = damp(me.vel.x, _d.x * hs, 0.9, dt); me.vel.z = damp(me.vel.z, _d.z * hs, 0.9, dt);
        if (above < 140 || (press('KeyF') && me.fallT > 1.2)) { me.st = 'chute'; this.audio.ui('chute'); this.hud.toast('낙하산 전개'); }
        this.audio.loop('wind', 0.12 + dive * 0.25, 600 + dive * 900);
      } else {
        me.vel.y = damp(me.vel.y, fwd > 0 ? -8 : fwd < 0 ? -4.6 : -6, 2, dt);
        const hs = fwd > 0 ? 15 : fwd < 0 ? 5 : 10;
        const dir = _t.set(Math.sin(me.yaw), 0, Math.cos(me.yaw)).multiplyScalar(hs).addScaledVector(_r, side * 6);
        me.vel.x = damp(me.vel.x, dir.x, 1.0, dt); me.vel.z = damp(me.vel.z, dir.z, 1.0, dt);
        this.audio.loop('wind', 0.06, 400);
      }
      me.pos.addScaledVector(me.vel, dt);
      me.pos.x = clamp(me.pos.x, -990, 990); me.pos.z = clamp(me.pos.z, -990, 990);
      const g2 = W.groundAt(me.pos.x, me.pos.z, me.pos.y + 1);
      if (me.pos.y <= g2 || (me.pos.y < -1.2 && W.heightAt(me.pos.x, me.pos.z) < -1.3)) {
        if (me.pos.y < -1.2 && W.heightAt(me.pos.x, me.pos.z) < -1.3) { me.pos.y = -1.35; me.st = 'swim'; } else { me.pos.y = g2; me.st = 'ground'; }
        if (me.vel.y < -20) this.takeDamage(40, 0, 'fall', 'fall');
        me.vel.set(0, 0, 0); me.onGround = true; this.audio.loop('wind', 0); this.audio.step(me.pos, 1.0);
        this.hud.toast('착지!');
      }
      me.hspeed = Math.hypot(me.vel.x, me.vel.z);
      return this.updateCamera(dt);
    }
    this.audio.loop('wind', 0);

    // ===== actions & weapon input =====
    const held = this.heldWeapon();
    const canAct = me.st === 'ground';
    if (canAct && !this.hud.anyOverlay()) {
      if (press('Digit1')) this.equip(0); if (press('Digit2')) this.equip(1); if (press('Digit3')) this.equip(2);
      if (press('Digit4')) this.equip(-1); if (press('Digit5') || press('KeyG')) { if (me.held === 3) { me.throwSel = me.throwSel === 'frag' ? 'smoke' : 'frag'; if (!me.inv[me.throwSel]) me.throwSel = me.throwSel === 'frag' ? 'smoke' : 'frag'; } else this.equip(3); }
      if (press('KeyX')) this.equip(-1);
      if (inp.wheel && !me.ads) { const order = [0, 1, 2, 3, -1]; let i = order.indexOf(me.held); for (let k = 0; k < 5; k++) { i = (i + (inp.wheel > 0 ? 1 : 4)) % 5; const s = order[i]; if (s === -1 || (s === 3 && (me.inv.frag || me.inv.smoke)) || (s >= 0 && s <= 2 && me.slots[s])) { this.equip(s); break; } } }
      if (press('KeyR')) this.startReload();
      if (press('KeyB') && held) { const d = WEAPONS[held.id]; held.mode = (held.mode + 1) % d.modes.length; this.hud.toast({ auto: '자동', single: '단발', burst: '점사' }[d.modes[held.mode]]); this.audio.ui('click'); }
      if (press('KeyH')) this.smartHeal();
      if (press('Digit7')) this.useItem('bandage'); if (press('Digit8')) this.useItem('firstaid'); if (press('Digit9')) this.useItem('medkit');
      if (press('Digit0')) this.useItem('energy'); if (press('Minus')) this.useItem('painkiller');
      if (press('KeyC') || press('ControlLeft')) { if (me.prone) { me.prone = false; me.crouch = true; } else if (me.crouch) { const c = W.ceilingAbove(me.pos.x, me.pos.z, me.pos.y + 1.0); if (c > me.pos.y + 1.85) me.crouch = false; } else me.crouch = true; }
      if (press('KeyZ')) { if (me.prone) { me.prone = false; me.crouch = true; } else { me.prone = true; me.crouch = false; me.sprinting = false; } }
      if (press('KeyT')) this.pingAim();
    }
    inp.wheel = 0;
    // interaction (F): revive > pick up
    let prompt = null;
    me.nearby = this.nearbyItems(me.pos, 2.4);
    const downMate = me.st === 'ground' ? this.teammates().find((a) => a.st === 'down' && a.pos.distanceTo(me.pos) < 2.2) : null;
    if (me.action && me.action.kind === 'revive') {
      const tg = this.actors.get(me.action.target);
      if (!key('KeyF') || !tg || tg.st !== 'down' || tg.pos.distanceTo(me.pos) > 2.6) me.action = null;
    }
    if (downMate && !me.action) { prompt = `[F] 길게 눌러 ${downMate.name} 부활`; if (key('KeyF')) me.action = { kind: 'revive', target: downMate.id, t: 0, dur: 8, label: `${downMate.name} 부활 중` }; }
    else if (me.nearby.length && canAct) {
      // pick the one closest to the view direction
      let best = me.nearby[0]; let bs = 1e9;
      for (const n of me.nearby) { const ang = Math.abs(angDiff(me.yaw, Math.atan2(n.it.x - me.pos.x, n.it.z - me.pos.z))); const s = n.d + ang * 0.6; if (s < bs) { bs = s; best = n; } }
      const info = itemInfo(best.it.type);
      prompt = `[F] ${best.crate ? (best.crate.kind === 'care' ? '보급 · ' : '상자 · ') : ''}${info.name}${best.it.qty > 1 ? ' ×' + best.it.qty : ''}`;
      if (press('KeyF')) this.pickup(best);
    }
    this.hud.prompt(prompt);

    // action progress / cancel
    if (me.action) {
      me.action.t += dt;
      if (me.action.t >= me.action.dur) this.finishAction();
    }

    // ===== movement =====
    const sprintReq = (key('ShiftLeft') || (inp.joy && inp.joy.sprint)) && fwd > 0 && !me.ads && me.st === 'ground' && !(me.action && me.action.kind === 'use' && me.action.type !== 'bandage' && me.action.type !== 'energy');
    if (sprintReq && me.prone) { me.prone = false; me.crouch = true; }
    if (sprintReq && me.crouch) { const c = W.ceilingAbove(me.pos.x, me.pos.z, me.pos.y + 1.0); if (c > me.pos.y + 1.85) me.crouch = false; }
    me.sprinting = sprintReq && !me.crouch;
    if (me.sprinting && me.action && me.action.kind === 'use' && me.action.type !== 'bandage' && me.action.type !== 'energy') me.action = null;
    let spd = me.st === 'down' ? 1.0 : me.st === 'swim' ? 2.6 : me.prone ? 1.1 : me.sprinting ? 6.4 : me.crouch ? 2.3 : 4.7;
    if (me.ads && me.st === 'ground') spd = Math.min(spd, me.crouch ? 1.6 : 2.6);
    if (me.action && me.action.kind === 'use') spd = Math.min(spd, 1.8);
    if (me.action && me.action.kind === 'revive') spd = 0;
    if (me.boost >= 60) spd *= 1.06;
    if (fwd < 0) spd *= 0.85;
    const lam = me.onGround || me.st === 'swim' ? 11 : 1.6;
    me.vel.x = damp(me.vel.x, _d.x * spd, lam, dt); me.vel.z = damp(me.vel.z, _d.z * spd, lam, dt);
    if (me.st !== 'swim') me.vel.y -= G * dt;
    if (me.mantle) { // vaulting / climbing over an obstacle
      const M = me.mantle; M.t += dt; const k = Math.min(1, M.t / M.dur);
      const up = Math.min(1, k * 1.6), fw = Math.max(0, (k - 0.35) / 0.65);
      me.pos.set(M.from.x + (M.to.x - M.from.x) * fw, M.from.y + (M.to.y + 0.02 - M.from.y) * (1 - (1 - up) * (1 - up)), M.from.z + (M.to.z - M.from.z) * fw);
      me.vel.set(0, 0, 0); me.hspeed = 2;
      if (k >= 1) { me.mantle = null; me.onGround = true; }
      return this.updateCamera(dt);
    }
    if (press('Space') && me.onGround && me.st === 'ground') {
      if (me.prone) { me.prone = false; me.crouch = true; }
      else if (me.crouch) me.crouch = false;
      else if (!this.tryMantle()) { me.vel.y = 6.3; me.onGround = false; if (me.action && me.action.kind === 'use') me.action = null; }
    }
    const height = me.st === 'down' ? 0.7 : me.prone ? 0.55 : me.crouch ? 1.25 : 1.8;
    const np = _q.copy(me.pos).addScaledVector(me.vel, dt);
    W.collide(np, 0.32, height);
    let ground = W.groundAt(np.x, np.z, np.y, 0.3);
    const wasGround = me.onGround;
    if (np.y <= ground) {
      if (me.vel.y < -12.5 && me.st === 'ground') this.takeDamage((-me.vel.y - 12.5) ** 2 * 1.8, 0, 'fall', 'fall');
      np.y = ground; me.vel.y = 0; me.onGround = true;
    } else if (wasGround && me.vel.y <= 0 && np.y - ground < STEPD) { np.y = ground; me.vel.y = 0; me.onGround = true; }
    else me.onGround = false;
    if (me.vel.y > 0) { const c = W.ceilingAbove(np.x, np.z, me.pos.y + 0.5); if (np.y + height > c) { np.y = c - height; me.vel.y = 0; } }
    // water
    const th = W.heightAt(np.x, np.z);
    if (th < -1.3 && ground < -1.3) {
      if (np.y <= -1.35) { np.y = -1.35; me.vel.y = 0; if (me.st === 'ground') { me.st = 'swim'; me.crouch = false; me.prone = false; if (me.held >= 0) me.heldBeforeSwim = me.held; me.held = -1; me.ads = false; } me.onGround = true; }
    } else if (me.st === 'swim' && np.y >= ground - 0.05) { me.st = 'ground'; }
    me.pos.copy(np);
    me.hspeed = Math.hypot(me.vel.x, me.vel.z);
    // footsteps
    if (me.onGround && me.hspeed > 1.2 && me.st === 'ground') { me.stepT -= dt * me.hspeed; if (me.stepT <= 0) { me.stepT = 2.1; this.audio.step(undefined, me.sprinting ? 0.5 : me.crouch ? 0.12 : 0.3, ground > th + 0.1 ? 'hard' : 'grass'); } }

    // ===== shooting =====
    me.cool -= dt; me.switchT -= dt; me.boltT -= dt; me.punchT -= dt;
    const busy = me.action && (me.action.kind === 'use' || me.action.kind === 'revive');
    const canShoot = me.st === 'ground' && !busy && me.switchT <= 0 && !this.hud.anyOverlay() && locked;
    // ADS
    const wantAds = canShoot && (held || me.held === -1) && inp.mouseR && held && !(me.action && me.action.kind === 'reload') && !me.sprinting;
    me.ads = !!wantAds;
    const st = held ? this.wstats(held) : null;
    me.adsK = damp(me.adsK, me.ads ? 1 : 0, me.ads ? 1 / (st ? st.adsTime : 0.2) * 1.4 : 14, dt);
    if (held && canShoot) {
      const d = st.d; const mode = d.modes[held.mode] || 'single';
      const trig = mode === 'auto' ? inp.mouseL : inp.mouseLPressed;
      if (mode === 'burst' && inp.mouseLPressed && me.burst <= 0) me.burst = 3;
      if ((trig || me.burst > 0) && me.cool <= 0 && me.boltT <= 0) {
        if (me.action && me.action.kind === 'reload') { if (held.mag > 0) me.action = null; }
        if (!me.action) {
          if (held.mag > 0) { this.shoot(held, st); me.sprinting = false; if (me.burst > 0) { me.burst--; if (me.burst > 0) me.cool = 0.075; } }
          else { me.burst = 0; this.audio.ui('empty'); me.cool = 0.3; if (me.inv[d.ammo] > 0) this.startReload(); }
        }
      }
    } else me.burst = 0;
    // throwables
    if (me.held === 3 && canShoot) {
      if (inp.mouseLPressed && me.inv[me.throwSel] > 0) { me.cook = 0; this.audio.ui('click'); }
      if (me.cook >= 0) {
        me.cook += dt;
        if (!inp.mouseL || me.cook > 4.5) this.throwGrenade();
      }
    }
    // melee
    if (me.held === -1 && canShoot && inp.mouseLPressed && me.punchT <= 0) this.punch();
    inp.mouseLPressed = false;

    // recoil recovery
    me.kick = damp(me.kick, 0, 9, dt); me.kickYaw = damp(me.kickYaw, 0, 9, dt);
    me.lean = damp(me.lean, (key('KeyE') ? 1 : 0) - (key('KeyQ') ? 1 : 0), 10, dt);
    this.updateCamera(dt);
  },

  tryMantle() {
    const me = this.me, W = this.world;
    const fx = Math.sin(me.yaw), fz = Math.cos(me.yaw);
    for (const dist of [0.55, 0.8, 1.05]) {
      const tx = me.pos.x + fx * dist, tz = me.pos.z + fz * dist;
      const top = W.groundAt(tx, tz, me.pos.y + 1.6, 0.2);
      const h = top - me.pos.y;
      if (h < 0.6 || h > 2.05) continue;
      // something must actually block us in front (not just a slope)
      const blockTop = W.groundAt(me.pos.x + fx * 0.35, me.pos.z + fz * 0.35, me.pos.y + 1.6, 0.15);
      if (blockTop < me.pos.y + 0.5 && dist > 0.6) continue;
      const ceil = W.ceilingAbove(tx, tz, top + 0.05, 0.25);
      if (ceil < top + 1.0) continue;
      const fx2 = tx + fx * 0.35, fz2 = tz + fz * 0.35;
      const land = W.groundAt(fx2, fz2, top + 0.2, 0.25);
      const to = Math.abs(land - top) < 0.3 ? new THREE.Vector3(fx2, land, fz2) : new THREE.Vector3(tx, top, tz);
      me.mantle = { t: 0, dur: 0.38 + h * 0.18, from: me.pos.clone(), to };
      if (W.ceilingAbove(to.x, to.z, to.y + 0.05) < to.y + 1.85) me.crouch = true;
      this.audio.step(undefined, 0.6, 'hard');
      return true;
    }
    return false;
  },
  jumpOut() {
    const me = this.me, m = this.match;
    me.st = 'fall'; me.fallT = 0;
    me.vel.set(m.plane.dx * 30, -5, m.plane.dz * 30);
    me.pos.y -= 3;
    me.yaw = Math.atan2(m.plane.dx, m.plane.dz);
    this.audio.ui('chute');
    this.hud.toast('낙하! [W] 전진 · 아래를 보면 빠르게 강하');
  },

  // aim ray from camera (returns point)
  aimPoint(out) {
    const cam = this.camera; cam.getWorldDirection(_t);
    const h = this.world.raycast(cam.position.x, cam.position.y, cam.position.z, _t.x, _t.y, _t.z, 900, true);
    let t = h ? h.t : 900;
    for (const a of this.actors.values()) { const r = a.hitTest(cam.position.x, cam.position.y, cam.position.z, cam.position.x + _t.x * t, cam.position.y + _t.y * t, cam.position.z + _t.z * t); if (r) t = r.t * t; }
    return out.copy(cam.position).addScaledVector(_t, Math.max(t, 2));
  },
  muzzleOrigin(out) {
    const me = this.me;
    if (me.ads || me.fpp) { this.camera.getWorldDirection(_t); return out.copy(this.camera.position).addScaledVector(_t, 0.3); }
    const fx = Math.sin(me.yaw), fz = Math.cos(me.yaw);
    return out.set(me.pos.x + fx * 0.55 - Math.cos(me.yaw) * 0.12, me.pos.y + (me.prone ? 0.3 : me.crouch ? 1.12 : 1.45), me.pos.z + fz * 0.55 + Math.sin(me.yaw) * 0.12);
  },
  shoot(w, st) {
    const me = this.me; const d = st.d;
    w.mag--; me.shotSeq++;
    me.cool = 60 / d.rpm;
    if (d.bolt) { me.boltT = 60 / d.rpm; setTimeout(() => this.audio.ui('bolt'), 50); }
    const origin = this.muzzleOrigin(_o).clone();
    const target = this.aimPoint(new THREE.Vector3());
    const dir = target.sub(origin).normalize();
    const moving = me.hspeed > 1;
    let spread = me.ads ? d.ads * (me.prone ? 0.6 : 1) : d.hip * (moving ? 1.5 : 1) * (me.prone ? 0.6 : me.crouch ? 0.8 : 1) * (me.onGround ? 1 : 2.4);
    spread *= Math.PI / 180;
    const n = d.pellets || 1;
    const up = new THREE.Vector3(0, 1, 0); const right = new THREE.Vector3().crossVectors(dir, up).normalize(); const up2 = new THREE.Vector3().crossVectors(right, dir);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
      const dd = dir.clone().addScaledVector(right, Math.cos(a) * r).addScaledVector(up2, Math.sin(a) * r).normalize();
      this.fireBullet(origin, dd, d, w.id, this.myPeer);
      if (i < 3) this.fx.tracer(origin.x, origin.y, origin.z, dd.x, dd.y, dd.z, d.vel, 800, [1, 0.8, 0.45]);
    }
    // recoil
    const k = (me.ads ? 1 : 1.25) * (me.prone ? 0.55 : me.crouch ? 0.85 : 1);
    const vk = st.rv * 0.0135 * k, hk = st.rh * 0.009 * k * (Math.random() * 2 - 1);
    me.pitch = clamp(me.pitch + vk * 0.62, -1.45, 1.45); me.yaw += hk * 0.6; me.kick += vk * 0.8; me.kickYaw += hk;
    const flashPos = me.ads || me.fpp ? origin.clone().addScaledVector(dir, 0.6).add(new THREE.Vector3(0, -0.08, 0)) : origin.clone().addScaledVector(dir, 0.35);
    if (!st.noflash) this.fx.muzzle(flashPos, dir, d.cat === 'SG' || d.cat === 'SR' ? 1.4 : 1, true);
    this.audio.gun(d.cat, undefined, { self: true, quiet: st.quiet });
    this.hud.recoilPulse();
    if (w.mag === 0 && me.inv[d.ammo] > 0) setTimeout(() => { if (this.heldWeapon() === w && !me.action) this.startReload(); }, 250);
  },
  throwGrenade() {
    const me = this.me; const type = me.throwSel;
    if (this.invTake(type, 1) <= 0) { me.cook = -1; return; }
    const fuse = type === 'frag' ? Math.max(0.05, 4.5 - me.cook) : 1.8;
    const cam = this.camera; cam.getWorldDirection(_t);
    const o = _o.set(me.pos.x, me.pos.y + 1.6, me.pos.z).addScaledVector(_t, 0.5);
    const v = _t.clone().multiplyScalar(me.ads ? 12 : 19).add(new THREE.Vector3(0, 3, 0)).add(me.vel);
    this.spawnGrenade(type, o.x, o.y, o.z, v.x, v.y, v.z, fuse, this.myPeer);
    const r = (x) => Math.round(x * 100) / 100;
    this.emit('gr', type, r(o.x), r(o.y), r(o.z), r(v.x), r(v.y), r(v.z), r(fuse));
    me.cook = -1;
    if (!me.inv[type]) { const other = type === 'frag' ? 'smoke' : 'frag'; if (me.inv[other]) me.throwSel = other; else this.equip(me.slots[0] ? 0 : me.slots[1] ? 1 : me.slots[2] ? 2 : -1); }
    this.hud.refreshInventory();
  },
  punch() {
    const me = this.me; me.punchT = 0.5; me.punchAnim = 1;
    const fx = Math.sin(me.yaw), fz = Math.cos(me.yaw);
    for (const a of this.actors.values()) {
      if (!a.alive || (a.team === this.myTeam && this.match.mode > 1)) continue;
      const dx = a.pos.x - me.pos.x, dz = a.pos.z - me.pos.z; const d = Math.hypot(dx, dz);
      if (d < 1.7 && Math.abs(a.pos.y - me.pos.y) < 1.2 && (dx * fx + dz * fz) / d > 0.6) {
        this.hud.hitMarker('body', false); this.audio.ui('hit'); me.dmg += 18;
        if (a.isBot && this.isHost) this.bots.damage(a.id, 18, 4, 'fist', this.myPeer); else this.emit('h', a.id, 18, 4, 'fist', this.myPeer);
        break;
      }
    }
    this.audio.step(undefined, 0.4, 'hard');
  },
  pingAim() {
    const p = this.aimPoint(new THREE.Vector3());
    this.me.marker = [p.x, p.z]; this.hud.toast('마커를 찍었습니다'); this.audio.ui('click');
  },

  // ---------- camera ----------
  updateCamera(dt) {
    const me = this.me, cam = this.camera, W = this.world, S = this.settings;
    const held = this.heldWeapon(); const st = held ? this.wstats(held) : null;
    const yaw = me.yaw + me.kickYaw * 0.4, pitch = me.pitch + me.kick * 0.5;
    this.camYaw = yaw;
    const cp = Math.cos(pitch);
    const fwd = _f.set(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp);
    let fov = S.fov;
    let showSelf = true;
    const C = (this.camS = this.camS || { eye: 1.6, dist: 2.8, side: 0.6, fovAdd: 0 });
    if (me.st === 'plane') {
      const P = this.plane.position;
      const back = 34;
      cam.position.set(P.x - fwd.x * back, P.y - fwd.y * back + 6, P.z - fwd.z * back);
      cam.lookAt(P.x, P.y + 2, P.z);
      showSelf = false;
    } else {
      const eyeT = me.st === 'down' ? 0.55 : me.st === 'swim' ? 1.45 : me.prone ? 0.36 : me.crouch ? 1.15 : 1.62;
      C.eye = me.st === 'ground' ? damp(C.eye, eyeT, 10, dt) : eyeT;
      const pivot = _o.set(me.pos.x, me.pos.y + C.eye, me.pos.z);
      const right = _r.set(-Math.cos(yaw), 0, Math.sin(yaw));
      pivot.addScaledVector(right, -me.lean * 0.35);
      const scopeOn = me.ads && me.adsK > 0.85;
      if ((me.ads || me.fpp) && me.st === 'ground' && !me.mantle) {
        cam.position.copy(pivot).addScaledVector(fwd, me.prone ? 0.2 : 0.1);
        if (me.fpp && !me.ads) { const bob = Math.sin(this.vmBobT || 0); cam.position.y += bob * 0.025 * Math.min(1, me.hspeed / 5); }
        if (me.ads) { const z = st.zoom; fov = lerp(S.fov, Math.atan(Math.tan((S.fov * Math.PI) / 360) / z) * 360 / Math.PI, me.adsK); this.curZoom = lerp(1, z, me.adsK); }
        showSelf = false;
        C.dist = 0.5;
      } else {
        this.curZoom = 1;
        const far = me.st === 'fall' || me.st === 'chute';
        const backT = far ? 6.5 : me.prone ? 2.3 : 2.7, sideT = far ? 0 : me.prone ? 0.45 : 0.58, up = far ? 1.2 : 0.16;
        C.side = damp(C.side, sideT, 8, dt);
        const want = _t.copy(pivot).addScaledVector(right, C.side).addScaledVector(fwd, -backT); want.y += up;
        const dx = want.x - pivot.x, dy = want.y - pivot.y, dz = want.z - pivot.z; const L = Math.hypot(dx, dy, dz);
        const h = W.raycast(pivot.x, pivot.y, pivot.z, dx / L, dy / L, dz / L, L + 0.3, true);
        const kT = h ? Math.max(0.12, (h.t - 0.3) / L) : 1;
        C.dist = kT < C.dist ? kT : damp(C.dist, kT, 6, dt); // snap in, ease out
        const k = Math.min(C.dist, 1);
        cam.position.set(pivot.x + dx * k, pivot.y + dy * k, pivot.z + dz * k);
        if (me.st !== 'swim') cam.position.y = Math.max(cam.position.y, W.heightAt(cam.position.x, cam.position.z) + 0.25);
        // sprint FOV kick
        C.fovAdd = damp(C.fovAdd, me.sprinting ? 7 : far ? 10 : 0, 5, dt); fov += C.fovAdd;
      }
      cam.lookAt(cam.position.x + fwd.x, cam.position.y + fwd.y, cam.position.z + fwd.z);
      if (me.lean) cam.rotateZ(-me.lean * 0.12);
      this.scopeView = scopeOn && st && st.scope;
      this.adsView = me.ads && me.adsK > 0.5;
    }
    if (this.shake > 0) { this.shake = Math.max(0, this.shake - dt * 1.5); cam.position.x += (Math.random() - 0.5) * this.shake * 0.3; cam.position.y += (Math.random() - 0.5) * this.shake * 0.3; }
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); this.fx.setScale(this.renderer.domElement.height, fov); }
    // my character model
    this.ensureMyChar();
    const ch = this.me.charObj;
    ch.group.visible = showSelf && me.st !== 'plane';
    ch.group.position.copy(me.pos); ch.group.rotation.y = me.yaw;
    const back = me.slots.find((w, i) => w && i !== me.held && i < 2);
    ch.setGun(held ? held.id : null, held ? held.att : null); ch.setBack(back ? back.id : null);
    ch.setGear(me.helm ? ITEMS[me.helm.type].lvl : 0, me.vest ? ITEMS[me.vest.type].lvl : 0, me.bag ? ITEMS[me.bag].lvl : 0);
    me.punchAnim = Math.max(0, (me.punchAnim || 0) - dt * 4);
    const lv = this.localVel(me.vel, me.yaw);
    const reload = me.action && me.action.kind === 'reload' ? me.action.t / me.action.dur : -1;
    if (ch.group.visible || me.st === 'dead') ch.animate(dt, { st: me.st, speed: me.st === 'fall' || me.st === 'chute' ? 0 : me.hspeed, vx: lv[0], vz: lv[1], crouch: me.crouch || !!me.mantle, prone: me.prone, sprint: me.sprinting, pitch: me.pitch, armed: !!held && me.st === 'ground' && !me.mantle, punch: me.punchAnim, lean: me.lean, ads: me.ads, reload });
    this.updateViewModel(dt, held, st);
    this.audio.setListener(cam.position.x, cam.position.y, cam.position.z, yaw);
  },
  localVel(v, yaw) { const c = Math.cos(yaw), sn = Math.sin(yaw); return [v.x * c - v.z * sn, v.x * sn + v.z * c]; },
  ensureMyChar() {
    const S = this.settings;
    if (!this.me.charObj || this.me.charColor !== S.color) {
      if (this.me.charObj) this.scene.remove(this.me.charObj.group);
      this.me.charObj = new Character({ shirt: PLAYER_COLORS[S.color % PLAYER_COLORS.length], skin: S.color % 5, hair: S.color % 4 });
      this.me.charColor = S.color; this.scene.add(this.me.charObj.group);
    }
  },
  buildViewModel(held) {
    const vm = this.vm;
    vm.clear();
    const gun = weaponModel(held.id, held.att); gun.rotation.y = Math.PI;
    const pivot = new THREE.Group(); pivot.add(gun); vm.add(pivot);
    const ud = gun.userData;
    const sleeve = new THREE.MeshStandardMaterial({ color: PLAYER_COLORS[this.settings.color % PLAYER_COLORS.length], roughness: 0.85 });
    const glove = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.7 });
    const limb = (a, b, r, mat) => {
      const d = new THREE.Vector3().subVectors(b, a); const L = d.length();
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.01, L - r * 2), 3, 10), mat);
      m.position.copy(a).add(b).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
      pivot.add(m); return m;
    };
    // in pivot space barrel points -Z (gun rotated PI); grip at origin, fore at (0, fy, -fz)
    const R = new THREE.Vector3(0, -0.03, 0.02), F = new THREE.Vector3(-ud.fore.x, ud.fore.y - 0.02, -ud.fore.z);
    limb(R, new THREE.Vector3(0.1, -0.22, 0.34), 0.045, sleeve);
    const hR = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.07), glove); hR.position.copy(R).add(new THREE.Vector3(0.0, -0.01, 0.02)); pivot.add(hR);
    limb(F, new THREE.Vector3(ud.pistol ? -0.06 : -0.17, -0.24, ud.pistol ? 0.3 : 0.12), 0.043, sleeve);
    const hL = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.06, 0.09), glove); hL.position.copy(F).add(new THREE.Vector3(-0.01, -0.02, 0)); pivot.add(hL);
    vm.traverse((m) => { if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; } });
    this.vmPivot = pivot; this.vmUD = ud;
  },
  updateViewModel(dt, held, st) {
    if (!this.vm) { this.vm = new THREE.Group(); this.camera.add(this.vm); this.vmId = null; }
    const me = this.me;
    const show = held && (me.ads || me.fpp) && me.st === 'ground' && !this.scopeView && !me.mantle;
    this.vm.visible = !!show;
    if (!show) return;
    const id = held.id + '|' + [held.att.s, held.att.m, held.att.g, held.att.x].join(',') + '|' + this.settings.color;
    if (this.vmId !== id) { this.buildViewModel(held); this.vmId = id; }
    const ud = this.vmUD; const k = me.adsK;
    this.vmBobT = (this.vmBobT || 0) + dt * (me.hspeed > 0.5 ? 2 + me.hspeed * 1.3 : 1.2);
    const bobA = (me.hspeed > 0.5 ? Math.min(1, me.hspeed / 5) : 0.15) * (1 - k * 0.85);
    const bx = Math.cos(this.vmBobT) * 0.012 * bobA, by = Math.abs(Math.sin(this.vmBobT)) * 0.014 * bobA;
    const er = ud.pistol ? 0.42 : held.att.s ? 0.2 : 0.24;
    // ADS: sight line at screen center
    const adsP = [0, -ud.sightY, ud.sightZ - er];
    const hipP = ud.pistol ? [0.16, -0.17, -0.38] : [0.14, -0.12 - ud.sightY * 0.6, ud.sightZ - 0.34];
    let rx = me.kick * 1.4, ry = lerp(0.05, 0, k), rz = 0, oy = 0;
    if (me.sprinting) { rx -= 0.5; ry += 0.6; oy -= 0.06; }
    if (me.action && me.action.kind === 'reload') { const r = Math.sin(Math.min(1, me.action.t / me.action.dur) * Math.PI); rx -= 0.35 * r; rz += 0.6 * r; oy -= 0.06 * r; }
    if (me.switchT > 0) oy -= me.switchT * 0.5;
    this.vmSway = this.vmSway || [0, 0];
    this.vmSway[0] = damp(this.vmSway[0], (this.input.dx || 0) * -0.0004, 8, dt); this.vmSway[1] = damp(this.vmSway[1], (this.input.dy || 0) * -0.0004, 8, dt);
    this.vm.position.set(lerp(hipP[0], adsP[0], k) + bx, lerp(hipP[1], adsP[1], k) + by + oy, lerp(hipP[2], adsP[2], k) + me.kick * 0.35);
    this.vm.rotation.set(rx, ry + this.vmSway[0] * (1 - k), rz);
  },

  // ---------- spectate ----------
  updateSpectate(dt) {
    const inp = this.input; const cam = this.camera;
    const list = [...this.actors.values()].filter((a) => a.alive && a.st !== 'plane');
    list.sort((a, b) => (b.team === this.myTeam) - (a.team === this.myTeam));
    let tg = this.actors.get(this.spec.id);
    if (!tg || !tg.alive) { tg = list[0]; this.spec.id = tg ? tg.id : null; }
    if (inp.mouseLPressed && list.length) { const i = list.indexOf(tg); tg = list[(i + 1) % list.length]; this.spec.id = tg.id; }
    inp.mouseLPressed = false;
    if (this.hud.captured()) { this.specYaw = (this.specYaw || 0) - inp.dx * 0.0025; this.specPitch = clamp((this.specPitch || -0.2) - inp.dy * 0.0025, -1.2, 1.2); }
    inp.dx = inp.dy = 0;
    this.ensureMyChar(); this.me.charObj.group.visible = this.me.st === 'dead' && this.me.deathT > 0;
    if (this.me.st === 'dead') { this.me.charObj.group.position.copy(this.me.pos); this.me.charObj.animate(dt, { st: 'dead', speed: 0 }); }
    if (this.vm) this.vm.visible = false;
    this.scopeView = false; this.adsView = false;
    if (cam.fov !== this.settings.fov) { cam.fov = this.settings.fov; cam.updateProjectionMatrix(); }
    if (tg) {
      const yaw = this.specFree ? this.specYaw : tg.yaw + (this.specYaw || 0) * 0;
      const y = this.specYaw ?? 0; const p = this.specPitch ?? -0.2;
      const Y = tg.yaw + y, cp = Math.cos(p);
      const f = _f.set(Math.sin(Y) * cp, Math.sin(p), Math.cos(Y) * cp);
      const piv = _o.set(tg.pos.x, tg.pos.y + 1.6, tg.pos.z);
      const back = tg.st === 'fall' || tg.st === 'chute' ? 7 : 3.4;
      const want = _t.copy(piv).addScaledVector(f, -back);
      const dx = want.x - piv.x, dy = want.y - piv.y, dz = want.z - piv.z; const L = Math.hypot(dx, dy, dz);
      const h = this.world.raycast(piv.x, piv.y, piv.z, dx / L, dy / L, dz / L, L, true);
      const k = h ? Math.max(0.15, (h.t - 0.25) / L) : 1;
      cam.position.set(piv.x + dx * k, piv.y + dy * k, piv.z + dz * k); cam.lookAt(piv);
      this.hud.spectating(tg.name, tg.team === this.myTeam);
    } else {
      // orbit the zone
      const Z = this.match.zoneNow; const t = performance.now() / 8000;
      cam.position.set(Z.bc[0] + Math.cos(t) * 260, 220, Z.bc[1] + Math.sin(t) * 260); cam.lookAt(Z.bc[0], 20, Z.bc[1]);
      this.hud.spectating(null);
    }
    this.audio.setListener(cam.position.x, cam.position.y, cam.position.z, Math.atan2(-(cam.position.x), -(cam.position.z)));
  },
};
const STEPD = 0.5;
