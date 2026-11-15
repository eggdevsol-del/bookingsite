import * as THREE from 'three/webgpu';
import type { Screen } from '../engine/stage';
import type { App, ScreenId } from '../app/context';
import { sceneCamera } from '../engine/backdrop';
import { ui } from '../ui/dom';
import { soundFor } from '../content/soundscapes';
import type { Soundscape } from '../engine/audio';

export abstract class BaseScreen implements Screen {
  abstract readonly id: ScreenId;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  blur = 0;
  protected dom: HTMLElement | null = null;
  private loading: Promise<void> | null = null;

  constructor(protected app: App, fov = 40) {
    this.camera = sceneCamera(this.scene, fov);
  }

  preload(): Promise<void> {
    if (!this.loading) {
      this.loading = this.load();
      this.loading.catch(() => (this.loading = null));
    }
    return this.loading;
  }

  protected async load(): Promise<void> {}

  /** Forget the finished load so the next preload() runs load() again. */
  protected resetLoad() {
    this.loading = null;
  }

  enter() {
    this.dom = this.render();
    this.dom.dataset.screen = this.id;
    this.dom.classList.add('screen', 'is-entering');
    ui().append(this.dom);
    this.app.audio.scene(this.soundscape());
    this.onEnter();
  }

  /** What this screen sounds like (ambience, music, room); see src/content/soundscapes.ts. */
  protected soundscape(): Soundscape {
    return soundFor(this.id, this.app.store.consult?.theme);
  }

  leave() {
    this.onLeave();
  }

  exit() {
    this.dom?.remove();
    this.dom = null;
    this.onExit();
  }

  /** Re-renders the DOM in place (e.g. after login state changes). */
  protected rerender() {
    if (!this.dom) return;
    const next = this.render();
    next.dataset.screen = this.id;
    next.classList.add('screen');
    this.dom.replaceWith(next);
    this.dom = next;
  }

  protected abstract render(): HTMLElement;
  protected onEnter() {}
  protected onLeave() {}
  protected onExit() {}

  update(_dt: number, _t: number) {}

  resize(width: number, height: number) {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.onResize(width, height);
  }

  protected onResize(_w: number, _h: number) {}
}
