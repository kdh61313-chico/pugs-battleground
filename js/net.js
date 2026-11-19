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
