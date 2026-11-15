// "Look" input for parallax: the phone's gyro when available, the mouse on
// desktop, and a slow breathing drift when neither is moving.
//
// Gyro access by platform:
//  - Android browsers: no prompt on HTTPS pages, so it starts at load.
//  - iPhone/iPad (Safari and in-app browsers built on it): Apple requires a one-time
//    permission prompt that can only open from a tap, so it is requested on the
//    client's very first tap anywhere (usually "Start Consult").
//  - If access is refused or unavailable, the scenes keep the slow automatic drift.
import * as THREE from 'three/webgpu';

type DOEWithPermission = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> };

export class LookInput {
  /** Smoothed look direction, roughly -1..1 on each axis. */
  readonly value = new THREE.Vector2();
  private target = new THREE.Vector2();
  private tiltBase: { x: number; y: number } | null = null;
  private lastTilt = 0;
  private lastPointer = 0;
  private listening = false;
  private asked = false;

  constructor() {
    addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      this.lastPointer = performance.now();
      this.target.set((e.clientX / innerWidth) * 2 - 1, -((e.clientY / innerHeight) * 2 - 1));
    });
    this.autoStart();
  }

  private get DOE(): DOEWithPermission | undefined {
    return (window as any).DeviceOrientationEvent;
  }

  private autoStart() {
    const DOE = this.DOE;
    if (!DOE) return;
    if (typeof DOE.requestPermission !== 'function') {
      this.listen(); // Android and desktop: no permission needed
      return;
    }
    // iOS: the prompt may only open inside a tap, so ask on the first one anywhere.
    const onFirstTap = () => {
      removeEventListener('touchend', onFirstTap, true);
      removeEventListener('click', onFirstTap, true);
      void this.enableTilt();
    };
    addEventListener('touchend', onFirstTap, { capture: true, passive: true });
    addEventListener('click', onFirstTap, { capture: true, passive: true });
  }

  /** Requests motion access (iOS) and starts listening. Safe to call more than once. */
  async enableTilt() {
    const DOE = this.DOE;
    if (!DOE || this.listening) return;
    if (typeof DOE.requestPermission === 'function') {
      if (this.asked) return;
      this.asked = true;
      try {
        if ((await DOE.requestPermission()) !== 'granted') return;
      } catch {
        return; // e.g. blocked inside an in-app browser
      }
    }
    this.listen();
  }

  private listen() {
    if (this.listening) return;
    this.listening = true;
    addEventListener('orientationchange', () => (this.tiltBase = null));
    screen.orientation?.addEventListener?.('change', () => (this.tiltBase = null));
    addEventListener('deviceorientation', (e) => {
      if (e.beta == null || e.gamma == null) return; // desktops report nulls
      // Map device axes to screen axes for however the phone is being held.
      const angle = screen.orientation?.angle ?? ((window as any).orientation as number) ?? 0;
      const a = ((angle % 360) + 360) % 360;
      const [x, y] =
        a === 90 ? [e.beta, -e.gamma] : a === 270 ? [-e.beta, e.gamma] : a === 180 ? [-e.gamma, -e.beta] : [e.gamma, e.beta];
      if (!this.tiltBase) this.tiltBase = { x, y };
      // The resting angle follows slowly, so a new way of holding the phone re-centres itself.
      this.tiltBase.x += (x - this.tiltBase.x) * 0.01;
      this.tiltBase.y += (y - this.tiltBase.y) * 0.01;
      const dx = THREE.MathUtils.clamp((x - this.tiltBase.x) / 18, -1, 1);
      const dy = THREE.MathUtils.clamp((y - this.tiltBase.y) / 18, -1, 1);
      this.target.set(dx, -dy);
      this.lastTilt = performance.now();
    });
  }

  update(dt: number, t: number) {
    const now = performance.now();
    const idle = now - Math.max(this.lastTilt, this.lastPointer) > 2500;
    if (idle) this.target.set(Math.sin(t * 0.21) * 0.35, Math.sin(t * 0.17 + 1.3) * 0.22);
    const k = 1 - Math.exp(-dt * (idle ? 0.8 : 5));
    this.value.lerp(this.target, k);
  }
}
