// Генерация компактных модулей данных из каталогов d3-celestial (BSD-3-Clause, © Olaf Frohn).
// Запуск: npm run data. Результат коммитится в src/data/, поэтому сборке не нужен интернет.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const dataDir = join(dirname(require.resolve('d3-celestial/package.json')), 'data');
const load = (name) => JSON.parse(readFileSync(join(dataDir, name), 'utf8'));
const outDir = join(root, 'src', 'data');
mkdirSync(outDir, { recursive: true });

const r = (x, d) => Number(x.toFixed(d));
const ra360 = (lon) => (lon < 0 ? lon + 360 : lon);
const clean = (s) => (s || '').replace(/[  ‎]/g, ' ').replace(/\s+/g, ' ').trim();

const header = (what) =>
  `// Сгенерировано scripts/build-data.mjs — не редактировать вручную.\n` +
  `// ${what}\n// Источник: каталоги d3-celestial (BSD-3-Clause, © 2015 Olaf Frohn), данные Hipparcos / HYG / IAU.\n\n`;

// ---------- Звёзды ----------
const stars = load('stars.6.json').features;
const starnames = load('starnames.json');

// Уточнения русских имён: исправления и более привычные варианты.
const RU_FIX = {
  11767: 'Полярная звезда',
  54879: 'Хертан',
  68002: 'Аль-Наир', // ζ Центавра, чтобы не путать с Альнаиром (α Журавля)
  71683: 'Альфа Центавра',
  71681: 'Толиман',
  67301: 'Бенетнаш',
  74785: 'Зубен-эль-Шемали',
  72622: 'Зубен-эль-Генуби',
  86032: 'Рас-Альхаг',
  84345: 'Рас-Альгети',
  9884: 'Хамаль',
  25428: 'Эльнат',
  107259: 'Гранатовая звезда Гершеля',
  65477: 'Алькор',
  65378: 'Мицар',
  17702: 'Альциона',
};

const names = {};
for (const [hip, n] of Object.entries(starnames)) {
  const ru = RU_FIX[hip] || clean(n.ru);
  const bayer = clean(n.bayer);
  const flam = clean(n.flam);
  const con = n.c || '';
  if (!ru && !bayer && !flam) continue;
  names[hip] = [ru, clean(n.name), bayer, flam, con];
}

const starRows = stars
  .map((f) => {
    const [lon, lat] = f.geometry.coordinates;
    const bv = parseFloat(f.properties.bv);
    return [r(ra360(lon), 4), r(lat, 4), r(f.properties.mag, 2), Number.isFinite(bv) ? r(bv, 2) : 0.6, f.id];
  })
  .sort((a, b) => a[2] - b[2]);

const namedHips = new Set(starRows.map((s) => String(s[4])));
const namesOut = Object.fromEntries(Object.entries(names).filter(([hip]) => namedHips.has(hip)));

writeFileSync(
  join(outDir, 'stars.js'),
  header(`${starRows.length} звёзд до 6.5m, отсортированы по блеску: [RA°, Dec°, m, B−V, HIP] (J2000).`) +
    `export const STARS = ${JSON.stringify(starRows.flat())};\nexport const STAR_STRIDE = 5;\n\n` +
    `// HIP → [русское имя, международное имя, буква Байера, номер Флемстида, созвездие]\n` +
    `export const STAR_NAMES = ${JSON.stringify(namesOut)};\n`,
);

// ---------- Созвездия ----------
const cons = load('constellations.json').features;
const lines = load('constellations.lines.json').features;
const bounds = load('constellations.bounds.json').features;

const conMeta = {};
for (const f of cons) {
  const p = f.properties;
  const [lon, lat] = f.geometry.coordinates;
  if (!conMeta[f.id]) conMeta[f.id] = { ru: clean(p.ru), la: p.name, gen: p.gen, rank: +p.rank, ra: r(ra360(lon), 2), dec: r(lat, 2) };
}

const conLines = {};
for (const f of lines) {
  const polys = f.geometry.coordinates.map((line) => line.flatMap(([lon, lat]) => [r(ra360(lon), 3), r(lat, 3)]));
  conLines[f.id] = (conLines[f.id] || []).concat(polys);
}

const conBounds = bounds.map((f) => [f.id, f.geometry.coordinates[0].flatMap(([lon, lat]) => [r(lon, 4), r(lat, 4)])]);

writeFileSync(
  join(outDir, 'constellations.js'),
  header('88 созвездий: названия, фигуры (линии между звёздами), границы IAU.') +
    `// id → { ru, la (латинское), gen (латинский родительный), rank (1 — крупные), ra, dec (место подписи) }\n` +
    `export const CONSTELLATIONS = ${JSON.stringify(conMeta)};\n\n` +
    `// id → массив ломаных [ra, dec, ra, dec, ...], градусы J2000\n` +
    `export const CON_LINES = ${JSON.stringify(conLines)};\n\n` +
    `// [id, [lon, lat, ...]] — замкнутые многоугольники границ, долгота −180..180, J2000\n` +
    `export const CON_BOUNDS = ${JSON.stringify(conBounds)};\n`,
);

// ---------- Объекты Мессье ----------
const messier = load('messier.json').features;
const dsonames = load('dsonames.json');
const DSO_RU = {
  M1: 'Крабовидная туманность', M8: 'Туманность Лагуна', M13: 'Шаровое скопление в Геркулесе',
  M16: 'Туманность Орёл', M17: 'Туманность Омега', M20: 'Тройная туманность', M27: 'Туманность Гантель',
  M31: 'Галактика Андромеды', M33: 'Галактика Треугольника', M42: 'Туманность Ориона', M44: 'Ясли',
  M45: 'Плеяды', M51: 'Галактика Водоворот', M57: 'Туманность Кольцо', M63: 'Галактика Подсолнух',
  M64: 'Галактика Чёрный Глаз', M81: 'Галактика Боде', M82: 'Галактика Сигара', M83: 'Южная Вертушка',
  M87: 'Галактика Дева A', M97: 'Туманность Сова', M101: 'Галактика Вертушка', M104: 'Галактика Сомбреро',
  M7: 'Скопление Птолемея', M6: 'Скопление Бабочка', M11: 'Скопление Дикая Утка', M22: 'Большое скопление Стрельца',
  M24: 'Звёздное облако Стрельца', M4: 'Шаровое скопление M4', M5: 'Шаровое скопление M5', M3: 'Шаровое скопление M3',
  M92: 'Шаровое скопление M92', M15: 'Шаровое скопление Пегаса', M35: 'Скопление M35 в Близнецах',
  M36: 'Скопление Вертушка', M37: 'Скопление M37 в Возничем', M38: 'Скопление Морская Звезда', M41: 'Скопление M41 в Большом Псе',
};
const messierRows = messier.map((f) => {
  const p = f.properties;
  const [lon, lat] = f.geometry.coordinates;
  const dim = String(p.dim || '').split('x').map(Number).filter(Number.isFinite);
  const alt = dsonames[f.id] || dsonames[String(p.desig).replace(/\s/g, '')] || {};
  const ru = DSO_RU[f.id] || clean(alt.ru) || '';
  return [f.id, r(ra360(lon), 3), r(lat, 3), p.mag, p.type, dim[0] || 0, dim[1] || dim[0] || 0, ru, p.desig || ''];
});

writeFileSync(
  join(outDir, 'messier.js'),
  header('Каталог Мессье: [id, RA°, Dec°, m, тип, размер′, размер′, русское имя, обозначение NGC/IC].') +
    `export const MESSIER = ${JSON.stringify(messierRows)};\n`,
);

console.log(`звёзд: ${starRows.length}, имён: ${Object.keys(namesOut).length}, созвездий: ${Object.keys(conMeta).length}, границ: ${conBounds.length}, Мессье: ${messierRows.length}`);
