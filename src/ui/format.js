// Форматирование по-русски: числа, склонения, стороны света, время в часовом поясе места.

import { TIMELINE } from '../data/lore.js';
import { msFromJd } from '../astro/time.js';

export function plural(n, forms) {
  const a = Math.abs(Math.trunc(n)) % 100, b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

const nf = (d) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const NF0 = nf(0), NF1 = nf(1), NF2 = nf(2);
export const num = (x, d = 0) => (d === 0 ? NF0 : d === 1 ? NF1 : NF2).format(x);

export function fmtMag(m) {
  return `${m < 0 ? '−' : ''}${Math.abs(m).toFixed(1).replace('.', ',')}`;
}

export function fmtDeg(x, d = 0) {
  return `${x < 0 ? '−' : ''}${Math.abs(x).toFixed(d).replace('.', ',')}°`;
}

export function fmtRa(ra) {
  const h = ra / 15;
  const hh = Math.floor(h), mm = Math.floor((h - hh) * 60), ss = Math.round(((h - hh) * 60 - mm) * 60);
  return `${hh}ʰ ${String(mm).padStart(2, '0')}ᵐ ${String(ss === 60 ? 59 : ss).padStart(2, '0')}ˢ`;
}

export function fmtDec(dec) {
  const s = dec < 0 ? '−' : '+';
  const a = Math.abs(dec);
  const d = Math.floor(a), m = Math.round((a - d) * 60);
  return `${s}${d}° ${String(m === 60 ? 59 : m).padStart(2, '0')}′`;
}

const DIRS16 = ['С', 'ССВ', 'СВ', 'ВСВ', 'В', 'ВЮВ', 'ЮВ', 'ЮЮВ', 'Ю', 'ЮЮЗ', 'ЮЗ', 'ЗЮЗ', 'З', 'ЗСЗ', 'СЗ', 'ССЗ'];
const DIRS8_WORDS = ['на севере', 'на северо-востоке', 'на востоке', 'на юго-востоке', 'на юге', 'на юго-западе', 'на западе', 'на северо-западе'];
export const dirShort = (az) => DIRS16[Math.round((((az % 360) + 360) % 360) / 22.5) % 16];
export const dirWords = (az) => DIRS8_WORDS[Math.round((((az % 360) + 360) % 360) / 45) % 8];

/** «на юго-западе, 24° над горизонтом» */
export function whereInSky(az, alt) {
  if (alt < -0.5) return `под горизонтом, ${dirWords(az).replace('на ', 'со стороны ').replace('севере', 'севера').replace('юге', 'юга').replace('востоке', 'востока').replace('западе', 'запада')}`;
  if (alt > 80) return 'почти в зените';
  return `${dirWords(az)}, ${Math.round(alt)}° над горизонтом`;
}

export function fmtDistanceKm(km) {
  if (km < 1e6) return `${num(km)} км`;
  if (km < 1e9) return `${num(km / 1e6, 1)} млн км`;
  return `${num(km / 1e9, 2)} млрд км`;
}

export function fmtLy(ly) {
  if (ly < 100) return `${num(ly, 1)} ${plural(Math.round(ly * 10) % 10 === 0 ? Math.round(ly) : 2, ['световой год', 'световых года', 'световых лет'])}`;
  if (ly < 1e6) return `${num(Math.round(ly / (ly < 1e4 ? 10 : 100)) * (ly < 1e4 ? 10 : 100))} световых лет`;
  return `${num(ly / 1e6, ly < 1e7 ? 2 : 0)} млн световых лет`;
}

export function fmtDuration(sec) {
  if (sec < 60) {
    const shown = sec < 10 ? Math.round(sec * 10) / 10 : Math.round(sec);
    // Дробные числа согласуются с родительным падежом единственного числа: «1,3 секунды».
    const word = Number.isInteger(shown) ? plural(shown, ['секунду', 'секунды', 'секунд']) : 'секунды';
    return `${num(shown, 1)} ${word}`;
  }
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  if (m < 60) return s && m < 20 ? `${m} ${plural(m, ['минуту', 'минуты', 'минут'])} ${s} ${plural(s, ['секунду', 'секунды', 'секунд'])}` : `${m} ${plural(m, ['минуту', 'минуты', 'минут'])}`;
  const h = Math.floor(m / 60), mm = m % 60;
  return `${h} ${plural(h, ['час', 'часа', 'часов'])}${mm ? ` ${mm} ${plural(mm, ['минуту', 'минуты', 'минут'])}` : ''}`;
}

function fmtYears(n) {
  if (n >= 1e6) return `${num(n / 1e6, n < 1e7 ? 1 : 0)} млн лет`;
  if (n >= 1e4) return `${num(Math.round(n / 1000))} тыс. лет`;
  return `${num(n)} ${plural(n, ['год', 'года', 'лет'])}`;
}

function fmtYear(y) {
  if (y > 0) return `${y} года`;
  return `${1 - y} года до н. э.`;
}

/**
 * История света: когда он отправился в путь и что тогда ещё не случилось.
 * @param {number} ly расстояние в световых годах
 * @param {number} nowYear текущий год (модельный)
 */
export function lightStory(ly, nowYear) {
  const dep = nowYear - ly;
  let when;
  if (ly < 1) when = 'Этот свет отправился в путь меньше года назад.';
  else if (ly < 10000) when = `Этот свет отправился в путь около ${fmtYear(Math.round(dep))}.`;
  else when = `Этот свет вышел в путь ${fmtYears(ly)} назад.`;
  const ev = [...TIMELINE].reverse().find(([y]) => y > dep);
  if (!ev || ev[0] > nowYear) return when;
  const wait = Math.round(ev[0] - dep);
  if (wait < 1) return when;
  return `${when} Тогда до ${ev[1]} оставалось ещё ${fmtYears(wait)}.`;
}

// ---------- Часовые пояса ----------

const fmtCache = new Map();
function dtf(tz, opts) {
  const key = tz + JSON.stringify(opts);
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('ru-RU', { timeZone: tz, ...opts });
    fmtCache.set(key, f);
  }
  return f;
}

/** Смещение часового пояса относительно UTC в минутах на момент ms. */
export function tzOffset(tz, ms) {
  const parts = dtf(tz, { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(ms));
  const get = (t) => +parts.find((p) => p.type === t).value;
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

/** Календарные составляющие момента в поясе tz. */
export function localParts(tz, ms) {
  const off = tzOffset(tz, ms);
  const d = new Date(ms + off * 60000);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(), wd: d.getUTCDay(), off };
}

/** Момент (мс UTC) для местного времени в поясе tz. */
export function msFromLocal(tz, y, mo, d, h = 0, mi = 0) {
  const guess = new Date(0);
  guess.setUTCFullYear(y, mo - 1, d);
  guess.setUTCHours(h, mi, 0, 0);
  let ms = guess.getTime();
  // Две итерации — корректно и около перевода часов.
  for (let i = 0; i < 2; i++) ms = guess.getTime() - tzOffset(tz, ms) * 60000;
  return ms;
}

export const fmtTime = (tz, ms) => dtf(tz, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
export const fmtTimeJd = (tz, jd) => fmtTime(tz, msFromJd(jd));
export const fmtDate = (tz, ms, opts = { day: 'numeric', month: 'long' }) => dtf(tz, opts).format(new Date(ms));
export const fmtDateLong = (tz, ms) => dtf(tz, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(ms)).replace(' г.', '');
export const fmtWeekday = (tz, ms) => dtf(tz, { weekday: 'short' }).format(new Date(ms));

export function fmtOffset(min) {
  const s = min < 0 ? '−' : '+';
  const a = Math.abs(min);
  return `UTC${s}${Math.floor(a / 60)}${a % 60 ? ':' + String(a % 60).padStart(2, '0') : ''}`;
}

/** «+3 ч 12 мин от текущего» */
export function fmtShift(ms) {
  const sign = ms < 0 ? '−' : '+';
  const a = Math.abs(ms) / 1000;
  const d = Math.floor(a / 86400), h = Math.floor((a % 86400) / 3600), m = Math.floor((a % 3600) / 60);
  if (d >= 365) return `${sign}${num(Math.round(d / 365.25))} ${plural(Math.round(d / 365.25), ['год', 'года', 'лет'])}`;
  if (d) return `${sign}${d} д ${h} ч`;
  if (h) return `${sign}${h} ч ${m} мин`;
  return `${sign}${m} мин`;
}
