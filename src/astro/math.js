// Небольшая математическая база: углы, векторы и матрицы 3×3.

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
export const TAU = Math.PI * 2;

export const sind = (x) => Math.sin(x * DEG);
export const cosd = (x) => Math.cos(x * DEG);
export const tand = (x) => Math.tan(x * DEG);
export const asind = (x) => Math.asin(clamp(x, -1, 1)) * RAD;
export const acosd = (x) => Math.acos(clamp(x, -1, 1)) * RAD;
export const atan2d = (y, x) => Math.atan2(y, x) * RAD;

export function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Угол в диапазоне [0, 360). */
export function norm360(x) {
  x %= 360;
  return x < 0 ? x + 360 : x;
}

/** Угол в диапазоне (-180, 180]. */
export function norm180(x) {
  x = norm360(x);
  return x > 180 ? x - 360 : x;
}

export function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

export const lerp = (a, b, t) => a + (b - a) * t;

// ---- Векторы: простые массивы [x, y, z] ----

/** Единичный вектор по долготе/широте (градусы): x к λ=0, z к полюсу. */
export function sph2vec(lonDeg, latDeg) {
  const cl = cosd(latDeg);
  return [cl * cosd(lonDeg), cl * sind(lonDeg), sind(latDeg)];
}

/** Обратно: [долгота 0..360, широта] в градусах. */
export function vec2sph(v) {
  const r = Math.hypot(v[0], v[1], v[2]);
  return [norm360(atan2d(v[1], v[0])), asind(v[2] / r)];
}

export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const vlen = (a) => Math.hypot(a[0], a[1], a[2]);
export function vnorm(a) {
  const l = vlen(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
export const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const vadd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const vscale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];

/** Угловое расстояние между двумя векторами, градусы (устойчиво на малых углах). */
export function angleBetween(a, b) {
  return atan2d(vlen(cross(a, b)), dot(a, b));
}

/** Угловое расстояние между точками на сфере (градусы). */
export function separation(lon1, lat1, lon2, lat2) {
  return angleBetween(sph2vec(lon1, lat1), sph2vec(lon2, lat2));
}

// ---- Матрицы 3×3: плоские массивы из 9 чисел по строкам ----

export function mulMV(m, v) {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

export function mulMM(a, b) {
  const r = new Array(9);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
    }
  }
  return r;
}

export const transpose = (m) => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];

/** Поворот системы координат вокруг оси X на угол a (градусы). */
export function rotX(a) {
  const c = cosd(a), s = sind(a);
  return [1, 0, 0, 0, c, s, 0, -s, c];
}
/** Поворот системы координат вокруг оси Y. */
export function rotY(a) {
  const c = cosd(a), s = sind(a);
  return [c, 0, -s, 0, 1, 0, s, 0, c];
}
/** Поворот системы координат вокруг оси Z. */
export function rotZ(a) {
  const c = cosd(a), s = sind(a);
  return [c, s, 0, -s, c, 0, 0, 0, 1];
}
