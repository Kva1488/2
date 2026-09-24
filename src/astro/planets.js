// Планеты по приближённым кеплеровым элементам JPL (E. M. Standish, 1800–2050 гг.).
// Точность — порядка угловой минуты: для карты неба и восходов/заходов этого достаточно.

import { sind, cosd, norm180, norm360, DEG, RAD, vsub, vlen, asind, atan2d, acosd, dot, vnorm, mulMV } from './math.js';
import { centuries } from './time.js';
import { eclVecToEq, OBLIQUITY_J2000, precessionMatrix } from './coords.js';
import { AU_KM } from './sun.js';

// a (а. е.), e, I (°), L (°), ϖ (°), Ω (°) и их скорости изменения за столетие.
const ELEMENTS = {
  mercury: [0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593,
    0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081],
  venus: [0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255,
    0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418],
  earth: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0,
    0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0],
  mars: [1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891,
    0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343],
  jupiter: [5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909,
    -0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106],
  saturn: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448,
    -0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794],
  uranus: [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503,
    -0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589],
  neptune: [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574,
    0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664],
};

/** Справочные данные о планетах. */
export const PLANETS = [
  { id: 'mercury', name: 'Меркурий', gen: 'Меркурия', radiusKm: 2439.7, color: '#c9bba8' },
  { id: 'venus', name: 'Венера', gen: 'Венеры', radiusKm: 6051.8, color: '#f7eed2' },
  { id: 'mars', name: 'Марс', gen: 'Марса', radiusKm: 3389.5, color: '#f08a5a' },
  { id: 'jupiter', name: 'Юпитер', gen: 'Юпитера', radiusKm: 69911, color: '#f1dcb8' },
  { id: 'saturn', name: 'Сатурн', gen: 'Сатурна', radiusKm: 58232, color: '#ecd79c' },
  { id: 'uranus', name: 'Уран', gen: 'Урана', radiusKm: 25362, color: '#b7e3ea' },
  { id: 'neptune', name: 'Нептун', gen: 'Нептуна', radiusKm: 24622, color: '#8fb2f5' },
];

const LIGHT_DAYS_PER_AU = 1 / 173.1446326846693;

function solveKepler(M, e) {
  // M, E в радианах; метод Ньютона.
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 12; i++) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-12) break;
  }
  return E;
}

/**
 * Гелиоцентрический вектор планеты в эклиптике J2000, а. е.
 * @param {string} id
 * @param {number} jdTT
 */
export function heliocentric(id, jdTT) {
  const el = ELEMENTS[id];
  const T = centuries(jdTT);
  const a = el[0] + el[6] * T;
  const e = el[1] + el[7] * T;
  const I = el[2] + el[8] * T;
  const L = el[3] + el[9] * T;
  const w = el[4] + el[10] * T;
  const O = el[5] + el[11] * T;
  const omega = w - O;
  const M = norm180(L - w) * DEG;
  const E = solveKepler(M, e);
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const co = cosd(omega), so = sind(omega), cO = cosd(O), sO = sind(O), cI = cosd(I), sI = sind(I);
  return [
    (co * cO - so * sO * cI) * xp + (-so * cO - co * sO * cI) * yp,
    (co * sO + so * cO * cI) * xp + (-so * sO + co * cO * cI) * yp,
    so * sI * xp + co * sI * yp,
  ];
}

// Полюс колец Сатурна (J2000): RA 40.589°, Dec 83.537°.
const SATURN_POLE = [cosd(83.537) * cosd(40.589), cosd(83.537) * sind(40.589), sind(83.537)];

/**
 * Видимая звёздная величина (формулы Мюллера из Astronomical Almanac, как у Миуса, гл. 41).
 * r, delta — расстояния до Солнца и Земли (а. е.), i — фазовый угол (°).
 */
function magnitude(id, r, delta, i, ringTilt) {
  const k = 5 * Math.log10(r * delta);
  switch (id) {
    case 'mercury': return -0.42 + k + 0.038 * i - 0.000273 * i * i + 0.000002 * i * i * i;
    case 'venus': return -4.4 + k + 0.0009 * i + 0.000239 * i * i - 0.00000065 * i * i * i;
    case 'mars': return -1.52 + k + 0.016 * i;
    case 'jupiter': return -9.4 + k + 0.005 * i;
    case 'saturn': {
      const sb = Math.abs(sind(ringTilt));
      return -8.88 + k + 0.044 * i - 2.6 * sb + 1.25 * sb * sb;
    }
    case 'uranus': return -7.19 + k;
    case 'neptune': return -6.87 + k;
    default: return 99;
  }
}

/**
 * Полное геоцентрическое положение планеты на дату.
 * @returns {{id, ra, dec, dist, helioDist, mag, phaseAngle, illum, diameter, ringTilt, vecEq}}
 *   RA/Dec эпохи даты (°), dist — до Земли (а. е.), diameter — угловой диаметр (″)
 */
export function planetPosition(id, jdTT, prec = precessionMatrix(jdTT)) {
  const earth = heliocentric('earth', jdTT);
  let helio = heliocentric(id, jdTT);
  let geo = vsub(helio, earth);
  // Учёт времени распространения света: планету видно там, где она была Δ/c назад.
  for (let k = 0; k < 2; k++) {
    const tau = vlen(geo) * LIGHT_DAYS_PER_AU;
    helio = heliocentric(id, jdTT - tau);
    geo = vsub(helio, earth);
  }
  const delta = vlen(geo);
  const r = vlen(helio);
  const i = acosd((r * r + delta * delta - vlen(earth) ** 2) / (2 * r * delta));
  const eq2000 = eclVecToEq(geo, OBLIQUITY_J2000);
  const eq = mulMV(prec, eq2000);
  const ra = norm360(atan2d(eq[1], eq[0]));
  const dec = asind(eq[2] / delta);
  let ringTilt = 0;
  if (id === 'saturn') ringTilt = asind(dot(vnorm(eq2000), SATURN_POLE));
  const info = PLANETS.find((p) => p.id === id);
  return {
    id,
    ra,
    dec,
    dist: delta,
    helioDist: r,
    mag: magnitude(id, r, delta, i, ringTilt),
    phaseAngle: i,
    illum: (1 + cosd(i)) / 2,
    diameter: ((2 * info.radiusKm) / (delta * AU_KM)) * RAD * 3600,
    ringTilt,
  };
}

/** Гелиоцентрическая эклиптическая долгота (для отладки и тестов). */
export function helioLon(id, jdTT) {
  const v = heliocentric(id, jdTT);
  return norm360(atan2d(v[1], v[0]));
}
