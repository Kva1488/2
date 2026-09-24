// Режим «наведи телефон на небо»: ориентация устройства → направление взгляда камеры.
// Матрица поворота по спецификации W3C DeviceOrientation: R = Rz(α)·Rx(β)·Ry(γ),
// оси Земли: x — восток, y — север, z — зенит. Взгляд — из задней камеры (−Z устройства).

import { DEG, vnorm, cross } from '../astro/math.js';

function rotation(alpha, beta, gamma) {
  const ca = Math.cos(alpha * DEG), sa = Math.sin(alpha * DEG);
  const cb = Math.cos(beta * DEG), sb = Math.sin(beta * DEG);
  const cg = Math.cos(gamma * DEG), sg = Math.sin(gamma * DEG);
  // Столбцы — оси устройства X, Y, Z в земной системе.
  const X = [ca * cg - sa * sb * sg, sa * cg + ca * sb * sg, -cb * sg];
  const Y = [-sa * cb, ca * cb, sb];
  const Z = [ca * sg + sa * sb * cg, sa * sg - ca * sb * cg, cb * cg];
  return { X, Y, Z };
}

export class OrientationAR {
  constructor(onBasis) {
    this.onBasis = onBasis;
    this.active = false;
    this.handler = (e) => this.onEvent(e);
    this.smooth = null;
    this.gotEvent = false;
  }

  static supported() {
    return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
  }

  /** Запрос разрешения (iOS 13+) и подписка на события. Возвращает true при успехе. */
  async start() {
    const DOE = window.DeviceOrientationEvent;
    try {
      if (DOE && typeof DOE.requestPermission === 'function') {
        const r = await DOE.requestPermission();
        if (r !== 'granted') return false;
      }
    } catch {
      return false;
    }
    this.active = true;
    this.gotEvent = false;
    this.absolute = 'ondeviceorientationabsolute' in window;
    window.addEventListener(this.absolute ? 'deviceorientationabsolute' : 'deviceorientation', this.handler, true);
    return true;
  }

  stop() {
    this.active = false;
    window.removeEventListener('deviceorientationabsolute', this.handler, true);
    window.removeEventListener('deviceorientation', this.handler, true);
    this.smooth = null;
  }

  onEvent(e) {
    if (e.alpha === null || e.beta === null) return;
    this.gotEvent = true;
    let alpha = e.alpha;
    // iOS отдаёт компасный курс отдельно; alpha там относительна.
    if (typeof e.webkitCompassHeading === 'number') alpha = 360 - e.webkitCompassHeading;
    const { X, Y, Z } = rotation(alpha, e.beta, e.gamma || 0);
    const angle = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    const c = Math.cos(angle * DEG), s = Math.sin(angle * DEG);
    const up = vnorm([c * Y[0] + s * X[0], c * Y[1] + s * X[1], c * Y[2] + s * X[2]]);
    const f = [-Z[0], -Z[1], -Z[2]];
    // Сглаживание дрожания датчиков.
    if (!this.smooth) this.smooth = { f, up };
    else {
      const k = 0.25;
      this.smooth.f = vnorm(this.smooth.f.map((v, i) => v + (f[i] - v) * k));
      this.smooth.up = vnorm(this.smooth.up.map((v, i) => v + (up[i] - v) * k));
    }
    const F = this.smooth.f;
    const R = vnorm(cross(F, this.smooth.up));
    const U = cross(R, F);
    this.onBasis(F, R, U);
  }
}
