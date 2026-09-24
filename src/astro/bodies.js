// Солнце, Луна и планеты для конкретного наблюдателя и момента.

import { sind, cosd, atan2d, asind, norm360, mulMV, DEG, RAD } from './math.js';
import { jdTT as toTT, lst as localSidereal } from './time.js';
import { precessionMatrix, eqToHorizonMatrix, enuToAzAlt } from './coords.js';
import { sunPosition, AU_KM, SUN_RADIUS_KM } from './sun.js';
import { moonPosition, moonPhase, MOON_RADIUS_KM, EARTH_RADIUS_KM } from './moon.js';
import { planetPosition, PLANETS } from './planets.js';

/**
 * Наблюдатель: { lat, lon } в градусах (долгота к востоку положительна), высота — 0.
 * Кадр: всё, что нужно на заданный момент, считается один раз.
 */
export function makeFrame(jdUT, observer) {
  const jdTT = toTT(jdUT);
  const lst = localSidereal(jdUT, observer.lon);
  return {
    jdUT,
    jdTT,
    lst,
    lat: observer.lat,
    lon: observer.lon,
    prec: precessionMatrix(jdTT),
    eq2hor: eqToHorizonMatrix(lst, observer.lat),
  };
}

const eqVec = (ra, dec) => [cosd(dec) * cosd(ra), cosd(dec) * sind(ra), sind(dec)];

/** Вектор наблюдателя от центра Земли в экваториальной системе даты, км (с учётом сжатия). */
export function observerVector(lat, lstDeg) {
  const u = Math.atan(0.99664719 * Math.tan(lat * DEG));
  const rhoSin = 0.99664719 * Math.sin(u);
  const rhoCos = Math.cos(u);
  return [
    EARTH_RADIUS_KM * rhoCos * cosd(lstDeg),
    EARTH_RADIUS_KM * rhoCos * sind(lstDeg),
    EARTH_RADIUS_KM * rhoSin,
  ];
}

/** Топоцентрические RA/Dec Луны с учётом параллакса (до ~1°). */
export function moonTopocentric(frame, moon = moonPosition(frame.jdTT)) {
  const g = eqVec(moon.ra, moon.dec).map((x) => x * moon.dist);
  const o = observerVector(frame.lat, frame.lst);
  const t = [g[0] - o[0], g[1] - o[1], g[2] - o[2]];
  const dist = Math.hypot(t[0], t[1], t[2]);
  return { ra: norm360(atan2d(t[1], t[0])), dec: asind(t[2] / dist), dist };
}

function horizontal(frame, ra, dec) {
  return enuToAzAlt(mulMV(frame.eq2hor, eqVec(ra, dec)));
}

export function sunState(frame) {
  const s = sunPosition(frame.jdTT);
  const [az, alt] = horizontal(frame, s.ra, s.dec);
  return {
    id: 'sun',
    kind: 'sun',
    name: 'Солнце',
    gen: 'Солнца',
    ra: s.ra,
    dec: s.dec,
    az,
    alt,
    distAU: s.dist,
    distKm: s.dist * AU_KM,
    mag: -26.74 + 5 * Math.log10(s.dist),
    diameter: 2 * Math.asin(SUN_RADIUS_KM / (s.dist * AU_KM)) * RAD,
    eclLon: s.lon,
    color: '#fff4dc',
  };
}

export function moonState(frame, sun = sunPosition(frame.jdTT)) {
  const m = moonPosition(frame.jdTT);
  const topo = moonTopocentric(frame, m);
  const phase = moonPhase(frame.jdTT, m, sun);
  const [az, alt] = horizontal(frame, topo.ra, topo.dec);
  const i = phase.phaseAngle;
  return {
    id: 'moon',
    kind: 'moon',
    name: 'Луна',
    gen: 'Луны',
    ra: topo.ra,
    dec: topo.dec,
    geoRa: m.ra,
    geoDec: m.dec,
    az,
    alt,
    distKm: topo.dist,
    geoDistKm: m.dist,
    // Звёздная величина Луны (Аллен): от −12.7 в полнолуние.
    mag: -12.73 + 0.026 * Math.abs(i) + 4e-9 * i ** 4,
    diameter: 2 * Math.asin(MOON_RADIUS_KM / topo.dist) * RAD,
    illum: phase.illum,
    phaseAngle: i,
    elong: phase.elong,
    waxing: phase.waxing,
    age: phase.age,
    eclLon: m.lon,
    eclLat: m.lat,
    color: '#f4f1e6',
  };
}

export function planetStates(frame) {
  return PLANETS.map((p) => {
    const pos = planetPosition(p.id, frame.jdTT, frame.prec);
    const [az, alt] = horizontal(frame, pos.ra, pos.dec);
    return {
      ...pos,
      kind: 'planet',
      name: p.name,
      gen: p.gen,
      color: p.color,
      az,
      alt,
      distAU: pos.dist,
      distKm: pos.dist * AU_KM,
      diameter: pos.diameter / 3600,
    };
  });
}

/** Всё Солнечное небо сразу: { sun, moon, planets }. */
export function solarSystem(frame) {
  const sunRaw = sunPosition(frame.jdTT);
  return {
    sun: sunState(frame),
    moon: moonState(frame, sunRaw),
    planets: planetStates(frame),
  };
}

/** Высота Солнца (истинная, без рефракции) — быстрая функция для поиска сумерек. */
export function sunAltitude(jdUT, observer) {
  const f = makeFrame(jdUT, observer);
  const s = sunPosition(f.jdTT);
  return horizontal(f, s.ra, s.dec)[1];
}

/** Высота центра Луны (топоцентрическая, без рефракции). */
export function moonAltitude(jdUT, observer) {
  const f = makeFrame(jdUT, observer);
  const t = moonTopocentric(f);
  return horizontal(f, t.ra, t.dec)[1];
}

/** Высота планеты. */
export function planetAltitude(id, jdUT, observer) {
  const f = makeFrame(jdUT, observer);
  const p = planetPosition(id, f.jdTT, f.prec);
  return horizontal(f, p.ra, p.dec)[1];
}

/** Высота неподвижной точки с RA/Dec (J2000). */
export function fixedAltitude(ra2000, dec2000, jdUT, observer) {
  const f = makeFrame(jdUT, observer);
  const v = mulMV(f.prec, eqVec(ra2000, dec2000));
  return enuToAzAlt(mulMV(f.eq2hor, v))[1];
}

export { eqVec, horizontal };
