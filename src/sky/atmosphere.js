// Модель яркости и цвета неба: день, закат, сумерки с поясом Венеры и тенью Земли,
// ночь со световым загрязнением, собственным свечением атмосферы и лунным светом.
// Это не физический перенос излучения, а быстрая модель, откалиброванная на глаз
// под то, что человек реально видит в разные фазы сумерек.

import { clamp, smoothstep, lerp } from '../astro/math.js';

/** Предельная звёздная величина в зените по шкале Бортля (1 — идеальная тьма, 9 — центр мегаполиса). */
export const BORTLE_LM = [0, 7.6, 7.1, 6.6, 6.2, 5.8, 5.4, 4.9, 4.4, 4.0];
export const BORTLE_NAMES = [
  '',
  'Идеально тёмное небо',
  'Очень тёмное небо',
  'Сельская местность',
  'Пригород, дальний',
  'Пригород',
  'Яркий пригород',
  'Окраина города',
  'Город',
  'Центр мегаполиса',
];
const LP = [0, 0, 0.004, 0.012, 0.03, 0.055, 0.09, 0.14, 0.2, 0.28];

function table(x, pts) {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return pts[pts.length - 1][1];
}

// Относительная яркость дневного неба в зените от высоты Солнца (уже с учётом адаптации глаза).
const DAYLIGHT = [[-18, 0], [-15, 0.0015], [-12, 0.005], [-9, 0.014], [-6, 0.038], [-3, 0.095], [0, 0.22], [3, 0.45], [6, 0.7], [10, 0.92], [20, 1]];
// Предельная величина от высоты Солнца (без Луны и засветки).
const LM_SUN = [[-18, 8], [-15, 6.3], [-12, 5.2], [-9, 4.1], [-6, 2.6], [-4.5, 1.6], [-3, 0.4], [-1, -1.2], [2, -2.6], [8, -3.6], [20, -4]];

/**
 * Условия наблюдения на момент кадра.
 * @param {object} p { sunEnu, sunAlt, moonEnu, moonAlt, moonIllum, bortle, atmosphere, eclipseObscuration }
 */
export function computeConditions(p) {
  // Во время полной фазы солнечного затмения небо темнеет, как в глубоких сумерках.
  const ecl = p.eclipseObscuration || 0;
  const eclDim = smoothstep(0.75, 1, ecl);
  const sunAltEff = p.sunAlt - 16 * eclDim;
  const day = p.atmosphere ? table(sunAltEff, DAYLIGHT) * (1 - 0.6 * smoothstep(0.3, 0.95, ecl)) : 0;
  const lmDark = BORTLE_LM[p.bortle] ?? 6.2;
  let lm = p.atmosphere ? Math.min(lmDark, table(sunAltEff, LM_SUN)) : 7;
  // Луна «съедает» слабые звёзды, особенно под тёмным загородным небом.
  const moonUp = smoothstep(-1, 25, p.moonAlt);
  const moonLight = p.atmosphere ? Math.pow(p.moonIllum, 1.3) * moonUp : 0;
  const darkSite = clamp((lmDark - 4) / 3.6, 0, 1);
  lm -= moonLight * (0.4 + 1.3 * darkSite) * smoothstep(-6, -14, sunAltEff) + moonLight * 0.2;
  if (!p.atmosphere) lm = 7;
  const lp = p.atmosphere ? LP[p.bortle] ?? 0.03 : 0;
  // Млечный Путь виден только при предельной величине от ~4.8.
  const mwVis = p.atmosphere ? smoothstep(4.6, 6.8, lm) : 1;
  return {
    sunEnu: p.sunEnu,
    moonEnu: p.moonEnu,
    sunAlt: p.sunAlt,
    sunAltEff,
    day,
    lm,
    lmDark,
    lp,
    moonLight,
    mwVis,
    atmosphere: p.atmosphere,
    twilight: p.atmosphere ? Math.exp(-(((sunAltEff + 3.5) / 5.5) ** 2)) * (1 - eclDim) : 0,
    belt: p.atmosphere ? smoothstep(4, -1, sunAltEff) * smoothstep(-9, -3, sunAltEff) * (1 - eclDim) : 0,
    sunVis: p.atmosphere ? smoothstep(-10, 1, p.sunAlt) * (1 - 0.97 * eclDim) : 0,
    eclipse: ecl,
    airglow: p.atmosphere ? (1 - clamp(lp * 4, 0, 1)) * smoothstep(-12, -18, sunAltEff) : 0,
  };
}

const ZENITH = [0.1, 0.25, 0.78];
const HORIZON = [0.46, 0.6, 0.86];
const NIGHT = [0.0009, 0.0013, 0.0027];

/**
 * Цвет неба (линейный RGB) в направлении d (ENU, единичный). Результат — в out.
 * Солнце и Луну задают векторы из cond.
 */
export function skyColor(d, cond, out) {
  const z = d[2] < 0 ? 0 : d[2];
  const hw = (1 - z) * (1 - z) * (1 - z);
  const s = cond.sunEnu, m = cond.moonEnu;
  const mus = d[0] * s[0] + d[1] * s[1] + d[2] * s[2];
  let r = NIGHT[0], g = NIGHT[1], b = NIGHT[2];
  if (!cond.atmosphere) { out[0] = 0; out[1] = 0; out[2] = 0; return out; }

  // Дневное небо: синий зенит, белёсый горизонт; у горизонта со стороны Солнца теплее.
  const day = cond.day;
  if (day > 0) {
    const warm = smoothstep(12, -2, cond.sunAltEff) * hw;
    r += day * (lerp(ZENITH[0], HORIZON[0], hw) + warm * 0.25 * Math.max(mus, 0));
    g += day * (lerp(ZENITH[1], HORIZON[1], hw) + warm * 0.08 * Math.max(mus, 0));
    b += day * lerp(ZENITH[2], HORIZON[2], hw);
  }

  // Ореол вокруг Солнца (рассеяние Ми): яркое ядро и широкое сияние.
  if (cond.sunVis > 0) {
    // Узкие составляющие ореола считаем только вблизи Солнца: дальше они ничтожны.
    let core = Math.exp((mus - 1) * 7) * 0.22;
    if (mus > 0.9) core += Math.exp((mus - 1) * 60) * 0.9;
    if (mus > 0.99) core += Math.exp((mus - 1) * 700) * 6;
    const k = core * cond.sunVis * (0.35 + 0.65 * Math.max(cond.day, 0.15));
    const low = smoothstep(15, -3, cond.sunAltEff);
    r += k * 1.0;
    g += k * (0.92 - 0.35 * low);
    b += k * (0.8 - 0.55 * low);
  }

  // Сумерки: зарево у горизонта со стороны Солнца.
  const sh = Math.hypot(s[0], s[1]) || 1, dh = Math.hypot(d[0], d[1]) || 1;
  const cosAz = (d[0] * s[0] + d[1] * s[1]) / (sh * dh);
  if (cond.twilight > 0.001) {
    const t = cond.twilight;
    const spread = Math.exp((cosAz - 1) * 1.6);
    const band = Math.exp(-z / 0.12);
    const high = Math.exp(-z / 0.35);
    const deep = smoothstep(-2, -12, cond.sunAltEff); // чем глубже сумерки, тем уже и краснее полоса
    const k = t * spread;
    r += k * (band * (0.95 - 0.35 * deep) + high * 0.12) * (1 - 0.6 * deep);
    g += k * (band * (0.42 - 0.2 * deep) + high * 0.1) * (1 - 0.7 * deep);
    b += k * (band * 0.12 + high * 0.14) * (1 - 0.75 * deep);
  }

  // Противоположная сторона: тень Земли (сине-серая полоса) и розовый пояс Венеры над ней.
  if (cond.belt > 0.001) {
    const anti = Math.exp((-cosAz - 1) * 1.3);
    const top = Math.max(0, -cond.sunAltEff) * 0.0175 + 0.015;
    const pink = Math.exp(-(((z - top - 0.07) / 0.06) ** 2)) * anti * cond.belt;
    r += pink * 0.2;
    g += pink * 0.1;
    b += pink * 0.13;
    const shadow = smoothstep(top + 0.02, top - 0.02, z) * anti * cond.belt;
    r *= 1 - 0.5 * shadow;
    g *= 1 - 0.4 * shadow;
    b *= 1 - 0.2 * shadow;
  }

  // Световое загрязнение: тёплое зарево у горизонта и «серый» зенит.
  if (cond.lp > 0) {
    const k = cond.lp * (0.25 + 1.3 * Math.exp(-z / 0.14));
    r += k * 0.055;
    g += k * 0.042;
    b += k * 0.032;
  }

  // Собственное свечение атмосферы — слабая зеленоватая дымка у горизонта в тёмных местах.
  if (cond.airglow > 0) {
    const k = cond.airglow * 0.0035 * Math.exp(-z / 0.1);
    r += k * 0.45;
    g += k;
    b += k * 0.6;
  }

  // Лунный свет: голубоватое небо и ореол вокруг Луны.
  if (cond.moonLight > 0.002) {
    const mum = d[0] * m[0] + d[1] * m[1] + d[2] * m[2];
    let halo = mum > 0.5 ? Math.exp((mum - 1) * 16) * 0.016 : 0;
    if (mum > 0.97) halo += Math.exp((mum - 1) * 250) * 0.07;
    const k = cond.moonLight;
    const nightness = 1 - clamp(cond.day * 8, 0, 1);
    r += k * nightness * (0.0028 + 0.005 * hw + halo * 0.7);
    g += k * nightness * (0.0042 + 0.0065 * hw + halo * 0.85);
    b += k * nightness * (0.0095 + 0.009 * hw + halo * 1.1);
  }

  out[0] = r;
  out[1] = g;
  out[2] = b;
  return out;
}

/** Цвет земли (линейный RGB) — от дневного до почти чёрного ночью. */
export function groundColor(cond, landscape) {
  const day = cond.atmosphere ? cond.day : 0;
  const moon = cond.moonLight * 0.004;
  const base = landscape === 'sea' ? [0.02, 0.05, 0.08] : landscape === 'city' ? [0.05, 0.05, 0.06] : [0.035, 0.05, 0.03];
  return [
    0.0016 + base[0] * day + moon + cond.lp * 0.01,
    0.0019 + base[1] * day + moon + cond.lp * 0.008,
    0.0028 + base[2] * day + moon * 1.3 + cond.lp * 0.006,
  ];
}

/** Тональная компрессия и гамма: линейный цвет → 0..255. */
export function toneMap(c) {
  const e = 1.45;
  return 255 * Math.pow(1 - Math.exp(-c * e), 1 / 2.2);
}

/** Таблица для быстрой тональной компрессии (линейное значение 0..8 → байт). */
export function makeToneLUT(size = 4096, max = 8) {
  const lut = new Uint8ClampedArray(size + 1);
  for (let i = 0; i <= size; i++) lut[i] = toneMap((i / size) ** 2 * max);
  return { lut, size, max };
}
