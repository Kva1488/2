// Системы координат: эклиптика, экватор, горизонт, галактика; прецессия и рефракция.

import {
  sind, cosd, tand, asind, atan2d, norm360, mulMM, mulMV, rotY, rotZ, transpose, clamp,
} from './math.js';
import { centuries, J2000 } from './time.js';

/** Средний наклон эклиптики к экватору, градусы (Миус, 22.2). T — столетия TT от J2000. */
export function obliquity(T) {
  return 23.439291111 - 0.013004167 * T - 1.639e-7 * T * T + 5.036e-7 * T * T * T;
}

export const OBLIQUITY_J2000 = obliquity(0);

/** Эклиптические координаты → экваториальные (та же эпоха). Всё в градусах. */
export function eclToEq(lon, lat, eps) {
  const ra = atan2d(sind(lon) * cosd(eps) - tand(lat) * sind(eps), cosd(lon));
  const dec = asind(sind(lat) * cosd(eps) + cosd(lat) * sind(eps) * sind(lon));
  return [norm360(ra), dec];
}

/** Экваториальные координаты → эклиптические [долгота, широта] (та же эпоха). */
export function eqToEcl(ra, dec, eps) {
  const lon = atan2d(sind(ra) * cosd(eps) + tand(dec) * sind(eps), cosd(ra));
  const lat = asind(sind(dec) * cosd(eps) - cosd(dec) * sind(eps) * sind(ra));
  return [norm360(lon), lat];
}

/** Вектор в эклиптической системе → вектор в экваториальной. */
export function eclVecToEq(v, eps) {
  const c = cosd(eps), s = sind(eps);
  return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
}

/**
 * Матрица прецессии J2000 → средний экватор и равноденствие даты (Миус, 21.2–21.4).
 * @param {number} jdTT юлианская дата в TT
 */
export function precessionMatrix(jdTT) {
  const T = centuries(jdTT);
  const as = 1 / 3600;
  const zeta = (2306.2181 * T + 0.30188 * T * T + 0.017998 * T * T * T) * as;
  const z = (2306.2181 * T + 1.09468 * T * T + 0.018203 * T * T * T) * as;
  const theta = (2004.3109 * T - 0.42665 * T * T - 0.041833 * T * T * T) * as;
  return mulMM(rotZ(-z), mulMM(rotY(theta), rotZ(-zeta)));
}

/** Прецессия точки (RA, Dec в градусах) из J2000 на дату. */
export function precess(ra, dec, jdTT) {
  if (jdTT === J2000) return [ra, dec];
  const v = mulMV(precessionMatrix(jdTT), [cosd(dec) * cosd(ra), cosd(dec) * sind(ra), sind(dec)]);
  return [norm360(atan2d(v[1], v[0])), asind(v[2])];
}

/**
 * Матрица перевода экваториального вектора (эпоха даты) в топоцентрический
 * горизонтальный ENU: x — восток, y — север, z — зенит.
 * @param {number} lstDeg местное звёздное время, градусы
 * @param {number} latDeg широта наблюдателя, градусы
 */
export function eqToHorizonMatrix(lstDeg, latDeg) {
  const sl = sind(latDeg), cl = cosd(latDeg);
  const toLocal = [0, 1, 0, -sl, 0, cl, cl, 0, sl];
  return mulMM(toLocal, rotZ(lstDeg));
}

/** Азимут (от севера через восток) и высота из вектора ENU. */
export function enuToAzAlt(v) {
  const r = Math.hypot(v[0], v[1], v[2]);
  return [norm360(atan2d(v[0], v[1])), asind(v[2] / r)];
}

/** Вектор ENU из азимута и высоты. */
export function azAltToEnu(az, alt) {
  const ca = cosd(alt);
  return [ca * sind(az), ca * cosd(az), sind(alt)];
}

/** Горизонтальные координаты [азимут, высота] для RA/Dec (эпоха даты). */
export function eqToHorizon(ra, dec, lstDeg, latDeg) {
  const H = lstDeg - ra;
  const alt = asind(sind(latDeg) * sind(dec) + cosd(latDeg) * cosd(dec) * cosd(H));
  const az = atan2d(-cosd(dec) * sind(H), cosd(latDeg) * sind(dec) - sind(latDeg) * cosd(dec) * cosd(H));
  return [norm360(az), alt];
}

/**
 * Атмосферная рефракция, градусы (формула Сэмундссона) для истинной высоты h.
 * Ниже горизонта плавно гасится до нуля.
 */
export function refraction(h) {
  const hh = Math.max(h, -1.5);
  const r = 1.02 / tand(hh + 10.3 / (hh + 5.11)) / 60;
  if (h >= -1.5) return Math.max(r, 0);
  return Math.max(r, 0) * clamp((h + 3) / 1.5, 0, 1);
}

/**
 * Атмосферная экстинкция в звёздных величинах для высоты h (градусы).
 * Воздушная масса по Пикерингу (2002), коэффициент k ≈ 0.2 для хорошего неба.
 */
export function airmass(h) {
  const hh = Math.max(h, -1);
  return 1 / sind(hh + 244 / (165 + 47 * Math.pow(hh + 1.0001, 1.1)));
}
export const extinction = (h, k = 0.2) => k * airmass(h);

/** Матрица J2000 экватор → галактические координаты (IAU 1958 в реализации Hipparcos). */
export const EQ2000_TO_GAL = [
  -0.0548755604, -0.8734370902, -0.4838350155,
  0.4941094279, -0.44482963, 0.7469822445,
  -0.867666149, -0.1980763734, 0.4559837762,
];
export const GAL_TO_EQ2000 = transpose(EQ2000_TO_GAL);
