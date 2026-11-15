// Touch-first camera for inspecting the body: one finger turns the body and
// slides up/down it, two fingers pinch to zoom, a double-tap flies in to
// that spot (or back out). A quick still tap is reported as a "tap".
import * as THREE from 'three/webgpu';

export interface OrbitLimits {
  minDistance: number;
  maxDistance: number;
  minY: number;
  maxY: number;
}

export class BodyOrbit {
  yaw = 0;
  pitch = 0.06;
  distance = 4;
  targetY = 0.95;
  private goal = { yaw: 0, pitch: 0.06, distance: 4, targetY: 0.95, targetX: 0 };
  private targetX = 0;
  private yawVel = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private down: { x: number; y: number; t: number; moved: boolean } | null = null;
  private lastPinch = 0;
  private lastTap = { t: 0, x: 0, y: 0 };
  private tapTimer = 0;
  enabled = true;
  /** When set, yaw turns this object instead of moving the camera around it. */
  turntable: THREE.Object3D | null = null;
  onTap: (x: number, y: number) => void = () => {};
  onDoubleTap: (x: number, y: number) => void = () => {};
  onInteract: () => void = () => {};

  constructor(private camera: THREE.PerspectiveCamera, private el: HTMLElement, public limits: OrbitLimits) {
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
  }

  dispose() {
    this.el.removeEventListener('pointerdown', this.onDown);
    this.el.removeEventListener('pointermove', this.onMove);
    this.el.removeEventListener('pointerup', this.onUp);
    this.el.removeEventListener('pointercancel', this.onUp);
    this.el.removeEventListener('wheel', this.onWheel);
  }

  /** Smoothly move to a view. */
  flyTo(v: Partial<{ yaw: number; pitch: number; distance: number; targetY: number; targetX: number }>) {
    Object.assign(this.goal, v);
    if (v.yaw !== undefined) {
      // Take the short way round.
      const d = ((((v.yaw - this.yaw) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      this.goal.yaw = this.yaw + d;
    }
    this.clampGoal();
  }

  snap() {
    this.yaw = this.goal.yaw;
    this.pitch = this.goal.pitch;
    this.distance = this.goal.distance;
    this.targetY = this.goal.targetY;
    this.targetX = this.goal.targetX;
  }

  get zoomedIn() {
    return this.goal.distance < this.limits.maxDistance * 0.7;
  }

  private clampGoal() {
    const L = this.limits;
    this.goal.distance = THREE.MathUtils.clamp(this.goal.distance, L.minDistance, L.maxDistance);
    // When zoomed out, keep the whole body centred; when zoomed in, allow travelling along it.
    const zoomK = (this.goal.distance - L.minDistance) / (L.maxDistance - L.minDistance);
    const mid = (L.minY + L.maxY) / 2;
    const span = ((L.maxY - L.minY) / 2) * (1 - zoomK);
    this.goal.targetY = THREE.MathUtils.clamp(this.goal.targetY, mid - span, mid + span);
    this.goal.targetX = THREE.MathUtils.clamp(this.goal.targetX, -0.5 * (1 - zoomK), 0.5 * (1 - zoomK));
    this.goal.pitch = THREE.MathUtils.clamp(this.goal.pitch, -0.6, 0.7);
  }

  private onDown = (e: PointerEvent) => {
    if (!this.enabled) return;
    this.el.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) this.down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
    else if (this.down) this.down.moved = true;
    this.yawVel = 0;
    this.onInteract();
  };

  private onMove = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId);
    if (!p || !this.enabled) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (this.pointers.size === 1) {
      if (this.down && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 8) this.down.moved = true;
      if (this.down?.moved) {
        const k = 3.6 / Math.max(320, this.el.clientWidth);
        this.goal.yaw -= dx * k;
        this.yawVel = (-dx * k) / 0.016;
        const perPixel = (2 * this.distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / this.el.clientHeight;
        this.goal.targetY += dy * perPixel;
        this.goal.pitch += dy * 0.0006;
      }
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.entries()].map(([id, q]) => (id === e.pointerId ? { x: e.clientX, y: e.clientY } : q));
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.lastPinch) this.goal.distance *= this.lastPinch / dist;
      this.lastPinch = dist;
    }
    p.x = e.clientX;
    p.y = e.clientY;
    this.clampGoal();
  };

  private onUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.lastPinch = 0;
    if (this.pointers.size === 0 && this.down && !this.down.moved && performance.now() - this.down.t < 350) {
      const now = performance.now();
      const { x, y } = this.down;
      if (now - this.lastTap.t < 320 && Math.hypot(x - this.lastTap.x, y - this.lastTap.y) < 40) {
        clearTimeout(this.tapTimer);
        this.lastTap.t = 0;
        this.onDoubleTap(x, y);
      } else {
        this.lastTap = { t: now, x, y };
        // Wait to see whether a second tap follows before treating this as a selection.
        clearTimeout(this.tapTimer);
        this.tapTimer = window.setTimeout(() => this.onTap(x, y), 230);
      }
    }
    if (this.pointers.size === 0) this.down = null;
  };

  private onWheel = (e: WheelEvent) => {
    if (!this.enabled) return;
    e.preventDefault();
    this.goal.distance *= Math.exp(e.deltaY * 0.0012);
    this.clampGoal();
    this.onInteract();
  };

  update(dt: number) {
    if (this.pointers.size === 0 && Math.abs(this.yawVel) > 0.01) {
      this.goal.yaw += this.yawVel * dt;
      this.yawVel *= Math.exp(-dt * 4);
    }
    const k = 1 - Math.exp(-dt * 7);
    this.yaw += (this.goal.yaw - this.yaw) * k;
    this.pitch += (this.goal.pitch - this.pitch) * k;
    this.distance += (this.goal.distance - this.distance) * k;
    this.targetY += (this.goal.targetY - this.targetY) * k;
    this.targetX += (this.goal.targetX - this.targetX) * k;
    // The body turns on a turntable while the camera and studio lights stay put,
    // so whichever side faces the client is always properly lit.
    const yaw = this.turntable ? 0 : this.yaw;
    if (this.turntable) this.turntable.rotation.y = -this.yaw;
    const c = Math.cos(this.pitch);
    this.camera.position.set(
      this.targetX + Math.sin(yaw) * c * this.distance,
      this.targetY + Math.sin(this.pitch) * this.distance,
      Math.cos(yaw) * c * this.distance,
    );
    this.camera.lookAt(this.targetX, this.targetY, 0);
  }
}
