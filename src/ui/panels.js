// Содержимое боковой панели: «Сегодня ночью», «События», карточка объекта.

import {
  fmtTimeJd, fmtMag, whereInSky, fmtDistanceKm, fmtLy, fmtDuration, lightStory, fmtRa, fmtDec, num, plural, fmtDate, dirWords, localParts,
} from './format.js';
import { phaseName } from './tonight.js';
import { msFromJd } from '../astro/time.js';
import { PHASE_NAMES } from '../astro/events.js';
import { BORTLE_NAMES } from '../sky/atmosphere.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function moonGlyph(illum, waxing, size = 22) {
  // Маленькая SVG-луна с правильной фазой (северное полушарие: растущая освещена справа).
  const r = size / 2 - 1, c = size / 2;
  const k = 2 * illum - 1; // −1 новолуние … 1 полнолуние
  const rx = Math.abs(k) * r;
  const lit = '#f1eee5', dark = '#1b2233';
  const sweep = waxing ? 1 : 0;
  const d = `M ${c} ${c - r} A ${r} ${r} 0 0 ${sweep} ${c} ${c + r} A ${rx} ${r} 0 0 ${k > 0 ? sweep : 1 - sweep} ${c} ${c - r} Z`;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true"><circle cx="${c}" cy="${c}" r="${r}" fill="${dark}" stroke="rgba(255,255,255,.15)"/><path d="${d}" fill="${lit}"/></svg>`;
}

const t = (tz, jd) => (jd ? fmtTimeJd(tz, jd) : '—');

export function tonightHTML(T, place, extra) {
  const tz = place.tz;
  const dateLabel = `${fmtDate(tz, T.noonMs)} — ${fmtDate(tz, T.noonMs + 86400000)}`;
  let html = `<h2 class="h-display">Ночь на ${esc(dateLabel)}</h2><p class="sub">${esc(place.name)} · ${fmtLatLon(place)}</p>`;

  // Итог в одну строку: что главное этой ночью.
  const visible = T.planets.filter((p) => p.visible);
  const dark = T.minSunAlt < -18;
  let verdict;
  if (T.polarDay) verdict = { cls: 'warn', text: 'Полярный день: Солнце не заходит, звёзд не будет.' };
  else if (T.minSunAlt > -6) verdict = { cls: 'warn', text: 'Белая ночь: небо не темнеет дальше гражданских сумерек. Видны только самые яркие звёзды и планеты.' };
  else if (!dark) verdict = { cls: '', text: 'Настоящей тьмы не будет — Солнце не опустится ниже 18°. Звёзды видны, но Млечный Путь бледный.' };
  else if (T.bestWindow && T.bestWindow.end - T.bestWindow.start > 1 / 48) {
    verdict = { cls: 'good', text: `Лучшее время для наблюдений: <b class="mono">${t(tz, T.bestWindow.start)}–${t(tz, T.bestWindow.end)}</b> — тёмное небо без Луны.` };
  } else if (T.moon.illum > 0.6) verdict = { cls: 'warn', text: `Яркая Луна (${Math.round(T.moon.illum * 100)}%) засветит слабые звёзды и Млечный Путь. Хорошее время для Луны и планет.` };
  else verdict = { cls: 'good', text: `Темно с <b class="mono">${t(tz, T.darkStart)}</b> до <b class="mono">${t(tz, T.darkEnd)}</b>.` };
  const planetsLine = visible.length
    ? ` Из планет ${visible.length === 1 ? 'видна' : 'видны'}: ${visible.sort((a, b) => a.mag - b.mag).map((p) => p.name).join(', ')}.`
    : '';
  html += `<div class="callout ${verdict.cls}" style="margin-top:14px">${verdict.text}${planetsLine}</div>`;

  // Сумерки.
  html += `<div class="h-section">Солнце и сумерки</div><div class="twilight">`;
  const rowsTw = [
    ['#e8a35c', 'Заход Солнца', T.sunset],
    ['#4d6aa6', 'Конец гражданских сумерек', T.civilEnd],
    ['#2a3d6b', 'Конец навигационных', T.nautEnd],
    ['#141d36', 'Полная темнота', T.astroEnd],
    ['#141d36', 'Начало утренних сумерек', T.astroStart],
    ['#e8a35c', 'Восход Солнца', T.sunrise],
  ];
  for (const [c, label, jd] of rowsTw) {
    if (!jd && (label === 'Полная темнота' || label === 'Начало утренних сумерек') && T.minSunAlt > -18) continue;
    html += `<span class="sw" style="background:${c}"></span><span>${label}</span><span class="tm">${t(tz, jd)}</span>`;
  }
  html += `</div>`;

  // Луна.
  const m = T.moon;
  const moonTimes = m.alwaysUp ? 'не заходит' : m.alwaysDown ? 'не восходит' : `восход ${t(tz, m.rise)} · заход ${t(tz, m.set)}`;
  html += `<div class="h-section">Луна</div>
  <button class="row" data-select="moon" type="button"><span class="glyph">${moonGlyph(m.illum, m.waxing)}</span>
  <span><span class="t">${phaseName(m.elong)}</span><br><span class="d">${moonTimes}</span></span><span class="r">${Math.round(m.illum * 100)}%</span></button>`;

  // Планеты.
  html += `<div class="h-section">Планеты</div><div class="rows">`;
  const sorted = [...T.planets].sort((a, b) => (b.visible - a.visible) || a.mag - b.mag);
  for (const p of sorted) {
    if (!p.naked && !p.visible) continue;
    let d;
    if (p.visible) {
      d = `${t(tz, p.start)}–${t(tz, p.end)}, выше всего в ${t(tz, p.best.jd)} ${dirWords(p.best.az)}`;
    } else d = 'не видна: слишком близко к Солнцу или под горизонтом';
    html += `<button class="row ${p.visible ? '' : 'dim'}" data-select="${p.id}" type="button"><span class="glyph"><span class="planet-dot" style="color:${p.color}"></span></span>
      <span><span class="t">${p.name}</span><br><span class="d">${d}</span></span><span class="r">${fmtMag(p.mag)}<sup>m</sup></span></button>`;
  }
  html += `</div>`;

  if (T.showers.length) {
    html += `<div class="h-section">Метеорные потоки</div><div class="rows">`;
    for (const s of T.showers) {
      html += `<div class="row"><span class="glyph">✶</span><span><span class="t">${s.shower.name}</span><br><span class="d">до ${Math.round(s.zhrNow)} метеоров в час в идеальных условиях · ${s.shower.parent}</span></span><span class="r">${s.level > 0.8 ? 'максимум' : ''}</span></div>`;
    }
    html += `</div>`;
  }

  // Сейчас на небе.
  if (extra.brightest.length) {
    html += `<div class="h-section">Самое яркое прямо сейчас</div><div class="rows">`;
    for (const b of extra.brightest) {
      html += `<button class="row" data-select="${esc(b.key)}" type="button"><span class="glyph"><span class="planet-dot" style="color:${b.color}"></span></span>
        <span><span class="t">${esc(b.name)}</span><br><span class="d">${whereInSky(b.az, b.alt)}</span></span><span class="r">${fmtMag(b.mag)}<sup>m</sup></span></button>`;
    }
    html += `</div>`;
  }

  html += `<div class="h-section">Условия</div><p class="muted" style="margin:0">Засветка: ${BORTLE_NAMES[extra.bortle]} (${extra.bortle} по шкале Бортля). Сейчас видны звёзды до <span class="mono">${fmtMag(extra.lm)}<sup>m</sup></span>. Изменить можно в слоях.</p>`;
  return html;
}

function fmtLatLon(p) {
  const lat = `${Math.abs(p.lat).toFixed(2).replace('.', ',')}° ${p.lat >= 0 ? 'с. ш.' : 'ю. ш.'}`;
  const lon = `${Math.abs(p.lon).toFixed(2).replace('.', ',')}° ${p.lon >= 0 ? 'в. д.' : 'з. д.'}`;
  return `${lat}, ${lon}`;
}

// ---------------------------------------------------------------- события

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const ECL_TYPES = { total: 'Полное', partial: 'Частное', annular: 'Кольцеобразное', penumbral: 'Полутеневое' };

export function describeEvent(e, tz) {
  switch (e.kind) {
    case 'phase':
      return { icon: moonGlyph([0, 0.5, 1, 0.5][e.phase], e.phase <= 2 && e.phase > 0, 20), title: PHASE_NAMES[e.phase], detail: `в ${t(tz, e.jd)}` };
    case 'conjunction': {
      const sep = e.sep < 1 ? `${num(e.sep * 60)}′` : `${num(e.sep, 1)}°`;
      return { icon: '☌', title: `${e.a.name} и ${e.b.name}`, detail: `сближение до ${sep} около ${t(tz, e.jd)}` };
    }
    case 'opposition':
      return { icon: '☍', title: `Противостояние: ${e.planet.name}`, detail: 'видна всю ночь, ближе и ярче всего в году', hot: e.planet.id === 'mars' || e.planet.id === 'jupiter' || e.planet.id === 'saturn' };
    case 'elongation':
      return { icon: '◐', title: `${e.planet.name}: наибольшая элонгация`, detail: `${num(e.value, 1)}° от Солнца, ${e.evening ? 'вечерняя видимость — ищите на западе после заката' : 'утренняя видимость — ищите на востоке до рассвета'}` };
    case 'shower':
      return { icon: '✶', title: `Максимум: ${e.shower.name}`, detail: `до ${e.shower.zhr} метеоров в час · ${e.shower.parent}`, hot: e.shower.zhr >= 50 };
    case 'lunar-eclipse': {
      const v = e.visibility;
      const vis = !v ? '' : v.atMax ? (v.fraction > 0.95 ? 'видно у вас целиком' : 'видно у вас') : v.fraction > 0 ? 'у вас видно частично' : 'у вас не видно';
      const phases = e.total ? `полная фаза ${t(tz, e.total[0])}–${t(tz, e.total[1])}` : e.partial ? `частные фазы ${t(tz, e.partial[0])}–${t(tz, e.partial[1])}` : `максимум в ${t(tz, e.jd)}`;
      return { icon: '●', title: `${ECL_TYPES[e.type]} лунное затмение`, detail: `${phases} · ${vis}`, hot: e.type !== 'penumbral' && v && (v.atMax || v.fraction > 0) };
    }
    case 'solar-eclipse': {
      const L = e.local;
      const low = L && L.sunAlt < 4 ? ', Солнце у самого горизонта' : '';
      const local = L
        ? `у вас: ${L.type === 'total' ? 'полное' : L.type === 'annular' ? 'кольцеобразное' : `частное, закроется ${Math.max(1, Math.round(L.obscuration * 100))}% диска`}, максимум в ${t(tz, L.jd)}${low}`
        : 'у вас не видно';
      return { icon: '◑', title: `${ECL_TYPES[e.type]} солнечное затмение`, detail: local, hot: !!L };
    }
    default:
      return { icon: '·', title: e.title || '', detail: '' };
  }
}

export function eventsHTML(list, place) {
  if (!list) return '<p class="spinner">Считаем события на два месяца вперёд…</p>';
  const tz = place.tz;
  let html = `<h2 class="h-display">Календарь неба</h2><p class="sub">Ближайшие события для места «${esc(place.name)}». Нажмите, чтобы перенестись в этот момент.</p>`;
  let month = -1;
  list.forEach((e, i) => {
    const ms = msFromJd(e.jd);
    const mo = localParts(tz, ms).mo - 1;
    if (mo !== month) {
      month = mo;
      html += `<div class="month">${MONTHS[mo]}</div>`;
    }
    const d = describeEvent(e, tz);
    html += `<button class="row" type="button" data-event="${i}"><span class="glyph" aria-hidden="true">${d.icon}</span>
      <span><span class="t">${esc(d.title)}${d.hot ? '<span class="badge hot">стоит увидеть</span>' : ''}</span><br><span class="d">${d.detail}</span></span>
      <span class="r ev-date">${fmtDate(tz, ms, { day: 'numeric', month: 'short' })}</span></button>`;
  });
  return html;
}

// ---------------------------------------------------------------- объект

export function objectHTML(o) {
  let html = `<h2 class="h-display">${esc(o.title)}</h2><p class="sub">${o.subtitle}</p>`;
  html += `<div class="facts">`;
  for (const [k, v, wide] of o.facts) html += `<div class="${wide ? 'wide' : ''}"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  html += `</div>`;
  if (o.story) html += `<div class="story">${o.story}</div>`;
  if (o.note) html += `<p class="note">${esc(o.note)}</p>`;
  if (o.members?.length) {
    html += `<div class="h-section">Яркие звёзды</div><div class="rows">`;
    for (const m of o.members) html += `<button class="row" data-select="${esc(m.key)}" type="button"><span class="glyph"><span class="planet-dot" style="color:${m.color}"></span></span><span><span class="t">${esc(m.name)}</span><br><span class="d">${esc(m.desig)}</span></span><span class="r">${fmtMag(m.mag)}<sup>m</sup></span></button>`;
    html += `</div>`;
  }
  html += `<div class="actions">
    <button class="btn primary" type="button" data-action="center"><svg class="icon"><use href="#i-target"/></svg>Навести</button>
    <button class="btn" type="button" data-action="track" aria-pressed="${o.tracking ? 'true' : 'false'}"><svg class="icon"><use href="#i-track"/></svg>${o.tracking ? 'Следим' : 'Следить'}</button>
  </div>`;
  if (o.coords) html += `<p class="muted mono" style="font-size:12px;margin-top:14px">${o.coords}</p>`;
  return html;
}

export { moonGlyph, esc, fmtRa, fmtDec, fmtDistanceKm, fmtLy, fmtDuration, lightStory, plural, whereInSky, t as fmtT };
