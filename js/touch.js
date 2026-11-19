// ===== LAST CIRCLE · mobile touch controls =====
// Left thumb: floating joystick (push to the edge = sprint). Right thumb: drag anywhere to look.
// Buttons: fire (drag on it to aim while shooting), aim, jump, crouch, prone, reload, interact, etc.
export function isTouchDevice() {
  try { return matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window && navigator.maxTouchPoints > 0); } catch (e) { return false; }
}

const BTN = [
  // id, label, css position, size, action
  ['tFire', '발사', 'right:3.5%;bottom:20%', 86, 'fire'],
  ['tFire2', '발사', 'left:2.5%;bottom:36%', 58, 'fire'],
  ['tAds', '조준', 'right:15%;bottom:36%', 58, 'ads'],
  ['tJump', '점프', 'right:3%;bottom:45%', 56, 'KeyJump'],
  ['tCrouch', '앉기', 'right:17%;bottom:6%', 52, 'KeyC'],
  ['tProne', '엎드려', 'right:3.5%;bottom:4%', 52, 'KeyZ'],
  ['tReload', '장전', 'right:17%;bottom:20%', 52, 'KeyR'],
  ['tUse', '줍기', 'right:28%;bottom:44%', 64, 'KeyF'],
];
const TOP = [['tBag', '가방', 'Tab'], ['tMap', '지도', 'KeyM'], ['tHeal', '회복', 'KeyH'], ['tSwap', '무기', 'swap'], ['tThrow', '투척', 'Digit5'], ['tView', '시점', 'KeyV'], ['tMenu', '메뉴', 'Escape']];

export class TouchControls {
  constructor(game, hud) {
    this.g = game; this.hud = hud; this.on = false;
    this.joy = null; this.look = new Map(); this.fireIds = new Set(); this.ads = false;
    game.input.joy = { x: 0, y: 0, active: false };
  }
  enable() {
    if (this.on) return; this.on = true;
    document.body.classList.add('touch');
    const root = document.createElement('div'); root.id = 'touch'; this.root = root;
    root.innerHTML = `<div id="tLayer"></div><div id="tJoyBase"><div id="tJoyKnob"></div></div>` +
      BTN.map(([id, lbl, pos, sz]) => `<div class="tb${id.startsWith('tFire') ? ' fire' : ''}" id="${id}" style="${pos};width:${sz}px;height:${sz}px;line-height:${sz}px">${lbl}</div>`).join('') +
      `<div id="tTop">${TOP.map(([id, lbl]) => `<div class="tt" id="${id}">${lbl}</div>`).join('')}</div>`;
    document.getElementById('hud').appendChild(root);
    this.bind();
  }
  bind() {
    const g = this.g, inp = g.input, root = this.root;
    const base = document.getElementById('tJoyBase'), knob = document.getElementById('tJoyKnob');
    const R = 56;
    const press = (code) => { inp.pressed.add(code); };
    // ---- whole-screen gesture layer (look + joystick); buttons stop propagation ----
    const layer = document.getElementById('tLayer');
    layer.addEventListener('pointerdown', (e) => {
      if (!this.on || e.pointerType === 'mouse' || this.hud.screen !== 'game' || this.hud.anyOverlay()) return;
      if (e.target.closest('.tb,.tt,#slots,.pe')) return;
      g.audio.unlock();
      const leftSide = e.clientX < window.innerWidth * 0.42;
      if (leftSide && !this.joy) {
        this.joy = { id: e.pointerId, x0: e.clientX, y0: e.clientY };
        base.style.display = 'block'; base.style.left = e.clientX - 70 + 'px'; base.style.top = e.clientY - 70 + 'px'; knob.style.transform = 'translate(0px,0px)';
      } else this.look.set(e.pointerId, { x: e.clientX, y: e.clientY });
      e.preventDefault();
    }, { passive: false });
    const move = (e) => {
      if (this.joy && e.pointerId === this.joy.id) {
        let dx = e.clientX - this.joy.x0, dy = e.clientY - this.joy.y0; const d = Math.hypot(dx, dy);
        if (d > R) { dx = dx / d * R; dy = dy / d * R; }
        knob.style.transform = `translate(${dx}px,${dy}px)`;
        inp.joy.x = dx / R; inp.joy.y = -dy / R; inp.joy.active = true;
        inp.joy.sprint = d > R * 1.15 && -dy > Math.abs(dx);
      }
      const L = this.look.get(e.pointerId);
      if (L) {
        const k = 2.3 * (this.g.settings.touchSens || 1);
        inp.dx += (e.clientX - L.x) * k; inp.dy += (e.clientY - L.y) * k; L.x = e.clientX; L.y = e.clientY;
      }
    };
    const up = (e) => {
      if (this.joy && e.pointerId === this.joy.id) { this.joy = null; base.style.display = 'none'; inp.joy.x = inp.joy.y = 0; inp.joy.active = false; inp.joy.sprint = false; }
      this.look.delete(e.pointerId);
      if (this.fireIds.has(e.pointerId)) { this.fireIds.delete(e.pointerId); if (!this.fireIds.size) inp.mouseL = false; }
    };
    window.addEventListener('pointermove', (e) => { if (e.pointerType !== 'mouse') move(e); }, { passive: true });
    window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
    // ---- action buttons ----
    for (const [id, , , , act] of BTN) {
      const el = document.getElementById(id);
      el.addEventListener('pointerdown', (e) => {
        e.stopPropagation(); e.preventDefault(); g.audio.unlock();
        el.classList.add('down');
        if (act === 'fire') { this.fireIds.add(e.pointerId); inp.mouseL = true; inp.mouseLPressed = true; this.look.set(e.pointerId, { x: e.clientX, y: e.clientY }); }
        else if (act === 'ads') { this.ads = !this.ads; inp.mouseR = this.ads; el.classList.toggle('lit', this.ads); }
        else if (act === 'KeyJump') press('Space');
        else { press(act); inp.down.add(act); }
      }, { passive: false });
      const rel = (e) => { el.classList.remove('down'); if (act !== 'fire' && act !== 'ads' && act !== 'KeyJump') inp.down.delete(act); };
      el.addEventListener('pointerup', rel); el.addEventListener('pointercancel', rel); el.addEventListener('pointerleave', rel);
    }
    for (const [id, , code] of TOP) {
      const el = document.getElementById(id);
      el.addEventListener('pointerdown', (e) => {
        e.stopPropagation(); e.preventDefault(); g.audio.unlock();
        if (code === 'Tab') this.hud.toggleInventory();
        else if (code === 'KeyM') this.hud.toggleMap();
        else if (code === 'Escape') this.hud.openPause();
        else if (code === 'swap') { const me = g.me; const order = [0, 1, 2, -1]; let i = order.indexOf(me.held); for (let k = 0; k < 4; k++) { i = (i + 1) % 4; const s = order[i]; if (s === -1 || me.slots[s]) { g.equip(s); break; } } }
        else press(code);
      }, { passive: false });
    }
  }
  update() {
    if (!this.on) return;
    const g = this.g, me = g.me;
    const inGame = this.hud.screen === 'game' && !this.hud.anyOverlay();
    this.root.style.display = inGame ? 'block' : 'none';
    if (!inGame) return;
    const ground = me.st === 'ground' || me.st === 'swim' || me.st === 'down';
    const air = me.st === 'plane' || me.st === 'fall' || me.st === 'chute';
    const show = (id, v) => { const el = document.getElementById(id); if (el) el.style.display = v ? 'block' : 'none'; };
    show('tFire', ground && me.st !== 'down'); show('tFire2', ground && me.st !== 'down');
    show('tAds', me.st === 'ground' && !!g.heldWeapon()); show('tReload', me.st === 'ground' && !!g.heldWeapon());
    show('tJump', me.st === 'ground'); show('tCrouch', me.st === 'ground'); show('tProne', me.st === 'ground');
    const useEl = document.getElementById('tUse');
    const prompt = document.getElementById('prompt');
    const canUse = air || (prompt && prompt.style.display === 'block');
    useEl.style.display = canUse ? 'block' : 'none';
    useEl.textContent = me.st === 'plane' ? '낙하' : me.st === 'fall' ? '낙하산' : me.st === 'chute' ? '' : /부활/.test(prompt.textContent) ? '부활' : '줍기';
    if (me.st === 'chute') useEl.style.display = 'none';
    if (!g.heldWeapon() && this.ads) { this.ads = false; g.input.mouseR = false; document.getElementById('tAds').classList.remove('lit'); }
    document.getElementById('tCrouch').classList.toggle('lit', !!me.crouch); document.getElementById('tProne').classList.toggle('lit', !!me.prone);
  }
}
