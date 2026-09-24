// Небосвод — главный контроллер: время, место, камера, панели, ввод.

import { jdFromDate, msFromJd, yearFromJd } from './astro/time.js';
import { makeFrame, solarSystem } from './astro/bodies.js';
import { riseTransitSet } from './astro/riseset.js';
import { eventCalendar, moonPhases } from './astro/events.js';
import { constellationAt } from './astro/constellation.js';
import { mulMM, mulMV, transpose, sph2vec, clamp, norm180, norm360, atan2d, asind } from './astro/math.js';
import { CITIES, cityForTimeZone } from './data/cities.js';
import { CONSTELLATIONS } from './data/constellations.js';
import { STAR_LORE, DSO_LORE, CON_GENITIVE, CON_INFO, PLANET_FACTS } from './data/lore.js';
import { Camera } from './sky/camera.js';
import { SkyRenderer } from './sky/renderer.js';
import { Meteors } from './sky/meteors.js';
import { LANDSCAPES } from './sky/landscape.js';
import { BORTLE_NAMES } from './sky/atmosphere.js';
import { bvToRgb } from './sky/sprites.js';
import {
  starObject, starIndexByHip, starHip, starCount, dsos, buildSearchIndex, search, normalize, starProperName, conLabels,
} from './sky/catalog.js';
import {
  fmtTime, fmtDate, fmtWeekday, fmtOffset, tzOffset, localParts, msFromLocal, fmtShift, fmtMag, fmtRa, fmtDec,
  whereInSky, fmtDistanceKm, fmtLy, fmtDuration, lightStory, num, fmtTimeJd,
} from './ui/format.js';
import { computeTonight, nightPreviewJd, phaseName } from './ui/tonight.js';
import { tonightHTML, eventsHTML, objectHTML, esc } from './ui/panels.js';
import { Ribbon } from './ui/ribbon.js';
import { OrientationAR } from './ui/ar.js';

const EMBED = typeof window !== 'undefined' && !!window.NEBO_EMBED;
const STORE_KEY = 'nebosvod:v1';
const SPEEDS = [-86400, -3600, -600, -60, -10, 1, 10, 60, 600, 3600, 86400];
const SPEED_LABEL = (s) => {
  const a = Math.abs(s);
  const txt = a === 1 ? '×1' : a < 3600 ? `${a / 60 >= 1 ? a / 60 + ' мин' : a + ' с'}/с` : a < 86400 ? `${a / 3600} ч/с` : '1 сут/с';
  return s < 0 ? `◂ ${txt}` : txt;
};

const DEFAULT_SETTINGS = {
  constellations: true,
  labels: true,
  bounds: false,
  dso: false,
  gridAz: false,
  gridEq: false,
  ecliptic: false,
  milkyway: true,
  atmosphere: true,
  ground: true,
  twinkle: true,
  meteors: true,
  landscape: 'forest',
  bortle: 4,
};

const SWITCHES = [
  ['constellations', 'Фигуры созвездий', 'C'],
  ['labels', 'Подписи'],
  ['milkyway', 'Млечный Путь', 'M'],
  ['atmosphere', 'Атмосфера', 'A'],
  ['ground', 'Земля', 'G'],
  ['dso', 'Туманности и галактики', 'D'],
  ['bounds', 'Границы созвездий', 'B'],
  ['ecliptic', 'Эклиптика', 'E'],
  ['gridAz', 'Сетка: высота и азимут'],
  ['gridEq', 'Сетка: экваториальная'],
  ['twinkle', 'Мерцание звёзд'],
  ['meteors', 'Метеоры'],
];

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || 'null') || {};
  } catch {
    return {};
  }
}

const $ = (id) => document.getElementById(id);

export class App {
  constructor() {
    this.root = $('app');
    this.canvas = $('sky');
    this.saved = load();
    this.settings = { ...DEFAULT_SETTINGS, ...(this.saved.settings || {}) };
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow';
    this.place = this.saved.place || { ...cityForTimeZone(tz) };
    this.camera = new Camera();
    const cam = this.saved.camera;
    if (cam) Object.assign(this.camera, { az: cam.az, alt: cam.alt, fov: cam.fov });
    else {
      this.camera.az = this.place.lat >= 0 ? 180 : 0;
      this.camera.alt = 20;
      this.camera.fov = window.innerWidth < 760 ? 110 : 105;
    }
    this.renderer = new SkyRenderer(this.canvas);
    this.renderer.setLandscape(this.settings.landscape);
    this.meteors = new Meteors();
    this.nowMs = Date.now();
    this.simMs = this.nowMs;
    this.live = true;
    this.playing = true;
    this.speed = 1;
    this.selected = null;
    this.track = false;
    this.anim = null;
    this.night = !!this.saved.night;
    this.panelTab = 'tonight';
    this.panelOpen = window.innerWidth >= 760 ? this.saved.panelOpen !== false : false;
    this.events = null;
    this.eventsKey = '';
    this.tonight = null;
    this.tonightKey = '';
    this.lastPanelUpdate = 0;
    this.searchIndex = null;
    this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.ar = new OrientationAR((f, r, u) => this.camera.setBasis(f, r, u));
  }

  init() {
    this.bindUI();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    if ('ResizeObserver' in window) new ResizeObserver(() => this.measureRibbon()).observe($('ribbon'));
    document.fonts?.ready.then(() => this.renderer.textWidth.clear());
    this.applyNight();
    this.renderSwitches();
    // Днём звёзд не видно — при первом запуске показываем ближайшую ночь.
    const f = makeFrame(jdFromDate(this.simMs), this.place);
    const ss = solarSystem(f);
    if (ss.sun.alt > -8) {
      const T = computeTonight(this.place, this.simMs);
      const jd = nightPreviewJd(T);
      if (T.minSunAlt < -6 && jd > jdFromDate(this.simMs)) {
        this.setSim(msFromJd(jd), { live: false });
        this.playing = true;
        this.speed = 1;
        this.toast(`Сейчас светло, поэтому показано небо сегодня в ${fmtTime(this.place.tz, this.simMs)}.`, 'Вернуться к текущему', () => this.goLive());
      }
    }
    this.updatePlaceUI();
    this.updatePanel(true);
    this.last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
    if (!EMBED && 'serviceWorker' in navigator && /^https:|^http:\/\/localhost/.test(location.href)) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  // ------------------------------------------------------------ состояние

  save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        settings: this.settings,
        place: this.place,
        camera: { az: this.camera.az, alt: this.camera.alt, fov: this.camera.fov },
        night: this.night,
        panelOpen: this.panelOpen,
      }));
    } catch { /* приватный режим — не страшно */ }
  }

  setSim(ms, { live = false } = {}) {
    const next = clamp(ms, Date.UTC(1000, 0, 1), Date.UTC(3000, 11, 31));
    // Прыжок во времени — панель должна обновиться сразу, а не по таймеру.
    if (Math.abs(next - this.simMs) > 10 * 60000) this.lastPanelUpdate = 0;
    this.simMs = next;
    this.live = live;
  }

  goLive() {
    this.setSim(Date.now(), { live: true });
    this.live = true;
    this.playing = true;
    this.speed = 1;
    this.updateTimeUI();
    this.hideToast();
  }

  get jd() {
    return jdFromDate(this.simMs);
  }

  // ------------------------------------------------------------ цикл

  loop(t) {
    const dt = Math.min(0.25, (t - this.last) / 1000);
    this.last = t;
    const prevMs = this.simMs;
    if (this.live) this.simMs = Date.now();
    else if (this.playing) this.setSim(this.simMs + dt * 1000 * this.speed);
    const dtSimH = (this.simMs - prevMs) / 3600000;

    const frame = makeFrame(this.jd, this.place);
    const ss = solarSystem(frame);
    this.frame = frame;
    this.ss = ss;

    this.stepCamera(dt, frame, ss);
    this.camera.update();

    const lm = this.renderer.cond ? this.renderer.cond.lm : 6;
    this.meteors.update(dt, Math.max(0, dtSimH), {
      date: new Date(this.simMs), j2000ToEnu: mulMM(frame.eq2hor, frame.prec), lm, sunAlt: ss.sun.alt, now: t,
    });

    this.renderer.render({
      camera: this.camera,
      frame,
      ss,
      settings: this.settings,
      selected: this.selected,
      highlightCon: this.selected?.kind === 'constellation' ? this.selected.id : this.hoverCon || null,
      meteors: this.meteors,
      now: t,
      reducedMotion: this.reducedMotion,
    });

    this.updateTimeUI();
    if (t - this.lastPanelUpdate > 1000) {
      this.lastPanelUpdate = t;
      this.updatePanel(false);
    }
    requestAnimationFrame((tt) => this.loop(tt));
  }

  stepCamera(dt, frame, ss) {
    const cam = this.camera;
    if (this.arOn) return;
    if (this.anim) {
      const a = this.anim;
      const k = Math.min(1, (performance.now() - a.t0) / a.dur);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      const target = a.target();
      if (target) {
        cam.az = a.az0 + norm180(target.az - a.az0) * e;
        cam.alt = a.alt0 + (target.alt - a.alt0) * e;
      }
      if (a.fov) cam.fov = a.fov0 + (a.fov - a.fov0) * e;
      if (k >= 1) this.anim = null;
      return;
    }
    if (this.track && this.selected) {
      const p = this.objectAzAlt(this.selected, frame, ss);
      if (p) {
        cam.az += norm180(p.az - cam.az) * Math.min(1, dt * 8);
        cam.alt += (p.alt - cam.alt) * Math.min(1, dt * 8);
      }
      return;
    }
    if (this.inertia && !this.dragging) {
      cam.az += this.inertia.az * dt * 60;
      cam.alt += this.inertia.alt * dt * 60;
      this.inertia.az *= Math.pow(0.9, dt * 60);
      this.inertia.alt *= Math.pow(0.9, dt * 60);
      if (Math.abs(this.inertia.az) < 0.002 && Math.abs(this.inertia.alt) < 0.002) this.inertia = null;
    }
    if (this.keysDown?.size) {
      const s = cam.fov / 90 * dt * 60;
      if (this.keysDown.has('ArrowLeft')) cam.az -= s;
      if (this.keysDown.has('ArrowRight')) cam.az += s;
      if (this.keysDown.has('ArrowUp')) cam.alt += s;
      if (this.keysDown.has('ArrowDown')) cam.alt -= s;
    }
  }

  /** Текущие азимут и высота объекта (видимые). */
  objectAzAlt(obj, frame = this.frame, ss = this.ss) {
    if (!obj) return null;
    if (obj.kind === 'sun') return { az: ss.sun.az, alt: ss.sun.alt };
    if (obj.kind === 'moon') return { az: ss.moon.az, alt: ss.moon.alt };
    if (obj.kind === 'planet') {
      const p = ss.planets.find((x) => x.id === obj.id);
      return { az: p.az, alt: p.alt };
    }
    let vec;
    if (obj.kind === 'constellation') vec = conLabels.find((c) => c.id === obj.id).vec;
    else vec = obj.vec || sph2vec(obj.ra2000, obj.dec2000);
    const e = mulMV(mulMM(frame.eq2hor, frame.prec), vec);
    return { az: norm360(atan2d(e[0], e[1])), alt: asind(e[2]) };
  }

  flyTo(obj, fov) {
    const cam = this.camera;
    this.inertia = null;
    this.anim = {
      t0: performance.now(),
      dur: this.reducedMotion ? 1 : 1100,
      az0: cam.az,
      alt0: cam.alt,
      fov0: cam.fov,
      fov: fov || null,
      target: () => this.objectAzAlt(obj),
    };
  }

  // ------------------------------------------------------------ интерфейс

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.camera.setSize(w, h);
    this.renderer.resize(w, h, dpr);
    this.measureRibbon();
  }

  measureRibbon() {
    const r = $('ribbon').getBoundingClientRect();
    this.ribbonSize = [r.width, r.height, Math.min(window.devicePixelRatio || 1, 2)];
  }

  bindUI() {
    // --- небо: перетаскивание, выбор, масштаб
    const c = this.canvas;
    const pointers = new Map();
    let downAt = null, grab = null, pinch = null, lastMove = null;
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.anim = null;
      this.inertia = null;
      if (pointers.size === 1) {
        downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
        grab = this.camera.unproject(e.clientX, e.clientY);
        this.dragging = true;
        lastMove = { x: e.clientX, y: e.clientY, t: performance.now(), az: this.camera.az, alt: this.camera.alt };
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), fov: this.camera.fov };
        grab = null;
      }
    });
    c.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) {
        this.hover(e.clientX, e.clientY);
        return;
      }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.camera.fov = clamp(pinch.fov * (pinch.d / Math.max(d, 1)), this.camera.minFov, this.camera.maxFov);
        this.camera.update();
        return;
      }
      if (grab && !this.arOn) {
        if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4) {
          c.classList.add('dragging');
          this.track = false;
        }
        const now = this.camera.unproject(e.clientX, e.clientY);
        this.camera.rotateFromTo(grab, now);
        const t = performance.now();
        if (t - lastMove.t > 16) {
          const k = 16 / (t - lastMove.t);
          this.velocity = { az: norm180(this.camera.az - lastMove.az) * k, alt: (this.camera.alt - lastMove.alt) * k };
          lastMove = { x: e.clientX, y: e.clientY, t, az: this.camera.az, alt: this.camera.alt };
        }
      }
    });
    const up = (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 0) {
        this.dragging = false;
        c.classList.remove('dragging');
        const moved = downAt ? Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) : 99;
        if (moved < 6 && performance.now() - downAt.t < 600) this.clickAt(e.clientX, e.clientY);
        else if (this.velocity && performance.now() - lastMove.t < 80 && !this.reducedMotion) this.inertia = this.velocity;
        this.velocity = null;
        grab = null;
        downAt = null;
        this.save();
      } else if (pointers.size === 1) {
        const [p] = [...pointers.values()];
        grab = this.camera.unproject(p.x, p.y);
      }
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.anim = null;
      const before = this.camera.unproject(e.clientX, e.clientY);
      const f = Math.exp(clamp(e.deltaY, -120, 120) * (e.ctrlKey ? 0.01 : 0.0022));
      this.camera.fov = clamp(this.camera.fov * f, this.camera.minFov, this.camera.maxFov);
      this.camera.update();
      if (!this.track && !this.arOn) {
        const after = this.camera.unproject(e.clientX, e.clientY);
        this.camera.rotateFromTo(before, after);
      }
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => this.save(), 400);
    }, { passive: false });
    c.addEventListener('dblclick', (e) => {
      const dir = this.camera.unproject(e.clientX, e.clientY);
      const target = { az: norm360(atan2d(dir[0], dir[1])), alt: asind(dir[2]) };
      this.anim = { t0: performance.now(), dur: 600, az0: this.camera.az, alt0: this.camera.alt, fov0: this.camera.fov, fov: Math.max(this.camera.fov / 2.5, 1), target: () => target };
    });

    // --- клавиатура
    this.keysDown = new Set();
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('keyup', (e) => this.keysDown.delete(e.key));
    window.addEventListener('blur', () => this.keysDown.clear());

    // --- время
    $('t-play').addEventListener('click', () => this.togglePlay());
    $('t-faster').addEventListener('click', () => this.changeSpeed(1));
    $('t-slower').addEventListener('click', () => this.changeSpeed(-1));
    $('t-prev').addEventListener('click', () => this.shiftTime(-86400000));
    $('t-next').addEventListener('click', () => this.shiftTime(86400000));
    $('t-now').addEventListener('click', () => this.goLive());
    $('live-chip').addEventListener('click', () => (this.live ? this.openDialog('dlg-time') : this.goLive()));
    this.ribbon = new Ribbon($('ribbon'), {
      onScrub: (ms, phase) => {
        if (phase === 'start') this.wasPlaying = this.playing;
        this.setSim(ms, { live: false });
        this.playing = phase === 'end' || phase === 'key' ? this.wasPlaying ?? this.playing : false;
      },
    });

    // --- инструменты
    $('layers-btn').addEventListener('click', () => this.toggleDialog('dlg-layers'));
    $('help-btn').addEventListener('click', () => this.toggleDialog('dlg-help'));
    $('place-btn').addEventListener('click', () => this.openPlace());
    $('time-btn').addEventListener('click', () => this.openTime());
    $('night-btn').addEventListener('click', () => { this.night = !this.night; this.applyNight(); this.save(); });
    $('full-btn').addEventListener('click', () => this.toggleFullscreen());
    $('shot-btn').addEventListener('click', () => this.screenshot());
    $('shot-btn-m').addEventListener('click', () => this.screenshot());
    $('help-btn-m').addEventListener('click', () => this.openDialog('dlg-help'));
    $('ar-btn').addEventListener('click', () => this.toggleAR());
    $('search-toggle').addEventListener('click', () => {
      const s = $('search');
      s.classList.toggle('open');
      if (s.classList.contains('open')) $('search-input').focus();
    });
    if (EMBED) document.querySelectorAll('[data-native]').forEach((el) => (el.hidden = true));
    if (!OrientationAR.supported() || !('ontouchstart' in window)) $('ar-btn').hidden = true;
    if (!document.documentElement.requestFullscreen) $('full-btn').hidden = true;
    $('backdrop').addEventListener('click', () => this.closeDialogs());
    document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => this.closeDialogs()));

    // --- слои
    $('bortle').value = this.settings.bortle;
    $('bortle').addEventListener('input', (e) => { this.settings.bortle = +e.target.value; this.renderSwitches(); this.save(); });
    $('switches').addEventListener('change', (e) => {
      const k = e.target.dataset.key;
      if (!k) return;
      this.settings[k] = e.target.checked;
      this.save();
    });
    $('landscape-seg').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-land]');
      if (!b) return;
      this.settings.landscape = b.dataset.land;
      this.renderer.setLandscape(b.dataset.land);
      this.renderSwitches();
      this.save();
    });

    // --- поиск
    const input = $('search-input');
    input.addEventListener('input', () => this.runSearch());
    input.addEventListener('focus', () => this.runSearch());
    input.addEventListener('keydown', (e) => {
      const items = [...$('search-results').querySelectorAll('button')];
      let i = items.findIndex((b) => b.getAttribute('aria-selected') === 'true');
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        i = clamp(i + (e.key === 'ArrowDown' ? 1 : -1), 0, items.length - 1);
        items.forEach((b, k) => b.setAttribute('aria-selected', k === i ? 'true' : 'false'));
      } else if (e.key === 'Enter') {
        (items[Math.max(i, 0)] || null)?.click();
      } else if (e.key === 'Escape') {
        input.blur();
        $('search-results').hidden = true;
        $('search').classList.remove('open');
      }
    });
    input.addEventListener('blur', () => setTimeout(() => ($('search-results').hidden = true), 180));
    $('search-results').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-k]');
      if (!b) return;
      const it = this.searchResults[+b.dataset.k];
      this.selectRef(it.obj, true);
      input.value = '';
      input.blur();
      $('search').classList.remove('open');
      $('search-results').hidden = true;
    });

    // --- панель
    document.querySelectorAll('.tabs [data-tab]').forEach((b) => b.addEventListener('click', () => { this.panelTab = b.dataset.tab; this.updatePanel(true); }));
    $('panel-close').addEventListener('click', () => { this.panelOpen = false; this.updatePanel(true); this.save(); });
    $('panel-open').addEventListener('click', () => { this.panelOpen = true; this.updatePanel(true); this.save(); });
    $('panel-body').addEventListener('click', (e) => this.onPanelClick(e));

    // --- место
    $('city-q').addEventListener('input', () => this.renderCities());
    $('city-list').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-city]');
      if (b) this.setPlace({ ...CITIES[+b.dataset.city] });
    });
    $('coord-apply').addEventListener('click', () => {
      const lat = parseFloat($('lat-in').value.replace(',', '.'));
      const lon = parseFloat($('lon-in').value.replace(',', '.'));
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
        this.toast('Проверьте координаты: широта от −90 до 90, долгота от −180 до 180.');
        return;
      }
      this.setPlace({ name: `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`, lat, lon, tz: this.guessTz(lon) });
    });
    $('geo-btn').addEventListener('click', () => this.geolocate());

    // --- время: диалог
    $('time-apply').addEventListener('click', () => {
      const d = $('date-in').value, tm = $('clock-in').value || '22:00';
      if (!d) return;
      const [y, mo, dd] = d.split('-').map(Number);
      const [h, mi] = tm.split(':').map(Number);
      this.setSim(msFromLocal(this.place.tz, y, mo, dd, h, mi));
      this.playing = false;
      this.closeDialogs();
    });
    document.querySelectorAll('[data-jump]').forEach((b) => b.addEventListener('click', () => {
      const T = computeTonight(this.place, this.simMs);
      const jd = { dusk: T.civilEnd || T.sunset, midnight: T.midnightJd, dawn: T.civilStart || T.sunrise }[b.dataset.jump];
      if (jd) { this.setSim(msFromJd(jd)); this.playing = false; }
      this.closeDialogs();
    }));

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.live) this.simMs = Date.now();
    });
  }

  onKey(e) {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    const toggle = (key) => { this.settings[key] = !this.settings[key]; this.renderSwitches(); this.save(); this.toast(`${SWITCHES.find((s) => s[0] === key)[1]}: ${this.settings[key] ? 'вкл.' : 'выкл.'}`); };
    if (k.startsWith('Arrow')) { this.keysDown.add(k); this.anim = null; this.track = false; e.preventDefault(); return; }
    switch (k) {
      case '/': e.preventDefault(); $('search').classList.add('open'); $('search-input').focus(); break;
      case ' ': e.preventDefault(); this.togglePlay(); break;
      case '[': this.shiftTime(e.shiftKey ? -86400000 : -3600000); break;
      case ']': this.shiftTime(e.shiftKey ? 86400000 : 3600000); break;
      case '{': this.shiftTime(-86400000); break;
      case '}': this.shiftTime(86400000); break;
      case '+': case '=': this.camera.fov /= 1.25; this.camera.update(); break;
      case '-': case '_': this.camera.fov *= 1.25; this.camera.update(); break;
      case 'Escape': this.closeDialogs(); if (this.selected) this.select(null); break;
      default: {
        const map = { c: 'constellations', m: 'milkyway', a: 'atmosphere', g: 'ground', d: 'dso', b: 'bounds', e: 'ecliptic' };
        const ru = { с: 'c', ь: 'm', ф: 'a', п: 'g', в: 'd', и: 'b', у: 'e', т: 'n', к: 'r', д: 'l', а: 'f', р: 'h' };
        const key = (ru[k.toLowerCase()] || k.toLowerCase());
        if (map[key]) toggle(map[key]);
        else if (key === 'n') this.goLive();
        else if (key === 'r') { this.night = !this.night; this.applyNight(); this.save(); }
        else if (key === 'l') this.toggleDialog('dlg-layers');
        else if (key === 'f') this.toggleFullscreen();
        else if (key === 'h' || k === '?') this.toggleDialog('dlg-help');
      }
    }
  }

  togglePlay() {
    if (this.live) { this.live = false; this.playing = false; }
    else this.playing = !this.playing;
  }

  changeSpeed(dir) {
    if (this.live) this.live = false;
    let i = SPEEDS.indexOf(this.speed);
    if (i < 0) i = SPEEDS.indexOf(1);
    i = clamp(i + dir, 0, SPEEDS.length - 1);
    this.speed = SPEEDS[i];
    this.playing = true;
  }

  shiftTime(ms) {
    this.setSim(this.simMs + ms, { live: false });
  }

  updateTimeUI() {
    const tz = this.place.tz;
    const ms = this.simMs;
    const key = `${Math.floor(ms / 1000)}|${this.live}|${this.playing}|${this.speed}|${tz}`;
    if (key !== this.timeKey) {
      this.timeKey = key;
      const lp = localParts(tz, ms);
      $('clock').textContent = fmtTime(tz, ms);
      const yearNote = Math.abs(lp.y - new Date().getFullYear()) > 0 ? ` ${lp.y}` : '';
      $('clock-sub').textContent = `${fmtWeekday(tz, ms)}, ${fmtDate(tz, ms)}${yearNote} · ${fmtOffset(lp.off)}`;
      const chip = $('live-chip');
      chip.classList.toggle('off', !this.live);
      $('live-text').textContent = this.live ? 'Сейчас' : `${fmtShift(ms - Date.now())} · вернуться`;
      $('t-play-icon').innerHTML = `<use href="#${this.playing ? 'i-pause' : 'i-play'}"/>`;
      $('t-play').setAttribute('aria-label', this.playing ? 'Пауза' : 'Пуск');
      $('speed').textContent = this.playing ? SPEED_LABEL(this.live ? 1 : this.speed) : 'пауза';
      $('t-now').hidden = this.live;
    }
    // Шкала суток.
    const lp = localParts(tz, ms);
    let noon = msFromLocal(tz, lp.y, lp.mo, lp.d, 12, 0);
    if (lp.h < 12) noon -= 86400000;
    const [rw, rh, dpr] = this.ribbonSize;
    if (rw > 0) {
      this.ribbon.prepare(this.place, noon, rw, rh, dpr);
      this.ribbon.draw(ms);
    }
  }

  // ------------------------------------------------------------ выбор объектов

  hover(x, y) {
    const hit = this.renderer.pick(x, y);
    this.canvas.style.cursor = hit ? 'pointer' : '';
  }

  clickAt(x, y) {
    const hit = this.renderer.pick(x, y);
    if (!hit) {
      // Клик по пустому небу — показываем созвездие в этой точке.
      const dir = this.camera.unproject(x, y);
      if (this.settings.ground && dir[2] < 0) { this.select(null); return; }
      const M = mulMM(this.frame.eq2hor, this.frame.prec);
      const v = mulMV(transpose(M), dir);
      const ra = norm360(atan2d(v[1], v[0])), dec = asind(v[2]);
      const id = constellationAt(ra, dec);
      if (this.selected?.kind === 'constellation' && this.selected.id === id) this.select(null);
      else if (window.innerWidth < 760 && !this.panelOpen) {
        // На телефоне не закрываем полэкрана панелью: подсвечиваем созвездие и даём короткую подсказку.
        this.selected = { kind: 'constellation', id };
        this.track = false;
        this.toast(`Созвездие ${CONSTELLATIONS[id].ru}`, 'Подробнее', () => this.select({ kind: 'constellation', id }));
        this.updatePanel(false);
      } else this.select({ kind: 'constellation', id });
      return;
    }
    if (hit.type === 'star') this.select(starObject(hit.index));
    else this.select(hit.obj);
  }

  selectRef(ref, fly) {
    let obj = null;
    if (ref.type === 'star') obj = starObject(ref.index);
    else if (ref.type === 'constellation') obj = { kind: 'constellation', id: ref.id };
    else if (ref.type === 'dso') obj = dsos.find((d) => d.id === ref.id);
    else if (ref.type === 'body') obj = ref.id === 'sun' ? { kind: 'sun', id: 'sun' } : ref.id === 'moon' ? { kind: 'moon', id: 'moon' } : { kind: 'planet', id: ref.id };
    if (!obj) return;
    this.select(obj);
    if (fly) {
      const p = this.objectAzAlt(obj);
      const fov = obj.kind === 'constellation' ? 70 : obj.kind === 'dso' ? Math.max(4, Math.min(30, obj.size[0] / 60 * 6)) : Math.min(this.camera.fov, 60);
      if (p && p.alt < 0 && this.settings.ground) {
        this.toast(`${this.objectTitle(obj)} сейчас под горизонтом.${this.nextRiseText(obj)}`, 'Убрать землю', () => { this.settings.ground = false; this.renderSwitches(); this.save(); });
      }
      this.flyTo(obj, fov);
    }
  }

  select(obj) {
    if (obj && (obj.kind === 'sun' || obj.kind === 'moon' || obj.kind === 'planet')) obj = { kind: obj.kind, id: obj.id };
    this.selected = obj;
    this.track = false;
    if (obj) {
      this.panelTab = 'object';
      this.panelOpen = true;
    } else if (this.panelTab === 'object') this.panelTab = 'tonight';
    this.updatePanel(true);
  }

  objectTitle(obj) {
    if (obj.kind === 'sun') return 'Солнце';
    if (obj.kind === 'moon') return 'Луна';
    if (obj.kind === 'planet') return this.ss.planets.find((p) => p.id === obj.id).name;
    if (obj.kind === 'constellation') return CONSTELLATIONS[obj.id].ru;
    return obj.name;
  }

  nextRiseText(obj) {
    const target = obj.kind === 'star' || obj.kind === 'dso' ? { ra2000: obj.ra2000, dec2000: obj.dec2000 } : obj.kind === 'constellation' ? (() => { const c = CONSTELLATIONS[obj.id]; return { ra2000: c.ra, dec2000: c.dec }; })() : { id: obj.id, kind: obj.kind };
    const r = riseTransitSet(target, this.place, this.jd, this.jd + 1);
    if (r.rises.length) return ` Взойдёт в ${fmtTimeJd(this.place.tz, r.rises[0])}.`;
    if (r.alwaysDown) return ' Из этого места он не восходит никогда в эти сутки.';
    return '';
  }

  onPanelClick(e) {
    const sel = e.target.closest('[data-select]');
    if (sel) {
      const key = sel.dataset.select;
      if (['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'].includes(key)) this.selectRef({ type: 'body', id: key }, true);
      else if (key.startsWith('hip-')) this.selectRef({ type: 'star', index: starIndexByHip.get(+key.slice(4)) }, true);
      else if (key.startsWith('dso-')) this.selectRef({ type: 'dso', id: key.slice(4) }, true);
      return;
    }
    const ev = e.target.closest('[data-event]');
    if (ev && this.events) {
      this.gotoEvent(this.events[+ev.dataset.event]);
      return;
    }
    const act = e.target.closest('[data-action]');
    if (act && this.selected) {
      if (act.dataset.action === 'center') this.flyTo(this.selected, this.selected.kind === 'constellation' ? 70 : undefined);
      if (act.dataset.action === 'track') {
        this.track = !this.track;
        if (this.track && this.live === false && !this.playing) this.playing = true;
        this.updatePanel(true);
      }
    }
  }

  gotoEvent(e) {
    this.live = false;
    this.playing = false;
    let ms = msFromJd(e.jd);
    let target = null, fov = 50;
    switch (e.kind) {
      case 'phase': target = { kind: 'moon', id: 'moon' }; fov = 40; break;
      case 'conjunction': target = e.a.id === 'moon' ? { kind: 'moon', id: 'moon' } : { kind: 'planet', id: e.a.id }; fov = Math.max(8, e.sep * 6); break;
      case 'opposition': case 'elongation': target = { kind: 'planet', id: e.planet.id }; fov = 60; break;
      case 'lunar-eclipse': target = { kind: 'moon', id: 'moon' }; fov = 6; break;
      case 'solar-eclipse': target = { kind: 'sun', id: 'sun' }; fov = 5; if (e.local) ms = msFromJd(e.local.jd); break;
      case 'shower': {
        // Лучше всего метеоры видны перед рассветом — ставим 3 часа ночи местного времени.
        const lp = localParts(this.place.tz, ms);
        ms = msFromLocal(this.place.tz, lp.y, lp.mo, lp.d, 3, 0);
        this.settings.meteors = true;
        this.playing = true;
        this.speed = 60;
        const s = e.shower;
        target = { kind: 'radiant', ra2000: s.ra, dec2000: s.dec, name: `Радиант: ${s.name}` };
        fov = 110;
        break;
      }
      default: break;
    }
    this.setSim(ms);
    // Для события-момента пересчитываем кадр, чтобы полёт камеры шёл к верной точке.
    this.frame = makeFrame(this.jd, this.place);
    this.ss = solarSystem(this.frame);
    if (target && target.kind !== 'radiant') this.select(target);
    if (target) {
      this.flyTo(target, fov);
      const p = this.objectAzAlt(target);
      if (p && p.alt < -0.5 && this.settings.ground && e.kind !== 'shower') {
        this.toast('В этот момент объект под горизонтом вашего места.', 'Убрать землю', () => { this.settings.ground = false; this.renderSwitches(); this.save(); });
        return;
      }
    }
    if (e.kind === 'shower') this.toast('Время ускорено: смотрите, как метеоры вылетают из одной точки — радианта.');
  }

  // ------------------------------------------------------------ панель

  updatePanel(force) {
    const panel = $('panel');
    panel.classList.toggle('collapsed', !this.panelOpen);
    $('panel-open').hidden = this.panelOpen;
    $('tab-object').hidden = !this.selected;
    document.querySelectorAll('.tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === this.panelTab)));
    if (!this.panelOpen && !force) return;
    let html = '';
    if (this.panelTab === 'tonight') {
      const T = this.getTonight();
      if (!force && this.panelTonightKey === this.tonightKey && Math.abs(this.simMs - (this.panelTonightMs || 0)) < 60000) return;
      this.panelTonightKey = this.tonightKey;
      this.panelTonightMs = this.simMs;
      html = tonightHTML(T, this.place, { brightest: this.brightestNow(), bortle: this.settings.bortle, lm: this.renderer.cond?.lm ?? 6 });
      $('panel-open-text').textContent = 'Сегодня ночью';
    } else if (this.panelTab === 'events') {
      this.ensureEvents();
      if (!force && this.panelEventsKey === this.eventsKey && this.events) return;
      this.panelEventsKey = this.events ? this.eventsKey : '';
      html = eventsHTML(this.events, this.place);
    } else if (this.panelTab === 'object' && this.selected) {
      html = objectHTML(this.objectInfo(this.selected));
      $('panel-open-text').textContent = this.objectTitle(this.selected);
    }
    const body = $('panel-body');
    // Не трогаем DOM без нужды: иначе клик, пришедшийся на момент обновления, потеряется.
    if (html === this.lastPanelHTML && this.lastTab === this.panelTab) return;
    this.lastPanelHTML = html;
    const scroll = body.scrollTop;
    body.innerHTML = html;
    if (this.lastTab !== this.panelTab) body.scrollTop = 0;
    else body.scrollTop = scroll;
    this.lastTab = this.panelTab;
  }

  getTonight() {
    const lp = localParts(this.place.tz, this.simMs);
    const key = `${this.place.lat},${this.place.lon},${lp.y}-${lp.mo}-${lp.d}-${lp.h < 12 ? 'am' : 'pm'}`;
    if (key !== this.tonightKey) {
      this.tonightKey = key;
      this.tonight = computeTonight(this.place, this.simMs);
    }
    return this.tonight;
  }

  ensureEvents() {
    const lp = localParts(this.place.tz, this.simMs);
    const key = `${this.place.lat},${this.place.lon},${lp.y}-${lp.mo}-${lp.d}`;
    if (key === this.eventsKey && this.events) return;
    if (this.eventsPending === key) return;
    this.eventsPending = key;
    this.events = null;
    setTimeout(() => {
      const start = msFromLocal(this.place.tz, lp.y, lp.mo, lp.d, 0, 0);
      this.events = eventCalendar(this.place, jdFromDate(start), 62);
      this.eventsKey = key;
      this.eventsPending = null;
      if (this.panelTab === 'events') this.updatePanel(true);
    }, 30);
  }

  brightestNow() {
    const out = [];
    const ss = this.ss || solarSystem(makeFrame(this.jd, this.place));
    const frame = this.frame || makeFrame(this.jd, this.place);
    const lm = this.renderer.cond?.lm ?? 6;
    if (ss.moon.alt > 0) out.push({ key: 'moon', name: 'Луна', mag: ss.moon.mag, az: ss.moon.az, alt: ss.moon.alt, color: '#f1eee5' });
    for (const p of ss.planets) if (p.alt > 0 && p.mag < lm) out.push({ key: p.id, name: p.name, mag: p.mag, az: p.az, alt: p.alt, color: p.color });
    const M = mulMM(frame.eq2hor, frame.prec);
    for (let i = 0; i < 40 && i < starCount; i++) {
      const o = starObject(i);
      const e = mulMV(M, sph2vec(o.ra2000, o.dec2000));
      if (e[2] <= 0.05 || o.mag > lm) continue;
      const [r, g, b] = bvToRgb(o.bv);
      out.push({ key: o.id, name: o.name, mag: o.mag, az: norm360(atan2d(e[0], e[1])), alt: asind(e[2]), color: `rgb(${r},${g},${b})` });
    }
    return out.sort((a, b) => a.mag - b.mag).slice(0, 6);
  }

  /** Сведения об объекте для карточки. */
  objectInfo(sel) {
    const tz = this.place.tz;
    const ss = this.ss;
    const year = yearFromJd(this.jd);
    const pos = this.objectAzAlt(sel);
    const facts = [];
    let title = '', subtitle = '', story = '', note = '', coords = '', members = null;
    const dayStart = (() => {
      const lp = localParts(tz, this.simMs);
      return jdFromDate(msFromLocal(tz, lp.y, lp.mo, lp.d, 0, 0));
    })();
    const rts = (target) => {
      const key = `${target.id || target.ra2000 + ',' + target.dec2000}|${dayStart}|${this.place.lat},${this.place.lon}`;
      this.rtsCache = this.rtsCache || new Map();
      if (this.rtsCache.size > 200) this.rtsCache.clear();
      let r = this.rtsCache.get(key);
      if (!r) {
        r = riseTransitSet(target, this.place, dayStart, dayStart + 1);
        this.rtsCache.set(key, r);
      }
      if (r.alwaysUp) return ['Над горизонтом', 'круглые сутки — не заходит', true];
      if (r.alwaysDown) return ['Над горизонтом', 'не поднимается в эти сутки', true];
      const f = (arr) => (arr.length ? fmtTimeJd(tz, arr[0]) : '—');
      return ['Восход · кульм. · заход', `${f(r.rises)} · ${r.transits.length ? fmtTimeJd(tz, r.transits[0].jd) : '—'} · ${f(r.sets)}`, true];
    };
    const conName = (ra, dec) => {
      const id = constellationAt(ra, dec);
      return { id, gen: CON_GENITIVE[id], name: CONSTELLATIONS[id].ru };
    };
    const where = pos ? whereInSky(pos.az, pos.alt) : '';
    const whereFact = pos ? ['Сейчас', where, true] : null;

    if (sel.kind === 'star') {
      const o = starObject(sel.index);
      const lore = STAR_LORE[o.hip];
      const con = conName(o.ra2000, o.dec2000);
      const temp = Math.round(4600 * (1 / (0.92 * o.bv + 1.7) + 1 / (0.92 * o.bv + 0.62)) / 100) * 100;
      const colorWord = o.bv < -0.05 ? 'голубовато-белая' : o.bv < 0.3 ? 'белая' : o.bv < 0.58 ? 'жёлто-белая' : o.bv < 0.8 ? 'жёлтая, как Солнце' : o.bv < 1.3 ? 'оранжевая' : 'красноватая';
      title = o.name;
      subtitle = `${o.name !== o.designation ? esc(o.designation) + ' · ' : ''}звезда в созвездии ${esc(con.gen)}${o.latin && o.latin !== o.name ? ' · ' + esc(o.latin) : ''}`;
      facts.push(['Блеск', `${fmtMag(o.mag)}<sup>m</sup>`], ['Цвет', `${colorWord}`], ['Температура', `≈ ${num(temp)} K`]);
      if (lore?.ly) facts.push(['Расстояние', fmtLy(lore.ly)]);
      else facts.push(['Каталог', `HIP ${o.hip}`]);
      if (whereFact) facts.push(whereFact);
      facts.push(rts({ ra2000: o.ra2000, dec2000: o.dec2000 }));
      if (lore?.ly) story = lightStory(lore.ly, year).replace(/около ([^.]+?) года/, 'около <b>$1 года</b>');
      note = lore?.note || '';
      coords = `α ${fmtRa(o.ra2000)} · δ ${fmtDec(o.dec2000)} (J2000)`;
    } else if (sel.kind === 'dso') {
      const d = dsos.find((x) => x.id === sel.id);
      const lore = DSO_LORE[d.id];
      const con = conName(d.ra2000, d.dec2000);
      title = d.name;
      subtitle = `${d.short && d.short !== d.name ? d.short + ' · ' : ''}${esc(d.designation)} · ${d.typeName} в созвездии ${esc(con.gen)}`;
      facts.push(['Блеск', `${fmtMag(d.mag)}<sup>m</sup>`], ['Размер', `${num(d.size[0])}′${d.size[1] !== d.size[0] ? ' × ' + num(d.size[1]) + '′' : ''}`]);
      if (lore?.ly) facts.push(['Расстояние', fmtLy(lore.ly), true]);
      if (whereFact) facts.push(whereFact);
      facts.push(rts({ ra2000: d.ra2000, dec2000: d.dec2000 }));
      const eye = d.mag < 5 ? 'Виден глазом в тёмную ночь.' : d.mag < 8 ? 'Нужен бинокль.' : 'Нужен телескоп.';
      if (lore?.ly) story = lightStory(lore.ly, year).replace(/(\d[\d  ,]*(?:тыс\.|млн)? лет назад)/, '<b>$1</b>');
      note = [lore?.note, eye].filter(Boolean).join(' ');
      coords = `α ${fmtRa(d.ra2000)} · δ ${fmtDec(d.dec2000)} (J2000)`;
    } else if (sel.kind === 'constellation') {
      const c = CONSTELLATIONS[sel.id];
      title = c.ru;
      subtitle = `созвездие · ${c.la} · ${sel.id}`;
      if (whereFact) facts.push(whereFact);
      note = CON_INFO[sel.id] || '';
      members = this.conMembers(sel.id);
      facts.push(['Самая яркая', members[0] ? esc(members[0].name) : '—']);
    } else if (sel.kind === 'sun') {
      const s = ss.sun;
      title = 'Солнце';
      subtitle = `жёлтый карлик спектрального класса G2 · сейчас в созвездии ${esc(conName(...this.to2000(s.ra, s.dec)).gen)}`;
      facts.push(['Блеск', `${fmtMag(s.mag)}<sup>m</sup>`], ['Расстояние', fmtDistanceKm(s.distKm)], ['Угловой диаметр', `${num(s.diameter * 60, 1)}′`], ['Свет идёт', fmtDuration((s.distKm / 299792.458))]);
      if (whereFact) facts.push(whereFact);
      facts.push(rts({ id: 'sun', kind: 'sun' }));
      const obsc = this.renderer.eclipse?.obscuration || 0;
      if (obsc > 0.001) {
        const total = obsc > 0.999 && ss.moon.diameter > s.diameter;
        facts.push(['Солнечное затмение', total ? '<b style="color:var(--brass)">полная фаза!</b> Видна солнечная корона' : `Луна закрывает ${Math.round(obsc * 100)}% диска`, true]);
      }
      note = PLANET_FACTS.sun;
      story = `Солнечный свет идёт до вас <b>${fmtDuration(s.distKm / 299792.458)}</b>: вы видите Солнце таким, каким оно было ${Math.round(s.distKm / 299792.458 / 60)} минут назад.`;
    } else if (sel.kind === 'moon') {
      const m = ss.moon;
      title = 'Луна';
      subtitle = `${phaseName(m.elong)} · в созвездии ${esc(conName(...this.to2000(m.ra, m.dec)).gen)}`;
      const nextPh = moonPhases(this.jd, this.jd + 32);
      const nextFull = nextPh.find((p) => p.phase === 2), nextNew = nextPh.find((p) => p.phase === 0);
      facts.push(['Освещена', `${Math.round(m.illum * 100)}%`], ['Возраст', `${num(m.age, 1)} сут`], ['Расстояние', fmtDistanceKm(m.distKm)], ['Угловой диаметр', `${num(m.diameter * 60, 1)}′`]);
      if (whereFact) facts.push(whereFact);
      facts.push(rts({ id: 'moon', kind: 'moon' }));
      if (nextFull) facts.push(['Полнолуние', `${fmtDate(tz, msFromJd(nextFull.jd))}, ${fmtTimeJd(tz, nextFull.jd)}`]);
      if (nextNew) facts.push(['Новолуние', `${fmtDate(tz, msFromJd(nextNew.jd))}, ${fmtTimeJd(tz, nextNew.jd)}`]);
      note = PLANET_FACTS.moon;
      story = `Свет от Луны идёт до вас <b>${fmtDuration(m.distKm / 299792.458)}</b>.`;
    } else if (sel.kind === 'planet') {
      const p = ss.planets.find((x) => x.id === sel.id);
      const lightSec = p.distKm / 299792.458;
      title = p.name;
      subtitle = `планета · сейчас в созвездии ${esc(conName(...this.to2000(p.ra, p.dec)).gen)}`;
      facts.push(['Блеск', `${fmtMag(p.mag)}<sup>m</sup>`], ['Расстояние', `${num(p.distAU, 2)} а. е.`], ['Угловой диаметр', `${num(p.diameter * 3600, 1)}″`], ['Освещена', `${Math.round(p.illum * 100)}%`]);
      if (whereFact) facts.push(whereFact);
      facts.push(rts({ id: p.id, kind: 'planet' }));
      const seenAt = fmtTime(tz, this.simMs - lightSec * 1000);
      story = `Свет от ${p.gen} идёт до вас <b>${fmtDuration(lightSec)}</b>: вы видите планету такой, какой она была в ${seenAt}.`;
      note = PLANET_FACTS[p.id];
      coords = `α ${fmtRa(p.ra)} · δ ${fmtDec(p.dec)} (на дату) · ${fmtDistanceKm(p.distKm)}`;
    }
    return { title, subtitle, facts: facts.filter(Boolean), story, note, coords, members, tracking: this.track };
  }

  /** Шесть самых ярких звёзд созвездия (кэшируется). */
  conMembers(id) {
    this.membersCache = this.membersCache || new Map();
    if (this.membersCache.has(id)) return this.membersCache.get(id);
    const members = [];
    const c = CONSTELLATIONS[id];
    const center = sph2vec(c.ra, c.dec);
    for (let i = 0; i < starCount && members.length < 6; i++) {
      const o = starObject(i);
      const v = sph2vec(o.ra2000, o.dec2000);
      // Быстрый отсев: созвездия не бывают шире ~60° от точки подписи.
      if (v[0] * center[0] + v[1] * center[1] + v[2] * center[2] < 0.45) continue;
      if (constellationAt(o.ra2000, o.dec2000) !== id) continue;
      const nm = starProperName(starHip[i]);
      const [r, g, b] = bvToRgb(o.bv);
      members.push({ key: o.id, name: nm || o.designation, desig: nm ? o.designation : `звезда ${fmtMag(o.mag)}m`, mag: o.mag, color: `rgb(${r},${g},${b})` });
    }
    this.membersCache.set(id, members);
    return members;
  }

  /** RA/Dec на дату → J2000 (для определения созвездия). */
  to2000(ra, dec) {
    const v = mulMV(transpose(this.frame.prec), sph2vec(ra, dec));
    return [norm360(atan2d(v[1], v[0])), asind(v[2])];
  }

  // ------------------------------------------------------------ поиск

  runSearch() {
    if (!this.searchIndex) {
      const bodies = [
        ['sun', 'Солнце', 'звезда'], ['moon', 'Луна', 'спутник Земли'],
        ['mercury', 'Меркурий', 'планета'], ['venus', 'Венера', 'планета'], ['mars', 'Марс', 'планета'],
        ['jupiter', 'Юпитер', 'планета'], ['saturn', 'Сатурн', 'планета'], ['uranus', 'Уран', 'планета'], ['neptune', 'Нептун', 'планета'],
      ].map(([id, label, sub]) => ({ label, sub, obj: { type: 'body', id }, keys: [label, id], weight: 10 }));
      this.searchIndex = buildSearchIndex(bodies);
    }
    const q = $('search-input').value;
    const box = $('search-results');
    if (!q.trim()) {
      box.hidden = true;
      return;
    }
    const res = search(this.searchIndex, q, 8);
    this.searchResults = res;
    box.hidden = false;
    box.innerHTML = res.length
      ? res.map((r, i) => `<button type="button" role="option" data-k="${i}" aria-selected="${i === 0}"><span class="r-name">${esc(r.label)}</span><span class="r-sub">${esc(r.sub)}</span></button>`).join('')
      : `<div class="empty">Ничего не нашлось по запросу «${esc(q)}»</div>`;
  }

  // ------------------------------------------------------------ место

  openPlace() {
    $('lat-in').value = this.place.lat.toFixed(4);
    $('lon-in').value = this.place.lon.toFixed(4);
    $('city-q').value = '';
    this.renderCities();
    this.openDialog('dlg-place');
    setTimeout(() => $('city-q').focus(), 50);
  }

  renderCities() {
    const q = normalize($('city-q').value || '');
    const list = CITIES.map((c, i) => ({ c, i })).filter(({ c }) => !q || normalize(c.name).includes(q)).slice(0, 60);
    $('city-list').innerHTML = list.length
      ? list.map(({ c, i }) => `<button type="button" data-city="${i}"><span>${esc(c.name)}</span><span class="c-coord">${c.lat.toFixed(1)}°, ${c.lon.toFixed(1)}°</span></button>`).join('')
      : '<p class="muted">Такого города нет в списке — введите координаты ниже.</p>';
  }

  setPlace(p) {
    this.place = p;
    this.events = null;
    this.eventsKey = '';
    this.tonightKey = '';
    this.renderer.skyKey = '';
    this.updatePlaceUI();
    this.closeDialogs();
    this.updatePanel(true);
    this.save();
    this.toast(`Место: ${p.name}`);
  }

  guessTz(lon) {
    // Для произвольных координат берём часовой пояс браузера, если долгота близка, иначе — поясное время.
    const own = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const off = tzOffset(own, Date.now()) / 60;
    if (Math.abs(off - lon / 15) < 2.5) return own;
    const h = Math.round(lon / 15);
    return h === 0 ? 'Etc/UTC' : `Etc/GMT${h > 0 ? '-' : '+'}${Math.abs(h)}`;
  }

  geolocate() {
    if (!navigator.geolocation) { this.toast('Браузер не умеет определять местоположение.'); return; }
    this.toast('Определяем местоположение…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lon } = pos.coords;
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const near = CITIES.map((c) => ({ c, d: Math.hypot(c.lat - lat, (c.lon - lon) * Math.cos(lat * Math.PI / 180)) })).sort((a, b) => a.d - b.d)[0];
        const name = near && near.d < 0.6 ? near.c.name : 'Моё место';
        this.setPlace({ name, lat, lon, tz });
      },
      () => this.toast('Не удалось определить местоположение. Выберите город из списка.'),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    );
  }

  updatePlaceUI() {
    $('place-name').textContent = this.place.name;
  }

  // ------------------------------------------------------------ время: диалог

  openTime() {
    const lp = localParts(this.place.tz, this.simMs);
    $('date-in').value = `${String(lp.y).padStart(4, '0')}-${String(lp.mo).padStart(2, '0')}-${String(lp.d).padStart(2, '0')}`;
    $('clock-in').value = `${String(lp.h).padStart(2, '0')}:${String(lp.mi).padStart(2, '0')}`;
    this.openDialog('dlg-time');
  }

  // ------------------------------------------------------------ диалоги и мелочи

  openDialog(id) {
    this.closeDialogs();
    $(id).hidden = false;
    $('backdrop').hidden = false;
    this.openId = id;
    if (id === 'dlg-layers') $('layers-btn').setAttribute('aria-pressed', 'true');
  }

  toggleDialog(id) {
    if (this.openId === id) this.closeDialogs();
    else this.openDialog(id);
  }

  closeDialogs() {
    for (const id of ['dlg-layers', 'dlg-place', 'dlg-time', 'dlg-help']) $(id).hidden = true;
    $('backdrop').hidden = true;
    $('layers-btn').setAttribute('aria-pressed', 'false');
    this.openId = null;
  }

  renderSwitches() {
    $('switches').innerHTML = SWITCHES.map(([k, label, key]) => `<label class="switch"><span>${label}${key ? ` <span class="muted mono" style="font-size:11px">${key}</span>` : ''}</span><input type="checkbox" data-key="${k}" ${this.settings[k] ? 'checked' : ''}></label>`).join('');
    $('landscape-seg').innerHTML = Object.entries(LANDSCAPES).map(([k, v]) => `<button type="button" data-land="${k}" aria-pressed="${this.settings.landscape === k}">${v}</button>`).join('');
    $('bortle-name').textContent = BORTLE_NAMES[this.settings.bortle];
    $('bortle-lm').textContent = `· класс ${this.settings.bortle} из 9`;
    $('bortle').value = this.settings.bortle;
  }

  applyNight() {
    this.root.classList.toggle('night', this.night);
    $('night-btn').setAttribute('aria-pressed', String(this.night));
    if (this.night) this.requestWakeLock();
  }

  async requestWakeLock() {
    try {
      this.wakeLock = await navigator.wakeLock?.request('screen');
    } catch { /* не критично */ }
  }

  toggleFullscreen() {
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen?.().catch(() => {});
    } catch { /* нет полноэкранного режима */ }
  }

  screenshot() {
    this.canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      const lp = localParts(this.place.tz, this.simMs);
      a.download = `nebosvod-${lp.y}-${String(lp.mo).padStart(2, '0')}-${String(lp.d).padStart(2, '0')}-${String(lp.h).padStart(2, '0')}${String(lp.mi).padStart(2, '0')}.png`;
      a.href = URL.createObjectURL(blob);
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
  }

  async toggleAR() {
    if (this.arOn) {
      this.arOn = false;
      this.ar.stop();
      this.camera.clearBasis();
      $('ar-btn').setAttribute('aria-pressed', 'false');
      $('ar-hint').hidden = true;
      this.stopCamera();
      return;
    }
    const ok = await this.ar.start();
    if (!ok) { this.toast('Нет доступа к датчикам ориентации.'); return; }
    this.arOn = true;
    this.track = false;
    this.anim = null;
    this.camera.fov = 70;
    $('ar-btn').setAttribute('aria-pressed', 'true');
    $('ar-hint').hidden = false;
    this.requestWakeLock();
    setTimeout(() => ($('ar-hint').hidden = true), 3500);
    setTimeout(() => {
      if (this.arOn && !this.ar.gotEvent) {
        this.toggleAR();
        this.toast('Датчики ориентации недоступны на этом устройстве.');
      }
    }, 2500);
    this.toast('Наведите телефон на небо. Показать изображение с камеры?', 'Камера', () => this.startCamera());
  }

  async startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      const v = $('camera-feed');
      v.srcObject = stream;
      v.hidden = false;
      await v.play();
      this.root.classList.add('ar-camera');
    } catch {
      this.toast('Камера недоступна.');
    }
  }

  stopCamera() {
    const v = $('camera-feed');
    if (v.srcObject) v.srcObject.getTracks().forEach((t) => t.stop());
    v.srcObject = null;
    v.hidden = true;
    this.root.classList.remove('ar-camera');
  }

  toast(text, actionLabel, action) {
    const el = $('toast');
    el.innerHTML = `<span>${esc(text)}</span>${actionLabel ? `<button class="btn" type="button">${esc(actionLabel)}</button>` : ''}`;
    el.hidden = false;
    if (actionLabel) el.querySelector('button').addEventListener('click', () => { action(); this.hideToast(); });
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.hideToast(), actionLabel ? 9000 : 3200);
  }

  hideToast() {
    $('toast').hidden = true;
  }
}
