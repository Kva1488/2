// Силуэт горизонта: лес, горы, город или море. Профиль — высота (°) для каждой 0.1° азимута.

const N = 3600;

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function smoothNoise(rand, cells, amp) {
  const pts = Array.from({ length: cells }, () => rand());
  return (i) => {
    const x = (i / N) * cells;
    const i0 = Math.floor(x) % cells, i1 = (i0 + 1) % cells;
    const f = x - Math.floor(x), s = f * f * (3 - 2 * f);
    return (pts[i0] + (pts[i1] - pts[i0]) * s) * amp;
  };
}

export const LANDSCAPES = {
  forest: 'Лес',
  mountains: 'Горы',
  city: 'Город',
  sea: 'Море',
  flat: 'Ровный горизонт',
};

/**
 * @returns {{profile: Float32Array, windows: {az:number, alt:number}[], max: number}}
 */
export function buildLandscape(type) {
  const profile = new Float32Array(N);
  const windows = [];
  const rand = rng(type.length * 7919 + 13);
  if (type === 'forest') {
    const hills = [smoothNoise(rand, 7, 1.4), smoothNoise(rand, 23, 0.5), smoothNoise(rand, 90, 0.25)];
    const ground = new Float32Array(N);
    for (let i = 0; i < N; i++) profile[i] = ground[i] = 0.25 + hills[0](i) + hills[1](i) + hills[2](i);
    // Ели: треугольные вершины разной высоты, где-то — просветы полей.
    const gaps = smoothNoise(rand, 11, 1);
    let az = 0;
    while (az < 360) {
      const w = 0.25 + rand() * 0.55;
      const idx = Math.floor(az * 10);
      // Плотность леса плавно меняется: поляны с редкими деревьями переходят в чащу.
      const dens = Math.min(1, Math.max(0, (gaps(idx % N) - 0.12) / 0.3));
      if (rand() < 0.1 + 0.9 * dens) {
        const h = 0.7 + rand() * 1.6 + (rand() < 0.08 ? 1.2 : 0);
        const half = Math.round(w * 5);
        for (let k = -half; k <= half; k++) {
          const j = (idx + k + N) % N;
          const t = 1 - Math.abs(k) / (half + 0.5);
          // Ёлочка: зазубрины по краям.
          const jag = 1 - 0.12 * ((Math.abs(k) % 3) === 1 ? 1 : 0);
          profile[j] = Math.max(profile[j], ground[j] + h * Math.pow(t, 0.85) * jag);
        }
      }
      az += w * (0.55 + rand() * 0.6);
    }
  } else if (type === 'mountains') {
    const octs = [smoothNoise(rand, 5, 5.5), smoothNoise(rand, 13, 3), smoothNoise(rand, 37, 1.3), smoothNoise(rand, 111, 0.5), smoothNoise(rand, 331, 0.18)];
    for (let i = 0; i < N; i++) {
      let h = 0;
      for (const o of octs) h += o(i);
      // «Гребни»: острее вершины, пологие долины.
      profile[i] = Math.max(0.3, Math.pow(h / 5, 1.6) * 5 - 0.6);
    }
  } else if (type === 'city') {
    const base = smoothNoise(rand, 17, 0.4);
    for (let i = 0; i < N; i++) profile[i] = 0.3 + base(i);
    let az = 0;
    while (az < 360) {
      const w = 0.6 + rand() * 3.2;
      const far = rand() < 0.35;
      const h = far ? 0.8 + rand() * 1.4 : 1.2 + rand() * rand() * 7;
      const i0 = Math.floor(az * 10), i1 = Math.floor((az + w) * 10);
      for (let i = i0; i < i1; i++) profile[i % N] = Math.max(profile[i % N], h);
      // Антенна на высотке.
      if (h > 5 && rand() < 0.4) {
        const c = Math.floor((i0 + i1) / 2);
        for (let k = -1; k <= 1; k++) profile[(c + k) % N] = Math.max(profile[(c + k) % N], h + 1.2 + rand());
      }
      // Окна: несколько горящих в каждом доме.
      if (!far) {
        const n = Math.floor(w * h * 1.2 * rand());
        for (let k = 0; k < n; k++) {
          windows.push({ az: az + 0.15 + rand() * (w - 0.3), alt: 0.4 + rand() * (h - 0.8) });
        }
      }
      az += w + (rand() < 0.3 ? rand() * 2 : 0.05);
    }
  } else if (type === 'sea') {
    for (let i = 0; i < N; i++) profile[i] = 0.02;
  } else {
    for (let i = 0; i < N; i++) profile[i] = 0;
  }
  let max = 0;
  for (let i = 0; i < N; i++) if (profile[i] > max) max = profile[i];
  return { type, profile, windows, max };
}

/** Высота силуэта (°) на азимуте az (°). */
export function horizonAltAt(land, az) {
  if (!land) return 0;
  const x = (((az % 360) + 360) % 360) * 10;
  const i0 = Math.floor(x) % N, i1 = (i0 + 1) % N;
  const f = x - Math.floor(x);
  return land.profile[i0] * (1 - f) + land.profile[i1] * f;
}

export const PROFILE_SAMPLES = N;
