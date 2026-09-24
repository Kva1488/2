// Шкала суток: полдень → полдень, цвет — высота Солнца (день, сумерки, ночь),
// тонкая линия сверху — когда над горизонтом Луна. Перетаскивание меняет время.

import { sunAltitude, moonAltitude } from '../astro/bodies.js';
import { jdFromDate, msFromJd } from '../astro/time.js';
import { fmtTime } from './format.js';

const STOPS = [
  [-90, [5, 8, 18]], [-18, [8, 12, 26]], [-12, [18, 28, 54]], [-6, [36, 56, 104]], [-2, [120, 96, 110]], [0, [214, 132, 78]], [4, [110, 150, 210]], [20, [96, 140, 214]], [90, [104, 150, 224]],
];

function sunColor(alt) {
  for (let i = 1; i < STOPS.length; i++) {
    if (alt <= STOPS[i][0]) {
      const [a0, c0] = STOPS[i - 1], [a1, c1] = STOPS[i];
      const t = (alt - a0) / (a1 - a0);
      return c0.map((v, k) => Math.round(v + (c1[k] - v) * t));
    }
  }
  return STOPS[STOPS.length - 1][1];
}

export class Ribbon {
  constructor(canvas, { onScrub }) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.onScrub = onScrub;
    this.base = document.createElement('canvas');
    this.key = '';
    let dragging = false;
    const toMs = (e) => {
      const r = canvas.getBoundingClientRect();
      const x = Math.min(Math.max(e.clientX - r.left, 0), r.width);
      return this.startMs + (x / r.width) * 86400000;
    };
    canvas.addEventListener('pointerdown', (e) => {
      dragging = true;
      canvas.setPointerCapture(e.pointerId);
      this.onScrub(toMs(e), 'start');
    });
    canvas.addEventListener('pointermove', (e) => { if (dragging) this.onScrub(toMs(e), 'move'); });
    const end = (e) => {
      if (!dragging) return;
      dragging = false;
      this.onScrub(toMs(e), 'end');
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 3600000 : 600000;
      if (e.key === 'ArrowLeft') { this.onScrub(this.curMs - step, 'key'); e.preventDefault(); }
      if (e.key === 'ArrowRight') { this.onScrub(this.curMs + step, 'key'); e.preventDefault(); }
    });
  }

  /** Перерисовать основу, если сменились сутки или место. */
  prepare(place, noonMs, w, h, dpr) {
    const key = `${place.lat},${place.lon},${noonMs},${w},${h},${dpr}`;
    if (key === this.key) return;
    this.key = key;
    this.startMs = noonMs;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.tz = place.tz;
    const b = this.base;
    b.width = Math.round(w * dpr);
    b.height = Math.round(h * dpr);
    const g = b.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.max(48, Math.round(w / 3));
    const jd0 = jdFromDate(noonMs);
    const bandTop = 14, bandH = h - 14;
    for (let i = 0; i < n; i++) {
      const jd = jd0 + (i + 0.5) / n;
      const [r, gg, bb] = sunColor(sunAltitude(jd, place));
      g.fillStyle = `rgb(${r},${gg},${bb})`;
      g.fillRect((i / n) * w, bandTop, w / n + 0.6, bandH);
      if (moonAltitude(jd, place) > 0) {
        g.fillStyle = 'rgba(236, 234, 222, 0.75)';
        g.fillRect((i / n) * w, bandTop, w / n + 0.6, 2);
      }
    }
    // Часовые отметки.
    g.font = '10.5px "JetBrains Mono", ui-monospace, monospace';
    g.textAlign = 'center';
    for (let hh = 0; hh <= 24; hh += 1) {
      const x = (hh / 24) * w;
      const ms = noonMs + hh * 3600000;
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.fillRect(x, bandTop, 1, hh % 3 === 0 ? 7 : 4);
      if (hh % 3 === 0 && hh > 0 && hh < 24 && (w > 420 || hh % 6 === 0)) {
        g.fillStyle = 'rgba(200, 208, 228, 0.62)';
        g.fillText(fmtTime(this.tz, ms), x, 10);
      }
    }
  }

  draw(curMs) {
    this.curMs = curMs;
    const { g, canvas, w, h, dpr } = this;
    if (canvas.width !== Math.round(w * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.drawImage(this.base, 0, 0);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const x = ((curMs - this.startMs) / 86400000) * w;
    if (x >= -2 && x <= w + 2) {
      g.fillStyle = '#e6b563';
      g.fillRect(x - 1, 12, 2, h - 12);
      g.beginPath();
      g.arc(x, 14, 4.5, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.5)';
      g.lineWidth = 1;
      g.stroke();
    }
    canvas.setAttribute('aria-valuenow', String(Math.round((curMs - this.startMs) / 60000)));
    canvas.setAttribute('aria-valuetext', fmtTime(this.tz, curMs));
  }
}

export { msFromJd };
