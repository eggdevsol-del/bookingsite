// Title screen: a living key-art shot (looping film of the studio at sunset),
// the wordmark, and a one-item game menu.
import * as THREE from 'three/webgpu';
import { BaseScreen } from './base';
import { Backdrop } from '../engine/backdrop';
import { loadTexture, loadVideo, media, playVideo } from '../engine/assets';
import { h, toast } from '../ui/dom';
import { api } from '../app/api';
import { BRAND } from '../../shared/brand.mjs';
import { r18Badge, openAgeLaws } from '../ui/r18';
import { originOf, type App } from '../app/context';

export class TitleScreen extends BaseScreen {
  readonly id = 'title' as const;
  private backdrop = new Backdrop({ strength: 0.03, focus: 0.3 });
  private video: HTMLVideoElement | null = null;
  private focus = 0;

  constructor(app: App) {
    super(app, 40);
    this.backdrop.attach(this.camera);

    addEventListener('keydown', this.onKey);
  }

  protected async load() {
    const [still, depth] = await Promise.all([loadTexture(media('title.webp')), loadTexture(media('title-depth.webp'), { color: false })]);
    this.backdrop.setImage(still, depth);
    // The film loop swaps in once it can play; the still covers the wait.
    loadVideo(media('title-loop.mp4'))
      .then(({ video, texture }) => {
        this.video = video;
        playVideo(video);
        this.backdrop.setImage(texture, depth);
      })
      .catch(() => {});
  }

  protected onEnter() {
    if (this.video) playVideo(this.video);
    this.focus = 0;
  }

  protected onExit() {
    this.video?.pause();
  }

  private items(): { label: string; run: (e?: PointerEvent) => void }[] {
    const c = this.app.store.consult;
    const start = (e?: PointerEvent) => this.begin(e);
    if (!c) return [{ label: 'Start Consult', run: start }];
    if (c.status === 'draft') return [{ label: 'Continue Consult', run: () => this.app.resume() }];
    return [
      { label: 'View My Consult', run: () => this.app.resume() },
      { label: 'New Consult', run: () => void this.newConsult() },
    ];
  }

  protected render() {
    const c = this.app.store.consult;
    const items = this.items();
    const menu = h(
      'nav',
      { class: 'menu', 'aria-label': 'Main menu' },
      ...items.map((it, i) =>
        h(
          'button',
          {
            class: `menu__item live${i === this.focus ? ' is-focus' : ''}`,
            onpointerenter: () => this.setFocus(i),
            onclick: (e: PointerEvent) => {
              this.app.sfx.unlock();
              this.app.sfx.tick();
              it.run(e);
            },
          },
          it.label,
        ),
      ),
    );
    return h(
      'section',
      { class: 'title-screen' },
      r18Badge(() => {
        this.app.sfx.unlock();
        this.app.sfx.tick();
        openAgeLaws();
      }),
      h('h1', { class: 'wordmark', style: { fontSize: `clamp(56px, ${Math.min(24, 150 / Math.max(3, BRAND.wordmark.length))}vw, 150px)` } }, BRAND.wordmark, h('small', null, BRAND.subtitle)),
      h('p', { class: 'byline' }, BRAND.byline),
      menu,
      c
        ? h('button', { class: 'link live', onclick: () => void this.logout() }, `Not ${c.profile.fullName.split(' ')[0]}? Log out`)
        : h(
            'button',
            {
              class: 'link live',
              onclick: (e: PointerEvent) => {
                this.app.sfx.unlock();
                void this.app.look.enableTilt();
                void this.app.director.show(this.app.screen('login'), { origin: originOf(e) });
              },
            },
            'Already sent a consult? Open it',
          ),
      h('p', { class: 'press', 'aria-hidden': 'true' }, matchMedia('(pointer: coarse)').matches ? 'Tap to begin' : 'Press enter'),
    );
  }

  private setFocus(i: number) {
    this.focus = i;
    this.dom?.querySelectorAll('.menu__item').forEach((el, k) => el.classList.toggle('is-focus', k === i));
  }

  private onKey = (e: KeyboardEvent) => {
    if (this.app.stage.active !== this || this.app.director.busy) return;
    const n = this.items().length;
    if (e.key === 'ArrowDown') this.setFocus((this.focus + 1) % n);
    else if (e.key === 'ArrowUp') this.setFocus((this.focus + n - 1) % n);
    else if (e.key === 'Enter') {
      this.app.sfx.unlock();
      this.items()[this.focus]?.run();
    }
  };

  private begin(e?: PointerEvent) {
    void this.app.look.enableTilt();
    void this.app.director.show(this.app.screen('profile'), { origin: e ? originOf(e) : [0.2, 0.2] });
  }

  private async newConsult() {
    try {
      const { consult } = await api.startAnother();
      this.app.store.adopt(consult);
      this.app.resume();
    } catch (err) {
      toast((err as Error).message, true);
    }
  }

  private async logout() {
    await api.logout().catch(() => {});
    this.app.store.adopt(null);
    this.focus = 0;
    this.rerender();
  }

  /** Called by main when login state changes while this screen is up. */
  refresh() {
    this.focus = 0;
    this.rerender();
  }

  update(dt: number, t: number) {
    const { look } = this.app;
    this.backdrop.u.offset.value.set(look.value.x, look.value.y);
    this.backdrop.u.zoom.value = 1.06 + Math.sin(t * 0.07) * 0.012;
    this.camera.rotation.set(look.value.y * 0.02, -look.value.x * 0.03, 0);
    void dt;
  }

  protected onResize() {
    this.backdrop.fit(this.camera);
  }
}
