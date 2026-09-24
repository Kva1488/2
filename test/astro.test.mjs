// Проверка астрономического ядра по эталонным примерам Ж. Миуса
// («Астрономические алгоритмы», 2-е изд.) и по известным событиям на небе.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jdFromCalendar, jdFromDate, gmst, deltaT, jdTT } from '../src/astro/time.js';
import { precess, eqToHorizon, eqToEcl, refraction, obliquity } from '../src/astro/coords.js';
import { sunPosition } from '../src/astro/sun.js';
import { moonPosition, moonPhase } from '../src/astro/moon.js';
import { planetPosition } from '../src/astro/planets.js';
import { makeFrame, solarSystem } from '../src/astro/bodies.js';
import { riseTransitSet, sunEvents } from '../src/astro/riseset.js';
import { norm180, separation } from '../src/astro/math.js';

const near = (actual, expected, tol, msg = '') =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg} ожидалось ${expected} ± ${tol}, получено ${actual}`);
const nearAngle = (a, e, tol, msg) => near(norm180(a - e), 0, tol, `${msg} (${a} vs ${e})`);
const hms = (h, m, s) => (h + m / 60 + s / 3600) * 15;
const dms = (d, m, s) => Math.sign(d || 1) * (Math.abs(d) + m / 60 + s / 3600);

test('юлианская дата (Миус, пример 7.a)', () => {
  near(jdFromCalendar(1957, 10, 4, 19, 26, 24), 2436116.31, 1e-6);
  near(jdFromCalendar(2000, 1, 1, 12), 2451545.0, 1e-9);
  near(jdFromDate(new Date('1970-01-01T00:00:00Z')), 2440587.5, 1e-9);
});

test('годы 0–99 н. э. не превращаются в 1900-е', () => {
  near(jdFromCalendar(33, 1, 1) - jdFromCalendar(1933, 1, 1), -1900 * 365.2425, 2);
});

test('звёздное время (Миус, пример 12.a)', () => {
  // 1987 апреля 10, 0h UT: θ0 = 13h10m46.3668s
  nearAngle(gmst(2446895.5), hms(13, 10, 46.3668), 1e-5, 'GMST');
});

test('ΔT правдоподобна', () => {
  near(deltaT(2000), 63.86, 0.5);
  near(deltaT(2020), 71.4, 3);
});

test('прецессия (Миус, пример 21.b, θ Персея)', () => {
  const years = 28.86705;
  const ra0 = hms(2, 44, 11.986) + (0.03425 * years * 15) / 3600;
  const dec0 = dms(49, 13, 42.48) + (-0.0895 * years) / 3600;
  const [ra, dec] = precess(ra0, dec0, 2462088.69);
  nearAngle(ra, 41.547214, 2e-5, 'RA');
  near(dec, 49.348483, 2e-5, 'Dec');
});

test('наклон эклиптики (Миус, пример 22.a)', () => {
  // ε0 = 23°26′27.407″ для 1987 апреля 10
  near(obliquity((2446895.5 - 2451545) / 36525), dms(23, 26, 27.407), 1e-5);
});

test('горизонтальные координаты (Миус, пример 13.b)', () => {
  // Венера из обсерватории ВМС США, 1987 апреля 10, 19:21 UT
  const lst = gmst(2446896.30625) - dms(77, 3, 56);
  const [az, alt] = eqToHorizon(hms(23, 9, 16.641), dms(-6, 43, 11.61), lst, dms(38, 55, 17));
  near(alt, 15.1249, 2e-3, 'высота');
  // Миус отсчитывает азимут от юга: 68.0337° → от севера 248.0337°
  nearAngle(az, 248.0337, 2e-3, 'азимут');
});

test('рефракция у видимого горизонта около 34′', () => {
  // Формула Сэмундссона берёт истинную высоту: видимый горизонт — это истинные −0.57°.
  near(refraction(-0.5667) * 60, 34.4, 1);
  near(refraction(45) * 60, 1.0, 0.1);
  assert.equal(refraction(-5), 0);
});

test('Солнце (Миус, пример 25.a)', () => {
  const s = sunPosition(2448908.5);
  near(s.lon, 199.90895, 0.003, 'долгота');
  nearAngle(s.ra, 198.38083, 0.005, 'RA');
  near(s.dec, -7.78507, 0.005, 'Dec');
  near(s.dist, 0.99766, 1e-4, 'R');
});

test('Луна (Миус, пример 47.a)', () => {
  const m = moonPosition(2448724.5);
  nearAngle(m.lon, 133.162655, 0.005, 'λ');
  near(m.lat, -3.229126, 0.005, 'β');
  near(m.dist, 368409.7, 20, 'Δ');
});

test('фаза Луны (Миус, пример 48.a)', () => {
  const ph = moonPhase(2448724.5);
  near(ph.illum, 0.6786, 0.005, 'k');
  assert.equal(ph.waxing, true);
});

test('Венера (Миус, пример 33.a)', () => {
  const p = planetPosition('venus', 2448976.5);
  nearAngle(p.ra, hms(21, 4, 41.454), 0.05, 'RA');
  near(p.dec, dms(-18, 53, 16.84), 0.05, 'Dec');
  near(p.dist, 0.910947, 0.0005, 'Δ');
  near(p.mag, -4.2, 0.2, 'блеск');
});

const elongation = (jdUT, id) => {
  const f = makeFrame(jdUT, { lat: 0, lon: 0 });
  const s = sunPosition(f.jdTT);
  const p = planetPosition(id, f.jdTT, f.prec);
  return separation(s.ra, s.dec, p.ra, p.dec);
};

// Противостояние — это разность эклиптических долгот Солнца и планеты ровно 180°.
const lonFromSun = (utc, id) => {
  const f = makeFrame(jdFromDate(new Date(utc)), { lat: 0, lon: 0 });
  const s = sunPosition(f.jdTT);
  const p = planetPosition(id, f.jdTT, f.prec);
  const [lon] = eqToEcl(p.ra, p.dec, obliquity((f.jdTT - 2451545) / 36525));
  return norm180(lon - s.lon);
};

test('противостояния планет в известные моменты', () => {
  nearAngle(lonFromSun('2025-01-16T02:32Z', 'mars'), 180, 0.1, 'Марс');
  nearAngle(lonFromSun('2024-12-07T20:59Z', 'jupiter'), 180, 0.1, 'Юпитер');
  nearAngle(lonFromSun('2025-09-21T05:45Z', 'saturn'), 180, 0.1, 'Сатурн');
});

test('блеск планет в противостоянии', () => {
  const mag = (utc, id) => {
    const f = makeFrame(jdFromDate(new Date(utc)), { lat: 0, lon: 0 });
    return planetPosition(id, f.jdTT, f.prec).mag;
  };
  near(mag('2025-01-16T00:00Z', 'mars'), -1.4, 0.15, 'Марс');
  near(mag('2024-12-07T00:00Z', 'jupiter'), -2.8, 0.15, 'Юпитер');
  near(mag('2025-09-21T00:00Z', 'saturn'), 0.6, 0.2, 'Сатурн (кольца почти с ребра)');
});

test('наибольшая восточная элонгация Венеры 10.01.2025 ≈ 47°', () => {
  near(elongation(jdFromCalendar(2025, 1, 10), 'venus'), 47.2, 0.5);
});

test('великое соединение Юпитера и Сатурна 21.12.2020', () => {
  const jd = jdTT(jdFromCalendar(2020, 12, 21, 18));
  const j = planetPosition('jupiter', jd), s = planetPosition('saturn', jd);
  assert.ok(separation(j.ra, j.dec, s.ra, s.dec) < 0.15);
});

test('полное солнечное затмение 08.04.2024 из Далласа', () => {
  const obs = { lat: 32.78, lon: -96.8 };
  const f = makeFrame(jdFromDate(new Date('2024-04-08T18:42:30Z')), obs);
  const { sun, moon } = solarSystem(f);
  const sep = separation(sun.ra, sun.dec, moon.ra, moon.dec);
  assert.ok(sep < 0.05, `разнесение ${sep}°`);
  assert.ok(moon.diameter > sun.diameter, 'Луна больше Солнца — затмение полное');
});

test('полнолуние 07.10.2025 03:48 UT', () => {
  const f = makeFrame(jdFromDate(new Date('2025-10-07T03:48:00Z')), { lat: 0, lon: 0 });
  const { moon } = solarSystem(f);
  near(moon.illum, 1, 0.002);
});

test('восход и заход Солнца в Москве 21.06.2025', () => {
  const obs = { lat: 55.7558, lon: 37.6173 };
  const jd0 = jdFromDate(new Date('2025-06-20T21:00:00Z')); // полночь по МСК
  const ev = sunEvents(obs, jd0, jd0 + 1);
  const rise = ev.sun.find((e) => e.type === 'rise');
  const set = ev.sun.find((e) => e.type === 'set');
  const msk = (jd) => new Date((jd - 2440587.5) * 864e5 + 3 * 36e5).toISOString().slice(11, 16);
  assert.equal(msk(rise.jd), '03:44');
  assert.ok(['21:17', '21:18', '21:19'].includes(msk(set.jd)), msk(set.jd));
  assert.equal(ev.astronomical.length, 0, 'в июне в Москве нет астрономической ночи');
});

test('полярная ночь в Мурманске 21.12.2025', () => {
  const obs = { lat: 68.97, lon: 33.07 };
  const jd0 = jdFromDate(new Date('2025-12-20T21:00:00Z'));
  const r = riseTransitSet({ id: 'sun', kind: 'sun' }, obs, jd0, jd0 + 1);
  assert.equal(r.rises.length, 0);
  assert.equal(r.alwaysDown, true);
});

test('восход и заход Венеры в Бостоне (Миус, пример 15.a)', () => {
  const obs = { lat: 42.3333, lon: -71.0833 };
  const jd0 = jdFromCalendar(1988, 3, 20);
  const r = riseTransitSet({ id: 'venus', kind: 'planet' }, obs, jd0, jd0 + 1);
  const ut = (jd) => ((jd - jd0) * 24);
  near(ut(r.rises[0]), 12 + 25 / 60, 4 / 60, 'восход');
  near(ut(r.transits[0].jd), 19 + 41 / 60, 3 / 60, 'кульминация');
  near(ut(r.sets[0]), 2 + 55 / 60, 4 / 60, 'заход');
});
