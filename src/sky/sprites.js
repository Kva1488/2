// Спрайты звёзд: мягкое ядро и ореол, цвет по показателю B−V.

import { clamp } from '../astro/math.js';

// Опорные цвета звёзд по B−V (Митчелл Чарити, слегка приглушены до «видимых глазом»).
const BV_STOPS = [
  [-0.4, [158, 184, 255]],
  [-0.1, [180, 202, 255]],
  [0.1, [214, 225, 255]],
  [0.35, [240, 242, 255]],
  [0.6, [255, 246, 234]],
  [0.85, [255, 230, 200]],
  [1.15, [255, 212, 166]],
  [1.45, [255, 196, 136]],
  [1.8, [255, 178, 110]],
];

export function bvToRgb(bv) {
  const x = clamp(bv, -0.4, 1.8);
  for (let i = 1; i < BV_STOPS.length; i++) {
    if (x <= BV_STOPS[i][0]) {
      const [x0, c0] = BV_STOPS[i - 1], [x1, c1] = BV_STOPS[i];
      const t = (x - x0) / (x1 - x0);
      return c0.map((v, k) => Math.round(v + (c1[k] - v) * t));
    }
  }
  return BV_STOPS[BV_STOPS.length - 1][1];
}

export const COLOR_BINS = 12;
export const bvBin = (bv) => Math.round(((clamp(bv, -0.4, 1.8) + 0.4) / 2.2) * (COLOR_BINS - 1));

const SPRITE = 64;

/** Атлас спрайтов: по строке на цветовой класс. */
export function buildStarAtlas() {
  const c = document.createElement('canvas');
  c.width = SPRITE * COLOR_BINS;
  c.height = SPRITE;
  const g = c.getContext('2d');
  for (let i = 0; i < COLOR_BINS; i++) {
    const bv = -0.4 + (i / (COLOR_BINS - 1)) * 2.2;
    const [r, gg, b] = bvToRgb(bv);
    const cx = i * SPRITE + SPRITE / 2, cy = SPRITE / 2;
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, SPRITE / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.1, `rgba(${Math.round((r + 255 * 2) / 3)},${Math.round((gg + 255 * 2) / 3)},${Math.round((b + 255 * 2) / 3)},1)`);
    grad.addColorStop(0.22, `rgba(${r},${gg},${b},0.7)`);
    grad.addColorStop(0.45, `rgba(${r},${gg},${b},0.16)`);
    grad.addColorStop(1, `rgba(${r},${gg},${b},0)`);
    g.fillStyle = grad;
    g.fillRect(i * SPRITE, 0, SPRITE, SPRITE);
  }
  return { canvas: c, size: SPRITE };
}

/** Мягкое пятно для туманностей и галактик (белое, красится через globalAlpha/композицию). */
export function buildGlowSprite(color = '255,255,255') {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, `rgba(${color},0.9)`);
  grad.addColorStop(0.35, `rgba(${color},0.35)`);
  grad.addColorStop(1, `rgba(${color},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return c;
}
