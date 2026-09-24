// Шкалы времени: юлианская дата, ΔT, звёздное время.

import { norm360 } from './math.js';

export const J2000 = 2451545.0;
const MS_PER_DAY = 86400000;
const UNIX_EPOCH_JD = 2440587.5;

/** Юлианская дата (UT) из Date или миллисекунд Unix. */
export function jdFromDate(date) {
  const ms = typeof date === 'number' ? date : date.getTime();
  return ms / MS_PER_DAY + UNIX_EPOCH_JD;
}

/** Миллисекунды Unix из юлианской даты (UT). */
export function msFromJd(jd) {
  return (jd - UNIX_EPOCH_JD) * MS_PER_DAY;
}

export const dateFromJd = (jd) => new Date(msFromJd(jd));

/** Юлианская дата для календарной даты (григорианский календарь), UT. */
export function jdFromCalendar(y, mo, d, h = 0, mi = 0, s = 0) {
  // setUTCFullYear, в отличие от Date.UTC, не превращает годы 0..99 в 1900..1999.
  const date = new Date(0);
  date.setUTCFullYear(y, mo - 1, d);
  date.setUTCHours(h, mi, 0, 0);
  return jdFromDate(date.getTime() + s * 1000);
}

/** Десятичный год для юлианской даты (приближённо). */
export const yearFromJd = (jd) => 2000 + (jd - J2000) / 365.25;

/**
 * ΔT = TT − UT в секундах. Полиномы Эспенака и Миуса (NASA, 2006),
 * для прочих эпох — долговременная парабола Моррисона и Стефенсона.
 */
export function deltaT(year) {
  const y = year;
  if (y >= 2005 && y < 2050) {
    const t = y - 2000;
    return 62.92 + 0.32217 * t + 0.005589 * t * t;
  }
  if (y >= 1986 && y < 2005) {
    const t = y - 2000;
    return 63.86 + 0.3345 * t - 0.060374 * t ** 2 + 0.0017275 * t ** 3 + 0.000651814 * t ** 4 + 0.00002373599 * t ** 5;
  }
  if (y >= 1961 && y < 1986) {
    const t = y - 1975;
    return 45.45 + 1.067 * t - t ** 2 / 260 - t ** 3 / 718;
  }
  if (y >= 1941 && y < 1961) {
    const t = y - 1950;
    return 29.07 + 0.407 * t - t ** 2 / 233 + t ** 3 / 2547;
  }
  if (y >= 1920 && y < 1941) {
    const t = y - 1920;
    return 21.2 + 0.84493 * t - 0.0761 * t ** 2 + 0.0020936 * t ** 3;
  }
  if (y >= 1900 && y < 1920) {
    const t = y - 1900;
    return -2.79 + 1.494119 * t - 0.0598939 * t ** 2 + 0.0061966 * t ** 3 - 0.000197 * t ** 4;
  }
  if (y >= 1860 && y < 1900) {
    const t = y - 1860;
    return 7.62 + 0.5737 * t - 0.251754 * t ** 2 + 0.01680668 * t ** 3 - 0.0004473624 * t ** 4 + t ** 5 / 233174;
  }
  if (y >= 1800 && y < 1860) {
    const t = y - 1800;
    return 13.72 - 0.332447 * t + 0.0068612 * t ** 2 + 0.0041116 * t ** 3 - 0.00037436 * t ** 4 +
      0.0000121272 * t ** 5 - 0.0000001699 * t ** 6 + 0.000000000875 * t ** 7;
  }
  if (y >= 2050 && y < 2150) {
    return -20 + 32 * ((y - 1820) / 100) ** 2 - 0.5628 * (2150 - y);
  }
  const u = (y - 1820) / 100;
  return -20 + 32 * u * u;
}

/** Юлианская дата в земном времени (TT) по UT. */
export function jdTT(jdUT) {
  return jdUT + deltaT(yearFromJd(jdUT)) / 86400;
}

/** Юлианские столетия от J2000. */
export const centuries = (jd) => (jd - J2000) / 36525;

/** Среднее гринвичское звёздное время, градусы (IAU 1982). */
export function gmst(jdUT) {
  const T = centuries(jdUT);
  return norm360(
    280.46061837 + 360.98564736629 * (jdUT - J2000) + 0.000387933 * T * T - (T * T * T) / 38710000,
  );
}

/** Местное звёздное время, градусы. Долгота положительна к востоку. */
export const lst = (jdUT, lonDeg) => norm360(gmst(jdUT) + lonDeg);
