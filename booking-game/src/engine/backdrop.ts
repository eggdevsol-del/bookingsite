// A photographic backdrop with real depth: each pixel shifts by its own depth
// as the phone tilts or the camera drifts (2.5D parallax), so a still photo
// moves like a filmed set. Lives on the camera, always fills the view.
import * as THREE from 'three/webgpu';
import { Fn, uniform, uv, vec2, vec3, vec4, float, texture, mix, luminance, clamp, select } from 'three/tsl';
import { withProjector } from './cinema';

/** Screen point (top-left origin) → image coordinates through a cover fit, zoom and pan. */
export function coverUV(st: any, viewAspect: any, imageAspect: any, zoom: any, pan: any = vec2(0, 0)) {
  const b = vec2(st.x, float(1).sub(st.y));
  const ratio = viewAspect.div(imageAspect);
  const fitted = select(ratio.greaterThan(1), vec2(b.x, b.y.sub(0.5).div(ratio).add(0.5)), vec2(b.x.sub(0.5).mul(ratio).add(0.5), b.y));
  return fitted.sub(0.5).div(zoom).add(0.5).add(pan);
}

export interface BackdropOptions {
  /** Parallax strength as a fraction of the frame. */
  strength?: number;
  /** Depth that stays still (0 far … 1 near). */
  focus?: number;
  distance?: number;
}

const BLANK = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
BLANK.needsUpdate = true;

export class Backdrop {
  readonly mesh: THREE.Mesh;
  readonly u = {
    offset: uniform(new THREE.Vector2()),
    strength: uniform(0.04),
    focus: uniform(0.35),
    zoom: uniform(1.08),
    pan: uniform(new THREE.Vector2(0, 0)),
    imageAspect: uniform(9 / 16),
    viewAspect: uniform(1),
    dim: uniform(0),
    desat: uniform(0),
    hasDepth: uniform(0),
    opacity: uniform(1),
    lod: uniform(0),
    /** 1 when this set has the cinema screen (see cinema.ts). */
    projector: uniform(0),
  };
  private colorNode = texture(BLANK);
  private depthNode = texture(BLANK);
  private distance: number;

  constructor(opts: BackdropOptions = {}) {
    this.u.strength.value = opts.strength ?? 0.04;
    this.u.focus.value = opts.focus ?? 0.35;
    this.distance = opts.distance ?? 50;
    const { u, colorNode, depthNode } = this;

    const material = new THREE.MeshBasicNodeMaterial({ depthWrite: false, depthTest: false, transparent: false });
    material.colorNode = Fn(() => {
      // Cover-fit the image into the view, then zoom and pan (for slow push-ins).
      const ratio = u.viewAspect.div(u.imageAspect);
      const base = uv().toVar();
      const fitted = select(
        ratio.greaterThan(1),
        vec2(base.x, base.y.sub(0.5).div(ratio).add(0.5)),
        vec2(base.x.sub(0.5).mul(ratio).add(0.5), base.y),
      );
      const zoomed = fitted.sub(0.5).div(u.zoom).add(0.5).add(u.pan);
      // Two fixed-point steps of parallax mapping: cheap, and steadier than one at edges.
      const shift = u.offset.mul(u.strength).mul(u.hasDepth);
      const d0 = depthNode.sample(zoomed).r;
      const p1 = zoomed.add(shift.mul(d0.sub(u.focus)));
      const d1 = depthNode.sample(p1).r;
      const p2 = zoomed.add(shift.mul(d1.sub(u.focus)));
      // lod > 0 reads a smaller mip level: a cheap, smooth background blur.
      const raw = colorNode.sample(clamp(p2, 0.001, 0.999)).level(u.lod).rgb;
      const col = withProjector(raw, vec2(p2.x, float(1).sub(p2.y)), u.projector);
      const grey = vec3(luminance(col));
      const graded = mix(col, grey, u.desat).mul(float(1).sub(u.dim));
      return vec4(graded, 1);
    })();
    material.opacityNode = u.opacity;

    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    this.mesh.renderOrder = -10;
    this.mesh.frustumCulled = false;
  }

  /** Linear brightness of the backdrop at a screen point, for lighting dust. */
  lightAt(st: any) {
    const { u } = this;
    return luminance(this.colorNode.sample(clamp(coverUV(st, u.viewAspect, u.imageAspect, u.zoom, u.pan), 0.001, 0.999)).rgb);
  }

  setImage(color: THREE.Texture, depth: THREE.Texture | null) {
    this.colorNode.value = color;
    this.depthNode.value = depth ?? BLANK;
    this.u.hasDepth.value = depth ? 1 : 0;
    const img = color.image as { width?: number; height?: number; videoWidth?: number; videoHeight?: number };
    const w = img.videoWidth || img.width || 9;
    const h = img.videoHeight || img.height || 16;
    this.u.imageAspect.value = w / h;
  }

  /** Parents the plane to the camera and sizes it to exactly fill the view. */
  attach(camera: THREE.PerspectiveCamera) {
    camera.add(this.mesh);
    this.fit(camera);
  }

  fit(camera: THREE.PerspectiveCamera) {
    const h = 2 * this.distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    this.mesh.position.set(0, 0, -this.distance);
    this.mesh.scale.set(h * camera.aspect, h, 1);
    this.u.viewAspect.value = camera.aspect;
  }
}

/** A camera parented into its scene, so camera children (the backdrop) render. */
export function sceneCamera(scene: THREE.Scene, fov = 40) {
  const camera = new THREE.PerspectiveCamera(fov, 1, 0.05, 200);
  scene.add(camera);
  return camera;
}
