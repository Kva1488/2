// Отрисовка неба на Canvas 2D: фон (атмосфера + Млечный Путь) в буфере низкого разрешения,
// поверх — векторные слои: сетки, созвездия, объекты, звёзды, Солнечная система, метеоры,
// силуэт горизонта и подписи.

import {
  mulMM, mulMV, transpose, vnorm, clamp, RAD, DEG, atan2d, norm360, cosd, sind, sph2vec, angleBetween, smoothstep,
} from '../astro/math.js';
import { refraction, airmass, EQ2000_TO_GAL, OBLIQUITY_J2000, eclVecToEq } from '../astro/coords.js';
import { overlapFraction } from '../astro/events.js';
import { computeConditions, skyColor, groundColor, makeToneLUT } from './atmosphere.js';
import { buildMilkyWayAsync, sampleMilkyWay } from './milkyway.js';
import { buildLandscape, horizonAltAt } from './landscape.js';
import { buildStarAtlas, buildGlowSprite } from './sprites.js';
import { buildMoonTexture } from './moon-texture.js';
import {
  starCount, starVec, starMag, starBin, starHip, starLabels, starProperName,
  conFigures, conLabels, conBorders, dsos, FAMOUS_DSO,
} from './catalog.js';

const CARDINALS = [
  [0, 'С', 1], [45, 'СВ', 0], [90, 'В', 1], [135, 'ЮВ', 0], [180, 'Ю', 1], [225, 'ЮЗ', 0], [270, 'З', 1], [315, 'СЗ', 0],
];

const TOP_DSO = new Set(['M31', 'M42', 'M45', 'M44', 'LMC', 'SMC', 'DC', 'OMC']);
const FONT_UI = '"Golos Text", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const FONT_DISPLAY = 'Forum, "Cormorant Garamond", Georgia, serif';

const toEnu = (M, v) => [
  M[0] * v[0] + M[1] * v[1] + M[2] * v[2],
  M[3] * v[0] + M[4] * v[1] + M[5] * v[2],
  M[6] * v[0] + M[7] * v[1] + M[8] * v[2],
];

/** Поднять вектор ENU на величину рефракции (видимое положение). */
function refractEnu(e, on) {
  if (!on) return e;
  const alt = Math.asin(clamp(e[2], -1, 1)) * RAD;
  if (alt < -3 || alt > 60) return e;
  const R = refraction(alt);
  if (R <= 0) return e;
  const na = (alt + R) * DEG;
  const h = Math.hypot(e[0], e[1]) || 1e-9;
  const c = Math.cos(na) / h;
  return [e[0] * c, e[1] * c, Math.sin(na)];
}

export class SkyRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d', { alpha: false });
    this.buf = document.createElement('canvas');
    this.bufG = this.buf.getContext('2d');
    this.atlas = buildStarAtlas();
    this.glow = buildGlowSprite();
    this.warmGlow = buildGlowSprite('255,214,160');
    this.moonTex = buildMoonTexture();
    this.lut = makeToneLUT();
    this.mwTex = null;
    this.mwReady = false;
    buildMilkyWayAsync((tex, done) => {
      this.mwTex = tex;
      this.mwReady = done;
      this.skyKey = '';
    });
    this.setLandscape('forest');
    this.dpr = 1;
    this.hitX = new Float32Array(starCount);
    this.hitY = new Float32Array(starCount);
    this.hitI = new Int32Array(starCount);
    this.hitN = 0;
    this.hits = [];
    this.textWidth = new Map();
    this.skyKey = '';
    this.rays = null;
  }

  setLandscape(type) {
    this.landType = type;
    this.land = type === 'flat' ? buildLandscape('flat') : buildLandscape(type);
    this.skyKey = '';
  }

  resize(w, h, dpr) {
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.size = [w, h];
    this.setQuality('hi', true);
  }

  /**
   * Два разрешения фона: полное — в покое, пониженное — пока небо движется
   * (перетаскивание, ускоренное время). Так вращение остаётся плавным и на телефоне.
   */
  setQuality(q, force) {
    if (!force && this.quality === q) return;
    this.quality = q;
    const [w, h] = this.size;
    const scale = clamp(Math.sqrt((w * h) / 70000), 2, 6) * (q === 'lo' ? 1.7 : 1);
    this.buf.width = Math.max(8, Math.ceil(w / scale));
    this.buf.height = Math.max(8, Math.ceil(h / scale));
    this.img = this.bufG.createImageData(this.buf.width, this.buf.height);
    this.rays = null;
    this.skyKey = '';
  }

  // ---------------------------------------------------------------- фон
  buildRays(cam) {
    const bw = this.buf.width, bh = this.buf.height;
    const sx = cam.width / bw, sy = cam.height / bh;
    const rays = new Float32Array(bw * bh * 3);
    for (let j = 0; j < bh; j++) {
      for (let i = 0; i < bw; i++) {
        const r = cam.rayLocal((i + 0.5) * sx, (j + 0.5) * sy);
        const k = (j * bw + i) * 3;
        rays[k] = r[0];
        rays[k + 1] = r[1];
        rays[k + 2] = r[2];
      }
    }
    this.rays = rays;
    this.raysKey = `${cam.width}x${cam.height}@${cam.fov}@${bw}`;
  }

  renderSky(S, cond, Menu) {
    const cam = S.camera, st = S.settings;
    if (!this.rays || this.raysKey !== `${cam.width}x${cam.height}@${cam.fov}@${this.buf.width}`) this.buildRays(cam);
    const bw = this.buf.width, bh = this.buf.height;
    const data = this.img.data;
    const rays = this.rays;
    const { f, r, u } = cam;
    // ENU → галактические координаты.
    const Mg = mulMM(EQ2000_TO_GAL, transpose(Menu));
    const mwOn = st.milkyway && this.mwTex && cond.mwVis > 0.01;
    const mwGain = cond.mwVis * (cond.atmosphere ? 0.032 : 0.04);
    const ground = st.ground;
    const gc = groundColor(cond, this.landType);
    const { lut, size, max } = this.lut;
    const tm = (c) => (c <= 0 ? lut[0] : c >= max ? 255 : lut[(Math.sqrt(c / max) * size) | 0]);
    const G0 = tm(gc[0]), G1 = tm(gc[1]), G2 = tm(gc[2]);
    const col = [0, 0, 0], mw = [0, 0, 0], d = [0, 0, 0];
    const sea = this.landType === 'sea';
    const sun = cond.sunEnu, moon = cond.moonEnu;
    for (let j = 0, p = 0; j < bh; j++) {
      for (let i = 0; i < bw; i++, p += 4) {
        const k = (j * bw + i) * 3;
        const cx = rays[k], cy = rays[k + 1], cz = rays[k + 2];
        d[0] = r[0] * cx + u[0] * cy + f[0] * cz;
        d[1] = r[1] * cx + u[1] * cy + f[1] * cz;
        d[2] = r[2] * cx + u[2] * cy + f[2] * cz;
        if (ground && d[2] < 0) {
          if (sea) {
            // Море: отражение неба и лунная (солнечная) дорожка.
            const z0 = d[2];
            d[2] = -z0;
            skyColor(d, cond, col);
            const depth = Math.min(1, -z0 * 6);
            let gr = col[0] * 0.22 + gc[0], gg = col[1] * 0.22 + gc[1], gb = col[2] * 0.24 + gc[2];
            const hd = Math.hypot(d[0], d[1]) || 1;
            for (const [src, amp] of [[moon, cond.moonLight * 0.25], [sun, cond.sunVis * 0.6 * (1 - cond.day * 0.6)]]) {
              if (amp <= 0 || src[2] < -0.02) continue;
              const hs = Math.hypot(src[0], src[1]) || 1;
              const ca = (d[0] * src[0] + d[1] * src[1]) / (hd * hs);
              const streak = Math.exp((ca - 1) * (900 + depth * 4000)) * amp * (1 - depth * 0.7);
              gr += streak; gg += streak * 0.95; gb += streak * 0.85;
            }
            data[p] = tm(gr * (1 - depth * 0.5)); data[p + 1] = tm(gg * (1 - depth * 0.5)); data[p + 2] = tm(gb * (1 - depth * 0.5)); data[p + 3] = 255;
            continue;
          }
          const shade = 1 - Math.min(0.5, -d[2] * 0.8);
          data[p] = G0 * shade; data[p + 1] = G1 * shade; data[p + 2] = G2 * shade; data[p + 3] = 255;
          continue;
        }
        const under = d[2] < 0;
        if (under) d[2] = -d[2]; // Без земли: «подземное» небо — зеркально и приглушённо.
        skyColor(d, cond, col);
        if (under) {
          col[0] = col[0] * 0.3 + 0.0008; col[1] = col[1] * 0.3 + 0.001; col[2] = col[2] * 0.34 + 0.002;
          d[2] = -d[2];
        }
        if (mwOn) {
          const gx = Mg[0] * d[0] + Mg[1] * d[1] + Mg[2] * d[2];
          const gy = Mg[3] * d[0] + Mg[4] * d[1] + Mg[5] * d[2];
          const gz = Mg[6] * d[0] + Mg[7] * d[1] + Mg[8] * d[2];
          const b = Math.asin(gz < -1 ? -1 : gz > 1 ? 1 : gz) * RAD;
          if (b < 64 && b > -64) {
            let l = Math.atan2(gy, gx) * RAD;
            if (l < 0) l += 360;
            sampleMilkyWay(this.mwTex, l, b, mw);
            const ext = cond.atmosphere ? smoothstep(0, 0.35, d[2]) : 1;
            const kk = mwGain * ext;
            col[0] += mw[0] * kk; col[1] += mw[1] * kk; col[2] += mw[2] * kk;
          }
        }
        data[p] = tm(col[0]); data[p + 1] = tm(col[1]); data[p + 2] = tm(col[2]); data[p + 3] = 255;
      }
    }
    this.bufG.putImageData(this.img, 0, 0);
  }

  // ---------------------------------------------------------------- главный кадр
  render(S) {
    const cam = S.camera, st = S.settings, frame = S.frame, ss = S.ss;
    const g = this.g;
    const W = cam.width, H = cam.height;
    const M = mulMM(frame.eq2hor, frame.prec);
    this.M = M;
    const atm = st.atmosphere;
    const sunEnu = sph2vecAzAlt(ss.sun.az, ss.sun.alt);
    const moonEnu = sph2vecAzAlt(ss.moon.az, ss.moon.alt);
    const sepSM = angleBetween(sunEnu, moonEnu);
    const obsc = overlapFraction(ss.sun.diameter / 2, ss.moon.diameter / 2, sepSM);
    const cond = computeConditions({
      sunEnu, sunAlt: ss.sun.alt, moonEnu, moonAlt: ss.moon.alt, moonIllum: ss.moon.illum,
      bortle: st.bortle, atmosphere: atm, eclipseObscuration: obsc,
    });
    this.cond = cond;
    this.eclipse = { obscuration: obsc, sep: sepSM };

    // Фон пересчитываем, только если что-то заметно изменилось.
    const key = [cam.az.toFixed(3), cam.alt.toFixed(3), cam.fov.toFixed(3), cam.roll.toFixed(2), W, H,
      Math.round(frame.jdUT * 86400 / 3), st.atmosphere, st.milkyway, st.ground, st.bortle, this.landType,
      this.mwTex ? (this.mwReady ? 2 : Math.round(performance.now() / 200)) : 0, cam.basisOverride ? cam.f.map((x) => x.toFixed(3)).join() : ''].join('|');
    const t = performance.now();
    if (key !== this.skyKey) {
      // Фон меняется кадр за кадром — переходим на пониженное разрешение.
      if (t - (this.lastSkyChange || 0) < 120) this.setQuality('lo');
      this.lastSkyChange = t;
      this.renderSky(S, cond, M);
      this.skyKey = key;
    } else if (this.quality === 'lo' && t - this.lastSkyChange > 250) {
      this.setQuality('hi');
      this.renderSky(S, cond, M);
      this.skyKey = key;
    }
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.drawImage(this.buf, 0, 0, W, H);

    this.hits = [];
    this.hitN = 0;
    this.labels = [];
    const zoomGain = clamp(2.4 * Math.log10(90 / cam.fov), 0, 5);
    const lm = cond.lm + zoomGain;
    this.lmView = lm;

    this.clipGround = st.ground;
    if (st.gridAz) this.drawAzGrid(g, cam);
    if (st.gridEq) this.drawEqGrid(g, cam, M);
    if (st.ecliptic) this.drawEcliptic(g, cam, M);
    if (st.bounds) this.drawBounds(g, cam, M, S.highlightCon);
    if (st.constellations || S.highlightCon) this.drawFigures(g, cam, M, st.constellations, S.highlightCon, cond);
    this.drawDsos(g, cam, M, S, lm, cond);
    this.drawStars(g, cam, M, S, lm, cond);
    this.drawSolarSystem(g, cam, S, lm, cond);
    if (S.meteors && st.meteors) S.meteors.draw(g, cam, S.now);
    this.clipGround = false;
    if (st.ground) this.drawLandscape(g, cam, cond, S);
    else this.drawHorizonLine(g, cam);
    this.drawCardinals(g, cam, st);
    if (st.constellations && st.labels) this.queueConNames(cam, M, S.highlightCon, cond);
    this.drawLabels(g);
    this.drawSelection(g, cam, S);
  }

  // ---------------------------------------------------------------- линии на сфере
  /**
   * Ломаная по точкам на сфере. Если включена земля, всё, что ниже горизонта, обрезается
   * точно по горизонту (иначе линии созвездий «просвечивали» бы сквозь землю).
   */
  strokeVecs(g, cam, pts, M, stride = 3) {
    const clip = this.clipGround;
    const a = [0, 0, 0];
    let started = false, px = 0, py = 0;
    let prev = null;
    const jump = Math.max(cam.width, cam.height) * 0.6;
    const put = (v, move) => {
      const p = cam.project(v, a);
      if (!p || p[2] < -0.6) { started = false; return; }
      if (!move && started && Math.hypot(p[0] - px, p[1] - py) < jump) g.lineTo(p[0], p[1]);
      else g.moveTo(p[0], p[1]);
      started = true;
      px = p[0];
      py = p[1];
    };
    for (let i = 0; i < pts.length; i += stride) {
      const v = M ? toEnu(M, [pts[i], pts[i + 1], pts[i + 2]]) : [pts[i], pts[i + 1], pts[i + 2]];
      if (clip) {
        const below = v[2] < 0;
        if (prev && (prev[2] < 0) !== below) {
          // Точка пересечения с горизонтом.
          const t = prev[2] / (prev[2] - v[2]);
          const h = vnorm([prev[0] + (v[0] - prev[0]) * t, prev[1] + (v[1] - prev[1]) * t, 0]);
          put(h, below ? false : true);
          if (below) started = false;
        }
        prev = v;
        if (below) { started = false; continue; }
      }
      put(v, false);
    }
  }

  drawAzGrid(g, cam) {
    g.strokeStyle = 'rgba(126, 170, 140, 0.22)';
    g.lineWidth = 1;
    g.beginPath();
    for (let alt = 15; alt < 90; alt += 15) {
      const pts = [];
      for (let az = 0; az <= 360; az += 2) pts.push(...sph2vecAzAlt(az, alt));
      this.strokeVecs(g, cam, pts, null);
    }
    for (let az = 0; az < 360; az += 15) {
      const pts = [];
      for (let alt = 0; alt <= 90; alt += 2) pts.push(...sph2vecAzAlt(az, alt));
      this.strokeVecs(g, cam, pts, null);
    }
    g.stroke();
  }

  drawEqGrid(g, cam, M) {
    g.strokeStyle = 'rgba(120, 150, 220, 0.2)';
    g.lineWidth = 1;
    g.beginPath();
    for (let dec = -75; dec <= 75; dec += 15) {
      const pts = [];
      for (let ra = 0; ra <= 360; ra += 2) pts.push(...sph2vec(ra, dec));
      this.strokeVecs(g, cam, pts, M);
    }
    for (let ra = 0; ra < 360; ra += 15) {
      const pts = [];
      for (let dec = -88; dec <= 88; dec += 2) pts.push(...sph2vec(ra, dec));
      this.strokeVecs(g, cam, pts, M);
    }
    g.stroke();
    // Небесный экватор ярче.
    g.strokeStyle = 'rgba(120, 150, 220, 0.4)';
    g.beginPath();
    const eq = [];
    for (let ra = 0; ra <= 360; ra += 1) eq.push(...sph2vec(ra, 0));
    this.strokeVecs(g, cam, eq, M);
    g.stroke();
  }

  drawEcliptic(g, cam, M) {
    const pts = [];
    for (let l = 0; l <= 360; l += 1) pts.push(...eclVecToEq(sph2vec(l, 0), OBLIQUITY_J2000));
    g.strokeStyle = 'rgba(232, 183, 90, 0.42)';
    g.lineWidth = 1.2;
    g.setLineDash([6, 5]);
    g.beginPath();
    this.strokeVecs(g, cam, pts, M);
    g.stroke();
    g.setLineDash([]);
  }

  drawBounds(g, cam, M, highlight) {
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(160, 130, 200, 0.18)';
    g.setLineDash([3, 4]);
    g.beginPath();
    for (const b of conBorders) if (b.id !== highlight) this.strokeVecs(g, cam, b.pts, M);
    g.stroke();
    g.setLineDash([]);
    if (highlight) {
      g.strokeStyle = 'rgba(232, 183, 90, 0.5)';
      g.beginPath();
      for (const b of conBorders) if (b.id === highlight) this.strokeVecs(g, cam, b.pts, M);
      g.stroke();
    }
  }

  drawFigures(g, cam, M, all, highlight, cond) {
    const dayFade = 1 - clamp(cond.day * 3, 0, 0.7);
    if (all) {
      g.strokeStyle = `rgba(122, 162, 236, ${0.3 * dayFade})`;
      g.lineWidth = 1;
      g.beginPath();
      for (const [id, polys] of Object.entries(conFigures)) {
        if (id === highlight) continue;
        for (const pts of polys) this.strokeVecs(g, cam, pts, M);
      }
      g.stroke();
    }
    if (highlight && conFigures[highlight]) {
      g.strokeStyle = 'rgba(240, 196, 110, 0.85)';
      g.lineWidth = 1.6;
      g.beginPath();
      for (const pts of conFigures[highlight]) this.strokeVecs(g, cam, pts, M);
      g.stroke();
    }
  }

  queueConNames(cam, M, highlight, cond) {
    const a = [0, 0, 0];
    const maxRank = cam.fov > 140 ? 1 : cam.fov > 80 ? 2 : 3;
    const alpha = 0.62 * (1 - clamp(cond.day * 3, 0, 0.6));
    for (const c of conLabels) {
      const hl = c.id === highlight;
      if (c.rank > maxRank && !hl) continue;
      const e = toEnu(M, c.vec);
      if (this.groundOn && e[2] < 0.03) continue;
      const p = cam.project(e, a);
      if (!p || p[2] < 0) continue;
      this.labels.push({
        x: p[0], y: p[1], text: c.name.toUpperCase(), font: `${hl ? 15 : 12.5}px ${FONT_DISPLAY}`,
        color: hl ? 'rgba(244, 204, 124, 0.95)' : `rgba(150, 178, 230, ${alpha})`, align: 'center', priority: hl ? 90 : 20 - c.rank, spacing: 2.2,
      });
    }
  }

  // ---------------------------------------------------------------- туманности и галактики
  drawDsos(g, cam, M, S, lm, cond) {
    const st = S.settings;
    const a = [0, 0, 0];
    const markers = st.dso;
    const scaleNear = (cz) => ((2 * cam.k) / (1 + cz)) * DEG;
    for (const d of dsos) {
      const famous = FAMOUS_DSO.has(d.id);
      if (!markers && !famous) continue;
      let e = toEnu(M, d.vec);
      if (st.ground && e[2] < 0) continue;
      e = refractEnu(e, st.atmosphere);
      if (st.ground && e[2] < 0.1 && Math.asin(e[2]) * RAD < horizonAltAt(this.land, norm360(atan2d(e[0], e[1])))) continue;
      const p = cam.project(e, a);
      if (!p || p[2] < 0 || p[0] < -200 || p[0] > cam.width + 200 || p[1] < -200 || p[1] > cam.height + 200) continue;
      const pxPerDeg = scaleNear(p[2]);
      const rx = Math.max((d.size[0] / 120) * pxPerDeg, 2.5);
      const ry = Math.max((d.size[1] / 120) * pxPerDeg, 2);
      const ext = st.atmosphere ? 0.2 * (airmass(Math.asin(e[2]) * RAD) - 1) : 0;
      const vis = clamp((lm + 1.2 - d.mag - ext) / 3, 0, 1);
      // Мягкое свечение туманных объектов, видимых глазом.
      if (famous && vis > 0 && d.type !== 'oc' && rx > 1.5) {
        // Позиционный угол большой оси отсчитывается от севера к востоку.
        const pa = d.id === 'M31' ? 35 : d.id === 'LMC' ? 170 : 0;
        const north = this.northAngle(cam, M, d.vec, p);
        const east = pa ? this.eastSign(cam, S, d.vec, p, Math.sin(north), -Math.cos(north)) : 1;
        const ang = north + east * pa * DEG;
        g.save();
        g.translate(p[0], p[1]);
        g.rotate(ang);
        g.globalAlpha = 0.5 * vis * (d.type === 'gc' ? 0.7 : 1);
        g.globalCompositeOperation = 'lighter';
        const sp = d.type === 'sfr' || d.type === 'en' || d.type === 'snr' ? this.warmGlow : this.glow;
        g.drawImage(sp, -ry * 1.6, -rx * 1.6, ry * 3.2, rx * 3.2);
        g.restore();
      }
      if (markers && (vis > 0 || cam.fov < 40)) {
        g.globalAlpha = 0.55 * Math.max(vis, 0.35);
        g.strokeStyle = d.type === 'oc' || d.type === 'gc' ? '#9fd6c4' : d.type.length <= 2 && 'gsie0'.includes(d.type[0]) ? '#e3a4c8' : '#a9c4ff';
        g.lineWidth = 1;
        g.beginPath();
        if (d.type === 'oc') g.setLineDash([2, 2]);
        g.ellipse(p[0], p[1], Math.min(rx, 60) + 2, Math.min(ry, 60) + 2, 0, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
        g.globalAlpha = 1;
      }
      const top = TOP_DSO.has(d.id);
      const showLabel = st.labels && ((top && cam.fov < 140) || (famous && cam.fov < 70) || (markers && cam.fov < 50)) && vis > 0.1;
      if (showLabel) {
        this.labels.push({ x: p[0], y: p[1] + Math.min(ry, 40) + 12, text: d.name, font: `11px ${FONT_UI}`, color: 'rgba(214, 186, 220, 0.8)', align: 'center', priority: famous ? 30 - d.mag : 10 - d.mag * 0.5 });
      }
      this.hits.push({ x: p[0], y: p[1], r: Math.min(Math.max(rx, 6), 40), obj: d, prio: famous ? 2 : 0 });
    }
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
  }

  /** Угол направления на север небесной сферы в экранных координатах (радианы). */
  northAngle(cam, M, vec, p0) {
    const north = [0, 0, 1];
    const t = vnorm([north[0] - vec[0] * vec[2], north[1] - vec[1] * vec[2], north[2] - vec[2] * vec[2]]);
    const q = vnorm([vec[0] + t[0] * 0.01, vec[1] + t[1] * 0.01, vec[2] + t[2] * 0.01]);
    const p1 = cam.project(toEnu(M, q), [0, 0, 0]);
    if (!p1) return 0;
    return Math.atan2(p1[0] - p0[0], -(p1[1] - p0[1]));
  }

  // ---------------------------------------------------------------- звёзды
  drawStars(g, cam, M, S, lm, cond) {
    const st = S.settings;
    const atm = st.atmosphere, ground = st.ground;
    this.groundOn = ground;
    const W = cam.width, H = cam.height;
    const { f, r, u, k, cx: ccx, cy: ccy } = cam;
    const atlas = this.atlas.canvas, S0 = this.atlas.size;
    const tw = st.twinkle && !S.reducedMotion ? S.now / 1000 : 0;
    const land = this.land, maxProfile = land.max;
    const labelLimit = clamp(1.3 + 2.2 * Math.log10(100 / cam.fov), 0.8, 4.2);
    const sizeGain = clamp(1 + 0.12 * Math.log10(90 / cam.fov), 0.9, 1.35);
    const labelSet = this.labelIndex || (this.labelIndex = new Set(starLabels));
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < starCount; i++) {
      const m = starMag[i];
      if (m > lm + 0.3) break;
      const vx = starVec[i * 3], vy = starVec[i * 3 + 1], vz = starVec[i * 3 + 2];
      let ex = M[0] * vx + M[1] * vy + M[2] * vz;
      let ey = M[3] * vx + M[4] * vy + M[5] * vz;
      let ez = M[6] * vx + M[7] * vy + M[8] * vz;
      if (ground && ez < -0.02) continue;
      let altDeg = 90;
      if (atm && ez < 0.87) {
        altDeg = Math.asin(ez) * RAD;
        if (altDeg > -3) {
          const R = refraction(altDeg);
          const na = (altDeg + R) * DEG, h = Math.hypot(ex, ey) || 1e-9, c = Math.cos(na) / h;
          ex *= c; ey *= c; ez = Math.sin(na);
          altDeg += R;
        }
      } else if (ez < 0.2) altDeg = Math.asin(ez) * RAD;
      if (ground && altDeg < maxProfile + 0.1) {
        if (altDeg < horizonAltAt(land, norm360(Math.atan2(ex, ey) * RAD))) continue;
      }
      const mEff = atm && altDeg < 45 ? m + 0.2 * (airmass(altDeg) - 1) : m;
      const b = lm - mEff;
      if (b <= 0) continue;
      const cz = ex * f[0] + ey * f[1] + ez * f[2];
      if (cz < -0.5) continue;
      const s = (2 * k) / (1 + cz);
      const x = ccx + (ex * r[0] + ey * r[1] + ez * r[2]) * s;
      const y = ccy - (ex * u[0] + ey * u[1] + ez * u[2]) * s;
      if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue;
      let rad = (0.62 + 0.42 * b + 0.05 * b * b) * sizeGain;
      let alpha = b < 1 ? 0.35 + 0.65 * b : 1;
      if (tw && m < 3.5) {
        // Мерцание сильнее у горизонта, где свет идёт через толщу воздуха.
        const amp = 0.08 + 0.3 * smoothstep(50, 5, altDeg);
        const n1 = Math.sin(tw * 13.1 + i * 1.7) * Math.sin(tw * 7.3 + i * 4.1);
        alpha *= 1 - amp * 0.5 + amp * n1 * 0.5;
        rad *= 1 + amp * 0.25 * n1;
      }
      const size = rad * 3.4;
      g.globalAlpha = alpha > 1 ? 1 : alpha;
      g.drawImage(atlas, starBin[i] * S0, 0, S0, S0, x - size / 2, y - size / 2, size, size);
      if (b > 0.6) {
        const hn = this.hitN++;
        this.hitX[hn] = x;
        this.hitY[hn] = y;
        this.hitI[hn] = i;
      }
      if (st.labels && m < labelLimit && labelSet.has(i)) {
        this.labels.push({ x: x + rad + 4, y: y - rad - 2, text: starProperName(starHip[i]), font: `12px ${FONT_UI}`, color: 'rgba(222, 228, 242, 0.78)', align: 'left', priority: 50 - m * 8 });
      }
    }
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- Солнце, Луна, планеты
  bodyScreen(cam, body, st) {
    let e = sph2vecAzAlt(body.az, body.alt);
    e = refractEnu(e, st.atmosphere);
    const altApp = Math.asin(clamp(e[2], -1, 1)) * RAD;
    const hidden = st.ground && altApp < horizonAltAt(this.land, body.az) - body.diameter / 2;
    const p = cam.project(e, [0, 0, 0]);
    return { e, p, altApp, hidden };
  }

  drawSolarSystem(g, cam, S, lm, cond) {
    const st = S.settings, ss = S.ss;
    const localScale = (p) => ((2 * cam.k) / (1 + p[2])) * DEG;
    // Сначала дальние: планеты, потом Солнце и Луна.
    const planets = [...ss.planets].sort((a, b) => b.distAU - a.distAU);
    for (const pl of planets) {
      const { p, altApp, hidden } = this.bodyScreen(cam, pl, st);
      if (!p || hidden || p[2] < -0.3) continue;
      if (p[0] < -30 || p[1] < -30 || p[0] > cam.width + 30 || p[1] > cam.height + 30) continue;
      const mEff = st.atmosphere && altApp < 45 ? pl.mag + 0.2 * (airmass(Math.max(altApp, -1)) - 1) : pl.mag;
      const b = lm - mEff;
      const trueR = (pl.diameter / 2) * localScale(p);
      const visible = b > 0 || trueR > 2;
      if (!visible) continue;
      const bb = Math.max(b, 0.5);
      const rad = Math.max(0.6 + 0.45 * bb + 0.05 * bb * bb, 1.5);
      const [cr, cg, cb] = hexRgb(pl.color);
      g.globalCompositeOperation = 'lighter';
      const halo = g.createRadialGradient(p[0], p[1], 0, p[0], p[1], rad * 3.4);
      const al = clamp(0.35 + b * 0.12, 0.25, 1);
      halo.addColorStop(0, `rgba(255,255,255,${al})`);
      halo.addColorStop(0.2, `rgba(${cr},${cg},${cb},${al * 0.8})`);
      halo.addColorStop(0.5, `rgba(${cr},${cg},${cb},${al * 0.15})`);
      halo.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
      g.fillStyle = halo;
      g.beginPath();
      g.arc(p[0], p[1], rad * 3.4, 0, Math.PI * 2);
      g.fill();
      g.globalCompositeOperation = 'source-over';
      if (trueR > 3) this.drawPlanetDisc(g, cam, S, pl, p, trueR);
      if (st.labels) this.labels.push({ x: p[0] + Math.max(rad, trueR) + 5, y: p[1] + 4, text: pl.name, font: `600 12.5px ${FONT_UI}`, color: 'rgba(245, 214, 150, 0.95)', align: 'left', priority: 80 });
      this.hits.push({ x: p[0], y: p[1], r: Math.max(rad * 1.5, trueR, 8), obj: pl, prio: 5 });
    }
    this.drawSun(g, cam, S, cond);
    this.drawMoon(g, cam, S, cond);
  }

  drawPlanetDisc(g, cam, S, pl, p, R) {
    const [cr, cg, cb] = hexRgb(pl.color);
    g.save();
    g.fillStyle = `rgb(${cr},${cg},${cb})`;
    g.beginPath();
    g.arc(p[0], p[1], R, 0, Math.PI * 2);
    g.fill();
    if (pl.id === 'jupiter' || pl.id === 'saturn') {
      g.clip();
      g.fillStyle = 'rgba(150, 110, 70, 0.28)';
      const ang = this.northAngle(cam, this.M, sph2vecRaDec2000(pl, S.frame), p);
      g.translate(p[0], p[1]);
      g.rotate(ang);
      for (const [y0, h] of [[-0.35, 0.14], [0.12, 0.16], [0.5, 0.08]]) g.fillRect(-R, y0 * R, 2 * R, h * R);
      g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }
    g.restore();
    if (pl.id === 'saturn') {
      const ang = this.northAngle(cam, this.M, sph2vecRaDec2000(pl, S.frame), p);
      g.save();
      g.translate(p[0], p[1]);
      g.rotate(ang + Math.PI / 2 + 6 * DEG);
      g.strokeStyle = 'rgba(236, 216, 160, 0.85)';
      g.lineWidth = Math.max(1, R * 0.28);
      g.beginPath();
      g.ellipse(0, 0, R * 2.1, Math.max(R * 2.1 * Math.abs(Math.sin(pl.ringTilt * DEG)), 0.6), 0, 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }
    if ((pl.id === 'venus' || pl.id === 'mercury' || pl.id === 'mars') && pl.illum < 0.97) {
      this.drawPhaseShadow(g, cam, S, p, R, pl.phaseAngle, pl, 'rgba(6, 8, 14, 0.92)');
    }
  }

  /** Экранное направление от тела к Солнцу (единичный вектор). */
  sunwardOnScreen(cam, S, bodyEnu, p) {
    const sunE = sph2vecAzAlt(S.ss.sun.az, S.ss.sun.alt);
    const d = bodyEnu[0] * sunE[0] + bodyEnu[1] * sunE[1] + bodyEnu[2] * sunE[2];
    const t = vnorm([sunE[0] - bodyEnu[0] * d, sunE[1] - bodyEnu[1] * d, sunE[2] - bodyEnu[2] * d]);
    const q = vnorm([bodyEnu[0] + t[0] * 0.01, bodyEnu[1] + t[1] * 0.01, bodyEnu[2] + t[2] * 0.01]);
    const p1 = cam.project(q, [0, 0, 0]);
    if (!p1) return [1, 0];
    const dx = p1[0] - p[0], dy = p1[1] - p[1];
    const l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l];
  }

  /** Путь освещённой части диска: полукруг к Солнцу + терминатор-эллипс. */
  litPath(g, cx, cy, R, sx, sy, phaseAngle) {
    const k = Math.cos(phaseAngle * DEG);
    const px = -sy, py = sx;
    g.beginPath();
    for (let a = -90; a <= 90; a += 6) {
      const c = Math.cos(a * DEG), s = Math.sin(a * DEG);
      const x = cx + R * (c * sx + s * px), y = cy + R * (c * sy + s * py);
      a === -90 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    for (let a = 90; a >= -90; a -= 6) {
      const c = Math.cos(a * DEG), s = Math.sin(a * DEG);
      g.lineTo(cx + R * (-k * c * sx + s * px), cy + R * (-k * c * sy + s * py));
    }
    g.closePath();
  }

  drawPhaseShadow(g, cam, S, p, R, phaseAngle, body, color) {
    const e = sph2vecAzAlt(body.az, body.alt);
    const [sx, sy] = this.sunwardOnScreen(cam, S, e, p);
    g.save();
    g.beginPath();
    g.arc(p[0], p[1], R, 0, Math.PI * 2);
    g.clip();
    // Тёмная часть = весь диск минус освещённая.
    g.beginPath();
    g.rect(p[0] - R - 2, p[1] - R - 2, 2 * R + 4, 2 * R + 4);
    this.litPathAppend(g, p[0], p[1], R, sx, sy, phaseAngle);
    g.fillStyle = color;
    g.fill('evenodd');
    g.restore();
  }

  litPathAppend(g, cx, cy, R, sx, sy, phaseAngle) {
    const k = Math.cos(phaseAngle * DEG);
    const px = -sy, py = sx;
    for (let a = -90; a <= 90; a += 6) {
      const c = Math.cos(a * DEG), s = Math.sin(a * DEG);
      const x = cx + R * (c * sx + s * px), y = cy + R * (c * sy + s * py);
      a === -90 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    for (let a = 90; a >= -90; a -= 6) {
      const c = Math.cos(a * DEG), s = Math.sin(a * DEG);
      g.lineTo(cx + R * (-k * c * sx + s * px), cy + R * (-k * c * sy + s * py));
    }
    g.closePath();
  }

  drawSun(g, cam, S, cond) {
    const st = S.settings, sun = S.ss.sun, moon = S.ss.moon;
    const { p, altApp, hidden } = this.bodyScreen(cam, sun, st);
    if (!p || hidden || p[2] < -0.2) return;
    const R = Math.max((sun.diameter / 2) * ((2 * cam.k) / (1 + p[2])) * DEG, 5);
    if (p[0] < -R * 8 || p[1] < -R * 8 || p[0] > cam.width + R * 8 || p[1] > cam.height + R * 8) return;
    const m = this.bodyScreen(cam, moon, st);
    const low = st.atmosphere ? smoothstep(12, -1, altApp) : 0;
    const col = [255, Math.round(246 - 90 * low), Math.round(222 - 150 * low)];
    const eclipse = this.eclipse.obscuration;
    g.save();
    if (eclipse > 0 && m.p) {
      // Луна закрывает Солнце: вырезаем её диск (в том же масштабе, что и диск Солнца).
      g.beginPath();
      g.rect(-10, -10, cam.width + 20, cam.height + 20);
      g.arc(m.p[0], m.p[1], R * (moon.diameter / sun.diameter), 0, Math.PI * 2);
      g.clip('evenodd');
    }
    g.globalCompositeOperation = 'lighter';
    const gl = g.createRadialGradient(p[0], p[1], R * 0.8, p[0], p[1], R * 5);
    gl.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},0.55)`);
    gl.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
    g.fillStyle = gl;
    g.beginPath();
    g.arc(p[0], p[1], R * 5, 0, Math.PI * 2);
    g.fill();
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
    g.beginPath();
    g.arc(p[0], p[1], R, 0, Math.PI * 2);
    g.fill();
    g.restore();
    // Солнечная корона в полной фазе затмения.
    if (eclipse > 0.995 && moon.diameter > sun.diameter) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2 + 0.3 * Math.sin(i * 7.1);
        const len = R * (1.8 + 1.6 * Math.abs(Math.sin(i * 3.7)));
        const gr = g.createLinearGradient(p[0], p[1], p[0] + Math.cos(a) * len, p[1] + Math.sin(a) * len);
        gr.addColorStop(0, 'rgba(235,240,255,0.35)');
        gr.addColorStop(1, 'rgba(235,240,255,0)');
        g.strokeStyle = gr;
        g.lineWidth = R * 0.35;
        g.beginPath();
        g.moveTo(p[0], p[1]);
        g.lineTo(p[0] + Math.cos(a) * len, p[1] + Math.sin(a) * len);
        g.stroke();
      }
      const cg = g.createRadialGradient(p[0], p[1], R, p[0], p[1], R * 2.6);
      cg.addColorStop(0, 'rgba(240,244,255,0.75)');
      cg.addColorStop(1, 'rgba(240,244,255,0)');
      g.fillStyle = cg;
      g.beginPath();
      g.arc(p[0], p[1], R * 2.6, 0, Math.PI * 2);
      g.fill();
      g.restore();
      g.fillStyle = '#05060a';
      g.beginPath();
      g.arc(m.p[0], m.p[1], R * (moon.diameter / sun.diameter), 0, Math.PI * 2);
      g.fill();
    }
    if (st.labels) this.labels.push({ x: p[0] + R + 6, y: p[1] + 4, text: 'Солнце', font: `600 12.5px ${FONT_UI}`, color: 'rgba(255, 220, 150, 0.95)', align: 'left', priority: 95 });
    this.hits.push({ x: p[0], y: p[1], r: Math.max(R, 10), obj: sun, prio: 6 });
  }

  drawMoon(g, cam, S, cond) {
    const st = S.settings, moon = S.ss.moon;
    const { e, p, hidden } = this.bodyScreen(cam, moon, st);
    if (!p || hidden || p[2] < -0.2) return;
    const scale = ((2 * cam.k) / (1 + p[2])) * DEG;
    const trueR = (moon.diameter / 2) * scale;
    const R = Math.max(trueR, 7);
    if (p[0] < -R * 3 || p[1] < -R * 3 || p[0] > cam.width + R * 3 || p[1] > cam.height + R * 3) return;
    const [sx, sy] = this.sunwardOnScreen(cam, S, e, p);
    // Ориентация лика: север Луны ≈ север неба; восток Луны (Море Кризисов) смотрит на запад неба.
    const vec = sph2vecRaDec2000(moon, S.frame);
    const nAng = this.northAngle(cam, this.M, vec, p);
    const nx = Math.sin(nAng), ny = -Math.cos(nAng);
    const mirror = this.eastSign(cam, S, vec, p, nx, ny);
    const day = cond.day;
    const eclipseSolar = this.eclipse.obscuration > 0;
    g.save();
    g.beginPath();
    g.arc(p[0], p[1], R, 0, Math.PI * 2);
    g.clip();
    // Пепельный свет на тёмной части — виден на тонком серпе в сумерках и ночью.
    // Пепельный свет заметен только у серпа: чем тоньше серп, тем он ярче.
    const earthshine = clamp(Math.pow(1 - moon.illum, 3) * 0.42 - day * 2, 0, 0.35);
    if (earthshine > 0.01 && !eclipseSolar) {
      g.globalAlpha = earthshine;
      this.drawMoonTexture(g, p, R, nx, ny, mirror);
      g.globalAlpha = earthshine * 0.8;
      g.fillStyle = 'rgb(40, 58, 104)';
      g.fillRect(p[0] - R, p[1] - R, 2 * R, 2 * R);
      g.globalAlpha = 1;
    }
    // Освещённая часть.
    this.litPath(g, p[0], p[1], R, sx, sy, moon.phaseAngle);
    g.save();
    g.clip();
    const lowSky = st.atmosphere ? smoothstep(10, -1, moon.alt) : 0;
    g.globalAlpha = 1 - day * 0.45;
    this.drawMoonTexture(g, p, R, nx, ny, mirror);
    if (lowSky > 0) {
      g.fillStyle = `rgba(255, 150, 70, ${0.35 * lowSky})`;
      g.globalCompositeOperation = 'multiply';
      g.fillRect(p[0] - R, p[1] - R, 2 * R, 2 * R);
      g.globalCompositeOperation = 'source-over';
    }
    g.restore();
    g.globalAlpha = 1;
    this.drawLunarEclipseShadow(g, cam, S, p, R, scale);
    g.restore();
    // Ореол.
    if (moon.illum > 0.15 && !eclipseSolar) {
      g.globalCompositeOperation = 'lighter';
      const halo = g.createRadialGradient(p[0], p[1], R, p[0], p[1], R * 3.2);
      halo.addColorStop(0, `rgba(210, 222, 255, ${0.16 * moon.illum})`);
      halo.addColorStop(1, 'rgba(210, 222, 255, 0)');
      g.fillStyle = halo;
      g.beginPath();
      g.arc(p[0], p[1], R * 3.2, 0, Math.PI * 2);
      g.fill();
      g.globalCompositeOperation = 'source-over';
    }
    if (st.labels) this.labels.push({ x: p[0] + R + 6, y: p[1] + 4, text: 'Луна', font: `600 12.5px ${FONT_UI}`, color: 'rgba(236, 236, 226, 0.95)', align: 'left', priority: 96 });
    this.hits.push({ x: p[0], y: p[1], r: Math.max(R, 10), obj: moon, prio: 7 });
  }

  /** Знак «востока» неба на экране относительно поворота севера (учёт зеркальности вида изнутри сферы). */
  eastSign(cam, S, vec, p, nx, ny) {
    const east = vnorm([-vec[1], vec[0], 0]);
    const q = vnorm([vec[0] + east[0] * 0.01, vec[1] + east[1] * 0.01, vec[2] + east[2] * 0.01]);
    const p1 = cam.project(toEnu(this.M, q), [0, 0, 0]);
    if (!p1) return 1;
    const ex = p1[0] - p[0], ey = p1[1] - p[1];
    // Поворот севера на +90° (по часовой в экранных координатах) — это «вправо».
    const rx = -ny, ry = nx;
    return ex * rx + ey * ry > 0 ? 1 : -1;
  }

  drawMoonTexture(g, p, R, nx, ny, eastSign) {
    // Восток неба на экране = eastSign · (−ny, nx). Восточный край Луны (Море Кризисов,
    // ось +u текстуры) смотрит на запад неба, поэтому u = −(восток неба).
    const ux = eastSign * ny, uy = -eastSign * nx;
    g.save();
    const half = this.moonTex.width / 2;
    g.transform((ux * R) / half, (uy * R) / half, (-nx * R) / half, (-ny * R) / half, p[0], p[1]);
    g.drawImage(this.moonTex, -half, -half);
    g.restore();
  }

  drawLunarEclipseShadow(g, cam, S, p, R, scale) {
    const moon = S.ss.moon, sun = S.ss.sun;
    // Центр тени Земли — антисолнечная точка (геоцентрически); смещаем в систему Луны.
    const anti = sph2vec(sun.ra + 180, -sun.dec);
    const geo = sph2vec(moon.geoRa, moon.geoDec);
    const topo = sph2vec(moon.ra, moon.dec);
    const off = [anti[0] - geo[0], anti[1] - geo[1], anti[2] - geo[2]];
    const sepDeg = Math.hypot(off[0], off[1], off[2]) * RAD;
    const piM = Math.asin(6378.14 / moon.geoDistKm) * RAD;
    const sS = sun.diameter / 2;
    const rU = 1.02 * (0.99834 * piM - sS + 0.0024);
    const rP = 1.02 * (0.99834 * piM + sS + 0.0024);
    const sM = moon.diameter / 2;
    if (sepDeg > rP + sM) return;
    const target = vnorm([topo[0] + off[0], topo[1] + off[1], topo[2] + off[2]]);
    const eqToEnu = S.frame.eq2hor;
    const c = cam.project(mulMV(eqToEnu, target), [0, 0, 0]);
    if (!c) return;
    const k = R / Math.max(sM * scale, 1e-6);
    const pr = rP * scale * k, ur = rU * scale * k;
    const pen = g.createRadialGradient(c[0], c[1], ur, c[0], c[1], pr);
    pen.addColorStop(0, 'rgba(20, 10, 10, 0.45)');
    pen.addColorStop(1, 'rgba(20, 10, 10, 0)');
    g.fillStyle = pen;
    g.fillRect(p[0] - R, p[1] - R, 2 * R, 2 * R);
    const um = g.createRadialGradient(c[0], c[1], 0, c[0], c[1], ur);
    um.addColorStop(0, 'rgba(70, 14, 4, 0.9)');
    um.addColorStop(0.85, 'rgba(120, 36, 12, 0.82)');
    um.addColorStop(1, 'rgba(150, 60, 30, 0.6)');
    g.fillStyle = um;
    g.beginPath();
    g.arc(c[0], c[1], ur, 0, Math.PI * 2);
    g.fill();
  }

  // ---------------------------------------------------------------- горизонт
  drawLandscape(g, cam, cond, S) {
    const land = this.land;
    const gc = groundColor(cond, this.landType);
    const { lut, size, max } = this.lut;
    const tm = (c) => (c <= 0 ? lut[0] : c >= max ? 255 : lut[(Math.sqrt(c / max) * size) | 0]);
    g.fillStyle = `rgb(${tm(gc[0])},${tm(gc[1])},${tm(gc[2])})`;
    const step = clamp(cam.fov / 900, 0.1, 1);
    const a = [0, 0, 0], b = [0, 0, 0];
    const runs = [];
    let run = null;
    for (let az = 0; az <= 360 + step; az += step) {
      const h = horizonAltAt(land, az);
      const top = cam.project(sph2vecAzAlt(az, h), a);
      const bot = cam.project(sph2vecAzAlt(az, -4), b);
      if (!top || !bot || top[2] < -0.3 || bot[2] < -0.3) {
        if (run) { runs.push(run); run = null; }
        continue;
      }
      if (!run) run = { top: [], bot: [] };
      run.top.push(top[0], top[1]);
      run.bot.push(bot[0], bot[1]);
    }
    if (run) runs.push(run);
    g.beginPath();
    for (const rr of runs) {
      for (let i = 0; i < rr.top.length; i += 2) i ? g.lineTo(rr.top[i], rr.top[i + 1]) : g.moveTo(rr.top[i], rr.top[i + 1]);
      for (let i = rr.bot.length - 2; i >= 0; i -= 2) g.lineTo(rr.bot[i], rr.bot[i + 1]);
      g.closePath();
    }
    g.fill();
    // Тонкая подсветка кромки на фоне яркого неба.
    if (cond.day > 0.02 || cond.twilight > 0.2) {
      g.strokeStyle = `rgba(255,255,255,${0.05 + 0.08 * cond.twilight})`;
      g.lineWidth = 1;
      g.beginPath();
      for (const rr of runs) for (let i = 0; i < rr.top.length; i += 2) i ? g.lineTo(rr.top[i], rr.top[i + 1]) : g.moveTo(rr.top[i], rr.top[i + 1]);
      g.stroke();
    }
    // Окна в городе по ночам.
    if (this.landType === 'city' && cond.day < 0.3 && cam.pxPerDeg > 5) {
      g.fillStyle = 'rgba(255, 206, 120, 0.8)';
      const s = Math.max(1, cam.pxPerDeg * 0.12);
      for (const w of land.windows) {
        const q = cam.project(sph2vecAzAlt(w.az, w.alt), a);
        if (!q || q[2] < 0 || q[0] < 0 || q[0] > cam.width || q[1] < 0 || q[1] > cam.height) continue;
        g.fillRect(q[0] - s / 2, q[1] - s / 2, s, s * 1.2);
      }
    }
  }

  drawHorizonLine(g, cam) {
    const pts = [];
    for (let az = 0; az <= 360; az += 1) pts.push(...sph2vecAzAlt(az, 0));
    g.strokeStyle = 'rgba(126, 190, 140, 0.55)';
    g.lineWidth = 1.2;
    g.beginPath();
    this.strokeVecs(g, cam, pts, null);
    g.stroke();
  }

  drawCardinals(g, cam, st) {
    const a = [0, 0, 0];
    for (const [az, name, major] of CARDINALS) {
      const p = cam.project(sph2vecAzAlt(az, st.ground ? -1.6 : 0.8), a);
      if (!p || p[2] < 0.05) continue;
      g.font = `${major ? '600 15px' : '12px'} ${FONT_UI}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = az === 0 ? 'rgba(255, 128, 110, 0.95)' : major ? 'rgba(232, 222, 196, 0.9)' : 'rgba(200, 196, 180, 0.6)';
      g.fillText(name, p[0], p[1] + (st.ground ? 10 : 0));
    }
    g.textBaseline = 'alphabetic';
  }

  // ---------------------------------------------------------------- подписи и выбор
  measure(g, font, text, spacing) {
    const key = font + '|' + text;
    let w = this.textWidth.get(key);
    if (w === undefined) {
      g.font = font;
      w = g.measureText(text).width + (spacing ? spacing * text.length : 0);
      if (this.textWidth.size > 4000) this.textWidth.clear();
      this.textWidth.set(key, w);
    }
    return w;
  }

  drawLabels(g) {
    const placed = [];
    this.labels.sort((a, b) => b.priority - a.priority);
    const hasSpacing = 'letterSpacing' in g;
    for (const L of this.labels) {
      const w = this.measure(g, L.font, L.text, hasSpacing ? L.spacing : 0);
      const h = 14;
      const x0 = L.align === 'center' ? L.x - w / 2 : L.x;
      const rect = [x0 - 2, L.y - h + 2, x0 + w + 2, L.y + 4];
      let clash = false;
      for (const q of placed) {
        if (rect[0] < q[2] && rect[2] > q[0] && rect[1] < q[3] && rect[3] > q[1]) { clash = true; break; }
      }
      if (clash) continue;
      placed.push(rect);
      g.font = L.font;
      if (hasSpacing) g.letterSpacing = L.spacing ? `${L.spacing}px` : '0px';
      g.textAlign = L.align;
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillText(L.text, L.x + 0.8, L.y + 0.8);
      g.fillStyle = L.color;
      g.fillText(L.text, L.x, L.y);
    }
    if (hasSpacing) g.letterSpacing = '0px';
  }

  /** Экранное положение объекта (для выделения и наведения). */
  locate(cam, S, obj) {
    if (!obj) return null;
    const st = S.settings;
    if (obj.kind === 'sun' || obj.kind === 'moon' || obj.kind === 'planet') {
      const body = obj.kind === 'sun' ? S.ss.sun : obj.kind === 'moon' ? S.ss.moon : S.ss.planets.find((p) => p.id === obj.id);
      const r = this.bodyScreen(cam, body, st);
      return r.p ? { x: r.p[0], y: r.p[1], cz: r.p[2], r: Math.max((body.diameter / 2) * cam.pxPerDeg, 8) } : null;
    }
    const vec = obj.vec || sph2vec(obj.ra2000, obj.dec2000);
    const e = refractEnu(toEnu(this.M, vec), st.atmosphere);
    const p = cam.project(e, [0, 0, 0]);
    if (!p) return null;
    const r = obj.kind === 'dso' ? Math.min(Math.max((obj.size[0] / 120) * cam.pxPerDeg, 8), 60) : 9;
    return { x: p[0], y: p[1], cz: p[2], r };
  }

  drawSelection(g, cam, S) {
    const obj = S.selected;
    if (!obj || obj.kind === 'constellation') return;
    const L = this.locate(cam, S, obj);
    if (!L || L.cz < 0) return;
    const t = S.reducedMotion ? 0 : S.now / 1000;
    const r = L.r + 6 + Math.sin(t * 3) * 1.2;
    g.save();
    g.strokeStyle = 'rgba(240, 196, 110, 0.95)';
    g.lineWidth = 1.5;
    for (let i = 0; i < 4; i++) {
      const a0 = (i * Math.PI) / 2 + t * 0.6 + 0.3;
      g.beginPath();
      g.arc(L.x, L.y, r, a0, a0 + 0.9);
      g.stroke();
    }
    g.restore();
  }

  /** Ближайший объект к точке экрана. */
  pick(x, y) {
    let best = null, bestScore = Infinity;
    for (const h of this.hits) {
      const d = Math.hypot(h.x - x, h.y - y);
      if (d > h.r + 14) continue;
      const score = d - h.r - h.prio * 2;
      if (score < bestScore) { bestScore = score; best = { type: 'obj', obj: h.obj }; }
    }
    for (let k = 0; k < this.hitN; k++) {
      const d = Math.hypot(this.hitX[k] - x, this.hitY[k] - y);
      if (d > 16) continue;
      const i = this.hitI[k];
      const score = d - (this.lmView - starMag[i]) * 1.4;
      if (score < bestScore) { bestScore = score; best = { type: 'star', index: i }; }
    }
    return best;
  }
}

function sph2vecAzAlt(az, alt) {
  const ca = cosd(alt);
  return [ca * sind(az), ca * cosd(az), sind(alt)];
}

/** Вектор J2000 для тела с RA/Dec эпохи даты (обратная прецессия). */
function sph2vecRaDec2000(body, frame) {
  return mulMV(transpose(frame.prec), sph2vec(body.ra, body.dec));
}

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export { sph2vecAzAlt, toEnu, refractEnu };
