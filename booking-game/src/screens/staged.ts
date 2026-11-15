// Puts the client's 3D body inside their chosen theme set: the set as a depth
// backdrop, lights tinted to match it, and a contact shadow on the floor.
import * as THREE from 'three/webgpu';
import { uv, length, smoothstep, float, color } from 'three/tsl';
import { Backdrop } from '../engine/backdrop';
import { environment } from './studio';
import { themeTextures, themeVideo } from './theme';
import { playVideo } from '../engine/assets';
import { THEMES, THEME_INDEX } from '../../shared/catalog.mjs';
import type { Character } from '../character/character';

export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export class Staging {
  readonly backdrop = new Backdrop({ strength: 0.035, focus: 0.4 });
  private key = new THREE.DirectionalLight('#ffffff', 2);
  private rimA = new THREE.DirectionalLight('#ff4f8b', 2);
  private rimB = new THREE.DirectionalLight('#ffa041', 1.5);
  private hemi = new THREE.HemisphereLight('#ffffff', '#1a1012', 0.5);
  character: Character | null = null;
  themeId: string | null = null;
  /** Play the set's film behind the body (off for blurred backdrops: films have no mip levels). */
  animated = false;
  private video: HTMLVideoElement | null = null;
  private goal: { pos: THREE.Vector3; look: THREE.Vector3 } | null = null;
  private look = new THREE.Vector3();

  constructor(private scene: THREE.Scene, private camera: THREE.PerspectiveCamera, renderer: THREE.WebGPURenderer, shadows: boolean) {
    this.backdrop.attach(camera);
    scene.environment = environment(renderer);
    scene.environmentIntensity = 0.3;
    this.key.position.set(1.6, 3, 2.4);
    this.key.castShadow = shadows;
    this.key.shadow.mapSize.set(1024, 1024);
    Object.assign(this.key.shadow.camera, { left: -1.2, right: 1.2, top: 2.2, bottom: -0.2, near: 0.5, far: 8 });
    this.key.shadow.bias = -0.0005;
    this.key.shadow.radius = 6;
    this.rimA.position.set(-2, 2.4, -2.6);
    this.rimB.position.set(2.2, 1.8, -2.2);
    scene.add(this.key, this.rimA, this.rimB, this.hemi);

    const catcher = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.ShadowMaterial({ opacity: 0.45 }));
    catcher.rotation.x = -Math.PI / 2;
    catcher.receiveShadow = true;
    scene.add(catcher);
    const blobMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    blobMat.colorNode = color('#000000');
    blobMat.opacityNode = smoothstep(0.5, 0.0, length(uv().sub(0.5))).mul(float(0.55));
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.5), blobMat);
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.002;
    scene.add(blob);
  }

  async setTheme(themeId: string | null) {
    const theme = THEME_INDEX.get(themeId ?? '') ?? THEMES[THEMES.length - 1];
    this.themeId = theme.id;
    const { color: c, depth } = await themeTextures(theme);
    this.backdrop.setImage(c, depth);
    this.video?.pause();
    this.video = null;
    if (this.animated) {
      themeVideo(theme)
        .then(({ video, texture }) => {
          if (this.themeId !== theme.id) return;
          this.backdrop.setImage(texture, depth);
          this.video = video;
          playVideo(video);
        })
        .catch(() => {});
    }
    const L = theme.light;
    this.key.color.set(L.key);
    this.key.intensity = L.keyIntensity;
    this.rimA.color.set(L.rim);
    this.rimA.intensity = L.rimIntensity * 1.4;
    this.rimB.color.set(L.key);
    this.rimB.intensity = L.rimIntensity * 0.6;
    this.hemi.color.set(L.key);
  }

  attach(character: Character) {
    this.character = character;
    character.root.position.set(0, 0, 0);
    character.root.rotation.set(0, 0, 0);
    this.scene.add(character.root);
  }

  /** Places the camera so the body fills the given part of the screen (fractions, top = 0). */
  frame(box: Box) {
    const c = this.character;
    const H = c?.meta.height ?? 1.75;
    const Wc = 0.95;
    const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const bw = box.right - box.left;
    const bh = box.bottom - box.top;
    const d = Math.max((H * 1.08) / (bh * 2 * tan), (Wc * 1.02) / (bw * 2 * tan * this.camera.aspect));
    const Vh = 2 * d * tan;
    const Vw = Vh * this.camera.aspect;
    const cx = (box.left + box.right) / 2;
    const cy = (box.top + box.bottom) / 2;
    const lx = -(cx - 0.5) * Vw;
    const ly = H / 2 + (cy - 0.5) * Vh;
    const first = !this.goal;
    this.goal = { pos: new THREE.Vector3(lx, ly + 0.05, d), look: new THREE.Vector3(lx, ly, 0) };
    if (first) this.snap();
    this.backdrop.fit(this.camera);
  }

  pause() {
    this.video?.pause();
  }

  resume() {
    if (this.video) playVideo(this.video);
  }

  /** Jump straight to the framing (used before the screen is first seen). */
  snap() {
    if (!this.goal) return;
    this.camera.position.copy(this.goal.pos);
    this.look.copy(this.goal.look);
    this.camera.lookAt(this.look);
  }

  /** Glide toward the framing, so layout changes (keyboard, rotation) never jump. */
  update(dt: number) {
    if (!this.goal) return;
    const k = 1 - Math.exp(-dt * 6);
    this.camera.position.lerp(this.goal.pos, k);
    this.look.lerp(this.goal.look, k);
    this.camera.lookAt(this.look);
  }
}
