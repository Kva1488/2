// Проверка данных и поиска созвездия по координатам.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STARS, STAR_STRIDE, STAR_NAMES } from '../src/data/stars.js';
import { CONSTELLATIONS, CON_LINES } from '../src/data/constellations.js';
import { MESSIER } from '../src/data/messier.js';
import { constellationAt } from '../src/astro/constellation.js';
import { CITIES } from '../src/data/cities.js';
import { STAR_LORE, DSO_LORE, CON_GENITIVE } from '../src/data/lore.js';

test('каталог звёзд отсортирован по блеску и начинается с Сириуса', () => {
  assert.equal(STARS[4], 32349);
  let prev = -Infinity;
  for (let i = 0; i < STARS.length; i += STAR_STRIDE) {
    assert.ok(STARS[i + 2] >= prev);
    prev = STARS[i + 2];
  }
  assert.ok(STARS.length / STAR_STRIDE > 5000);
});

test('все 88 созвездий с русскими названиями и родительным падежом', () => {
  const ids = Object.keys(CONSTELLATIONS);
  assert.equal(ids.length, 88);
  for (const id of ids) {
    assert.ok(CONSTELLATIONS[id].ru, id);
    assert.ok(CON_GENITIVE[id], `родительный падеж для ${id}`);
    assert.ok(CON_LINES[id]?.length, `линии для ${id}`);
  }
});

// Номера Флемстида исторически закреплены за «старыми» созвездиями: 10 Большой Медведицы
// на деле лежит в Рыси, 24 Скорпиона — в Змееносце. Поэтому сверяемся только по буквам Байера.
test('поиск созвездия совпадает с обозначениями Байера для ≥ 99.5% звёзд', () => {
  let total = 0, ok = 0;
  const bad = [];
  for (let i = 0; i < STARS.length; i += STAR_STRIDE) {
    const n = STAR_NAMES[STARS[i + 4]];
    if (!n || !n[2] || !n[4]) continue;
    total++;
    const c = constellationAt(STARS[i], STARS[i + 1]);
    if (c === n[4]) ok++;
    else if (bad.length < 10) bad.push(`${STARS[i + 4]}: ${c} ≠ ${n[4]}`);
  }
  assert.ok(total > 1300, `${total}`);
  assert.ok(ok / total >= 0.995, `${ok}/${total}; ${bad.join(', ')}`);
});

test('знаменитые «беглецы»: 10 UMa в Рыси, 24 Sco в Змееносце, 2 UMi в Цефее', () => {
  assert.equal(constellationAt(135.1599, 41.7829), 'Lyn');
  assert.equal(constellationAt(250.3933, -17.7422), 'Oph');
  assert.equal(constellationAt(17.187, 86.2571), 'Cep');
});

test('известные точки: полюса, Сириус, Вега, M31', () => {
  assert.equal(constellationAt(0, 89.9), 'UMi');
  assert.equal(constellationAt(180, -89.9), 'Oct');
  assert.equal(constellationAt(101.287, -16.716), 'CMa');
  assert.equal(constellationAt(279.235, 38.784), 'Lyr');
  assert.equal(constellationAt(10.68, 41.27), 'And');
});

test('Мессье: 110 объектов, у самых известных есть русские имена', () => {
  assert.equal(MESSIER.length, 110);
  const byId = Object.fromEntries(MESSIER.map((m) => [m[0], m]));
  assert.equal(byId.M31[7], 'Галактика Андромеды');
  assert.equal(byId.M45[7], 'Плеяды');
});

test('справочники: расстояния заданы для ярких звёзд и объектов', () => {
  assert.ok(STAR_LORE[32349].ly > 8 && STAR_LORE[32349].ly < 9, 'Сириус ~8.6 св. лет');
  assert.ok(DSO_LORE.M31.ly > 2e6);
  for (const [hip] of Object.entries(STAR_LORE)) assert.ok(STAR_NAMES[hip], `HIP ${hip} есть в каталоге`);
});

test('города: корректные координаты и часовые пояса', () => {
  assert.ok(CITIES.length > 80);
  for (const c of CITIES) {
    assert.ok(Math.abs(c.lat) <= 90 && Math.abs(c.lon) <= 180, c.name);
    assert.doesNotThrow(() => new Intl.DateTimeFormat('ru', { timeZone: c.tz }), c.name);
  }
});
