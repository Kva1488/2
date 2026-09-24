// Основные метеорные потоки (по календарю Международной метеорной организации, IMO).
// Даты — месяц/день; радиант — RA/Dec J2000 в максимуме, градусы; ZHR — зенитное часовое число.

export const SHOWERS = [
  { id: 'QUA', name: 'Квадрантиды', start: [12, 28], peak: [1, 3], end: [1, 12], ra: 230, dec: 49, zhr: 110, speed: 41, width: 0.6, parent: 'астероид 2003 EH1' },
  { id: 'LYR', name: 'Лириды', start: [4, 14], peak: [4, 22], end: [4, 30], ra: 271, dec: 34, zhr: 18, speed: 49, width: 1.3, parent: 'комета Тэтчера C/1861 G1' },
  { id: 'ETA', name: 'Эта-Аквариды', start: [4, 19], peak: [5, 6], end: [5, 28], ra: 338, dec: -1, zhr: 50, speed: 66, width: 5, parent: 'комета Галлея' },
  { id: 'SDA', name: 'Южные дельта-Аквариды', start: [7, 12], peak: [7, 30], end: [8, 23], ra: 340, dec: -16, zhr: 25, speed: 41, width: 6, parent: 'комета Макхольца 96P' },
  { id: 'CAP', name: 'Альфа-Каприкорниды', start: [7, 3], peak: [7, 30], end: [8, 15], ra: 307, dec: -10, zhr: 5, speed: 23, width: 7, parent: 'комета 169P/NEAT' },
  { id: 'PER', name: 'Персеиды', start: [7, 17], peak: [8, 12], end: [8, 24], ra: 48, dec: 58, zhr: 100, speed: 59, width: 2.5, parent: 'комета Свифта — Туттля' },
  { id: 'DRA', name: 'Дракониды', start: [10, 6], peak: [10, 8], end: [10, 10], ra: 262, dec: 54, zhr: 10, speed: 20, width: 0.6, parent: 'комета Джакобини — Циннера' },
  { id: 'STA', name: 'Южные Тауриды', start: [9, 10], peak: [10, 10], end: [11, 20], ra: 32, dec: 9, zhr: 5, speed: 27, width: 15, parent: 'комета Энке' },
  { id: 'ORI', name: 'Ориониды', start: [10, 2], peak: [10, 21], end: [11, 7], ra: 95, dec: 16, zhr: 20, speed: 66, width: 4, parent: 'комета Галлея' },
  { id: 'NTA', name: 'Северные Тауриды', start: [10, 20], peak: [11, 12], end: [12, 10], ra: 58, dec: 22, zhr: 5, speed: 29, width: 12, parent: 'комета Энке' },
  { id: 'LEO', name: 'Леониды', start: [11, 6], peak: [11, 17], end: [11, 30], ra: 152, dec: 22, zhr: 15, speed: 71, width: 1.5, parent: 'комета Темпеля — Туттля' },
  { id: 'GEM', name: 'Геминиды', start: [12, 4], peak: [12, 14], end: [12, 20], ra: 112, dec: 33, zhr: 150, speed: 35, width: 1.2, parent: 'астероид (3200) Фаэтон' },
  { id: 'URS', name: 'Урсиды', start: [12, 17], peak: [12, 22], end: [12, 26], ra: 217, dec: 76, zhr: 10, speed: 33, width: 0.8, parent: 'комета Туттля 8P' },
];

const DAY = 86400000;

/** Дата максимума потока в заданном году (UTC, полночь). */
export function peakDate(shower, year) {
  return new Date(Date.UTC(year, shower.peak[0] - 1, shower.peak[1]));
}

/** Сдвиг в сутках от ближайшего максимума потока (со знаком). */
function daysFromPeak(shower, date) {
  const y = date.getUTCFullYear();
  let best = Infinity;
  for (const yy of [y - 1, y, y + 1]) {
    const d = (date.getTime() - peakDate(shower, yy).getTime()) / DAY;
    if (Math.abs(d) < Math.abs(best)) best = d;
  }
  return best;
}

function inSeason(shower, date) {
  const m = date.getUTCMonth() + 1, d = date.getUTCDate();
  const v = m * 100 + d;
  const s = shower.start[0] * 100 + shower.start[1];
  const e = shower.end[0] * 100 + shower.end[1];
  return s <= e ? v >= s && v <= e : v >= s || v <= e;
}

/**
 * Активность потока на дату: доля от максимального ZHR (0..1).
 * Профиль — экспонента по обе стороны от максимума, как у IMO.
 */
export function activity(shower, date) {
  if (!inSeason(shower, date)) return 0;
  const dd = Math.abs(daysFromPeak(shower, date));
  return Math.pow(10, -dd / shower.width / 2.5);
}

/** Активные потоки на дату: [{shower, level, zhrNow}]. */
export function activeShowers(date) {
  return SHOWERS.map((s) => {
    const level = activity(s, date);
    return { shower: s, level, zhrNow: s.zhr * level };
  }).filter((x) => x.level > 0.02);
}

/**
 * Ожидаемое число метеоров в час для наблюдателя.
 * @param {number} zhr текущее ZHR
 * @param {number} radiantAlt высота радианта, градусы
 * @param {number} lm предельная звёздная величина неба
 */
export function visibleRate(zhr, radiantAlt, lm) {
  if (radiantAlt <= 0) return 0;
  const r = 2.2; // популяционный индекс
  return zhr * Math.sin((radiantAlt * Math.PI) / 180) * Math.pow(r, lm - 6.5);
}

/** Ближайшие максимумы потоков после даты: [{shower, date}], по возрастанию. */
export function upcomingPeaks(from, days = 365) {
  const out = [];
  const y = from.getUTCFullYear();
  for (const s of SHOWERS) {
    for (const yy of [y, y + 1]) {
      const p = peakDate(s, yy);
      const dt = (p - from) / DAY;
      if (dt >= -1 && dt <= days) out.push({ shower: s, date: p });
    }
  }
  return out.sort((a, b) => a.date - b.date);
}
