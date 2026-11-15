// The cinema set's projector. The set's photo already shows the screen lit white between its red
// curtains; a mask (scripts/cinema-mask.mjs) marks the strip of screen you can see, laid over the
// full film rectangle behind the curtains. The 3D view uses it to flicker that strip like a
// projector lamp striking up while the live film (src/engine/film.ts) loads, and to dim it under
// the film once it plays; the page uses the same mask to cut the film to the curtains.
import * as THREE from 'three/webgpu';
import { Fn, texture, uniform, vec2, float, mix, step } from 'three/tsl';
import { loadTexture, media } from './assets';

export interface ScreenSpec {
  /** The film rectangle in image fractions (top = 0); mostly hidden behind the curtains. */
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** The screen's value in the set's depth map, for gyro parallax. */
  depth?: number;
  /** Mask of the visible strip, covering exactly the film rectangle (in /media). */
  mask: string;
}

const BLACK = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
BLACK.needsUpdate = true;

export const projector = {
  /** Brightness of the visible screen relative to the photo (1 = as photographed). */
  lamp: uniform(1),
  /** The whole room's brightness, which follows the projector a little. */
  glow: uniform(1),
  rect: uniform(new THREE.Vector4(0, 1, 0, 1)),
  mask: texture(BLACK),
  /** The live film (a VideoTexture once it plays), projected onto the visible strip. */
  film: texture(BLACK),
  /** How much of the film is on the screen (0..1): fades it in, and out during a swipe. */
  show: uniform(0),
  /** Cover-fits the film into the screen rectangle: scale xy, offset zw. */
  fit: uniform(new THREE.Vector4(1, 1, 0, 0)),
  /** Seconds, for the projector's flicker and gate weave. */
  time: uniform(0),
  /** URL of the loaded mask, for the page-side film. */
  maskUrl: '',
  /** Loads a set's screen mask once (only one set has a screen). */
  async load(spec: ScreenSpec) {
    const url = media(spec.mask);
    if (this.maskUrl === url) return;
    const tex = await loadTexture(url, { color: false });
    this.mask.value = tex;
    this.rect.value.set(spec.left, spec.right, spec.top, spec.bottom);
    this.maskUrl = url;
  },
  /** Back to the photo as shot. */
  reset() {
    this.lamp.value = 1;
    this.glow.value = 1;
    this.show.value = 0;
  },
  /** Fits a film of this width/height into the screen rectangle (the mask has the rectangle's shape). */
  fitFilm(w: number, h: number) {
    const img = this.mask.value.image as { width: number; height: number } | undefined;
    const screen = img ? img.width / img.height : 16 / 9;
    const film = w / h;
    // Cover: the film fills the screen, its overflow cropped evenly.
    const sx = film > screen ? screen / film : 1;
    const sy = film > screen ? 1 : film / screen;
    this.fit.value.set(sx, sy, (1 - sx) / 2, (1 - sy) / 2);
  },
};


/**
 * Applies the projector to a set's colour. imgUV: image coordinates with the top at 0.
 * on: 1 for the cinema set, 0 for every other set. The visible strip of screen follows the lamp
 * and the room follows the glow.
 */
export const withProjector = Fn(([col, imgUV, on]: any[]) => {
  const r = projector.rect;
  const s = vec2(imgUV.x.sub(r.x).div(r.y.sub(r.x)), imgUV.y.sub(r.z).div(r.w.sub(r.z)));
  const inside = step(0, s.x).mul(step(s.x, 1)).mul(step(0, s.y)).mul(step(s.y, 1));
  const m = projector.mask.sample(vec2(s.x, float(1).sub(s.y))).r.mul(inside).mul(on);
  const room = mix(float(1), projector.glow, on);
  const lit = mix(col.mul(room), col.mul(projector.lamp), m);

  return lit;
});
