// ===== LAST CIRCLE · networking over the artifact `room` capability =====
// Everything travels in presence (allowed for every admitted viewer):
// each client publishes its own absolute state + a short ring of recent events.
export class Net {
  constructor() {
    this.api = null; this.room = null; this.available = false; this.connected = false;
    this.onPeers = () => {}; this.onStatus = () => {};
    this.myPeer = null; this.unsub = [];
    this.pending = null; this.sending = false; this.lastSize = 0;
  }
  async init() {
    try {
      if (!window.claude || typeof window.claude.use !== 'function') { this.onStatus('offline'); return false; }
      const api = await Promise.race([window.claude.use('room'), new Promise((r) => setTimeout(() => r(null), 12000))]);
      if (!api) { this.onStatus('offline'); return false; }
      this.api = api; this.available = true;
      this.onStatus('ready');
      return true;
    } catch (e) { this.onStatus('offline'); return false; }
  }
  async join(code) {
    if (!this.api) throw new Error('no-room');
    await this.leave();
    const name = 'lc3-' + code.toLowerCase();
    const room = await this.api.join(name);
    this.room = room; this.code = code;
    this.unsub.push(room.onPeers((ch) => {
      for (const p of ch.peers) if (p.sameTab) this.myPeer = p.peer;
      this.onPeers(ch);
    }, (e) => this.onStatus('error:' + e.code)));
    this.unsub.push(room.onConnection((c) => { this.connected = c; this.onStatus(c ? 'connected' : 'reconnecting'); }));
    return room;
  }
  async leave() {
    for (const u of this.unsub) { try { u(); } catch (e) {} }
    this.unsub = [];
    if (this.room) { try { await this.room.leave(); } catch (e) {} }
    this.room = null; this.myPeer = null;
  }
  peers() { return this.room ? this.room.peers() : []; }
  // send whole state object; coalesce while a send is in flight
  send(obj) {
    if (!this.room) return;
    this.pending = obj;
    if (this.sending) return;
    this.flush();
  }
  flush() {
    const obj = this.pending; if (!obj) return;
    this.pending = null; this.sending = true;
    let json = JSON.stringify(obj);
    // keep under 4 KiB: trim event ring, then bots precision
    let guard = 0;
    while (json.length > 3900 && guard++ < 40) {
      if (obj.ev && obj.ev.length > 1) obj.ev.shift();
      else if (obj.b && obj.b.length) obj.b = obj.b.slice(0, obj.b.length - 1);
      else break;
      json = JSON.stringify(obj);
    }
    this.lastSize = json.length;
    const patch = {};
    for (const k in obj) patch[k] = obj[k];
    if (this.prevKeys) for (const k of this.prevKeys) if (!(k in obj)) patch[k] = null;
    this.prevKeys = Object.keys(obj);
    this.room.presence(patch).catch(() => {}).finally(() => { this.sending = false; if (this.pending) this.flush(); });
  }
}

// simple local stand-in (single player practice)
export class LocalNet {
  constructor() { this.available = false; this.myPeer = 'local'; this.onPeers = () => {}; this.onStatus = () => {}; this.state = {}; }
  async join() {}
  async leave() {}
  peers() { return [{ peer: 'local', isMe: true, sameTab: true, presence: this.state, kind: 'viewer', guest: false, updatedAt: Date.now() }]; }
  send(obj) { this.state = obj; }
}

const ALPH = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function makeCode() { let s = ''; for (let i = 0; i < 5; i++) s += ALPH[Math.floor(Math.random() * ALPH.length)]; return s; }
export function cleanCode(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); }

// ===== Peer-to-peer networking for when the page runs outside claude.ai (GitHub Pages, any static host) =====
// Uses Trystero: browsers find each other through free public Nostr relays, then talk directly over WebRTC.
// Same interface as Net: join(code) / leave() / peers() / send(obj) / onPeers(change) / myPeer.
const TRYSTERO_URL = 'https://cdn.jsdelivr.net/npm/trystero@0.27.0/+esm';
const APP_ID = 'last-circle-br.kdh61313-chico.v3';
export class P2PNet {
  constructor() {
    this.lib = null; this.room = null; this.available = false; this.connected = false; this.p2p = true;
    this.onPeers = () => {}; this.onStatus = () => {};
    this.myPeer = null; this.others = new Map(); this.mine = {};
    this.sending = false; this.pending = null; this.lastSize = 0; this.fireQueued = false; this.joined = []; this.left = [];
  }
  async init() {
    try {
      if (typeof RTCPeerConnection === 'undefined') { this.onStatus('offline'); return false; }
      this.lib = await import(/* @vite-ignore */ TRYSTERO_URL);
      this.available = true; this.onStatus('ready');
      return true;
    } catch (e) { console.warn('p2p init failed', e); this.onStatus('offline'); return false; }
  }
  async join(code) {
    await this.leave();
    const room = this.lib.joinRoom({
      appId: APP_ID, identity: 'none',
      rtcConfig: { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }, { urls: 'stun:stun.cloudflare.com:3478' }] },
    }, 'lc3-' + code.toLowerCase());
    this.room = room; this.code = code;
    const act = room.makeAction('st');
    this.sendSt = (data, target) => act.send(data, target ? { target } : undefined);
    act.onMessage((data, ctx) => {
      const id = typeof ctx === 'string' ? ctx : ctx && ctx.peerId;
      if (!id || !data || typeof data !== 'object') return;
      const known = this.others.has(id);
      const p = { peer: id, by: null, isMe: false, sameTab: false, kind: 'viewer', guest: false, presence: data, updatedAt: Date.now() };
      this.others.set(id, p);
      if (!known) this.joined.push(p);
      this.fire();
    });
    room.onPeerJoin((c) => {
      const id = typeof c === 'string' ? c : c.peerId;
      this.connected = true; this.onStatus('connected');
      if (this.mine && this.sendSt) this.sendSt(this.mine, id); // late joiner gets our state right away
    });
    room.onPeerLeave((c) => {
      const id = typeof c === 'string' ? c : c.peerId;
      const p = this.others.get(id); if (p) { this.others.delete(id); this.left.push(p); this.fire(); }
    });
    if (room.onError) room.onError((e) => { if (e && (e.code === 'relay-failed')) this.onStatus('error:relay'); });
    try { const self = await room.getSelf(); this.myPeer = self.peerId; } catch (e) { this.myPeer = 'me-' + Math.random().toString(36).slice(2, 10); }
    this.connected = true; this.onStatus('connected');
    this.fire();
    return room;
  }
  fire() {
    if (this.fireQueued) return; this.fireQueued = true;
    queueMicrotask(() => {
      this.fireQueued = false;
      const peers = this.peers(); const joined = this.joined, left = this.left; this.joined = []; this.left = [];
      try { this.onPeers({ peers, joined, left, updated: [] }); } catch (e) { console.error(e); }
    });
  }
  async leave() {
    if (this.room) { try { await this.room.leave(); } catch (e) {} }
    this.room = null; this.others.clear(); this.sendSt = null;
  }
  peers() {
    if (!this.room) return [];
    const me = { peer: this.myPeer, by: null, isMe: true, sameTab: true, kind: 'viewer', guest: false, presence: this.mine, updatedAt: Date.now() };
    return [me, ...this.others.values()];
  }
  send(obj) {
    if (!this.room || !this.sendSt) return;
    this.mine = obj; this.pending = obj;
    if (this.sending) return;
    this.flush();
  }
  flush() {
    const obj = this.pending; if (!obj) return; this.pending = null;
    if (!this.others.size) return; // nobody to talk to yet; state is resent on join
    this.sending = true;
    let p;
    try { p = this.sendSt(obj); } catch (e) { p = null; }
    Promise.resolve(p).catch(() => {}).finally(() => { this.sending = false; if (this.pending) this.flush(); });
  }
}
