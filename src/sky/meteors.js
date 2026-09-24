// Метеоры: вылетают из радиантов активных потоков с реальной частотой (плюс спорадические).
// При ускорении времени частота растёт вместе с ним — так видна «работа» потока за ночь.

import { activeShowers, visibleRate } from '../astro/showers.js';
import { mulMV, sph2vec, cross, vnorm, cosd, sind, clamp } from '../astro/math.js';

const SPORADIC_ZHR = 6;
const MAX_PER_SECOND = 5;

export class Meteors {
  constructor() {
    this.list = [];
    this.budget = 0;
    this.rand = Math.random;
  }

  /**
   * @param {number} dtReal прошедшее реальное время, с
   * @param {number} dtSimHours прошедшее модельное время, ч
   * @param {object} ctx { date, j2000ToEnu (матрица), lm, sunAlt, now (мс) }
   */
  update(dtReal, dtSimHours, ctx) {
    const now = ctx.now;
    this.list = this.list.filter((m) => now - m.t0 < m.dur * 1000 + 50);
    if (dtSimHours <= 0 || ctx.sunAlt > -8) return;
    const sources = activeShowers(ctx.date).map((a) => {
      const rad = mulMV(ctx.j2000ToEnu, sph2vec(a.shower.ra, a.shower.dec));
      const alt = Math.asin(clamp(rad[2], -1, 1)) * 57.2958;
      return { rad, alt, rate: visibleRate(a.zhrNow, alt, ctx.lm), speed: a.shower.speed, shower: a.shower };
    });
    sources.push({ rad: null, alt: 90, rate: visibleRate(SPORADIC_ZHR, 55, ctx.lm), speed: 40, shower: null });
    for (const s of sources) {
      const expected = s.rate * dtSimHours;
      // Пуассоновский поток, но не больше MAX_PER_SECOND реальных, чтобы при ×86400 не было «снега».
      const allowed = MAX_PER_SECOND * dtReal;
      const lambda = Math.min(expected, allowed);
      let n = 0;
      let p = Math.exp(-lambda), cum = p;
      const u = this.rand();
      while (u > cum && n < 20) { n++; p *= lambda / n; cum += p; }
      for (let i = 0; i < n; i++) this.spawn(s, now);
    }
  }

  spawn(src, now) {
    const r = this.rand;
    let start, dir;
    if (src.rad) {
      // Точка на расстоянии 15–70° от радианта, метеор летит от радианта по большому кругу.
      const d0 = 15 + r() * 55;
      const t = vnorm(cross(src.rad, Math.abs(src.rad[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
      const w = cross(src.rad, t);
      const a = r() * Math.PI * 2;
      const axis = [t[0] * Math.cos(a) + w[0] * Math.sin(a), t[1] * Math.cos(a) + w[1] * Math.sin(a), t[2] * Math.cos(a) + w[2] * Math.sin(a)];
      start = src.rad.map((v, k) => v * cosd(d0) + axis[k] * sind(d0));
      dir = axis.map((v, k) => v * cosd(d0) - src.rad[k] * sind(d0));
    } else {
      const az = r() * 360, alt = 15 + r() * 60;
      start = [cosd(alt) * sind(az), cosd(alt) * cosd(az), sind(alt)];
      const t = vnorm(cross(start, [0, 0, 1]));
      const b = cross(start, t);
      const a = r() * Math.PI * 2;
      dir = t.map((v, k) => v * Math.cos(a) + b[k] * Math.sin(a));
    }
    if (start[2] < 0.05) return;
    const len = (4 + r() * 14) * (src.speed > 55 ? 1.25 : 1);
    const end = start.map((v, k) => v * cosd(len) + dir[k] * sind(len));
    const mag = -1 + r() * r() * 5 * (src.speed < 30 ? 0.7 : 1);
    this.list.push({
      start,
      end,
      t0: now,
      dur: clamp(0.25 + len / src.speed / 0.6, 0.25, 1.1),
      mag,
      color: src.speed > 55 ? [190, 225, 255] : src.speed < 30 ? [255, 214, 170] : [235, 240, 255],
      shower: src.shower,
    });
  }

  /** Отрисовка: яркая голова и затухающий след. */
  draw(g, camera, now) {
    const a = [0, 0, 0], b = [0, 0, 0];
    for (const m of this.list) {
      const t = (now - m.t0) / (m.dur * 1000);
      if (t < 0 || t > 1) continue;
      const head = Math.min(1, t * 1.25);
      const tail = Math.max(0, head - 0.45);
      const p = (u) => m.start.map((v, k) => v + (m.end[k] - v) * u);
      if (!camera.project(p(tail), a) || !camera.project(p(head), b)) continue;
      const fade = t < 0.8 ? 1 : 1 - (t - 0.8) / 0.2;
      const bright = clamp(0.45 + (2 - m.mag) * 0.2, 0.2, 1) * fade;
      const grad = g.createLinearGradient(a[0], a[1], b[0], b[1]);
      const [r, gg, bb] = m.color;
      grad.addColorStop(0, `rgba(${r},${gg},${bb},0)`);
      grad.addColorStop(1, `rgba(${r},${gg},${bb},${bright})`);
      g.strokeStyle = grad;
      g.lineWidth = clamp(1.8 - m.mag * 0.3, 0.8, 2.6);
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(a[0], a[1]);
      g.lineTo(b[0], b[1]);
      g.stroke();
    }
  }
}
