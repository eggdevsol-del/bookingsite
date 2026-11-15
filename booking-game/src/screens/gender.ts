// Character select: two real people idling on a filmed loop. Picking one
// pushes the camera into them, then hands over to the live 3D body.
import { BaseScreen } from './base';
import { Backdrop } from '../engine/backdrop';
import { loadTexture, loadVideo, media, playVideo } from '../engine/assets';
import { h, tween, easeInOut } from '../ui/dom';
import { Character } from '../character/character';
import { originOf, type App } from '../app/context';

export class GenderScreen extends BaseScreen {
  readonly id = 'gender' as const;
  private backdrop = new Backdrop({ strength: 0.02, focus: 0.55 });
  private video: HTMLVideoElement | null = null;
  private picking = false;
  private push = { zoom: 1.04, panX: 0, panY: 0 };

  constructor(app: App) {
    super(app, 40);
    this.backdrop.attach(this.camera);
  }

  protected async load() {
    const [still, depth] = await Promise.all([loadTexture(media('gender.webp')), loadTexture(media('gender-depth.webp'), { color: false })]);
    this.backdrop.setImage(still, depth);
    try {
      const { video, texture } = await loadVideo(media('gender-loop.mp4'));
      this.video = video;
      this.backdrop.setImage(texture, depth);
    } catch {
      /* the still image stays */
    }
  }

  protected onEnter() {
    this.picking = false;
    this.push = { zoom: 1.04, panX: 0, panY: 0 };
    if (this.video) {
      this.video.currentTime = 0;
      playVideo(this.video);
    }
    this.app.store.set({ step: 'gender' });
    // Warm both bodies up in the background so the next screen is instant.
    void Character.load('male').catch(() => {});
    void Character.load('female').catch(() => {});
  }

  protected onExit() {
    this.video?.pause();
  }

  protected render() {
    const pick = (gender: 'male' | 'female') => (e: PointerEvent) => void this.pick(gender, e);
    return h(
      'section',
      { class: 'gender-screen' },
      h('div', null, h('span', { class: 'kicker' }, 'Character select'), h('h2', { class: 'title' }, 'Choose your', h('br'), h('span', { class: 'title--grad' }, 'body'))),
      h(
        'div',
        { class: 'gender-picks' },
        h('button', { class: 'gender-pick live', onclick: pick('male'), 'aria-label': 'Male body' }, h('small', null, 'Player one'), h('span', null, 'Male')),
        h('button', { class: 'gender-pick live', onclick: pick('female'), 'aria-label': 'Female body' }, h('small', null, 'Player one'), h('span', null, 'Female')),
      ),
    );
  }

  private async pick(gender: 'male' | 'female', e: PointerEvent) {
    if (this.picking || this.app.director.busy) return;
    this.picking = true;
    this.app.sfx.tick();
    this.app.store.set({ gender });
    const body = this.app.screen('body');
    void body.preload();
    // Dolly in on the chosen person before cutting to the 3D body.
    const side = gender === 'male' ? -1 : 1;
    this.dom?.classList.add('is-leaving');
    await tween(0.75, (k) => {
      this.push.zoom = 1.04 + k * 0.9;
      this.push.panX = side * 0.17 * k;
      this.push.panY = 0.04 * k;
    }, easeInOut);
    await this.app.director.show(body, { kind: 'push', origin: originOf(e) });
  }

  update(_dt: number, t: number) {
    const { look } = this.app;
    this.backdrop.u.offset.value.set(look.value.x * 0.6, look.value.y * 0.6);
    this.backdrop.u.zoom.value = this.push.zoom + Math.sin(t * 0.1) * 0.006;
    this.backdrop.u.pan.value.set(this.push.panX, this.push.panY);
  }

  protected onResize() {
    this.backdrop.fit(this.camera);
  }
}
