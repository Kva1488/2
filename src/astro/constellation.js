// В каком созвездии точка неба: проверка попадания в многоугольники границ IAU.
// Границы утверждены в 1930 г. в координатах эпохи B1875.0: там все их стороны идут строго
// по кругам склонений и параллелям. Поэтому и вершины, и точку переводим в B1875 —
// тогда проверка «точка в многоугольнике» на плоскости (RA, Dec) становится точной.

import { CON_BOUNDS } from '../data/constellations.js';
import { mulMV, sph2vec, vec2sph } from './math.js';
import { precessionMatrix } from './coords.js';

const B1875 = 2405889.25855;
let polys = null;
let toB1875 = null;

function precessTo1875(ra, dec) {
  return vec2sph(mulMV(toB1875, sph2vec(ra, dec)));
}

// Разворачиваем долготы так, чтобы соседние вершины отличались меньше чем на 180°.
// Если суммарный обход даёт ±360°, многоугольник охватывает полюс — замыкаем его через полюс.
function prepare() {
  // Матрица прецессии «J2000 → дата» для даты в прошлом — это и есть J2000 → B1875.
  toB1875 = precessionMatrix(B1875);
  polys = CON_BOUNDS.map(([id, flat]) => {
    const pts = [];
    let prev = null, offset = 0;
    for (let i = 0; i < flat.length; i += 2) {
      let [lon, lat] = precessTo1875(flat[i], flat[i + 1]);
      if (prev !== null) {
        const d = lon + offset - prev;
        if (d > 180) offset -= 360;
        else if (d < -180) offset += 360;
      }
      lon += offset;
      pts.push([lon, lat]);
      prev = lon;
    }
    const first = pts[0], last = pts[pts.length - 1];
    const wind = last[0] - first[0];
    if (Math.abs(wind) > 180) {
      const pole = pts.reduce((s, p) => s + p[1], 0) > 0 ? 90 : -90;
      pts.push([last[0], pole], [first[0], pole]);
    }
    let min = Infinity, max = -Infinity;
    for (const p of pts) { if (p[0] < min) min = p[0]; if (p[0] > max) max = p[0]; }
    return { id, pts, min, max };
  });
}

function inside(pts, x, y) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/**
 * Созвездие для точки с координатами J2000.
 * @param {number} ra градусы 0..360
 * @param {number} dec градусы
 * @returns {string} трёхбуквенное обозначение IAU
 */
export function constellationAt(ra, dec) {
  if (!polys) prepare();
  const [ra0, dec0] = precessTo1875(ra, dec);
  for (const p of polys) {
    for (let k = -1; k <= 1; k++) {
      const x = ra0 + k * 360;
      if (x < p.min || x > p.max) continue;
      if (inside(p.pts, x, dec0)) return p.id;
    }
  }
  return dec0 > 0 ? 'UMi' : 'Oct';
}
