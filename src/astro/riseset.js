// Восходы, заходы, кульминации и сумерки — численным поиском, поэтому
// корректно работает и за полярным кругом (полярный день и ночь).

import { RAD } from './math.js';
import { sunAltitude, moonAltitude, planetAltitude, fixedAltitude, makeFrame, moonTopocentric } from './bodies.js';
import { MOON_RADIUS_KM } from './moon.js';

const STEP = 1 / 96; // 15 минут
const EPS = 1 / 86400; // 1 секунда

/** Стандартные высоты горизонта (центр объекта), градусы. */
export const H0 = {
  star: -0.5667, // рефракция 34′
  sun: -0.8333, // + радиус диска 16′
  civil: -6,
  nautical: -12,
  astronomical: -18,
};

function bisect(fn, a, fa, b, target) {
  let lo = a, hi = b, flo = fa - target;
  while (hi - lo > EPS) {
    const mid = (lo + hi) / 2;
    const fm = fn(mid) - target;
    if ((fm > 0) === (flo > 0)) { lo = mid; flo = fm; } else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Все пересечения функции высоты с уровнем h0 на интервале [jd0, jd1].
 * @returns {{jd:number, type:'rise'|'set'}[]}
 */
export function findCrossings(altFn, jd0, jd1, h0, step = STEP) {
  const out = [];
  let a = jd0, fa = altFn(a);
  while (a < jd1) {
    const b = Math.min(a + step, jd1);
    const fb = altFn(b);
    if ((fa - h0) * (fb - h0) < 0 || (fa === h0 && a === jd0)) {
      const jd = bisect(altFn, a, fa, b, h0);
      out.push({ jd, type: fb > fa ? 'rise' : 'set' });
    }
    a = b;
    fa = fb;
  }
  return out;
}

/** Максимум высоты (верхняя кульминация) на интервале: [{jd, alt}]. */
export function findMaxima(altFn, jd0, jd1, step = STEP) {
  const out = [];
  let p0 = altFn(jd0 - step), p1 = altFn(jd0);
  for (let t = jd0; t < jd1; t += step) {
    const p2 = altFn(t + step);
    if (p1 >= p0 && p1 > p2) {
      // Золотое сечение на [t−step, t+step]
      let a = t - step, b = t + step;
      const g = 0.381966;
      let x1 = a + g * (b - a), x2 = b - g * (b - a), f1 = altFn(x1), f2 = altFn(x2);
      while (b - a > EPS * 10) {
        if (f1 < f2) { a = x1; x1 = x2; f1 = f2; x2 = b - g * (b - a); f2 = altFn(x2); } else { b = x2; x2 = x1; f2 = f1; x1 = a + g * (b - a); f1 = altFn(x1); }
      }
      const jd = (a + b) / 2;
      if (jd >= jd0 && jd < jd1) out.push({ jd, alt: altFn(jd) });
    }
    p0 = p1;
    p1 = p2;
  }
  return out;
}

/** Функция высоты для объекта по его идентификатору. */
export function altitudeFn(target, observer) {
  if (target.id === 'sun') return (jd) => sunAltitude(jd, observer);
  if (target.id === 'moon') return (jd) => moonAltitude(jd, observer);
  if (target.kind === 'planet') return (jd) => planetAltitude(target.id, jd, observer);
  return (jd) => fixedAltitude(target.ra2000, target.dec2000, jd, observer);
}

/** Высота горизонта (центра) для события восхода/захода данного объекта. */
export function horizonFor(target, jd, observer) {
  if (target.id === 'sun') return H0.sun;
  if (target.id === 'moon') {
    const f = makeFrame(jd, observer);
    const t = moonTopocentric(f);
    return H0.star - Math.asin(MOON_RADIUS_KM / t.dist) * RAD;
  }
  return H0.star;
}

/**
 * Восход, кульминация и заход объекта за интервал.
 * @returns {{rises:number[], sets:number[], transits:{jd,alt}[], alwaysUp:boolean, alwaysDown:boolean}}
 */
export function riseTransitSet(target, observer, jd0, jd1) {
  const fn = altitudeFn(target, observer);
  const h0 = horizonFor(target, (jd0 + jd1) / 2, observer);
  const crossings = findCrossings(fn, jd0, jd1, h0);
  const transits = findMaxima(fn, jd0, jd1);
  const rises = crossings.filter((c) => c.type === 'rise').map((c) => c.jd);
  const sets = crossings.filter((c) => c.type === 'set').map((c) => c.jd);
  let alwaysUp = false, alwaysDown = false;
  if (!crossings.length) {
    const mid = fn((jd0 + jd1) / 2);
    alwaysUp = mid > h0;
    alwaysDown = !alwaysUp;
  }
  return { rises, sets, transits, alwaysUp, alwaysDown };
}

/**
 * Солнце и сумерки за интервал (обычно от полудня до полудня).
 * @returns объект со списками событий по уровням и функцией sunAlt
 */
export function sunEvents(observer, jd0, jd1) {
  const fn = (jd) => sunAltitude(jd, observer);
  const pick = (h) => findCrossings(fn, jd0, jd1, h);
  return {
    sun: pick(H0.sun),
    civil: pick(H0.civil),
    nautical: pick(H0.nautical),
    astronomical: pick(H0.astronomical),
    altAt: fn,
  };
}
