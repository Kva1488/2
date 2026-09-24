// Календарь небесных событий: фазы Луны, соединения, затмения, противостояния,
// элонгации, максимумы метеорных потоков.

import { norm180, norm360, separation, asind, RAD } from './math.js';
import { jdTT, jdFromDate, dateFromJd } from './time.js';
import { precessionMatrix, eqToEcl, obliquity, precess } from './coords.js';
import { sunPosition, AU_KM } from './sun.js';
import { moonPosition, MOON_RADIUS_KM, EARTH_RADIUS_KM } from './moon.js';
import { planetPosition, PLANETS } from './planets.js';
import { makeFrame, moonTopocentric, sunState } from './bodies.js';
import { upcomingPeaks } from './showers.js';

const EPS = 1 / 86400;

function bisect(fn, a, b) {
  let fa = fn(a);
  while (b - a > EPS) {
    const m = (a + b) / 2;
    const fm = fn(m);
    if ((fm > 0) === (fa > 0)) { a = m; fa = fm; } else b = m;
  }
  return (a + b) / 2;
}

function goldenMin(fn, a, b, tol = EPS * 30) {
  const g = 0.381966;
  let x1 = a + g * (b - a), x2 = b - g * (b - a), f1 = fn(x1), f2 = fn(x2);
  while (b - a > tol) {
    if (f1 > f2) { a = x1; x1 = x2; f1 = f2; x2 = b - g * (b - a); f2 = fn(x2); } else { b = x2; x2 = x1; f2 = f1; x1 = a + g * (b - a); f1 = fn(x1); }
  }
  const x = (a + b) / 2;
  return { jd: x, value: fn(x) };
}

/** Локальные минимумы функции ниже порога: [{jd, value}]. */
function minima(fn, jd0, jd1, step, threshold) {
  const out = [];
  let p0 = fn(jd0 - step), p1 = fn(jd0);
  for (let t = jd0; t <= jd1; t += step) {
    const p2 = fn(t + step);
    if (p1 <= p0 && p1 < p2 && p1 < threshold * 1.5) {
      const m = goldenMin(fn, t - step, t + step);
      if (m.value < threshold && m.jd >= jd0 && m.jd <= jd1) out.push(m);
    }
    p0 = p1;
    p1 = p2;
  }
  return out;
}

// ---------- Геоцентрические положения (время — UT) ----------

const sunAt = (jd) => sunPosition(jdTT(jd));
const moonAt = (jd) => moonPosition(jdTT(jd));
function planetAt(id, jd) {
  const tt = jdTT(jd);
  return planetPosition(id, tt, precessionMatrix(tt));
}

/** Элонгация Луны по долготе, 0..360. */
const moonElong = (jd) => {
  const tt = jdTT(jd);
  return norm360(moonPosition(tt).lon - sunPosition(tt).lon);
};

export const PHASE_NAMES = ['Новолуние', 'Первая четверть', 'Полнолуние', 'Последняя четверть'];

/** Главные фазы Луны на интервале: [{jd, phase: 0..3}]. */
export function moonPhases(jd0, jd1) {
  const out = [];
  for (let k = 0; k < 4; k++) {
    const target = k * 90;
    const fn = (jd) => norm180(moonElong(jd) - target);
    let a = jd0, fa = fn(a);
    for (let t = jd0 + 1; t <= jd1 + 1; t += 1) {
      const fb = fn(t);
      if (fa < 0 && fb >= 0 && fb - fa < 60) {
        const jd = bisect(fn, a, t);
        if (jd >= jd0 && jd <= jd1) out.push({ jd, phase: k });
      }
      a = t;
      fa = fb;
    }
  }
  return out.sort((x, y) => x.jd - y.jd);
}

// ---------- Затмения ----------

function shadowGeometry(jd) {
  const tt = jdTT(jd);
  const s = sunPosition(tt);
  const m = moonPosition(tt);
  const rs = s.dist * AU_KM;
  return {
    s, m,
    piM: Math.asin(EARTH_RADIUS_KM / m.dist) * RAD,
    piS: (8.794 / 3600) / s.dist,
    sS: (959.63 / 3600) / s.dist,
    sM: Math.asin(MOON_RADIUS_KM / m.dist) * RAD,
    rs,
  };
}

/** Лунные затмения около полнолуний на интервале. */
export function lunarEclipses(jd0, jd1, observer) {
  const out = [];
  for (const ph of moonPhases(jd0 - 1, jd1 + 1)) {
    if (ph.phase !== 2) continue;
    const sepFn = (jd) => {
      const g = shadowGeometry(jd);
      return separation(g.s.ra + 180, -g.s.dec, g.m.ra, g.m.dec);
    };
    const best = goldenMin(sepFn, ph.jd - 0.25, ph.jd + 0.25);
    const g = shadowGeometry(best.jd);
    const rU = 1.02 * (0.99834 * g.piM - g.sS + g.piS);
    const rP = 1.02 * (0.99834 * g.piM + g.sS + g.piS);
    const umbral = (rU + g.sM - best.value) / (2 * g.sM);
    const penumbral = (rP + g.sM - best.value) / (2 * g.sM);
    if (penumbral <= 0) continue;
    const type = umbral >= 1 ? 'total' : umbral > 0 ? 'partial' : 'penumbral';
    const contacts = (radius) => {
      const f = (jd) => sepFn(jd) - radius;
      if (f(best.jd) >= 0) return null;
      return [bisect(f, best.jd - 0.25, best.jd), bisect(f, best.jd, best.jd + 0.25)];
    };
    const ev = {
      kind: 'lunar-eclipse',
      type,
      jd: best.jd,
      magnitude: umbral > 0 ? umbral : penumbral,
      penumbral: contacts(rP + g.sM),
      partial: contacts(rU + g.sM),
      total: contacts(rU - g.sM),
    };
    if (observer) {
      const [s, e] = ev.partial || ev.penumbral;
      ev.visibility = moonVisibility(observer, s, e, best.jd);
    }
    if (best.jd >= jd0 && best.jd <= jd1) out.push(ev);
  }
  return out;
}

function moonVisibility(observer, s, e, max) {
  const alt = (jd) => {
    const f = makeFrame(jd, observer);
    const t = moonTopocentric(f);
    const m = f.eq2hor;
    const v = [Math.cos(t.dec / RAD) * Math.cos(t.ra / RAD), Math.cos(t.dec / RAD) * Math.sin(t.ra / RAD), Math.sin(t.dec / RAD)];
    return asind(m[6] * v[0] + m[7] * v[1] + m[8] * v[2]);
  };
  let up = 0, n = 0;
  for (let t = s; t <= e; t += (e - s) / 24) { n++; if (alt(t) > 0) up++; }
  return { atMax: alt(max) > 0, fraction: n ? up / n : 0, altAtMax: alt(max) };
}

/** Площадь перекрытия дисков (доля диска Солнца), радиусы и расстояние в одних единицах. */
export function overlapFraction(rSun, rMoon, d) {
  if (d >= rSun + rMoon) return 0;
  if (d <= Math.abs(rSun - rMoon)) return rMoon >= rSun ? 1 : (rMoon * rMoon) / (rSun * rSun);
  const a1 = rSun * rSun * Math.acos((d * d + rSun * rSun - rMoon * rMoon) / (2 * d * rSun));
  const a2 = rMoon * rMoon * Math.acos((d * d + rMoon * rMoon - rSun * rSun) / (2 * d * rMoon));
  const a3 = 0.5 * Math.sqrt((-d + rSun + rMoon) * (d + rSun - rMoon) * (d - rSun + rMoon) * (d + rSun + rMoon));
  return (a1 + a2 - a3) / (Math.PI * rSun * rSun);
}

/** Солнечные затмения около новолуний; при наличии наблюдателя — местные обстоятельства. */
export function solarEclipses(jd0, jd1, observer) {
  const out = [];
  for (const ph of moonPhases(jd0 - 1, jd1 + 1)) {
    if (ph.phase !== 0) continue;
    const sepFn = (jd) => {
      const g = shadowGeometry(jd);
      return separation(g.s.ra, g.s.dec, g.m.ra, g.m.dec);
    };
    const best = goldenMin(sepFn, ph.jd - 0.25, ph.jd + 0.25);
    const g = shadowGeometry(best.jd);
    const limit = 0.998 * (g.piM - g.piS) + g.sS + g.sM;
    if (best.value >= limit) continue;
    const central = best.value < 0.998 * (g.piM - g.piS);
    const sMoonSurface = Math.asin(MOON_RADIUS_KM / (g.m.dist - EARTH_RADIUS_KM)) * RAD;
    const type = !central ? 'partial' : sMoonSurface > g.sS ? 'total' : 'annular';
    const ev = { kind: 'solar-eclipse', type, jd: best.jd };
    if (observer) ev.local = localSolarEclipse(observer, best.jd);
    if (best.jd >= jd0 && best.jd <= jd1) out.push(ev);
  }
  return out;
}

/** Обстоятельства солнечного затмения в точке наблюдения. */
export function localSolarEclipse(observer, jdMax) {
  const state = (jd) => {
    const f = makeFrame(jd, observer);
    const sun = sunState(f);
    const t = moonTopocentric(f);
    const sM = Math.asin(MOON_RADIUS_KM / t.dist) * RAD;
    const sep = separation(sun.ra, sun.dec, t.ra, t.dec);
    return { sep, sS: sun.diameter / 2, sM, sunAlt: sun.alt };
  };
  // Функция «насколько далеко от касания»; ищем её минимум при Солнце над горизонтом.
  const gap = (jd) => { const s = state(jd); return s.sep - (s.sS + s.sM); };
  const step = 5 / 1440;
  let best = null;
  for (let t = jdMax - 0.2; t <= jdMax + 0.2; t += step) {
    const s = state(t);
    if (s.sunAlt < -0.8) continue;
    const v = s.sep - (s.sS + s.sM);
    if (!best || v < best.v) best = { jd: t, v };
  }
  if (!best || best.v >= 0) return null;
  const m = goldenMin((jd) => state(jd).sep, best.jd - step, best.jd + step);
  const s = state(m.jd);
  const magnitude = (s.sS + s.sM - s.sep) / (2 * s.sS);
  const obscuration = overlapFraction(s.sS, s.sM, s.sep);
  const localType = s.sep < Math.abs(s.sM - s.sS) ? (s.sM > s.sS ? 'total' : 'annular') : 'partial';
  const start = gap(m.jd - 0.2) > 0 ? bisect(gap, m.jd - 0.2, m.jd) : null;
  const end = gap(m.jd + 0.2) > 0 ? bisect((jd) => -gap(jd), m.jd, m.jd + 0.2) : null;
  return { jd: m.jd, magnitude, obscuration, type: localType, start, end, sunAlt: s.sunAlt };
}

// ---------- Соединения и сближения ----------

// Яркие звёзды у эклиптики, с которыми сближаются Луна и планеты (RA/Dec J2000).
export const ECLIPTIC_STARS = [
  { id: 'hip-21421', name: 'Альдебаран', ra: 68.98, dec: 16.51 },
  { id: 'M45', name: 'Плеяды', ra: 56.75, dec: 24.12 },
  { id: 'hip-37826', name: 'Поллукс', ra: 116.33, dec: 28.03 },
  { id: 'hip-49669', name: 'Регул', ra: 152.09, dec: 11.97 },
  { id: 'hip-65474', name: 'Спика', ra: 201.3, dec: -11.16 },
  { id: 'hip-80763', name: 'Антарес', ra: 247.35, dec: -26.43 },
];

/**
 * Сближения Луны с планетами и яркими звёздами, планет между собой.
 * @returns {{jd, a, b, sep}[]} a и b — {id, name}
 */
export function conjunctions(jd0, jd1) {
  const out = [];
  const bodies = PLANETS.filter((p) => p.id !== 'neptune' && p.id !== 'uranus');
  // Луна — планеты и звёзды: шаг 2 часа, порог 4°.
  const moonRaDec = (jd) => { const m = moonAt(jd); return [m.ra, m.dec]; };
  // Сближения в лучах Солнца не наблюдаются — отбрасываем всё, что ближе 15° к нему.
  const farFromSun = (jd) => {
    const s = sunAt(jd), m = moonAt(jd);
    return separation(s.ra, s.dec, m.ra, m.dec) > 15;
  };
  for (const p of bodies) {
    const fn = (jd) => { const [r, d] = moonRaDec(jd); const q = planetAt(p.id, jd); return separation(r, d, q.ra, q.dec); };
    for (const m of minima(fn, jd0, jd1, 1 / 12, 4)) {
      if (farFromSun(m.jd)) out.push({ jd: m.jd, a: { id: 'moon', name: 'Луна' }, b: { id: p.id, name: p.name }, sep: m.value });
    }
  }
  for (const s of ECLIPTIC_STARS) {
    const fn = (jd) => { const [r, d] = moonRaDec(jd); const [sr, sd] = precess(s.ra, s.dec, jdTT(jd)); return separation(r, d, sr, sd); };
    for (const m of minima(fn, jd0, jd1, 1 / 12, 3)) {
      if (farFromSun(m.jd)) out.push({ jd: m.jd, a: { id: 'moon', name: 'Луна' }, b: { id: s.id, name: s.name }, sep: m.value });
    }
  }
  // Планеты между собой: шаг сутки, порог 3°.
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const A = bodies[i], Bb = bodies[j];
      const fn = (jd) => { const p = planetAt(A.id, jd), q = planetAt(Bb.id, jd); return separation(p.ra, p.dec, q.ra, q.dec); };
      for (const m of minima(fn, jd0, jd1, 1, 3)) {
        // Слишком близко к Солнцу — не наблюдается, пропускаем.
        const s = sunAt(m.jd), p = planetAt(A.id, m.jd);
        if (separation(s.ra, s.dec, p.ra, p.dec) < 12) continue;
        out.push({ jd: m.jd, a: { id: A.id, name: A.name }, b: { id: Bb.id, name: Bb.name }, sep: m.value });
      }
    }
  }
  return out.sort((x, y) => x.jd - y.jd);
}

// ---------- Противостояния, соединения с Солнцем, элонгации ----------

function lonFromSun(id, jd) {
  const tt = jdTT(jd);
  const p = planetPosition(id, tt, precessionMatrix(tt));
  const [lon] = eqToEcl(p.ra, p.dec, obliquity((tt - 2451545) / 36525));
  return norm180(lon - sunPosition(tt).lon);
}

export function planetEvents(jd0, jd1) {
  const out = [];
  for (const p of PLANETS) {
    const inner = p.id === 'mercury' || p.id === 'venus';
    if (!inner) {
      // Противостояние: разность долгот проходит через ±180.
      const f = (jd) => norm180(lonFromSun(p.id, jd) - 180);
      let a = jd0, fa = f(a);
      for (let t = jd0 + 2; t <= jd1; t += 2) {
        const fb = f(t);
        if (fa < 0 && fb >= 0 && fb - fa < 30) out.push({ kind: 'opposition', jd: bisect(f, a, t), planet: p });
        if (fa > 0 && fb <= 0 && fa - fb < 30) out.push({ kind: 'opposition', jd: bisect((x) => -f(x), a, t), planet: p });
        a = t; fa = fb;
      }
    } else {
      // Наибольшие элонгации — максимумы углового расстояния от Солнца.
      const el = (jd) => { const s = sunAt(jd), q = planetAt(p.id, jd); return separation(s.ra, s.dec, q.ra, q.dec); };
      for (const m of minima((jd) => -el(jd), jd0, jd1, 1, 0)) {
        out.push({ kind: 'elongation', jd: m.jd, planet: p, value: -m.value, evening: lonFromSun(p.id, m.jd) > 0 });
      }
    }
  }
  return out.sort((x, y) => x.jd - y.jd);
}

/**
 * Сводный календарь событий на ближайшие дни.
 * @param {{lat, lon}} observer
 * @param {number} jdStart
 * @param {number} days
 */
export function eventCalendar(observer, jdStart, days = 60) {
  const jd1 = jdStart + days;
  const list = [];
  for (const p of moonPhases(jdStart, jd1)) list.push({ jd: p.jd, kind: 'phase', phase: p.phase, title: PHASE_NAMES[p.phase] });
  for (const e of lunarEclipses(jdStart, jdStart + 400, observer)) list.push({ ...e });
  for (const e of solarEclipses(jdStart, jdStart + 400, observer)) list.push({ ...e });
  for (const c of conjunctions(jdStart, jd1)) list.push({ kind: 'conjunction', ...c });
  for (const e of planetEvents(jdStart, jdStart + Math.max(days, 120))) list.push(e);
  const from = dateFromJd(jdStart);
  for (const s of upcomingPeaks(from, days)) list.push({ kind: 'shower', jd: jdFromDate(s.date), shower: s.shower });
  return list.sort((a, b) => a.jd - b.jd);
}
