// ===== LAST CIRCLE · boot =====
import * as THREE from 'three';
import { World } from './world.js';
import { Effects } from './effects.js';
import { Audio } from './audio.js';
import { Hud } from './hud.js';
import { Game } from './game.js';
import { Net, LocalNet, P2PNet, makeCode, cleanCode } from './net.js';
import { PLAYER_COLORS } from './data.js';
import { TouchControls, isTouchDevice } from './touch.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// ---------- settings ----------
const DEF = { name: '생존자' + Math.floor(Math.random() * 900 + 100), color: Math.floor(Math.random() * PLAYER_COLORS.length), sens: 1, adsSens: 0.8, fov: 78, vol: 0.7, quality: 'med', invertY: false };
let settings = { ...DEF };
try { const s = JSON.parse(localStorage.getItem('lastcircle.settings') || 'null'); if (s) { settings = { ...DEF, ...s }; if (!s.cfgV || s.cfgV < 2) { settings.quality = 'med'; settings.cfgV = 2; } } } catch (e) {}
settings.cfgV = 2;
const TOUCH = isTouchDevice();
if (TOUCH && !settings.touchCfg) { settings.quality = 'low'; settings.touchCfg = 1; }
const saveSettings = () => { try { localStorage.setItem('lastcircle.settings', JSON.stringify(settings)); } catch (e) {} };
if (!localStorage || !(() => { try { return localStorage.getItem('lastcircle.settings'); } catch (e) { return null; } })()) {
  // first run: pick quality by GPU hint
  settings.quality = TOUCH ? 'low' : 'med';
}

// ---------- renderer ----------
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const FOG = new THREE.Color(0xb8cbdb);
scene.fog = new THREE.Fog(FOG, 250, 1900);
scene.background = FOG;
const camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.05, 6000);
scene.add(camera);
const hemi = new THREE.HemisphereLight(0xd6e6ff, 0x6a6250, 1.15); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
sun.castShadow = true; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.5;
let shadowExt = 75; const SH = 75; Object.assign(sun.shadow.camera, { left: -SH, right: SH, top: SH, bottom: -SH, near: 1, far: 600 });
scene.add(sun); scene.add(sun.target);

// ---------- post-processing ----------
let composer = null, bloom = null, grade = null;
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uVig: { value: 0.32 }, uSat: { value: 1.08 }, uHurt: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uVig; uniform float uSat; uniform float uHurt; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126,0.7152,0.0722));
      c.rgb = mix(vec3(l), c.rgb, uSat - uHurt*0.7);
      c.rgb *= vec3(1.02, 1.0, 0.97);
      vec2 d = vUv - 0.5; float v = 1.0 - dot(d, d) * uVig * 2.2;
      c.rgb *= clamp(v, 0.0, 1.0);
      c.rgb = mix(c.rgb, c.rgb*vec3(1.0,0.35,0.35), uHurt*smoothstep(0.15, 0.7, length(d)));
      gl_FragColor = c; }`,
};
function setupComposer() {
  if (composer) { composer.dispose(); composer = null; }
  if (settings.quality !== 'high') return; // bloom/grading only on high; med uses native MSAA + CSS vignette
  const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: settings.quality === 'high' ? 4 : 2 });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.32, 0.55, 0.92);
  composer.addPass(bloom);
  grade = new ShaderPass(GradeShader); composer.addPass(grade);
  composer.addPass(new OutputPass());
  composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(innerWidth, innerHeight);
}
// dynamic resolution: keep the frame rate up on weaker GPUs
let dynScale = 1, slowSec = 0, fastSec = 0;
function adaptRes(fps) {
  if (document.hidden || fps < 15) return; // <15 usually means the page is throttled in the background, not GPU-bound
  if (fps < 42) { slowSec++; fastSec = 0; } else if (fps > 57) { fastSec++; slowSec = 0; } else { slowSec = 0; fastSec = 0; }
  if (slowSec >= 2 && dynScale > 0.55) { dynScale = Math.max(0.55, dynScale - 0.12); slowSec = 0; applyQuality(true); }
  if (fastSec >= 6 && dynScale < 1) { dynScale = Math.min(1, dynScale + 0.08); fastSec = 0; applyQuality(true); }
}
function applyQuality(keepComposer) {
  const q = settings.quality;
  const pr = (q === 'low' ? Math.min(devicePixelRatio, 1) * 0.8 : q === 'med' ? Math.min(devicePixelRatio, 1.25) : Math.min(devicePixelRatio, 1.6)) * dynScale;
  renderer.setPixelRatio(pr);
  renderer.setSize(innerWidth, innerHeight, false);
  sun.castShadow = q !== 'low';
  const ms = q === 'high' ? 2048 : 1536;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const ext = q === 'high' ? 75 : 55; Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext }); sun.shadow.camera.updateProjectionMatrix(); shadowExt = ext;
  if (sun.shadow.mapSize.x !== ms) { sun.shadow.mapSize.set(ms, ms); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
  scene.fog.far = q === 'low' ? 1200 : q === 'med' ? 1700 : 2200;
  camera.far = scene.fog.far + 4000; camera.updateProjectionMatrix();
  const fe = document.getElementById('fps'); if (fe) fe.style.display = settings.showFps ? 'block' : 'none';
  if (typeof fx !== 'undefined' && fx) fx.setScale(renderer.domElement.height, camera.fov);
  if (keepComposer === true && composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(innerWidth, innerHeight); } else setupComposer();
}

// ---------- systems ----------
const world = new World();
const fx = new Effects(scene);
const audio = new Audio(); audio.setVolume(settings.vol);
let realNet = new Net();
const app = {};
const game = new Game({ renderer, scene, camera, world, audio, fx, hud: null, settings, net: realNet });
game.app = app; game.saveSettings = saveSettings; game.realNet = realNet;
const hud = new Hud(game); game.hud = hud;
hud.touchMode = TOUCH;
if (!game.input) game.input = {};
Object.assign(game.input, { down: new Set(), pressed: new Set(), mouseL: false, mouseR: false, mouseLPressed: false, dx: 0, dy: 0, wheel: 0, joy: { x: 0, y: 0, active: false } });
const touch = new TouchControls(game, hud); if (TOUCH) touch.enable();
applyQuality();
realNet.onStatus = (st) => hud.netStatus(st);

// ---------- app actions ----------
function menuError(t) { document.getElementById('netTxt').textContent = t; }
app.createRoom = async () => {
  if (!realNet.available) return menuError('멀티플레이를 사용할 수 없습니다');
  game.net = realNet;
  try { await game.enterRoom(makeCode(), true); } catch (e) { menuError('방을 만들지 못했습니다: ' + (e.code || e.message)); }
};
app.joinRoom = async (raw) => {
  const code = cleanCode(raw);
  if (code.length < 4) return menuError('방 코드를 정확히 입력하세요 (5자리)');
  if (!realNet.available) return menuError('멀티플레이를 사용할 수 없습니다');
  game.net = realNet;
  try {
    await game.enterRoom(code, false);
    setTimeout(() => { if (game.mode === 'lobby' && game.lobbyPeers().length <= 1) hud.chat('알림', `코드 ${code} 방에 아직 아무도 없습니다. 코드를 다시 확인하거나 친구가 먼저 방을 만들 때까지 기다리세요.`); }, 3500);
  } catch (e) { menuError('입장 실패: ' + (e.code || e.message)); }
};
app.practice = (cfg) => { game.realNet = realNet; game.startPractice(cfg); };
app.quitMatch = async () => {
  if (game.offline) { game.endLocalMatch(); game.net = realNet; game.mode = 'menu'; hud.showScreen('menu'); }
  else await game.leaveRoom();
};
app.resultLobby = () => {
  if (game.offline) return app.quitMatch();
  if (game.isHost && game.match && game.match.ended) game.hostBackToLobby();
};
app.applyQuality = applyQuality;

// ---------- input ----------
const inp = game.input;
const GAME_KEYS = new Set(['Tab', 'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyM', 'KeyC', 'ControlLeft', 'ShiftLeft', 'KeyQ', 'KeyE', 'KeyR', 'KeyB', 'KeyG', 'KeyH', 'KeyT', 'KeyV', 'KeyX']);
addEventListener('keydown', (e) => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
  if (hud.screen === 'game' && (GAME_KEYS.has(e.code) || e.code.startsWith('Digit'))) e.preventDefault();
  if (e.code === 'Escape') { hud.handleEsc(); return; }
  if (hud.screen === 'game') {
    if (e.code === 'Tab') { if (!e.repeat) { if (document.getElementById('inv').classList.contains('on')) hud.toggleInventory(false); else if (!hud.anyOverlay() || document.getElementById('inv').classList.contains('on')) game.me && (game.me.st !== 'plane') && hud.toggleInventory(true); } return; }
    if (e.code === 'KeyM') { if (!e.repeat) { if (document.getElementById('map').classList.contains('on')) hud.toggleMap(false); else if (!hud.anyOverlay()) hud.toggleMap(true); } return; }
  }
  if (!e.repeat) inp.pressed.add(e.code);
  inp.down.add(e.code);
});
addEventListener('keyup', (e) => { inp.down.delete(e.code); });
addEventListener('blur', () => { inp.down.clear(); inp.mouseL = inp.mouseR = false; });
addEventListener('mousedown', (e) => {
  audio.unlock();
  if (TOUCH && hud.touchMode && (e.sourceCapabilities ? e.sourceCapabilities.firesTouchEvents : false)) return;
  if (hud.screen !== 'game' || !hud.captured() || hud.anyOverlay()) return;
  if (e.button === 0) { inp.mouseL = true; inp.mouseLPressed = true; }
  if (e.button === 2) inp.mouseR = true;
});
addEventListener('mouseup', (e) => { if (e.button === 0) inp.mouseL = false; if (e.button === 2) inp.mouseR = false; });
addEventListener('mousemove', (e) => { if (hud.screen === 'game' && hud.captured() && !hud.anyOverlay()) { inp.dx += e.movementX || 0; inp.dy += e.movementY || 0; } });
addEventListener('wheel', (e) => { if (hud.screen === 'game' && hud.captured() && !hud.anyOverlay()) inp.wheel = Math.sign(e.deltaY); }, { passive: true });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
document.getElementById('hud').addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('pointerlockchange', () => { if (document.pointerLockElement) hud.fakeLock = false; hud.onLockChange(); });
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); applyQuality(true); hud.fitMap(); });

// ---------- loop ----------
let last = performance.now(), menuT = 0, endT = 0, fpsN = 0, fpsT = performance.now(), fpsV = 0;
const fpsEl = document.getElementById('fps');
const sunOff = new THREE.Vector3();
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now(); let dt = Math.min(0.05, (now - last) / 1000); last = now; lastFrameReal = now;
  if (!world.ready) return;
  if (game.mode === 'menu' || game.mode === 'lobby') {
    menuT += dt * 0.025;
    const r = 760; camera.position.set(Math.cos(menuT) * r, 230 + Math.sin(menuT * 2.3) * 30, Math.sin(menuT) * r);
    camera.lookAt(0, 30, 0);
    if (camera.fov !== settings.fov) { camera.fov = settings.fov; camera.updateProjectionMatrix(); }
  }
  try { game.update(dt); } catch (err) { console.error(err); }
  inp.pressed.clear(); inp.mouseLPressed = false;
  if (window.__camOverride) { const o = window.__camOverride; camera.position.set(...o.pos); camera.lookAt(...o.look); if (o.fov) { camera.fov = o.fov; camera.updateProjectionMatrix(); } }
  // host auto return to lobby
  if (game.match && game.match.ended && game.isHost && !game.offline) { endT += dt; if (endT > 25) { endT = 0; game.hostBackToLobby(); } } else endT = 0;
  world.update(dt, camera.position);
  world.updateGrass(camera.position.x, camera.position.z);
  fx.update(dt);
  try { hud.update(dt); touch.update(); } catch (err) { console.error(err); }
  // altitude-aware haze (less washed-out from the plane)
  { const alt = Math.max(0, camera.position.y - Math.max(0, world.heightAt(camera.position.x, camera.position.z)));
    const base = settings.quality === 'low' ? 1200 : settings.quality === 'med' ? 1700 : 2200;
    scene.fog.near = 250 + alt * 1.4; scene.fog.far = base + alt * 2.6; }
  // fps
  fpsN++; if (now - fpsT > 1000) { fpsV = Math.round(fpsN * 1000 / (now - fpsT)); fpsN = 0; fpsT = now; if (settings.showFps) fpsEl.textContent = fpsV + ' FPS · ' + Math.round(dynScale * 100) + '%'; adaptRes(fpsV); }
  // sun shadow follows camera (texel-snapped)
  const c = camera.position; const step = (shadowExt * 2) / sun.shadow.mapSize.x;
  const tx = Math.round(c.x / step) * step, tz = Math.round(c.z / step) * step;
  sunOff.copy(world.sunDir).multiplyScalar(300);
  sun.target.position.set(tx, Math.max(0, world.heightAt(tx, tz)), tz);
  sun.position.copy(sun.target.position).add(sunOff);
  if (window.__pauseRender) return;
  if (composer) {
    const me = game.me; const hurt = game.mode === 'match' && me && me.st !== 'dead' && me.st !== 'spec' ? Math.max(0, (35 - (me.st === 'down' ? 0 : me.hp)) / 35) * 0.6 : 0;
    grade.uniforms.uHurt.value += (hurt - grade.uniforms.uHurt.value) * 0.1;
    composer.render();
  } else {
    renderer.render(scene, camera);
    const me = game.me; const hurt = game.mode === 'match' && me && me.st !== 'dead' && me.st !== 'spec' ? Math.max(0, (35 - (me.st === 'down' ? 0 : me.hp)) / 35) : 0;
    if (Math.abs(hurt - (vigEl._h || 0)) > 0.02) { vigEl._h = hurt; vigEl.style.boxShadow = hurt > 0 ? `inset 0 0 ${120 + hurt * 120}px rgba(160,0,0,${hurt * 0.55})` : 'none'; }
  }
}
const vigEl = document.getElementById('vig');

// background tick: keeps the simulation & network alive when the tab is hidden (rAF paused)
let lastFrameReal = performance.now();
app.bgTick = () => {
  if (!world.ready) return;
  const now = performance.now();
  if (now - lastFrameReal < 400) return;
  let el = Math.min(1.2, (now - last) / 1000); last = now;
  try { while (el > 0.001) { const d = Math.min(0.05, el); game.update(d); el -= d; } } catch (err) { console.error(err); }
  inp.pressed.clear(); inp.mouseLPressed = false;
};
setInterval(app.bgTick, 250);

// ---------- boot ----------
(async () => {
  hud.showScreen('loading');
  await world.build(scene, renderer, settings.quality, (p, t) => hud.loading(p, t));
  world.ready = true;
  fx.setScale(renderer.domElement.height, camera.fov);
  hud.showScreen('menu');
  requestAnimationFrame(frame);
  // claude.ai artifact -> built-in room; anywhere else -> peer-to-peer WebRTC
  realNet.init().then(async (ok) => {
    if (ok) return;
    const p2p = new P2PNet(); p2p.onStatus = (st) => hud.netStatus(st, true);
    hud.netStatus('checking', true);
    if (await p2p.init()) { realNet = p2p; game.realNet = p2p; if (!(game.net instanceof LocalNet)) game.net = p2p; }
  });
  window.__game = game;
})().catch((e) => { console.error(e); document.getElementById('loadTxt').textContent = '로딩 실패: ' + e.message; });
