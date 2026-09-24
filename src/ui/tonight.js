// «Сегодня ночью»: сумерки, Луна, окна видимости планет, лучшее время для наблюдений.

import { jdFromDate } from '../astro/time.js';
import { sunEvents, riseTransitSet, H0 } from '../astro/riseset.js';
import { makeFrame, moonState, planetStates, sunAltitude } from '../astro/bodies.js';
import { PLANETS } from '../astro/planets.js';
import { activeShowers } from '../astro/showers.js';
import { localParts, msFromLocal } from './format.js';

/**
 * @param {{lat, lon, tz}} place
 * @param {number} ms момент, для которого нужна «ближайшая ночь»
 */
export function computeTonight(place, ms) {
  const lp = localParts(place.tz, ms);
  // Ночь «сегодня»: с местного полудня. До полудня — это ещё прошлая ночь.
  let noonMs = msFromLocal(place.tz, lp.y, lp.mo, lp.d, 12, 0);
  if (lp.h < 12) noonMs -= 86400000;
  const jd0 = jdFromDate(noonMs), jd1 = jd0 + 1;
  const sun = sunEvents(place, jd0, jd1);
  const first = (arr, type) => arr.find((e) => e.type === type)?.jd ?? null;
  const sunset = first(sun.sun, 'set'), sunrise = first(sun.sun, 'rise');
  const civilEnd = first(sun.civil, 'set'), civilStart = first(sun.civil, 'rise');
  const nautEnd = first(sun.nautical, 'set'), nautStart = first(sun.nautical, 'rise');
  const astroEnd = first(sun.astronomical, 'set'), astroStart = first(sun.astronomical, 'rise');

  // Самая низкая точка Солнца за ночь — чтобы понимать, будет ли вообще темно.
  let minAlt = 90, minJd = jd0;
  for (let t = jd0; t <= jd1; t += 1 / 48) {
    const a = sunAltitude(t, place);
    if (a < minAlt) { minAlt = a; minJd = t; }
  }
  const darkStart = astroEnd ?? nautEnd ?? civilEnd ?? sunset;
  const darkEnd = astroStart ?? nautStart ?? civilStart ?? sunrise;

  const moonRTS = riseTransitSet({ id: 'moon', kind: 'moon' }, place, jd0, jd1);
  const moonMid = moonState(makeFrame(minJd, place));

  // Окна видимости: Солнце ниже −7° (для ярких планет ниже −3°), планета выше 8°.
  const acc = PLANETS.map((p) => ({
    ...p,
    sunLimit: p.id === 'venus' || p.id === 'jupiter' ? -3 : p.id === 'mercury' ? -4 : -7,
    start: null, end: null, best: null, mag: 99,
  }));
  for (let t = jd0; t <= jd1; t += 1 / 96) {
    const sAlt = sunAltitude(t, place);
    if (sAlt > -3) continue;
    const states = planetStates(makeFrame(t, place));
    for (let i = 0; i < acc.length; i++) {
      const a = acc[i], st = states[i];
      a.mag = st.mag;
      if (sAlt > a.sunLimit || st.alt <= 8) continue;
      if (a.start === null) a.start = t;
      a.end = t;
      if (!a.best || st.alt > a.best.alt) a.best = { jd: t, alt: st.alt, az: st.az };
    }
  }
  if (acc.some((a) => a.mag === 99)) {
    const states = planetStates(makeFrame(minJd, place));
    acc.forEach((a, i) => { if (a.mag === 99) a.mag = states[i].mag; });
  }
  const planets = acc.map((a) => ({ ...a, naked: a.mag < 6, visible: a.start !== null && a.mag < 6 }));

  const date = new Date((minJd - 2440587.5) * 864e5);
  const showers = activeShowers(date).filter((s) => s.level > 0.15);

  // Лучшее окно: темно и Луна под горизонтом (или тонкий серп).
  let bestWindow = null;
  if (minAlt < -12) {
    let run = null;
    for (let t = jd0; t <= jd1; t += 1 / 96) {
      const dark = sunAltitude(t, place) < -15;
      const m = moonState(makeFrame(t, place));
      const moonOk = m.alt < 0 || m.illum < 0.25;
      if (dark && moonOk) {
        if (!run) run = { start: t, end: t };
        run.end = t;
      } else if (run) {
        if (!bestWindow || run.end - run.start > bestWindow.end - bestWindow.start) bestWindow = run;
        run = null;
      }
    }
    if (run && (!bestWindow || run.end - run.start > bestWindow.end - bestWindow.start)) bestWindow = run;
  }

  return {
    jd0, jd1, noonMs,
    sunset, sunrise, civilEnd, civilStart, nautEnd, nautStart, astroEnd, astroStart,
    darkStart, darkEnd, minSunAlt: minAlt, midnightJd: minJd,
    polarDay: !sunset && sun.altAt(jd0 + 0.5) > H0.sun,
    polarNight: !sunrise && !sunset && sun.altAt(jd0) < H0.sun,
    moon: { ...moonMid, rise: moonRTS.rises[0] ?? null, set: moonRTS.sets[0] ?? null, alwaysUp: moonRTS.alwaysUp, alwaysDown: moonRTS.alwaysDown },
    planets,
    showers,
    bestWindow,
  };
}

/** Ближайшая «тёмная» минута ночи (для первого показа неба днём). */
export function nightPreviewJd(tonight) {
  if (tonight.astroEnd) return tonight.astroEnd + 20 / 1440;
  if (tonight.nautEnd) return tonight.midnightJd;
  return tonight.midnightJd;
}

const PHASES = [
  [0.02, 'Новолуние'], [0.23, 'Растущий серп'], [0.27, 'Первая четверть'], [0.48, 'Растущая Луна'],
  [0.52, 'Полнолуние'], [0.73, 'Убывающая Луна'], [0.77, 'Последняя четверть'], [0.98, 'Убывающий серп'], [1.01, 'Новолуние'],
];

/** Название фазы по элонгации (0..360). */
export function phaseName(elong) {
  const x = elong / 360;
  return PHASES.find(([t]) => x <= t)[1];
}
