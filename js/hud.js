// ===== LAST CIRCLE · HUD, menus, inventory, maps =====
import * as THREE from 'three';
import { WEAPONS, AMMO, ATTACH, ITEMS, itemInfo, itemWeight, PLAYER_COLORS, TEAM_COLORS, TOWNS } from './data.js';
import { fmtTime, escapeHtml, clamp } from './util.js';
import { planePos } from './match.js';

const $ = (id) => document.getElementById(id);
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const KIND_COL = { weapon: '#c9a46a', ammo: '#9fc46a', attach: '#7ac2e8', heal: '#f0f0f0', boost: '#7ab4f0', throw: '#9aa070', helm: '#a0a878', vest: '#8898a8', bag: '#a89878' };
const KIND_LBL = { ammo: 'AMMO', attach: 'ATT', heal: '+', boost: '⚡', throw: 'G', helm: 'H', vest: 'V', bag: 'B' };
const TEAMC = ['#ffcf3f', '#4fc3ff', '#6dff8a', '#ff7ad9'];
const _p = new THREE.Vector3();

export class Hud {
  constructor(game) {
    this.g = game; this.screen = 'loading';
    this.feedEls = []; this.bannerQ = []; this.fakeLock = false;
    this.map = { zoom: 1, cx: 0, cz: 0, drag: null };
    this.hpLagW = 100;
    this.buildCompass();
    this.bindMenu(); this.bindLobby(); this.bindOverlays(); this.bindMap();
    this.mini = $('minimap').getContext('2d');
    this.big = $('bigmap').getContext('2d');
    this.tags = {}; this.lastInvRefresh = 0;
    $('slots').addEventListener('pointerdown', (e) => { const el = e.target.closest('.slot'); if (!el || this.screen !== 'game') return; e.stopPropagation(); const i = +el.dataset.i; if (i === 3 && this.g.me.held === 3) { this.g.input.pressed.add('Digit5'); } else this.g.equip(i); });
    for (const id of ['inv', 'map']) { const b = document.createElement('button'); b.className = 'btn ovX'; b.textContent = '닫기 ✕'; b.onclick = () => (id === 'inv' ? this.toggleInventory(false) : this.toggleMap(false)); $(id).appendChild(b); }
  }
  // ---------- screens ----------
  showScreen(name) {
    this.screen = name;
    document.body.classList.toggle('ingame', name === 'game');
    for (const s of ['loading', 'menu', 'lobby', 'hud']) $(s).classList.toggle('on', s === name || (name === 'game' && s === 'hud'));
    if (name !== 'game') { this.closeAll(); if (document.pointerLockElement) document.exitPointerLock(); }
    if (name === 'menu') this.refreshMenu();
    if (name === 'game' && !this.touchMode) $('clickPlay').classList.add('on');
  }
  loading(p, txt) { $('loadBar').style.width = Math.round(p * 100) + '%'; $('loadTxt').textContent = txt; }
  captured() { return !!document.pointerLockElement || this.fakeLock || (this.touchMode && this.screen === 'game'); }
  anyOverlay() { return ['inv', 'map', 'pause', 'result', 'help'].some((id) => $(id).classList.contains('on')); }
  closeAll() { for (const id of ['inv', 'map', 'pause', 'result', 'help']) $(id).classList.remove('on'); }
  requestLock() {
    if (this.touchMode) { this.g.audio.unlock(); return; }
    const c = this.g.renderer.domElement;
    this.g.audio.unlock();
    try {
      const r = c.requestPointerLock({ unadjustedMovement: false });
      if (r && r.catch) r.catch(() => { this.fakeLock = true; this.onLockChange(); });
    } catch (e) { this.fakeLock = true; }
    setTimeout(() => { if (!document.pointerLockElement && this.screen === 'game' && !this.anyOverlay()) { this.fakeLock = true; this.onLockChange(); } }, 400);
  }
  releaseLock() { this.fakeLock = false; if (document.pointerLockElement) document.exitPointerLock(); }
  onLockChange() {
    const locked = this.captured();
    $('clickPlay').classList.toggle('on', this.screen === 'game' && !locked && !this.anyOverlay() && !this.touchMode);
    if (!document.pointerLockElement && !this.fakeLock && this.screen === 'game' && !this.anyOverlay() && this.wasLocked) this.openPause();
    this.wasLocked = locked;
  }

  // ---------- menu ----------
  bindMenu() {
    const S = this.g.settings;
    const sw = $('swatches');
    PLAYER_COLORS.forEach((c, i) => { const d = document.createElement('div'); d.className = 'sw'; d.style.background = hex(c); d.onclick = () => { S.color = i; this.g.saveSettings(); this.refreshMenu(); }; sw.appendChild(d); });
    $('nameIn').addEventListener('input', (e) => { S.name = e.target.value.replace(/[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202f\u2060-\u206f\ufeff]/g, '').trim().slice(0, 14) || '생존자'; this.g.saveSettings(); });
    $('nameIn').addEventListener('keydown', (e) => e.stopPropagation());
    $('codeIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('bJoin').click(); e.stopPropagation(); });
    $('bCreate').onclick = () => { this.g.audio.unlock(); this.g.app.createRoom(); };
    $('bJoin').onclick = () => { this.g.audio.unlock(); this.g.app.joinRoom($('codeIn').value); };
    $('bPractice').onclick = () => { this.g.audio.unlock(); this.g.app.practice({ nb: +$('pBots').value, df: +$('pDiff').value, sp: +$('pSpeed').value }); };
    $('bHelp').onclick = () => $('help').classList.add('on');
    $('bHelpClose').onclick = () => $('help').classList.remove('on');
    $('bSettings').onclick = () => this.openPause(true);
    $('bFull').onclick = () => { try { const d = document.documentElement; const r = d.requestFullscreen ? d.requestFullscreen({ navigationUI: 'hide' }) : d.webkitRequestFullscreen && d.webkitRequestFullscreen(); Promise.resolve(r).then(() => { try { screen.orientation.lock('landscape').catch(() => {}); } catch (e) {} }).catch(() => this.toast('이 환경에서는 전체화면을 쓸 수 없습니다')); } catch (e) {} };
  }
  refreshMenu() {
    const S = this.g.settings;
    $('nameIn').value = S.name;
    [...$('swatches').children].forEach((d, i) => d.classList.toggle('on', i === S.color));
  }
  netStatus(st, p2p) {
    const dot = $('netDot'), t = $('netTxt');
    const ok = st === 'ready' || st === 'connected';
    dot.className = 'dot ' + (ok ? 'ok' : st === 'offline' ? 'bad' : '');
    t.textContent = ok ? (p2p ? '멀티플레이 사용 가능 (P2P 직접 연결)' : '멀티플레이 사용 가능') : st === 'offline' ? (p2p ? '이 브라우저는 P2P 연결을 지원하지 않습니다 (연습 모드는 가능)' : '멀티플레이 확인 중…') : st === 'reconnecting' ? '재연결 중…' : st === 'error:relay' ? '연결 서버 응답 없음 — 잠시 후 다시 시도하세요' : st.startsWith('error') ? '연결 오류 — 새로고침 해주세요' : '연결 확인 중…';
    $('bCreate').disabled = $('bJoin').disabled = !ok;
    $('netWarn').style.display = st === 'reconnecting' ? 'block' : 'none';
  }
  // ---------- lobby ----------
  bindLobby() {
    const g = this.g;
    $('bCopy').onclick = () => { try { navigator.clipboard.writeText(g.code).then(() => this.lobbyToast('복사됨!'), () => this.lobbyToast('복사 실패 — 직접 입력해주세요')); } catch (e) { this.lobbyToast('복사 실패'); } };
    for (const [id, k] of [['sMode', 'mode'], ['sBots', 'nb'], ['sDiff', 'df'], ['sSpeed', 'sp']]) $(id).onchange = (e) => g.setLobbyCfg(k, +e.target.value);
    $('bStart').onclick = () => g.hostStart();
    $('bReady').onclick = () => { g.ready = !g.ready; g.sendNow(); this.updateLobby(); };
    $('bLeave').onclick = () => g.leaveRoom();
    $('chatIn').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { g.sendChat(e.target.value); e.target.value = ''; } });
  }
  lobbyToast(t) { this.chat('알림', t); }
  updateLobby() {
    const g = this.g; if (this.screen !== 'lobby') return;
    $('lCode').textContent = g.code || '-----';
    const peers = g.lobbyPeers(); const host = g.hostPeer(); const isHost = g.isHost;
    const hs = g.hostState() || g.g || {};
    const mode = hs.mode || 4;
    const teams = $('lTeams'); teams.innerHTML = '';
    const nT = mode === 1 ? 1 : 4;
    for (let t = 1; t <= nT; t++) {
      const list = mode === 1 ? peers : peers.filter((p) => p.team === t);
      const d = document.createElement('div'); d.className = 'team' + (mode > 1 && g.myTeamNum === t ? ' mine' : '');
      if (mode === 1) d.style.gridColumn = '1 / -1';
      d.innerHTML = `<h5><span style="color:${TEAMC[t - 1]}">${mode === 1 ? '참가자 (솔로)' : '팀 ' + t}</span><span class="num">${list.length}${mode > 1 ? '/' + mode : ''}</span></h5>` +
        list.map((p) => `<div class="pl"><span class="c" style="background:${hex(PLAYER_COLORS[p.color])}"></span>${escapeHtml(p.name)}${p.isMe ? ' <span style="color:var(--dim)">(나)</span>' : ''}${p.peer === host ? ' <span class="tag">방장</span>' : p.ready ? ' <span class="tag rd">준비</span>' : ''}${p.guest ? ' <span class="tag" style="background:rgba(255,255,255,.1);color:#ccc">게스트</span>' : ''}</div>`).join('') +
        (mode > 1 && g.myTeamNum !== t ? '<div class="hint" style="margin-top:6px">클릭해서 이 팀으로 이동</div>' : '');
      if (mode > 1) d.onclick = () => { g.myTeamNum = t; g.sendNow(); this.updateLobby(); };
      teams.appendChild(d);
    }
    for (const [id, k] of [['sMode', 'mode'], ['sBots', 'nb'], ['sDiff', 'df'], ['sSpeed', 'sp']]) { const el = $(id); el.disabled = !isHost; if (hs[k] !== undefined) el.value = String(hs[k]); }
    $('lHostTag').textContent = isHost ? '내가 방장' : '방장만 변경 가능';
    $('bStart').style.display = isHost ? '' : 'none';
    $('bReady').style.display = isHost ? 'none' : '';
    $('bReady').textContent = g.ready ? '준비 취소' : '준비';
    $('bReady').classList.toggle('pri', !g.ready);
    const allReady = peers.filter((p) => p.peer !== host).every((p) => p.ready);
    $('bStart').textContent = peers.length <= 1 ? '경기 시작 (봇과 함께)' : allReady ? '경기 시작' : '경기 시작 (준비 안 된 인원 있음)';
  }
  chat(name, text) {
    const el = $('lChat'); const d = document.createElement('div');
    d.innerHTML = `<b>${escapeHtml(name)}</b>  ${escapeHtml(text)}`; el.appendChild(d); el.scrollTop = el.scrollHeight;
    if (this.screen === 'game') this.feedText(`💬 ${name}: ${text}`);
  }

  // ---------- overlays ----------
  bindOverlays() {
    const g = this.g, S = g.settings;
    $('clickPlay').onclick = () => this.requestLock();
    $('bResume').onclick = () => { $('pause').classList.remove('on'); if (this.screen === 'game') this.requestLock(); };
    $('bQuit').onclick = () => { $('pause').classList.remove('on'); g.app.quitMatch(); };
    const bindR = (id, key, fmt, apply) => { const el = $(id); el.value = S[key]; $(id + 'V').textContent = fmt(S[key]); el.oninput = () => { S[key] = +el.value; $(id + 'V').textContent = fmt(S[key]); apply && apply(); g.saveSettings(); }; };
    bindR('oSens', 'sens', (v) => v.toFixed(2));
    bindR('oAds', 'adsSens', (v) => v.toFixed(2));
    bindR('oFov', 'fov', (v) => v | 0);
    bindR('oVol', 'vol', (v) => Math.round(v * 100), () => g.audio.setVolume(S.vol));
    if (S.touchSens == null) S.touchSens = 1; bindR('oTouch', 'touchSens', (v) => v.toFixed(2));
    $('oQ').value = S.quality; $('oQ').onchange = (e) => { S.quality = e.target.value; g.saveSettings(); g.app.applyQuality(); };
    $('oInv').checked = !!S.invertY; $('oInv').onchange = (e) => { S.invertY = e.target.checked; g.saveSettings(); };
    $('oFps').checked = !!S.showFps; $('oFps').onchange = (e) => { S.showFps = e.target.checked; g.saveSettings(); $('fps').style.display = S.showFps ? 'block' : 'none'; };
    $('bSpec').onclick = () => { $('result').classList.remove('on'); this.requestLock(); };
    $('bLobby').onclick = () => g.app.resultLobby();
    $('inv').addEventListener('contextmenu', (e) => e.preventDefault());
  }
  openPause(fromMenu) {
    $('pause').classList.add('on');
    $('bQuit').style.display = fromMenu ? 'none' : '';
    $('bQuit').textContent = this.g.offline ? '메뉴로 나가기' : '방 나가기';
    $('bResume').textContent = fromMenu ? '닫기' : '계속하기';
    this.pauseFromMenu = fromMenu;
    $('bResume').onclick = () => { $('pause').classList.remove('on'); if (!fromMenu && this.screen === 'game') this.requestLock(); };
  }
  toggleInventory(force) {
    const el = $('inv'); const on = force ?? !el.classList.contains('on');
    if (on && this.anyOverlay() && !el.classList.contains('on')) return;
    el.classList.toggle('on', on);
    if (on) { this.releaseLock(); this.refreshInventory(true); } else this.requestLock();
  }
  toggleMap(force) {
    const el = $('map'); const on = force ?? !el.classList.contains('on');
    if (on && this.anyOverlay() && !el.classList.contains('on')) return;
    el.classList.toggle('on', on);
    if (on) { this.releaseLock(); const me = this.g.me; this.map.cx = me.pos.x; this.map.cz = me.pos.z; this.map.zoom = 1; this.fitMap(); } else this.requestLock();
  }
  fitMap() { const c = $('bigmap'); const s = Math.min(window.innerWidth, window.innerHeight) * 0.9; c.style.width = c.style.height = s + 'px'; }
  handleEsc() {
    if ($('inv').classList.contains('on')) { this.toggleInventory(false); return true; }
    if ($('map').classList.contains('on')) { this.toggleMap(false); return true; }
    if ($('help').classList.contains('on')) { $('help').classList.remove('on'); return true; }
    if ($('pause').classList.contains('on')) { $('pause').classList.remove('on'); if (this.screen === 'game' && !this.pauseFromMenu) this.requestLock(); return true; }
    if (this.screen === 'game' && this.fakeLock) { this.fakeLock = false; this.openPause(); return true; }
    return false;
  }

  // ---------- match notifications ----------
  onMatchStart() {
    $('feed').innerHTML = ''; $('banner').innerHTML = ''; $('toasts').innerHTML = ''; $('result').classList.remove('on');
    this.banner('비행기 탑승 · [F]로 원하는 위치에 낙하하세요', 'info');
    this.resultShown = false;
  }
  banner(text, kind = 'info') {
    const b = $('banner'); const d = document.createElement('div'); d.className = 'bn ' + kind; d.textContent = text; b.appendChild(d);
    while (b.children.length > 2) b.firstChild.remove();
    setTimeout(() => d.remove(), 4200);
  }
  bigNotice(text, kind) { const el = $('big'); el.textContent = text; el.className = kind; el.style.opacity = 1; clearTimeout(this.bigT); this.bigT = setTimeout(() => (el.style.opacity = 0), 2200); }
  toast(text, kind) {
    const t = $('toasts'); const d = document.createElement('div'); d.className = 'toast ' + (kind || ''); d.textContent = text; t.appendChild(d);
    while (t.children.length > 4) t.firstChild.remove(); setTimeout(() => d.remove(), 2200);
  }
  feedText(text) { const f = $('feed'); const d = document.createElement('div'); d.className = 'fe'; d.textContent = text; f.appendChild(d); while (f.children.length > 6) f.firstChild.remove(); setTimeout(() => d.remove(), 7000); }
  killFeed(k) {
    const f = $('feed'); const d = document.createElement('div');
    d.className = 'fe' + (k.mine ? ' mine' : k.team || k.meV ? ' team' : '');
    const verb = k.kind === 1 ? '기절' : '처치';
    if (k.special) d.innerHTML = `${escapeHtml(k.victim)}<span class="w">${k.special}에 의해 사망</span>`;
    else if (!k.killer) d.innerHTML = `${escapeHtml(k.victim)}<span class="w">사망</span>`;
    else d.innerHTML = `${escapeHtml(k.killer)}<span class="w">${k.head ? '<span class="hd">헤드샷</span> · ' : ''}${escapeHtml(k.weapon || '')} ${verb}</span>${escapeHtml(k.victim)}`;
    f.appendChild(d); while (f.children.length > 6) f.firstChild.remove(); setTimeout(() => d.remove(), 7000);
  }
  hitMarker(kind, kill) {
    const el = $('hitm'); el.className = kill ? 'kill' : kind === 'head' ? 'head' : '';
    el.style.transition = 'none'; el.style.opacity = 1; el.style.transform = 'scale(1.25)';
    requestAnimationFrame(() => { el.style.transition = 'opacity .35s, transform .2s'; el.style.opacity = 0; el.style.transform = 'scale(1)'; });
  }
  damageDir(ang) {
    const d = document.createElement('div'); d.className = 'dd'; d.style.transform = `rotate(${-ang}rad)`;
    $('dirs').appendChild(d); requestAnimationFrame(() => (d.style.opacity = 0)); setTimeout(() => d.remove(), 1300);
  }
  flashDamage(k) { const el = $('dmg'); el.style.transition = 'none'; el.style.boxShadow = `inset 0 0 160px rgba(200,0,0,${0.25 + k * 0.5})`; requestAnimationFrame(() => { el.style.transition = 'box-shadow .7s'; el.style.boxShadow = 'inset 0 0 160px rgba(200,0,0,0)'; }); }
  recoilPulse() { this.spreadPulse = 1; }
  prompt(t) { const el = $('prompt'); if (t) { el.textContent = t; el.style.display = 'block'; } else el.style.display = 'none'; }
  spectating(name, team) { const el = $('specInfo'); el.style.display = 'block'; el.innerHTML = name ? `관전 중: <b style="color:${team ? 'var(--acc)' : '#fff'}">${escapeHtml(name)}</b> · 좌클릭: 다음 플레이어` : '관전할 플레이어가 없습니다'; }
  showResult(r) {
    const g = this.g;
    $('rRank').textContent = r.rank; $('rK').textContent = r.kills; $('rD').textContent = r.dmg; $('rT').textContent = fmtTime(r.time);
    const t = $('rTitle'); t.textContent = r.won ? '승리! 최후의 생존자' : r.final ? '경기 종료' : '탈락';
    t.className = r.won ? 'win' : '';
    $('rSub').textContent = r.won ? '마지막 원 안에 끝까지 남았습니다' : r.killer ? `처치한 상대: ${r.killer}` : '';
    const ended = g.match && g.match.ended;
    $('bSpec').style.display = !ended && r.canSpectate ? '' : 'none';
    const bl = $('bLobby');
    if (g.offline) { bl.textContent = '메뉴로'; bl.disabled = false; }
    else if (g.isHost) { bl.textContent = ended ? '로비로 (전원)' : '경기 끝나면 로비로'; bl.disabled = !ended; }
    else { bl.textContent = ended ? '방장이 로비로 이동하면 자동 이동' : '경기 종료까지 관전'; bl.disabled = true; }
    $('result').classList.add('on'); this.releaseLock();
    this.resultShown = true;
  }

  // ---------- compass ----------
  buildCompass() {
    const s = $('compassStrip'); const PX = 4; let html = '';
    for (let rep = 0; rep < 3; rep++) for (let d = 0; d < 360; d += 5) {
      const x = (rep * 360 + d) * PX;
      const big = d % 15 === 0;
      html += `<i class="ctick" style="left:${x}px;height:${big ? 10 : 5}px"></i>`;
      if (d % 15 === 0) { const card = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' }[d]; html += `<span class="clab ${card && card.length === 1 ? 'card' : ''}" style="left:${x}px">${card || d}</span>`; }
    }
    s.innerHTML = html; this.compassPX = PX;
    this.cmarks = document.createElement('div'); this.cmarks.style.cssText = 'position:absolute;inset:0'; $('compass').appendChild(this.cmarks);
  }
  bearing(yaw) { return ((180 - (yaw * 180) / Math.PI) % 360 + 360) % 360; }
  bearingTo(dx, dz) { return this.bearing(Math.atan2(dx, dz)); }

  // ---------- inventory ----------
  refreshInventory(force) {
    if (!$('inv').classList.contains('on')) return;
    if (this.drag && this.drag.active) return; // don't rebuild under the finger
    const g = this.g, me = g.me;
    this.srcs = [];
    const S = (o) => { this.srcs.push(o); return this.srcs.length - 1; };
    const icon = (type, kind) => {
      const info = itemInfo(type); const k = kind || info.kind;
      const lbl = k === 'weapon' ? WEAPONS[type].cat : k === 'ammo' ? AMMO[type].name.replace(/mm| 게이지| ACP| 매그넘/g, '') : KIND_LBL[k] || '?';
      const col = k === 'ammo' ? hex(AMMO[type].color) : KIND_COL[k] || '#888';
      return `<span class="ic" style="background:${col}">${lbl}</span>`;
    };
    // near
    const near = g.nearbyItems(me.pos, 3.2);
    $('invNearN').textContent = near.length ? near.length + '개' : '';
    const nEl = $('invNear'); nEl.dataset.drop = 'near';
    nEl.innerHTML = near.length ? '' : '<div class="hint">주변에 아이템이 없습니다<br>가방·장비를 여기로 끌어 놓으면 버립니다</div>';
    near.slice(0, 40).forEach((n) => {
      const info = itemInfo(n.it.type);
      const d = document.createElement('div'); d.className = 'it'; d.dataset.src = S({ from: 'near', n, type: n.it.type });
      d.innerHTML = `${icon(n.it.type)}<span>${escapeHtml(info.name)}<span class="sub">${n.crate ? (n.crate.kind === 'care' ? '보급 상자' : escapeHtml(n.crate.owner || '') + ' 의 상자') : '바닥'}${itemWeight(n.it.type, n.it.qty) ? ' · 무게 ' + itemWeight(n.it.type, n.it.qty).toFixed(1) : ''}</span></span><span class="q">${n.it.qty > 1 ? n.it.qty : ''}</span>`;
      nEl.appendChild(d);
    });
    // bag
    const cap = g.capacity(), load = g.load();
    $('invCapT').textContent = `${Math.round(load)} / ${cap}`; $('invCap').style.width = Math.min(100, (load / cap) * 100) + '%';
    const bEl = $('invBag'); bEl.innerHTML = ''; bEl.parentElement.dataset.drop = 'bag';
    const order = ['ammo', 'heal', 'boost', 'throw', 'attach'];
    const keys = Object.keys(me.inv).sort((a, b) => order.indexOf(itemInfo(a).kind) - order.indexOf(itemInfo(b).kind));
    if (!keys.length) bEl.innerHTML = '<div class="hint">가방이 비어 있습니다<br>주변 아이템을 여기로 끌어 오세요</div>';
    for (const k of keys) {
      const info = itemInfo(k); const q = me.inv[k];
      const d = document.createElement('div'); d.className = 'it'; d.dataset.src = S({ from: 'bag', type: k, qty: q });
      const act = info.kind === 'heal' || info.kind === 'boost' ? '탭: 사용' : info.kind === 'attach' ? '총으로 끌어서 장착' : info.kind === 'throw' ? '탭: 들기' : '';
      d.innerHTML = `${icon(k)}<span>${escapeHtml(info.name)}<span class="sub">${act}${act ? ' · ' : ''}주변으로 끌면 버림</span></span><span class="q">${q}</span>`;
      bEl.appendChild(d);
    }
    // equipment
    const eq = $('invEq'); eq.innerHTML = '';
    const gear = [['helm', '헬멧', me.helm && ITEMS[me.helm.type], me.helm && me.helm.dur], ['vest', '방탄복', me.vest && ITEMS[me.vest.type], me.vest && me.vest.dur], ['bag', '배낭', me.bag && ITEMS[me.bag], null]];
    for (const [k, nm, it, dur] of gear) {
      const d = document.createElement('div'); d.className = 'eq'; d.dataset.drop = 'gear'; d.dataset.kind = k;
      if (it) d.dataset.src = S({ from: 'gear', kind: k, type: k === 'bag' ? me.bag : me[k].type });
      d.innerHTML = it ? `<b>${nm} Lv.${it.lvl}</b>${dur != null ? '내구도 ' + Math.max(0, Math.round((dur / it.dur) * 100)) + '%' : '용량 ' + it.cap}` : `<b style="color:var(--dim)">${nm}</b>없음`;
      eq.appendChild(d);
    }
    const wEl = $('invW'); wEl.innerHTML = '';
    const SL = { s: '조준경', m: '총구', g: '손잡이', x: '탄창' };
    ['주무기 1', '주무기 2', '권총'].forEach((nm, i) => {
      const w = me.slots[i]; const d = document.createElement('div'); d.className = 'wcard' + (me.held === i ? ' on' : ''); d.dataset.drop = 'weapon'; d.dataset.slot = i;
      if (!w) { d.innerHTML = `<div class="wt">${nm}<span>비어 있음 · 총을 끌어 놓으세요</span></div>`; wEl.appendChild(d); return; }
      d.dataset.src = S({ from: 'weapon', slot: i, type: w.id });
      const def = WEAPONS[w.id]; const st = g.wstats(w);
      d.innerHTML = `<div class="wt">${escapeHtml(def.name)}<span>${i + 1} · ${def.cat} · ${AMMO[def.ammo].name} · ${w.mag}/${st.mag}</span></div><div class="atts">${['s', 'm', 'g', 'x'].map((sl) => { const has = w.att[sl]; const ok = def.slots.includes(sl); const src = has ? ` data-src="${S({ from: 'att', slot: i, aslot: sl, type: has })}"` : ''; return `<div class="att ${has ? 'has' : ''} ${ok ? '' : 'na'}" ${ok ? `data-drop="att" data-slot="${i}" data-a="${sl}"` : ''}${src}>${has ? escapeHtml(ATTACH[has].name) : SL[sl]}</div>`; }).join('')}</div><div class="hint" style="margin-top:6px">탭: 들기 · 끌어서 다른 칸과 교체 · 주변으로 끌면 버림</div>`;
      wEl.appendChild(d);
    });
    this.bindInvDrag();
  }
  // ---------- inventory drag & drop (mouse + touch via pointer events) ----------
  bindInvDrag() {
    if (this.invDragBound) return; this.invDragBound = true;
    const root = $('inv');
    root.addEventListener('pointerdown', (e) => {
      if (e.button === 2) return;
      const el = e.target.closest('[data-src]'); if (!el) return;
      const src = this.srcs[+el.dataset.src]; if (!src) return;
      this.drag = { src, el, x0: e.clientX, y0: e.clientY, id: e.pointerId, active: false, ghost: null };
      if (e.pointerType === 'mouse') e.preventDefault();
    });
    window.addEventListener('pointermove', (e) => {
      const d = this.drag; if (!d || e.pointerId !== d.id) return;
      if (!d.active && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 7) {
        d.active = true;
        const gh = d.el.cloneNode(true); gh.classList.add('dragGhost'); gh.style.width = Math.min(260, d.el.offsetWidth) + 'px'; document.body.appendChild(gh); d.ghost = gh;
        root.querySelectorAll('[data-drop]').forEach((t) => { if (this.canDrop(d.src, t)) t.classList.add('dropOk'); });
      }
      if (d.active) {
        d.ghost.style.left = e.clientX + 'px'; d.ghost.style.top = e.clientY + 'px';
        const t = this.dropTargetAt(e.clientX, e.clientY);
        root.querySelectorAll('.dropHot').forEach((x) => x !== t && x.classList.remove('dropHot'));
        if (t && this.canDrop(d.src, t)) t.classList.add('dropHot');
      }
    });
    const finish = (e) => {
      const d = this.drag; if (!d || e.pointerId !== d.id) return;
      this.drag = null;
      root.querySelectorAll('.dropOk,.dropHot').forEach((x) => x.classList.remove('dropOk', 'dropHot'));
      if (d.ghost) d.ghost.remove();
      if (e.type === 'pointercancel') return;
      if (d.active) { const t = this.dropTargetAt(e.clientX, e.clientY); if (t && this.canDrop(d.src, t)) this.doDrop(d.src, t); }
      else this.clickSrc(d.src);
      this.refreshInventory();
    };
    window.addEventListener('pointerup', finish); window.addEventListener('pointercancel', finish);
    root.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const el = e.target.closest('[data-src]'); if (!el) return; const src = this.srcs[+el.dataset.src]; if (!src) return;
      this.doDrop(src, { dataset: { drop: 'near' } }, e.shiftKey); this.refreshInventory();
    });
  }
  dropTargetAt(x, y) {
    const el = document.elementFromPoint(x, y); if (!el) return null;
    return el.closest('[data-drop]');
  }
  canDrop(src, t) {
    const drop = t.dataset.drop, g = this.g, me = g.me;
    const info = itemInfo(src.type); const kind = info.kind;
    switch (drop) {
      case 'near': return src.from !== 'near';
      case 'bag': return (src.from === 'near' && kind !== 'weapon' && !['helm', 'vest', 'bag'].includes(kind)) || src.from === 'att';
      case 'gear': return src.from === 'near' && kind === t.dataset.kind;
      case 'weapon': {
        const slot = +t.dataset.slot;
        if (kind === 'weapon' && src.from === 'near') return slot === 2 ? WEAPONS[src.type].cat === 'PST' : WEAPONS[src.type].cat !== 'PST';
        if (src.from === 'weapon') return src.slot !== slot && src.slot < 2 && slot < 2;
        if (kind === 'attach' && (src.from === 'bag' || src.from === 'near' || src.from === 'att')) { const w = me.slots[slot]; return !!w && WEAPONS[w.id].slots.includes(ATTACH[src.type].slot) && !(src.from === 'att' && src.slot === slot); }
        return false;
      }
      case 'att': {
        if (kind !== 'attach' || !(src.from === 'bag' || src.from === 'near' || src.from === 'att')) return false;
        if (ATTACH[src.type].slot !== t.dataset.a) return false;
        return !(src.from === 'att' && src.slot === +t.dataset.slot);
      }
    }
    return false;
  }
  doDrop(src, t, half) {
    const g = this.g, me = g.me; const drop = t.dataset.drop;
    if (drop === 'near') {
      if (src.from === 'bag') g.dropInv(src.type, half ? Math.ceil(src.qty / 2) : src.qty);
      else if (src.from === 'gear') g.dropGear(src.kind);
      else if (src.from === 'weapon') g.dropWeapon(src.slot);
      else if (src.from === 'att') { const w = me.slots[src.slot]; if (w && w.att[src.aslot]) { const ty = w.att[src.aslot]; w.att[src.aslot] = null; g.dropItem(ty, 1, me.pos.x, me.pos.y, me.pos.z); } }
      g.audio.ui('click'); return;
    }
    if (drop === 'bag') { if (src.from === 'near') g.pickup(src.n); else if (src.from === 'att') g.detach(src.slot, src.aslot); return; }
    if (drop === 'gear') { g.pickup(src.n); return; }
    if (drop === 'weapon' || drop === 'att') {
      const slot = +t.dataset.slot;
      if (src.from === 'near' && itemInfo(src.type).kind === 'weapon') { g.pickupToSlot(src.n, slot); return; }
      if (src.from === 'weapon') { g.swapSlots(src.slot, slot); return; }
      if (itemInfo(src.type).kind === 'attach') { g.attachTo(src, slot); return; }
    }
  }
  clickSrc(src) {
    const g = this.g, me = g.me; const kind = itemInfo(src.type).kind;
    if (src.from === 'near') { g.pickup(src.n); return; }
    if (src.from === 'weapon') { g.equip(src.slot); return; }
    if (src.from === 'att') { g.detach(src.slot, src.aslot); return; }
    if (src.from === 'bag') {
      const k = src.type;
      if (kind === 'heal' || kind === 'boost') { g.useItem(k); this.toggleInventory(false); }
      else if (kind === 'attach') { const order = [me.held, 0, 1, 2].filter((i) => i >= 0 && i <= 2); let ok = false; for (const i of order) { const w = me.slots[i]; if (w && WEAPONS[w.id].slots.includes(ATTACH[k].slot) && !w.att[ATTACH[k].slot]) { ok = g.attachFromInv(k, i); break; } } if (!ok) for (const i of order) if (g.attachFromInv(k, i)) { ok = true; break; } if (!ok) this.toast('장착할 수 있는 무기가 없습니다', 'warn'); }
      else if (kind === 'throw') { me.throwSel = k; g.equip(3); this.toggleInventory(false); }
    }
  }

  // ---------- map ----------
  bindMap() {
    const c = $('bigmap'); c.style.touchAction = 'none';
    const ptrs = new Map(); let pinch = null, lastTap = 0;
    c.addEventListener('wheel', (e) => { e.preventDefault(); this.zoomAt(e, e.deltaY < 0 ? 1.2 : 1 / 1.2); }, { passive: false });
    c.addEventListener('pointerdown', (e) => {
      if (e.button === 2) return;
      c.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 1) this.map.drag = { x: e.clientX, y: e.clientY, cx: this.map.cx, cz: this.map.cz, moved: false };
      if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: this.map.zoom }; this.map.drag = null; }
    });
    c.addEventListener('pointermove', (e) => {
      if (!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && ptrs.size >= 2) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); const mid = { clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 }; this.zoomAt(mid, (pinch.z * d / pinch.d) / this.map.zoom); return; }
      const d = this.map.drag; if (!d) return; const r = c.getBoundingClientRect(); const mpp = 2000 / this.map.zoom / r.width;
      this.map.cx = d.cx - (e.clientX - d.x) * mpp; this.map.cz = d.cz - (e.clientY - d.y) * mpp; if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 6) d.moved = true;
    });
    const end = (e) => {
      if (!ptrs.has(e.pointerId)) return; ptrs.delete(e.pointerId);
      if (ptrs.size < 2) pinch = null;
      const d = this.map.drag; this.map.drag = null;
      if (d && !d.moved && ptrs.size === 0) { const now = performance.now(); if (now - lastTap < 350) { this.setMarker(e); lastTap = 0; } else lastTap = now; }
    };
    c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
    c.addEventListener('contextmenu', (e) => { e.preventDefault(); this.setMarker(e); });
    window.addEventListener('resize', () => this.fitMap());
  }
  zoomAt(e, f) { const w = this.screenToWorld(e); this.map.zoom = clamp(this.map.zoom * f, 1, 8); const w2 = this.screenToWorld(e); this.map.cx += w[0] - w2[0]; this.map.cz += w[1] - w2[1]; }
  setMarker(e) {
    const w = this.screenToWorld(e); const me = this.g.me;
    if (me.marker && Math.hypot(me.marker[0] - w[0], me.marker[1] - w[1]) < 30 / this.map.zoom) me.marker = null; else me.marker = w;
    this.g.audio.ui('click');
  }
  screenToWorld(e) {
    const c = $('bigmap'); const r = c.getBoundingClientRect();
    const u = (e.clientX - r.left) / r.width, v = (e.clientY - r.top) / r.height;
    const span = 2000 / this.map.zoom; const x0 = this.mapX0(), z0 = this.mapZ0();
    return [x0 + u * span, z0 + v * span];
  }
  mapX0() { const span = 2000 / this.map.zoom; this.map.cx = clamp(this.map.cx, -1000 + span / 2, 1000 - span / 2); return this.map.cx - span / 2; }
  mapZ0() { const span = 2000 / this.map.zoom; this.map.cz = clamp(this.map.cz, -1000 + span / 2, 1000 - span / 2); return this.map.cz - span / 2; }
  drawMapLayer(ctx, size, x0, z0, span, opts) {
    const g = this.g, W = g.world, m = g.match, me = g.me;
    const k = size / span; const X = (x) => (x - x0) * k, Z = (z) => (z - z0) * k;
    const px = 1024 / 2000;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(W.mapCanvas, (x0 + 1000) * px, (z0 + 1000) * px, span * px, span * px, 0, 0, size, size);
    if (opts.grid) {
      ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1; ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = `600 ${Math.round(size / 55)}px Rajdhani, sans-serif`;
      for (let i = 0; i <= 8; i++) { const v = -1000 + i * 250; ctx.beginPath(); ctx.moveTo(X(v), 0); ctx.lineTo(X(v), size); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, Z(v)); ctx.lineTo(size, Z(v)); ctx.stroke(); }
      for (let i = 0; i < 8; i++) { ctx.fillText('ABCDEFGH'[i], X(-1000 + i * 250 + 8), Math.max(14, Z(-1000) + 18)); ctx.fillText(String(i + 1), Math.max(4, X(-1000) + 6), Z(-1000 + i * 250 + 26)); }
      ctx.textAlign = 'center';
      for (const t of TOWNS) { const fs = Math.round(size / (t.style === 'village' ? 70 : 58)); ctx.font = `700 ${fs}px "Noto Sans KR", sans-serif`; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.65)'; ctx.strokeText(t.name, X(t.x), Z(t.z)); ctx.fillStyle = '#fff'; ctx.fillText(t.name, X(t.x), Z(t.z)); }
      ctx.textAlign = 'left';
    }
    if (!m) return;
    const zn = m.zoneNow;
    if (zn) {
      // blue outside tint
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, size, size); ctx.arc(X(zn.bc[0]), Z(zn.bc[1]), Math.max(0, zn.br * k), 0, Math.PI * 2, true); ctx.fillStyle = 'rgba(40,80,230,0.32)'; ctx.fill('evenodd'); ctx.restore();
      ctx.strokeStyle = 'rgba(90,150,255,0.95)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(X(zn.bc[0]), Z(zn.bc[1]), Math.max(0, zn.br * k), 0, Math.PI * 2); ctx.stroke();
      if (zn.wc) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(X(zn.wc[0]), Z(zn.wc[1]), Math.max(1, zn.wr * k), 0, Math.PI * 2); ctx.stroke(); }
      if (zn.wc && (me.st !== 'dead' && me.st !== 'spec')) { // run line
        const dx = me.pos.x - zn.wc[0], dz = me.pos.z - zn.wc[1], d = Math.hypot(dx, dz);
        if (d > zn.wr) { ctx.setLineDash([6, 6]); ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(X(me.pos.x), Z(me.pos.z)); ctx.lineTo(X(zn.wc[0] + dx / d * zn.wr), Z(zn.wc[1] + dz / d * zn.wr)); ctx.stroke(); ctx.setLineDash([]); }
      }
    }
    // plane path
    if (m.t < m.plane.dur + 2) {
      ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.setLineDash([10, 8]); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(X(m.plane.sx), Z(m.plane.sz)); ctx.lineTo(X(m.plane.ex), Z(m.plane.ez)); ctx.stroke(); ctx.setLineDash([]);
      const P = planePos(m.plane, m.t); this.drawArrow(ctx, X(P[0]), Z(P[2]), Math.atan2(m.plane.dx, m.plane.dz), '#fff', size / 70);
    }
    // care packages
    for (const c of m.care) if (c.state !== 'wait') { const cr = g.crates.get(c.id); const left = cr && cr.items.some((i) => !i.taken); if (!left) continue; ctx.fillStyle = '#3a78e8'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; const s = size / 90; ctx.fillRect(X(c.x) - s, Z(c.z) - s, s * 2, s * 2); ctx.strokeRect(X(c.x) - s, Z(c.z) - s, s * 2, s * 2); }
    // markers
    const marks = [];
    if (me.marker) marks.push([me.marker, g.myTeamNum, true]);
    for (const a of g.actors.values()) if (!a.isBot && a.team === g.myTeam && a.mk) marks.push([a.mk, (this.teamIdx(a) || 0) + 1]);
    for (const [mk, ci] of marks) { ctx.fillStyle = TEAMC[(ci - 1) % 4]; ctx.beginPath(); const s = size / 110; ctx.moveTo(X(mk[0]), Z(mk[1])); ctx.arc(X(mk[0]), Z(mk[1]) - s * 2, s, Math.PI * 0.8, Math.PI * 2.2); ctx.closePath(); ctx.fill(); }
    // teammates
    for (const a of g.actors.values()) if (!a.isBot && a.team === g.myTeam && a.alive && g.match.mode > 1) { ctx.fillStyle = a.st === 'down' ? '#ff4d4d' : TEAMC[this.teamIdx(a) % 4]; ctx.beginPath(); ctx.arc(X(a.pos.x), Z(a.pos.z), size / 120, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke(); }
    // me
    if (me.st !== 'dead' && me.st !== 'spec') this.drawArrow(ctx, X(me.pos.x), Z(me.pos.z), me.yaw, '#ffb547', size / (opts.grid ? 70 : 28));
  }
  teamIdx(a) { return this.g.match && this.g.match.mode > 1 ? 1 + ([...this.g.actors.values()].filter((x) => !x.isBot && x.team === this.g.myTeam).indexOf(a)) : 0; }
  drawArrow(ctx, x, y, yaw, col, s) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI - yaw);
    ctx.beginPath(); ctx.moveTo(0, -s * 1.3); ctx.lineTo(s * 0.85, s * 0.9); ctx.lineTo(0, s * 0.4); ctx.lineTo(-s * 0.85, s * 0.9); ctx.closePath();
    ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore();
  }

  // ---------- per-frame ----------
  update(dt) {
    if (this.screen !== 'game') return;
    const g = this.g, me = g.me, m = g.match; if (!m) return;
    // compass
    const yaw = g.camYaw ?? me.yaw;
    const br = this.bearing(yaw);
    $('compassStrip').style.transform = `translateX(${260 - (360 + br) * this.compassPX}px)`;
    $('bearing').textContent = Math.round(br) % 360;
    // compass markers
    let mh = '';
    const addMark = (x, z, col) => { let d = this.bearingTo(x - me.pos.x, z - me.pos.z) - br; d = ((d + 540) % 360) - 180; if (Math.abs(d) < 65) mh += `<i class="cmark" style="left:${260 + d * this.compassPX}px;background:${col}"></i>`; };
    if (me.marker) addMark(me.marker[0], me.marker[1], TEAMC[(g.myTeamNum - 1) % 4]);
    for (const a of g.actors.values()) if (!a.isBot && a.team === g.myTeam && m.mode > 1) { if (a.alive) addMark(a.pos.x, a.pos.z, a.st === 'down' ? '#ff4d4d' : TEAMC[this.teamIdx(a) % 4]); if (a.mk) addMark(a.mk[0], a.mk[1], TEAMC[this.teamIdx(a) % 4]); }
    this.cmarks.innerHTML = mh;
    // counts
    $('cAlive').textContent = g.aliveCount(); $('cKills').textContent = me.kills;
    // zone
    const zn = m.zoneNow;
    if (zn) {
      const zi = $('zoneInfo'); zi.classList.toggle('shr', zn.shrinking);
      $('zoneLbl').textContent = zn.pre ? '자기장 공개까지' : zn.final ? '최종 자기장' : zn.shrinking ? '자기장 축소 중' : '자기장 축소까지';
      $('zoneT').textContent = fmtTime(zn.timeTo);
      const ph = m.zones[Math.max(0, zn.phase - 1)];
      $('zoneBarI').style.width = (zn.shrinking ? ((ph.tEnd - m.t) / (ph.tEnd - ph.tShrink)) * 100 : 100) + '%';
      const alive = me.st !== 'dead' && me.st !== 'spec';
      const rt = $('runTip');
      if (alive && zn.wc && me.st !== 'plane') {
        const d = Math.hypot(me.pos.x - zn.wc[0], me.pos.z - zn.wc[1]) - zn.wr;
        if (d > 0) { rt.style.display = 'block'; rt.textContent = `안전구역까지 ${Math.round(d)}m · 도보 약 ${fmtTime(d / 6.2)}`; } else rt.style.display = 'none';
      } else rt.style.display = 'none';
      $('zoneVig').style.opacity = alive && me.outside && me.st !== 'plane' ? 1 : 0;
    }
    // minimap
    this.drawMini();
    if ($('map').classList.contains('on')) { const span = 2000 / this.map.zoom; this.big.clearRect(0, 0, 1600, 1600); this.drawMapLayer(this.big, 1600, this.mapX0(), this.mapZ0(), span, { grid: true }); }
    // HP / boost / gear
    const hpW = me.st === 'down' ? me.kh : me.hp;
    $('hpFill').style.width = clamp(hpW, 0, 100) + '%';
    if (hpW < this.hpLagW - 0.5 || hpW > this.hpLagW) { this.hpLagW = hpW; $('hpLag').style.width = clamp(hpW, 0, 100) + '%'; }
    $('hpNum').textContent = Math.ceil(clamp(hpW, 0, 100));
    $('hpWrap').classList.toggle('low', me.hp < 30 && me.st !== 'down'); $('hpWrap').classList.toggle('kn', me.st === 'down');
    if (!this.boostEls) { const b = $('boost'); for (let i = 0; i < 4; i++) b.appendChild(document.createElement('i')); this.boostEls = [...b.children]; }
    this.boostEls.forEach((e, i) => e.classList.toggle('on', me.boost > [0, 20, 60, 90][i]));
    const gearHtml = [['헬멧', me.helm, (h) => ITEMS[h.type].lvl, (h) => h.dur / ITEMS[h.type].dur], ['조끼', me.vest, (h) => ITEMS[h.type].lvl, (h) => h.dur / ITEMS[h.type].dur], ['배낭', me.bag, (h) => ITEMS[h].lvl, () => 1]]
      .map(([n, v, lv, du]) => `<div class="gi ${v ? '' : 'off'}">${n}<b>${v ? lv(v) : '-'}</b>${v ? `<div class="du"><i style="width:${Math.max(0, du(v) * 100)}%"></i></div>` : ''}</div>`).join('');
    if (gearHtml !== this.lastGear) { $('gear').innerHTML = gearHtml; this.lastGear = gearHtml; }
    // weapon panel
    const held = g.heldWeapon();
    const slotHtml = [0, 1, 2].map((i) => { const w = me.slots[i]; return w ? `<div class="slot pe ${me.held === i ? 'on' : ''}" data-i="${i}"><span class="k">${i + 1}</span>${escapeHtml(WEAPONS[w.id].name)}</div>` : ''; }).join('') +
      ((me.inv.frag || me.inv.smoke) ? `<div class="slot pe ${me.held === 3 ? 'on' : ''}" data-i="3"><span class="k">5</span>${me.inv.frag ? '수류탄 ' + me.inv.frag : ''}${me.inv.frag && me.inv.smoke ? ' · ' : ''}${me.inv.smoke ? '연막 ' + me.inv.smoke : ''}</div>` : '');
    if (slotHtml !== this.lastSlots) { $('slots').innerHTML = slotHtml; this.lastSlots = slotHtml; }
    if (held) {
      const st = g.wstats(held); const d = st.d;
      $('wName').textContent = d.name; const res = me.inv[d.ammo] || 0;
      $('wAmmo').innerHTML = `${held.mag}<small>/ ${res}</small>`; $('wAmmo').classList.toggle('empty', held.mag === 0);
      $('wMode').textContent = { auto: 'AUTO · 자동', single: 'SINGLE · 단발', burst: 'BURST · 점사' }[d.modes[held.mode]] + (st.zoom > 1.3 ? ` · ${st.zoom}x` : '');
    } else if (me.held === 3) { $('wName').textContent = '투척'; $('wAmmo').innerHTML = `${me.inv[me.throwSel] || 0}<small>${ITEMS[me.throwSel].name}</small>`; $('wMode').textContent = me.cook >= 0 && me.throwSel === 'frag' ? `안전핀 제거 · ${Math.max(0, 4.5 - me.cook).toFixed(1)}초` : '좌클릭 유지 후 놓아서 투척'; }
    else { $('wName').textContent = '맨손'; $('wAmmo').innerHTML = '—'; $('wMode').textContent = ''; }
    const qh = [['bandage', '붕대', 7], ['firstaid', '구급', 8], ['medkit', '메디', 9], ['energy', '드링크', 0], ['painkiller', '주사', '-']].map(([k, n, key]) => `<div class="qi ${me.inv[k] ? '' : 'none'}">${n}<b>${me.inv[k] || 0}</b>${key}</div>`).join('');
    if (qh !== this.lastQuick) { $('quick').innerHTML = qh; this.lastQuick = qh; }
    // team list
    if (m.mode > 1) {
      const mates = [...g.actors.values()].filter((a) => !a.isBot && a.team === g.myTeam);
      const th = `<div class="tm ${me.st === 'down' ? 'down' : me.st === 'dead' || me.st === 'spec' ? 'dead' : ''}"><span class="n" style="background:${TEAMC[0]}">1</span>${escapeHtml(g.settings.name)}<span class="hb"><i style="width:${me.st === 'down' ? me.kh : me.hp}%"></i></span></div>` +
        mates.map((a, i) => `<div class="tm ${a.st === 'down' ? 'down' : !a.alive ? 'dead' : ''}"><span class="n" style="background:${TEAMC[(i + 1) % 4]}">${i + 2}</span>${escapeHtml(a.name)}<span class="hb"><i style="width:${a.st === 'down' ? a.kh : a.hp}%"></i></span></div>`).join('');
      if (th !== this.lastTeam) { $('teamList').innerHTML = th; this.lastTeam = th; }
    } else if (this.lastTeam) { $('teamList').innerHTML = ''; this.lastTeam = ''; }
    // crosshair & scope
    const alive = me.st === 'ground';
    this.spreadPulse = Math.max(0, (this.spreadPulse || 0) - dt * 6);
    let gap = 6;
    if (held) { const d = WEAPONS[held.id]; gap = 4 + d.hip * 6 * (me.hspeed > 1 ? 1.5 : 1) * (me.crouch ? 0.8 : 1) * (me.onGround ? 1 : 2) + this.spreadPulse * 8; }
    const cr = $('cross'); const showCross = alive && !g.adsView && me.held !== 3;
    cr.style.display = showCross || (alive && me.held === 3) ? 'block' : 'none';
    const [t, b, l, r] = cr.children; t.style.top = -(gap + 8) + 'px'; b.style.top = gap + 'px'; l.style.left = -(gap + 8) + 'px'; r.style.left = gap + 'px';
    const scopeOn = g.scopeView && alive; $('scope').classList.toggle('on', !!scopeOn);
    if (scopeOn) { const st = g.wstats(held); if (this.scopeType !== st.reticle) { this.scopeType = st.reticle; $('scopeSvg').innerHTML = scopeSvg(st.reticle); } }
    const ret = $('reticle'); const retOn = g.adsView && alive && !scopeOn && held;
    ret.classList.toggle('on', !!retOn);
    if (retOn) { const st = g.wstats(held); if (this.retType !== st.reticle) { this.retType = st.reticle; ret.innerHTML = reticleSvg(st.reticle); } }
    // progress
    const pr = $('prog');
    if (me.action) { pr.style.display = 'block'; $('progL').textContent = me.action.label + ` ${Math.max(0, me.action.dur - me.action.t).toFixed(1)}초`; $('progI').style.width = (me.action.t / me.action.dur) * 100 + '%'; }
    else if (me.st === 'down') { pr.style.display = 'block'; $('progL').textContent = '기절 — 팀원의 부활을 기다리는 중'; $('progI').style.width = me.kh + '%'; }
    else pr.style.display = 'none';
    // plane / altitude
    $('planeHint').style.display = me.st === 'plane' ? 'block' : 'none';
    const altOn = me.st === 'fall' || me.st === 'chute'; $('alt').style.display = altOn ? 'block' : 'none';
    if (altOn) { const gy = Math.max(0, g.world.heightAt(me.pos.x, me.pos.z)); $('altV').textContent = Math.max(0, Math.round(me.pos.y - gy)) + 'm'; $('altS').textContent = me.st === 'fall' ? `강하 ${Math.round(-me.vel.y)} m/s · [F] 낙하산` : `낙하산 · ${Math.round(me.hspeed)} m/s`; }
    if (me.st !== 'dead' && me.st !== 'spec') $('specInfo').style.display = 'none';
    // name tags & markers
    this.updateTags();
    if ($('inv').classList.contains('on')) { this.lastInvRefresh -= dt; if (this.lastInvRefresh <= 0) { this.lastInvRefresh = 0.5; this.refreshInventory(); } }
    // HUD hidden pieces when in scope
    $('compass').style.opacity = scopeOn ? 0.5 : 1;
  }
  drawMini() {
    const g = this.g, me = g.me, ctx = this.mini;
    const R = me.st === 'plane' || me.st === 'fall' ? 520 : me.st === 'chute' ? 300 : 150;
    let cx = me.pos.x, cz = me.pos.z;
    if (me.st === 'dead' || me.st === 'spec') { const a = g.actors.get(g.spec.id); if (a) { cx = a.pos.x; cz = a.pos.z; } }
    ctx.fillStyle = '#21485a'; ctx.fillRect(0, 0, 432, 432);
    this.drawMapLayer(ctx, 432, cx - R, cz - R, R * 2, { grid: false });
    if (me.st === 'dead' || me.st === 'spec') { const a = g.actors.get(g.spec.id); if (a) this.drawArrow(ctx, 216, 216, a.yaw, '#fff', 12); }
    // view cone
    if (me.st === 'ground' || me.st === 'down') {
      ctx.save(); ctx.translate(216, 216); ctx.rotate(Math.PI - (g.camYaw ?? me.yaw));
      const grd = ctx.createRadialGradient(0, 0, 0, 0, 0, 120); grd.addColorStop(0, 'rgba(255,255,255,0.25)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grd; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 120, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55); ctx.closePath(); ctx.fill(); ctx.restore();
    }
  }
  updateTags() {
    const g = this.g, cam = g.camera, el = $('tags');
    const W = window.innerWidth, H = window.innerHeight;
    const want = {};
    const place = (key, wx, wy, wz, html, cls, color) => {
      _p.set(wx, wy, wz).project(cam);
      if (_p.z > 1 || _p.z < -1) return;
      const x = (_p.x * 0.5 + 0.5) * W, y = (-_p.y * 0.5 + 0.5) * H;
      if (x < -50 || x > W + 50 || y < -50 || y > H + 50) return;
      want[key] = true;
      let d = this.tags[key];
      if (!d) { d = this.tags[key] = document.createElement('div'); el.appendChild(d); }
      d.className = cls; d.style.left = x + 'px'; d.style.top = y + 'px'; d.style.color = color || '#fff';
      if (d._h !== html) { d.innerHTML = html; d._h = html; }
    };
    const me = g.me; const m = g.match;
    if (m && m.mode > 1) {
      for (const a of g.actors.values()) {
        if (a.isBot || a.team !== g.myTeam || !a.alive) continue;
        const dist = Math.round(a.pos.distanceTo(me.pos));
        place('t' + a.id, a.pos.x, a.pos.y + 2.15, a.pos.z, `${escapeHtml(a.name)}<small>${a.st === 'down' ? '기절! ' : ''}${dist}m</small>`, 'ntag', a.st === 'down' ? '#ff6060' : TEAMC[this.teamIdx(a) % 4]);
      }
    }
    const marks = [];
    if (me.marker) marks.push(['me', me.marker, TEAMC[0]]);
    if (m && m.mode > 1) for (const a of g.actors.values()) if (!a.isBot && a.team === g.myTeam && a.mk) marks.push([a.id, a.mk, TEAMC[this.teamIdx(a) % 4]]);
    for (const [k, mk, col] of marks) { const y = g.world.heightAt(mk[0], mk[1]) + 2; place('m' + k, mk[0], y, mk[1], `${Math.round(Math.hypot(mk[0] - me.pos.x, mk[1] - me.pos.z))}m`, 'mpin', col); }
    for (const k in this.tags) if (!want[k]) { this.tags[k].remove(); delete this.tags[k]; }
  }
}

function scopeSvg(kind) {
  const L = 'stroke="#000" stroke-width="0.7" fill="none"';
  if (kind === 'cross') return `<line x1="-100" y1="0" x2="-6" y2="0" ${L}/><line x1="6" y1="0" x2="100" y2="0" ${L}/><line x1="0" y1="-100" x2="0" y2="-6" ${L}/><line x1="0" y1="6" x2="0" y2="100" ${L}/><circle r="1.2" fill="#ff3030"/>`;
  if (kind === 'chevron') return `<path d="M-5 6 L0 0 L5 6" stroke="#ff3a3a" stroke-width="1.1" fill="none"/><line x1="0" y1="6" x2="0" y2="100" ${L}/><line x1="-100" y1="0" x2="-14" y2="0" ${L} stroke-width="1.6"/><line x1="14" y1="0" x2="100" y2="0" ${L} stroke-width="1.6"/>` + [12, 22, 32, 42].map((y, i) => `<line x1="${-3 - i}" y1="${y}" x2="${3 + i}" y2="${y}" ${L}/><text x="${6 + i}" y="${y + 1.5}" font-size="4" fill="#000">${(i + 2) * 100}</text>`).join('');
  return `<line x1="-100" y1="0" x2="100" y2="0" ${L} stroke-width="0.4"/><line x1="0" y1="-100" x2="0" y2="100" ${L} stroke-width="0.4"/><line x1="-100" y1="0" x2="-30" y2="0" ${L} stroke-width="1.8"/><line x1="30" y1="0" x2="100" y2="0" ${L} stroke-width="1.8"/><line x1="0" y1="30" x2="0" y2="100" ${L} stroke-width="1.8"/>` + [-20, -15, -10, -5, 5, 10, 15, 20].map((v) => `<circle cx="${v}" cy="0" r="0.5" fill="#000"/><circle cx="0" cy="${v}" r="0.5" fill="#000"/>`).join('');
}
function reticleSvg(kind) {
  if (kind === 'dot') return '<svg width="40" height="40" viewBox="-20 -20 40 40" style="position:absolute;left:-20px;top:-20px"><circle r="1.8" fill="#ff2a2a"/><circle r="3" fill="none" stroke="rgba(255,60,60,.35)" stroke-width="1"/></svg>';
  if (kind === 'holo') return '<svg width="60" height="60" viewBox="-30 -30 60 60" style="position:absolute;left:-30px;top:-30px"><circle r="11" fill="none" stroke="#ff3030" stroke-width="1.4"/><circle r="1.3" fill="#ff3030"/><line x1="-15" y1="0" x2="-11" y2="0" stroke="#ff3030" stroke-width="1.4"/><line x1="11" y1="0" x2="15" y2="0" stroke="#ff3030" stroke-width="1.4"/><line x1="0" y1="11" x2="0" y2="15" stroke="#ff3030" stroke-width="1.4"/></svg>';
  return '<svg width="60" height="60" viewBox="-30 -30 60 60" style="position:absolute;left:-30px;top:-30px"><rect x="-1.3" y="-1" width="2.6" height="10" fill="#111" stroke="#fff" stroke-width=".4"/><path d="M-14 9 h9 v-6 h2 v8 h-11z M14 9 h-9 v-6 h-2 v8 h11z" fill="#111" stroke="#fff" stroke-width=".4"/></svg>';
}
