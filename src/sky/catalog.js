// Каталог объектов в удобном для отрисовки и поиска виде: единичные векторы J2000,
// подписи, поисковый индекс.

import { STARS, STAR_STRIDE, STAR_NAMES } from '../data/stars.js';
import { CONSTELLATIONS, CON_LINES, CON_BOUNDS } from '../data/constellations.js';
import { MESSIER } from '../data/messier.js';
import { CON_GENITIVE, EXTRA_DSO, DSO_TYPES } from '../data/lore.js';
import { sph2vec, cosd, vnorm, dot, acosd } from '../astro/math.js';
import { bvBin } from './sprites.js';

const GREEK = {
  α: 'альфа', β: 'бета', γ: 'гамма', δ: 'дельта', ε: 'эпсилон', ζ: 'дзета', η: 'эта', θ: 'тета',
  ι: 'йота', κ: 'каппа', λ: 'лямбда', μ: 'мю', ν: 'ню', ξ: 'кси', ο: 'омикрон', π: 'пи', ρ: 'ро',
  σ: 'сигма', τ: 'тау', υ: 'ипсилон', φ: 'фи', χ: 'хи', ψ: 'пси', ω: 'омега',
};

export const normalize = (s) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9α-ω ]/gi, ' ').replace(/\s+/g, ' ').trim();

// ---------- Звёзды ----------
const n = STARS.length / STAR_STRIDE;
export const starCount = n;
export const starVec = new Float32Array(n * 3);
export const starMag = new Float32Array(n);
export const starBin = new Uint8Array(n);
export const starHip = new Int32Array(n);
export const starRa = new Float32Array(n);
export const starDec = new Float32Array(n);

for (let i = 0; i < n; i++) {
  const ra = STARS[i * STAR_STRIDE], dec = STARS[i * STAR_STRIDE + 1];
  const v = sph2vec(ra, dec);
  starVec[i * 3] = v[0];
  starVec[i * 3 + 1] = v[1];
  starVec[i * 3 + 2] = v[2];
  starMag[i] = STARS[i * STAR_STRIDE + 2];
  starBin[i] = bvBin(STARS[i * STAR_STRIDE + 3]);
  starHip[i] = STARS[i * STAR_STRIDE + 4];
  starRa[i] = ra;
  starDec[i] = dec;
}

/** Обозначение звезды: «α Лиры», «61 Лебедя» или «HIP 12345». */
export function starDesignation(hip) {
  const nm = STAR_NAMES[hip];
  if (!nm) return `HIP ${hip}`;
  const gen = CON_GENITIVE[nm[4]] || nm[4];
  if (nm[2]) return `${nm[2]} ${gen}`;
  if (nm[3]) return `${nm[3]} ${gen}`;
  return `HIP ${hip}`;
}

/** Собственное имя звезды по-русски (или пусто). */
export const starProperName = (hip) => (STAR_NAMES[hip] && STAR_NAMES[hip][0]) || '';
export const starLatinName = (hip) => (STAR_NAMES[hip] && STAR_NAMES[hip][1]) || '';

// Индекс звезды по HIP.
export const starIndexByHip = new Map();
for (let i = 0; i < n; i++) starIndexByHip.set(starHip[i], i);

/** Объект-звезда для панели сведений. */
export function starObject(i) {
  const hip = starHip[i];
  const proper = starProperName(hip);
  const desig = starDesignation(hip);
  return {
    kind: 'star',
    id: `hip-${hip}`,
    hip,
    index: i,
    name: proper || desig,
    designation: desig,
    latin: starLatinName(hip),
    ra2000: starRa[i],
    dec2000: starDec[i],
    mag: starMag[i],
    bv: STARS[i * STAR_STRIDE + 3],
  };
}

// Подписи ярких звёзд: только собственные имена.
export const starLabels = [];
for (let i = 0; i < n; i++) {
  const name = starProperName(starHip[i]);
  if (name && starMag[i] < 4.2) starLabels.push(i);
}

// ---------- Созвездия ----------
function slerpPoints(a, b, stepDeg) {
  const ang = acosd(Math.max(-1, Math.min(1, dot(a, b))));
  const k = Math.max(1, Math.ceil(ang / stepDeg));
  const pts = [];
  for (let i = 0; i <= k; i++) {
    const t = i / k;
    pts.push(vnorm([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]));
  }
  return pts;
}

/** id → массив ломаных (Float32Array векторов J2000) */
export const conFigures = {};
for (const [id, polys] of Object.entries(CON_LINES)) {
  conFigures[id] = polys.map((flat) => {
    const pts = [];
    for (let i = 0; i < flat.length; i += 2) pts.push(sph2vec(flat[i], flat[i + 1]));
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const seg = slerpPoints(pts[i], pts[i + 1], 2.5);
      if (i) seg.shift();
      out.push(...seg);
    }
    return Float32Array.from(out.flat());
  });
}

export const conLabels = Object.entries(CONSTELLATIONS).map(([id, c]) => ({
  id,
  name: c.ru,
  latin: c.la,
  rank: c.rank,
  vec: sph2vec(c.ra, c.dec),
}));

/** Границы: ломаные, интерполированные по RA/Dec (стороны идут по параллелям). */
export const conBorders = CON_BOUNDS.map(([id, flat]) => {
  const pts = [];
  const m = flat.length;
  for (let i = 0; i < m; i += 2) {
    const j = (i + 2) % m;
    let [ra0, dec0, ra1, dec1] = [flat[i], flat[i + 1], flat[j], flat[j + 1]];
    if (ra1 - ra0 > 180) ra1 -= 360;
    if (ra0 - ra1 > 180) ra1 += 360;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(ra1 - ra0) * cosd(dec0), Math.abs(dec1 - dec0)) / 2));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      pts.push(...sph2vec(ra0 + (ra1 - ra0) * t, dec0 + (dec1 - dec0) * t));
    }
  }
  pts.push(pts[0], pts[1], pts[2]);
  return { id, pts: Float32Array.from(pts) };
});

// ---------- Туманности, скопления, галактики ----------
export const dsos = [...MESSIER, ...EXTRA_DSO].map(([id, ra, dec, mag, type, d1, d2, ru, desig]) => ({
  kind: 'dso',
  id,
  name: ru || id,
  short: id.startsWith('M') && /^M\d+$/.test(id) ? id : '',
  designation: desig,
  typeName: DSO_TYPES[type] || 'объект',
  type,
  mag: mag >= 99 ? 12 : mag,
  size: [d1 || 1, d2 || d1 || 1],
  ra2000: ra,
  dec2000: dec,
  vec: sph2vec(ra, dec),
}));

// Известные туманные объекты, которые рисуем мягким свечением даже без маркеров.
export const FAMOUS_DSO = new Set(['M31', 'M42', 'M45', 'M44', 'M13', 'M8', 'M22', 'M7', 'M33', 'DC', 'OMC', 'TUC47', 'LMC', 'SMC', 'CAR', 'M11', 'M6', 'M81', 'M51', 'M104', 'M1', 'M57', 'M27']);

// ---------- Поиск ----------
export function buildSearchIndex(extra = []) {
  const items = [];
  const add = (label, sub, obj, keys, weight) => {
    items.push({ label, sub, obj, keys: keys.filter(Boolean).map(normalize), weight });
  };
  for (const e of extra) add(e.label, e.sub, e.obj, e.keys, e.weight);
  for (let i = 0; i < n; i++) {
    const hip = starHip[i];
    const nm = STAR_NAMES[hip];
    if (!nm) continue;
    const des = starDesignation(hip);
    const greekWord = nm[2] ? `${GREEK[nm[2][0]] || ''}${nm[2].slice(1)} ${CON_GENITIVE[nm[4]] || ''}` : '';
    if (!nm[0] && starMag[i] > 4.5) continue;
    add(nm[0] || des, nm[0] ? `${des} · звезда ${starMag[i].toFixed(1)}m` : `звезда ${starMag[i].toFixed(1)}m`, { type: 'star', index: i }, [nm[0], nm[1], des, greekWord, `hip ${hip}`], 3 - starMag[i] * 0.2);
  }
  for (const c of conLabels) add(c.name, `созвездие · ${c.latin}`, { type: 'constellation', id: c.id }, [c.name, c.latin, c.id], 4 - c.rank);
  for (const d of dsos) add(d.name, `${d.designation ? d.designation + ' · ' : ''}${d.typeName}`, { type: 'dso', id: d.id }, [d.name, d.id, d.designation, d.short && `мессье ${d.short.slice(1)}`], 2.5 - d.mag * 0.1);
  return items;
}

export function search(index, query, limit = 8) {
  const q = normalize(query);
  if (!q) return [];
  const res = [];
  for (const it of index) {
    let score = -1;
    for (const k of it.keys) {
      if (k === q) score = Math.max(score, 100);
      else if (k.startsWith(q)) score = Math.max(score, 60 - (k.length - q.length) * 0.5);
      else if (k.includes(' ' + q)) score = Math.max(score, 40);
      else if (q.length >= 3 && k.includes(q)) score = Math.max(score, 25);
    }
    if (score >= 0) res.push({ it, score: score + it.weight });
  }
  res.sort((a, b) => b.score - a.score);
  return res.slice(0, limit).map((r) => r.it);
}
