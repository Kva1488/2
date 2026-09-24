// Календарь событий сверяется с каталогами затмений NASA (Эспенак) и таблицами фаз Луны.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jdFromDate, dateFromJd } from '../src/astro/time.js';
import { moonPhases, lunarEclipses, solarEclipses, localSolarEclipse, conjunctions, planetEvents, overlapFraction } from '../src/astro/events.js';
import { activeShowers, activity, SHOWERS } from '../src/astro/showers.js';

const jd = (s) => jdFromDate(new Date(s));
const minutesBetween = (a, b) => Math.abs(a - b) * 1440;

test('фазы Луны в октябре 2025', () => {
  const ph = moonPhases(jd('2025-10-01T00:00Z'), jd('2025-11-01T00:00Z'));
  const full = ph.find((p) => p.phase === 2);
  const newm = ph.find((p) => p.phase === 0);
  assert.ok(minutesBetween(full.jd, jd('2025-10-07T03:48Z')) < 10, dateFromJd(full.jd).toISOString());
  assert.ok(minutesBetween(newm.jd, jd('2025-10-21T12:25Z')) < 10, dateFromJd(newm.jd).toISOString());
  assert.equal(ph.length, 4);
});

test('лунные затмения 2025–2026 по каталогу NASA', () => {
  const list = lunarEclipses(jd('2025-01-01T00:00Z'), jd('2027-01-01T00:00Z'));
  const got = list.map((e) => [dateFromJd(e.jd).toISOString().slice(0, 10), e.type]);
  assert.deepEqual(got, [
    ['2025-03-14', 'total'],
    ['2025-09-07', 'total'],
    ['2026-03-03', 'total'],
    ['2026-08-28', 'partial'],
  ]);
  const m = list[0];
  assert.ok(minutesBetween(m.jd, jd('2025-03-14T06:58:43Z')) < 5, 'момент максимума');
  assert.ok(Math.abs(m.magnitude - 1.178) < 0.03, `фаза ${m.magnitude}`);
  assert.ok(minutesBetween(m.total[0], jd('2025-03-14T06:26Z')) < 4, 'начало полной фазы');
  assert.ok(minutesBetween(m.total[1], jd('2025-03-14T07:31Z')) < 4, 'конец полной фазы');
  assert.ok(Math.abs(list[3].magnitude - 0.93) < 0.03, `частное 28.08.2026: ${list[3].magnitude}`);
});

test('солнечные затмения 2025–2027 по каталогу NASA', () => {
  const list = solarEclipses(jd('2025-01-01T00:00Z'), jd('2027-12-31T00:00Z'));
  const got = list.map((e) => [dateFromJd(e.jd).toISOString().slice(0, 10), e.type]);
  assert.deepEqual(got, [
    ['2025-03-29', 'partial'],
    ['2025-09-21', 'partial'],
    ['2026-02-17', 'annular'],
    ['2026-08-12', 'total'],
    ['2027-02-06', 'annular'],
    ['2027-08-02', 'total'],
  ]);
});

test('местные обстоятельства: 08.04.2024 в Далласе — полное, в Сиднее — не видно', () => {
  const dallas = localSolarEclipse({ lat: 32.78, lon: -96.8 }, jd('2024-04-08T18:17Z'));
  assert.equal(dallas.type, 'total');
  assert.ok(minutesBetween(dallas.jd, jd('2024-04-08T18:42:40Z')) < 3, dateFromJd(dallas.jd).toISOString());
  assert.ok(dallas.magnitude > 1);
  assert.equal(localSolarEclipse({ lat: -33.87, lon: 151.21 }, jd('2024-04-08T18:17Z')), null);
});

test('площадь перекрытия дисков', () => {
  assert.equal(overlapFraction(1, 1, 3), 0);
  assert.equal(overlapFraction(1, 1.05, 0), 1);
  assert.ok(Math.abs(overlapFraction(1, 0.9, 0) - 0.81) < 1e-9);
  const half = overlapFraction(1, 1, 0.8079);
  assert.ok(Math.abs(half - 0.5) < 0.01, `${half}`);
});

test('великое соединение Юпитера и Сатурна найдено 21.12.2020', () => {
  const list = conjunctions(jd('2020-12-10T00:00Z'), jd('2020-12-31T00:00Z'));
  const js = list.find((c) => c.a.id === 'jupiter' && c.b.id === 'saturn');
  assert.ok(js, 'соединение найдено');
  // Минимум очень пологий (0.1° меняется за сутки на секунды дуги), поэтому допуск по времени — полсуток.
  assert.ok(Math.abs(js.jd - jd('2020-12-21T18:20Z')) < 0.5, dateFromJd(js.jd).toISOString());
  assert.ok(Math.abs(js.sep - 0.102) < 0.01, `${js.sep}`);
});

test('противостояние Сатурна 21.09.2025 и элонгация Венеры 10.01.2025', () => {
  const ev = planetEvents(jd('2024-12-01T00:00Z'), jd('2025-10-01T00:00Z'));
  const sat = ev.find((e) => e.kind === 'opposition' && e.planet.id === 'saturn');
  assert.equal(dateFromJd(sat.jd).toISOString().slice(0, 10), '2025-09-21');
  const ven = ev.find((e) => e.kind === 'elongation' && e.planet.id === 'venus');
  assert.equal(dateFromJd(ven.jd).toISOString().slice(0, 10), '2025-01-10');
  assert.equal(ven.evening, true, 'вечерняя видимость');
});

test('Персеиды активны 12 августа и молчат в марте', () => {
  const per = SHOWERS.find((s) => s.id === 'PER');
  assert.ok(activity(per, new Date('2025-08-12T00:00Z')) > 0.9);
  assert.equal(activity(per, new Date('2025-03-01T00:00Z')), 0);
  assert.ok(activeShowers(new Date('2025-12-14T00:00Z')).some((a) => a.shower.id === 'GEM'));
  assert.ok(activeShowers(new Date('2026-01-03T00:00Z')).some((a) => a.shower.id === 'QUA'), 'сезон через Новый год');
});
