// A small vintage desk fan built from primitives: weighted base, stem,
// motor housing, wire cage and spinning blades, with a slow oscillating head.
import * as THREE from 'three/webgpu';
import { Fn, uv, length, smoothstep, float, sin, atan, time, mix, color, vec2 } from 'three/tsl';

const TILT = -0.34; // radians the head points down

export class DeskFan {
  readonly root = new THREE.Group();
  readonly head = new THREE.Group();
  private blades = new THREE.Group();
  /** Current blowing direction in world space. */
  readonly direction = new THREE.Vector3();
  readonly outlet = new THREE.Vector3();
  private phase = 0;

  constructor() {
    const enamel = new THREE.MeshPhysicalNodeMaterial({ color: '#1f2a2a', roughness: 0.32, metalness: 0.2, clearcoat: 0.8, clearcoatRoughness: 0.2 });
    const chrome = new THREE.MeshStandardNodeMaterial({ color: '#d8d4cc', roughness: 0.18, metalness: 1 });
    const brass = new THREE.MeshStandardNodeMaterial({ color: '#c9a161', roughness: 0.3, metalness: 1 });

    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.078, 0.018, 48), enamel);
    base.position.y = 0.009;
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.012, 24), brass);
    collar.position.y = 0.024;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.16, 16), chrome);
    stem.position.y = 0.1;
    this.root.add(base, collar, stem);

    this.head.position.y = 0.19;
    this.root.add(this.head);
    const tiltGroup = new THREE.Group();
    tiltGroup.rotation.x = TILT; // aimed down at the sheets on the desk
    this.head.add(tiltGroup);

    const motor = new THREE.Mesh(new THREE.SphereGeometry(0.042, 32, 24), enamel);
    motor.scale.set(1, 1, 1.35);
    motor.position.z = -0.03;
    const badge = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.004, 24), brass);
    badge.rotation.x = Math.PI / 2;
    badge.position.z = 0.018;
    tiltGroup.add(motor, badge);

    // Wire cage: front and back rings plus curved spokes.
    const R = 0.105;
    const ringGeo = new THREE.TorusGeometry(R, 0.0018, 8, 96);
    for (const z of [0.012, 0.05]) {
      const ring = new THREE.Mesh(ringGeo, chrome);
      ring.position.z = z;
      tiltGroup.add(ring);
    }
    const spokeCount = 18;
    for (let i = 0; i < spokeCount; i++) {
      const a = (i / spokeCount) * Math.PI * 2;
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(Math.cos(a) * R, Math.sin(a) * R, 0.05),
        new THREE.Vector3(Math.cos(a) * R * 0.6, Math.sin(a) * R * 0.6, 0.074),
        new THREE.Vector3(Math.cos(a) * 0.012, Math.sin(a) * 0.012, 0.082),
      ]);
      tiltGroup.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 10, 0.0011, 5), chrome));
      const back = new THREE.CatmullRomCurve3([
        new THREE.Vector3(Math.cos(a) * R, Math.sin(a) * R, 0.012),
        new THREE.Vector3(Math.cos(a) * R * 0.55, Math.sin(a) * R * 0.55, -0.004),
        new THREE.Vector3(Math.cos(a) * 0.03, Math.sin(a) * 0.03, -0.01),
      ]);
      tiltGroup.add(new THREE.Mesh(new THREE.TubeGeometry(back, 8, 0.0011, 5), chrome));
    }
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.012, 16, 12), brass);
    cap.position.z = 0.082;
    tiltGroup.add(cap);

    // Blades, plus a translucent blur disc that sells the speed.
    const blade = new THREE.Shape();
    blade.moveTo(0, 0);
    blade.bezierCurveTo(0.03, 0.01, 0.09, 0.03, 0.092, 0.0);
    blade.bezierCurveTo(0.09, -0.035, 0.04, -0.03, 0, 0);
    const bladeGeo = new THREE.ShapeGeometry(blade, 12);
    const bladeMat = new THREE.MeshStandardNodeMaterial({ color: '#b9a27a', roughness: 0.35, metalness: 0.8, side: THREE.DoubleSide, transparent: true, opacity: 0.45 });
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Mesh(bladeGeo, bladeMat);
      b.rotation.z = (i / 4) * Math.PI * 2;
      b.rotation.y = 0.35;
      this.blades.add(b);
    }
    this.blades.position.z = 0.03;
    tiltGroup.add(this.blades);
    const blurMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    blurMat.colorNode = color('#d8c6a0');
    blurMat.opacityNode = Fn(() => {
      const p = uv().sub(0.5);
      const r = length(p).mul(2);
      const streak = sin(atan(p.y, p.x).mul(4).add(time.mul(9))).mul(0.5).add(0.5);
      return smoothstep(1, 0.85, r).mul(smoothstep(0.1, 0.25, r)).mul(mix(float(0.1), float(0.22), streak));
    })();
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.094, 48), blurMat);
    disc.position.z = 0.031;
    tiltGroup.add(disc);
    void vec2;

    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
    });
    disc.castShadow = false;
  }

  /** Where the head is in its swing, -1 (one end) to 1 (the other). */
  get swing() {
    return Math.sin(this.phase);
  }

  /** aimYaw: the head's centre direction; sweep: how far it swings either side (radians). */
  update(dt: number, aimYaw: number, sweep: number) {
    this.phase += dt * 0.32;
    this.head.rotation.y = aimYaw + Math.sin(this.phase) * sweep;
    this.blades.rotation.z -= dt * 38;
    this.head.updateWorldMatrix(true, false);
    this.direction.set(0, Math.sin(TILT), Math.cos(TILT)).applyQuaternion(this.head.getWorldQuaternion(new THREE.Quaternion())).normalize();
    this.head.getWorldPosition(this.outlet);
  }
}
