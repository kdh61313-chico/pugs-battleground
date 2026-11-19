// ===== LAST CIRCLE · game data (all names/stats original) =====
export const GAME_VER = 3;

// ---- ammo ----
export const AMMO = {
  a556: { name: '5.56mm', stack: 30, w: 0.5, color: 0x6fae4a },
  a762: { name: '7.62mm', stack: 30, w: 0.7, color: 0xc8963c },
  a9: { name: '9mm', stack: 30, w: 0.375, color: 0xd6c84a },
  a45: { name: '.45 ACP', stack: 30, w: 0.4, color: 0x5a8fd0 },
  a12: { name: '12 게이지', stack: 10, w: 1.25, color: 0xc84a3c },
  a300: { name: '.300 매그넘', stack: 10, w: 1.0, color: 0x9a4ad0 },
};

// ---- weapons ----
// cat: AR SMG DMR SR SG LMG PST
// slots: s=sight m=muzzle g=grip x=mag
export const WEAPONS = {
  kv47: { name: 'KV-47', cat: 'AR', ammo: 'a762', dmg: 47, rpm: 600, modes: ['auto', 'single'], mag: 30, ext: 40, reload: 2.7, vel: 715, rv: 1.15, rh: 0.6, hip: 2.4, ads: 0.22, slots: 'smx', head: 2.3, range: 120, color: 0x6b4a2e },
  m5c: { name: 'M5 카빈', cat: 'AR', ammo: 'a556', dmg: 41, rpm: 690, modes: ['auto', 'single'], mag: 30, ext: 40, reload: 2.2, vel: 880, rv: 0.78, rh: 0.36, hip: 2.1, ads: 0.18, slots: 'smgx', head: 2.3, range: 140, color: 0x2d2f33 },
  sable: { name: '세이블 AR', cat: 'AR', ammo: 'a556', dmg: 43, rpm: 640, modes: ['auto', 'burst', 'single'], mag: 30, ext: 40, reload: 2.4, vel: 900, rv: 0.66, rh: 0.3, hip: 2.0, ads: 0.16, slots: 'smgx', head: 2.3, range: 150, color: 0x5a6148 },
  ranger: { name: '레인저 DMR', cat: 'DMR', ammo: 'a762', dmg: 58, rpm: 300, modes: ['single'], mag: 10, ext: 20, reload: 2.9, vel: 840, rv: 1.7, rh: 0.5, hip: 3.2, ads: 0.05, slots: 'smgx', head: 2.35, range: 350, color: 0x3e3a33 },
  hawk: { name: '호크-14', cat: 'DMR', ammo: 'a556', dmg: 47, rpm: 420, modes: ['single'], mag: 20, ext: 30, reload: 2.5, vel: 990, rv: 1.1, rh: 0.35, hip: 3.0, ads: 0.05, slots: 'smgx', head: 2.35, range: 300, color: 0x4a4f38 },
  longbow: { name: '롱보우', cat: 'SR', ammo: 'a762', dmg: 82, rpm: 36, modes: ['single'], mag: 5, ext: 5, reload: 3.2, vel: 760, rv: 2.6, rh: 0.4, hip: 5.0, ads: 0.0, slots: 'smx', head: 2.5, range: 500, color: 0x5a3d22, bolt: true },
  wraith: { name: '레이스 .300', cat: 'SR', ammo: 'a300', dmg: 105, rpm: 32, modes: ['single'], mag: 5, ext: 7, reload: 3.6, vel: 945, rv: 3.0, rh: 0.4, hip: 5.0, ads: 0.0, slots: 'smx', head: 2.5, range: 700, color: 0x2b4a3a, bolt: true, rare: true },
  stinger: { name: '스팅어 9', cat: 'SMG', ammo: 'a9', dmg: 30, rpm: 900, modes: ['auto', 'single'], mag: 33, ext: 45, reload: 2.0, vel: 400, rv: 0.48, rh: 0.36, hip: 1.3, ads: 0.25, slots: 'smgx', head: 2.1, range: 60, color: 0x222428 },
  vex: { name: '벡스-45', cat: 'SMG', ammo: 'a45', dmg: 36, rpm: 680, modes: ['auto', 'burst', 'single'], mag: 25, ext: 35, reload: 2.1, vel: 360, rv: 0.55, rh: 0.3, hip: 1.4, ads: 0.28, slots: 'smgx', head: 2.1, range: 55, color: 0x3a3532 },
  breacher: { name: '브리처 12', cat: 'SG', ammo: 'a12', dmg: 24, pellets: 9, rpm: 70, modes: ['single'], mag: 5, ext: 5, reload: 4.0, vel: 360, rv: 3.0, rh: 0.6, hip: 3.6, ads: 3.0, slots: 'sm', head: 1.5, range: 18, color: 0x4a2e1d, pump: true },
  hailstorm: { name: '헤일스톰 LMG', cat: 'LMG', ammo: 'a556', dmg: 42, rpm: 750, modes: ['auto'], mag: 75, ext: 100, reload: 4.6, vel: 915, rv: 0.72, rh: 0.42, hip: 3.0, ads: 0.25, slots: 'smx', head: 2.3, range: 150, color: 0x33362e, rare: true },
  p9: { name: 'P9 권총', cat: 'PST', ammo: 'a9', dmg: 30, rpm: 450, modes: ['single'], mag: 15, ext: 20, reload: 1.8, vel: 380, rv: 0.9, rh: 0.4, hip: 1.6, ads: 0.6, slots: 'sx', head: 2.1, range: 40, color: 0x1f1f22 },
};
export const PRIMARY_CATS = ['AR', 'SMG', 'DMR', 'SR', 'SG', 'LMG'];

// ---- attachments ----
export const ATTACH = {
  s_red: { name: '레드 도트', slot: 's', zoom: 1.25, reticle: 'dot', w: 5 },
  s_holo: { name: '홀로 사이트', slot: 's', zoom: 1.25, reticle: 'holo', w: 5 },
  s_2x: { name: '2배율 스코프', slot: 's', zoom: 2, reticle: 'cross', scope: true, w: 7 },
  s_4x: { name: '4배율 스코프', slot: 's', zoom: 4, reticle: 'chevron', scope: true, w: 8 },
  s_8x: { name: '8배율 스코프', slot: 's', zoom: 8, reticle: 'mil', scope: true, w: 10 },
  m_comp: { name: '보정기', slot: 'm', rv: 0.82, rh: 0.8, w: 5 },
  m_supp: { name: '소음기', slot: 'm', rv: 0.95, rh: 0.95, quiet: true, w: 6 },
  m_flash: { name: '소염기', slot: 'm', rv: 0.9, rh: 0.9, noflash: true, w: 4 },
  g_vert: { name: '수직 손잡이', slot: 'g', rv: 0.82, rh: 0.95, w: 4 },
  g_ang: { name: '앵글 손잡이', slot: 'g', rv: 0.93, rh: 0.78, adsFast: true, w: 4 },
  x_ext: { name: '대용량 탄창', slot: 'x', ext: true, w: 6 },
  x_quick: { name: '퀵드로 탄창', slot: 'x', quick: true, w: 6 },
  x_eq: { name: '대용량 퀵드로 탄창', slot: 'x', ext: true, quick: true, w: 7 },
};

// ---- consumables / gear ----
export const ITEMS = {
  bandage: { name: '붕대', kind: 'heal', w: 2, stack: 5, time: 4, heal: 10, cap: 75, color: 0xe8e2d0 },
  firstaid: { name: '구급키트', kind: 'heal', w: 10, stack: 1, time: 6, heal: 75, cap: 75, color: 0xd8d8d8 },
  medkit: { name: '메디킷', kind: 'heal', w: 20, stack: 1, time: 8, heal: 100, cap: 100, color: 0xf2f2f2 },
  energy: { name: '에너지 드링크', kind: 'boost', w: 4, stack: 1, time: 4, boost: 40, color: 0x3fa9f5 },
  painkiller: { name: '진통 주사', kind: 'boost', w: 10, stack: 1, time: 6, boost: 60, color: 0xf5a93f },
  frag: { name: '세열 수류탄', kind: 'throw', w: 12, stack: 1, color: 0x3b4a2a },
  smoke: { name: '연막탄', kind: 'throw', w: 10, stack: 1, color: 0x8a8f96 },
  helm1: { name: '헬멧 Lv.1', kind: 'helm', lvl: 1, red: 0.3, dur: 80, color: 0x6b7a4a },
  helm2: { name: '헬멧 Lv.2', kind: 'helm', lvl: 2, red: 0.4, dur: 150, color: 0x4e5a3a },
  helm3: { name: '헬멧 Lv.3', kind: 'helm', lvl: 3, red: 0.55, dur: 230, color: 0x2f3526 },
  vest1: { name: '방탄복 Lv.1', kind: 'vest', lvl: 1, red: 0.3, dur: 200, color: 0x7a7a5a },
  vest2: { name: '방탄복 Lv.2', kind: 'vest', lvl: 2, red: 0.4, dur: 220, color: 0x4a5a6a },
  vest3: { name: '방탄복 Lv.3', kind: 'vest', lvl: 3, red: 0.55, dur: 250, color: 0x2a2f36 },
  bag1: { name: '배낭 Lv.1', kind: 'bag', lvl: 1, cap: 150, color: 0x6a5a3a },
  bag2: { name: '배낭 Lv.2', kind: 'bag', lvl: 2, cap: 200, color: 0x4a5a3a },
  bag3: { name: '배낭 Lv.3', kind: 'bag', lvl: 3, cap: 250, color: 0x3a3f4a },
};
export const BASE_CAP = 60;

export function itemInfo(type) {
  if (WEAPONS[type]) return { name: WEAPONS[type].name, kind: 'weapon', def: WEAPONS[type] };
  if (AMMO[type]) return { name: AMMO[type].name, kind: 'ammo', def: AMMO[type] };
  if (ATTACH[type]) return { name: ATTACH[type].name, kind: 'attach', def: ATTACH[type] };
  if (ITEMS[type]) return { name: ITEMS[type].name, kind: ITEMS[type].kind, def: ITEMS[type] };
  return { name: type, kind: 'unknown', def: {} };
}
export function itemWeight(type, qty = 1) {
  if (AMMO[type]) return AMMO[type].w * qty;
  if (ATTACH[type]) return ATTACH[type].w * qty;
  if (ITEMS[type] && ITEMS[type].w) return ITEMS[type].w * qty;
  return 0;
}

// ---- loot tables ----
export const LOOT_TABLE = [
  ['weapon', 24], ['ammo', 22], ['heal', 16], ['attach', 14], ['armor', 12], ['throw', 6], ['boost', 6],
];
export const LOOT_WEAPONS = [['kv47', 10], ['m5c', 11], ['sable', 6], ['ranger', 4], ['hawk', 5], ['longbow', 4], ['stinger', 10], ['vex', 8], ['breacher', 8], ['p9', 12]];
export const LOOT_ATTACH = [['s_red', 10], ['s_holo', 9], ['s_2x', 7], ['s_4x', 4], ['s_8x', 1.5], ['m_comp', 6], ['m_supp', 3], ['m_flash', 5], ['g_vert', 6], ['g_ang', 6], ['x_ext', 6], ['x_quick', 5], ['x_eq', 2.5]];
export const LOOT_ARMOR = [['helm1', 12], ['helm2', 6], ['helm3', 0.8], ['vest1', 12], ['vest2', 6], ['vest3', 0.8], ['bag1', 10], ['bag2', 6], ['bag3', 1.2]];
export const LOOT_HEAL = [['bandage', 14], ['firstaid', 6], ['medkit', 1]];
export const LOOT_BOOST = [['energy', 6], ['painkiller', 4]];
export const LOOT_THROW = [['frag', 6], ['smoke', 4]];
export const CARE_LOOT = [['wraith', 3], ['hailstorm', 3], ['s_8x', 2], ['vest3', 3], ['helm3', 3], ['medkit', 3], ['bag3', 2], ['x_eq', 1]];

// ---- blue zone schedule [wait, shrink, radius, dps] ----
export const ZONE_PHASES = [
  [80, 80, 560, 0.6],
  [65, 60, 330, 1.0],
  [55, 50, 190, 2.0],
  [45, 40, 105, 4.0],
  [40, 35, 55, 6.0],
  [30, 30, 25, 9.0],
  [20, 25, 0, 12.0],
];
export const ZONE_START = 35; // seconds after match start
export const ZONE_R0 = 1500;

// ---- map: fixed island layout (original) ----
export const MAP_SEED = 917331;
export const TOWNS = [
  { id: 'central', name: '세운시', x: 20, z: -10, r: 135, style: 'city', n: 46 },
  { id: 'harbor', name: '남포항', x: -90, z: 560, r: 95, style: 'harbor', n: 12 },
  { id: 'base', name: '흑산 기지', x: 520, z: -400, r: 115, style: 'military', n: 12 },
  { id: 'plant', name: '청류 발전소', x: -520, z: -300, r: 105, style: 'industrial', n: 10 },
  { id: 'school', name: '백양 학교', x: 330, z: 190, r: 70, style: 'school', n: 7 },
  { id: 'quarry', name: '돌머리 채석장', x: -380, z: 300, r: 80, style: 'quarry', n: 5 },
  { id: 'farm', name: '들녘 농장', x: 450, z: 470, r: 85, style: 'farm', n: 8 },
  { id: 'lodge', name: '솔바람 산장', x: 80, z: -560, r: 70, style: 'village', n: 7 },
  { id: 'cape', name: '등대곶', x: -640, z: 90, r: 60, style: 'village', n: 6 },
  { id: 'hill', name: '언덕마을', x: -230, z: -620, r: 70, style: 'village', n: 8 },
  { id: 'east', name: '동녘리', x: 690, z: 40, r: 65, style: 'village', n: 7 },
];
export const ROADS = [
  ['central', 'harbor'], ['central', 'school'], ['central', 'lodge'], ['central', 'plant'], ['central', 'quarry'],
  ['school', 'farm'], ['school', 'east'], ['base', 'east'], ['base', 'lodge'], ['plant', 'hill'], ['plant', 'cape'],
  ['quarry', 'cape'], ['quarry', 'harbor'], ['farm', 'harbor'], ['hill', 'lodge'],
];

export const PLAYER_COLORS = [0xe8503f, 0x3f86f0, 0x3fd472, 0xf2c33c, 0xa862f0, 0xf2803c, 0x3fd9d9, 0xf04fa8];
export const TEAM_COLORS = ['#ffcf3f', '#4fc3ff', '#6dff8a', '#ff7ad9'];

const BN1 = ['그림자', '야간', '번개', '강철', '푸른', '붉은', '은빛', '조용한', '빠른', '고독한', '날쌘', '차가운', '잿빛', '흰', '검은', '용감한'];
const BN2 = ['늑대', '매', '여우', '표범', '저격수', '유령', '사냥꾼', '곰', '독수리', '호랑이', '방랑자', '까마귀', '전사', '올빼미', '스나', '토끼'];
export function botName(seed, i) {
  let h = (seed * 31 + i * 7919) >>> 0;
  const a = BN1[h % BN1.length]; h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
  const b = BN2[h % BN2.length];
  const n = (h >>> 8) % 100;
  return a + b + (n < 40 ? n : '');
}
