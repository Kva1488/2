// Процедурный Млечный Путь в галактических координатах: балдж к центру Галактики,
// звёздные облака, тёмные пылевые прожилки (Большой Разлом, Угольный Мешок),
// Магеллановы Облака. Текстура строится один раз при запуске.

import { clamp, smoothstep } from '../astro/math.js';

export const MW_W = 900; // по долготе l: 0..360°
export const MW_H = 224; // по широте b: −64..+64°
export const MW_BMAX = 64;

// --- Детерминированный шум, периодичный по долготе ---
function hash(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function valueNoise(x, y, periodX, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const xa = ((x0 % periodX) + periodX) % periodX, xb = (xa + 1) % periodX;
  const a = hash(xa, y0, seed), b = hash(xb, y0, seed);
  const c = hash(xa, y0 + 1, seed), d = hash(xb, y0 + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Фрактальный шум: l, b в градусах, базовый масштаб cell (°). */
function fbm(l, b, cell, octaves, seed) {
  let sum = 0, amp = 0.5, norm = 0, c = cell;
  for (let o = 0; o < octaves; o++) {
    const period = Math.round(360 / c);
    sum += amp * valueNoise((l / 360) * period, b / c, period, seed + o * 17);
    norm += amp;
    amp *= 0.5;
    c /= 2.1;
  }
  return sum / norm;
}

const gauss = (x, s) => Math.exp(-(x * x) / (2 * s * s));
const wrap180 = (l) => ((l + 540) % 360) - 180;

/** Яркость и «теплота» Млечного Пути в точке (l, b). Возвращает [яркость, тёплая доля]. */
function sample(l, b) {
  const dl = wrap180(l);
  const adl = Math.abs(dl);

  // Диск: ярче к центру Галактики, толще в районе балджа.
  const disk = 0.28 + 0.72 * gauss(dl, 70);
  const thick = 3.2 + 5 * gauss(dl, 22) + 1.2 * gauss(dl - 75, 18);
  let I = disk * Math.exp(-Math.abs(b + 0.4) / thick) * 0.9;
  // Балдж — эллипсоид вокруг центра.
  I += 1.1 * Math.exp(-(dl * dl) / (2 * 11 * 11) - (b * b) / (2 * 7.5 * 7.5));

  // Звёздные облака: Лебедь, Щит, Стрелец, Киль, Персей, Центавр.
  I += 0.55 * gauss(dl - 76, 7) * gauss(b - 1.5, 4);
  I += 0.5 * gauss(dl - 27, 4) * gauss(b + 3, 2.5);
  I += 0.6 * gauss(dl - 3, 6) * gauss(b + 4, 3.5);
  I += 0.45 * gauss(dl + 73, 10) * gauss(b + 1, 3.5);
  I += 0.25 * gauss(adl - 135, 20) * gauss(b + 1, 5);
  I += 0.3 * gauss(dl + 50, 12) * gauss(b, 4);

  // Далеко от диска и облаков рассчитывать шум незачем.
  const nearLMC = Math.abs(b + 38) < 16 && Math.abs(wrap180(l - 290)) < 30;
  if (I < 0.004 && !nearLMC) return [I, 0.1];

  // Клочковатость звёздных облаков.
  const n1 = fbm(l, b, 9, 4, 1);
  I *= 0.3 + 1.45 * n1 * n1 * 1.6;

  // Пыль: общий тёмный слой вдоль экватора Галактики + Большой Разлом.
  const nearPlane = Math.abs(b) < 22;
  const dustNoise = nearPlane ? fbm(l + 40, b, 5, 4, 7) : 0.5;
  let T = 1 - 0.55 * gauss(b - 0.3, 1.6 + 1.2 * gauss(dl, 30)) * smoothstep(0.25, 0.7, dustNoise);
  // Большой Разлом: от Лебедя (l≈80) к Змееносцу (l≈0, b≈+5), ниже диска — рваные облака.
  if (dl > -25 && dl < 95) {
    const bRift = dl > 30 ? 0.5 + 0.02 * (dl - 30) : 0.5 + (30 - dl) * 0.16;
    const wRift = 1.6 + 1.4 * gauss(dl - 10, 15);
    const rift = gauss(b - bRift, wRift) * smoothstep(-25, -5, dl) * (1 - smoothstep(80, 95, dl));
    if (rift > 0.01) T *= 1 - 0.8 * rift * (0.55 + 0.6 * fbm(l, b, 4, 3, 11));
  }
  // Облака в Змееносце (ро Змееносца, Трубка).
  T *= 1 - 0.55 * gauss(dl + 7, 4) * gauss(b - 16, 5);
  T *= 1 - 0.6 * gauss(dl - 0, 3) * gauss(b - 4.5, 1.5);
  // Угольный Мешок у Южного Креста.
  T *= 1 - 0.8 * gauss(dl + 58.8, 2.4) * gauss(b + 0.9, 2.1);
  // Пыль в Тельце — Возничем (антицентр).
  T *= 1 - 0.35 * gauss(adl - 170, 12) * gauss(b + 14, 6) * dustNoise;
  I *= clamp(T, 0, 1);

  // Магеллановы Облака.
  if (nearLMC) {
    I += 0.75 * gauss(wrap180(l - 280.5), 4.2) * gauss(b + 32.9, 3.2) * (0.6 + 0.6 * fbm(l, b, 2, 3, 23));
    I += 0.45 * gauss(wrap180(l - 302.8), 2.2) * gauss(b + 44.3, 1.5);
  }

  const warm = clamp(gauss(dl, 35) * 1.1 + 0.08, 0, 1);
  return [I, warm];
}

const COLD = [0.78, 0.86, 1.0];
const HOT = [1.0, 0.86, 0.66];

function buildRows(tex, j0, j1) {
  const cold = COLD, hot = HOT;
  for (let j = j0; j < j1; j++) {
    const b = MW_BMAX - ((j + 0.5) / MW_H) * 2 * MW_BMAX;
    for (let i = 0; i < MW_W; i++) {
      const l = ((i + 0.5) / MW_W) * 360;
      const [I, w] = sample(l, b);
      const k = (j * MW_W + i) * 3;
      tex[k] = I * (cold[0] + (hot[0] - cold[0]) * w);
      tex[k + 1] = I * (cold[1] + (hot[1] - cold[1]) * w);
      tex[k + 2] = I * (cold[2] + (hot[2] - cold[2]) * w);
    }
  }
}

/** Строит текстуру целиком: Float32Array из MW_W×MW_H×3 (линейный RGB, условные единицы). */
export function buildMilkyWay() {
  const tex = new Float32Array(MW_W * MW_H * 3);
  buildRows(tex, 0, MW_H);
  return tex;
}

/**
 * Строит текстуру по частям, не блокируя интерфейс. Сначала — полоса диска (|b| < 30°),
 * чтобы Млечный Путь проявился как можно раньше.
 * @param {(tex: Float32Array, done: boolean) => void} onProgress
 */
export function buildMilkyWayAsync(onProgress) {
  const tex = new Float32Array(MW_W * MW_H * 3);
  const mid = MW_H / 2, band = Math.round((30 / MW_BMAX) * mid);
  const order = [];
  for (let j = mid - band; j < mid + band; j += 8) order.push([j, Math.min(j + 8, mid + band)]);
  for (let j = 0; j < mid - band; j += 8) order.push([j, Math.min(j + 8, mid - band)]);
  for (let j = mid + band; j < MW_H; j += 8) order.push([j, Math.min(j + 8, MW_H)]);
  let k = 0;
  const idle = globalThis.requestIdleCallback || ((fn) => setTimeout(() => fn({ timeRemaining: () => 8 }), 16));
  const step = (deadline) => {
    const t0 = performance.now();
    while (k < order.length && (performance.now() - t0 < 10 || deadline.timeRemaining() > 4)) {
      buildRows(tex, order[k][0], order[k][1]);
      k++;
    }
    onProgress(tex, k >= order.length);
    if (k < order.length) idle(step, { timeout: 60 });
  };
  idle(step, { timeout: 30 });
}

/**
 * Билинейная выборка текстуры по галактическим l, b (градусы) в массив out[0..2].
 */
export function sampleMilkyWay(tex, l, b, out) {
  if (b >= MW_BMAX || b <= -MW_BMAX) { out[0] = out[1] = out[2] = 0; return out; }
  const x = (l / 360) * MW_W - 0.5;
  const y = ((MW_BMAX - b) / (2 * MW_BMAX)) * MW_H - 0.5;
  let x0 = Math.floor(x);
  const y0 = Math.max(0, Math.min(MW_H - 2, Math.floor(y)));
  const fx = x - x0, fy = clamp(y - y0, 0, 1);
  x0 = ((x0 % MW_W) + MW_W) % MW_W;
  const x1 = (x0 + 1) % MW_W;
  const i00 = (y0 * MW_W + x0) * 3, i10 = (y0 * MW_W + x1) * 3;
  const i01 = ((y0 + 1) * MW_W + x0) * 3, i11 = ((y0 + 1) * MW_W + x1) * 3;
  for (let c = 0; c < 3; c++) {
    const a = tex[i00 + c] + (tex[i10 + c] - tex[i00 + c]) * fx;
    const d = tex[i01 + c] + (tex[i11 + c] - tex[i01 + c]) * fx;
    out[c] = a + (d - a) * fy;
  }
  return out;
}
