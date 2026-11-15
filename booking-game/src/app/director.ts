// Runs the show: switches screens with a transition, and can stop the action
// on a Guy Ritchie freeze-frame with a slammed-in name card first.
import type { Stage, Screen, TransitionKind } from '../engine/stage';
import type { Sfx } from '../engine/sfx';
import { h, ui, tween, wait, easeInOut, easeOut } from '../ui/dom';

export interface FreezeCard {
  name: string;
  tape?: string;
  lines?: string[];
  hold?: number;
}

export interface ShowOptions {
  kind?: TransitionKind;
  duration?: number;
  /** Where the ink starts, in 0..1 screen coordinates (y up). */
  origin?: [number, number];
  freeze?: FreezeCard | null;
}

export class Director {
  busy = false;
  private loading: HTMLElement | null = null;

  constructor(private stage: Stage, private sfx: Sfx) {}

  get current() {
    return this.stage.active;
  }

  /** First screen: fades up from black. */
  async start(screen: Screen) {
    await screen.preload();
    screen.resize(this.stage.size.width, this.stage.size.height);
    screen.enter();
    this.stage.active = screen;
    await tween(1.4, (k) => (this.stage.u.fade.value = 1 - k), easeOut);
  }

  async show(next: Screen, opts: ShowOptions = {}) {
    if (this.busy || next === this.stage.active) return;
    this.busy = true;
    const prev = this.stage.active;
    try {
      prev?.leave?.();
      const kind = opts.kind ?? 'ink';
      const ready = next.preload();
      const slow = window.setTimeout(() => this.showLoading(true), 250);
      if (opts.freeze) await this.freeze(opts.freeze);
      await ready;
      clearTimeout(slow);
      this.showLoading(false);

      const { u } = this.stage;
      u.origin.value.set(...(opts.origin ?? [0.5, 0.5]));
      next.resize(this.stage.size.width, this.stage.size.height);
      this.stage.incoming = next;
      next.enter();
      document.querySelectorAll(`[data-screen="${prev?.id}"]`).forEach((el) => el.classList.add('is-leaving'));
      this.sfx.whoosh(kind === 'flash' ? 0.5 : 1.0);
      const duration = opts.duration ?? (kind === 'ink' ? 1.35 : kind === 'push' ? 0.95 : 0.6);
      this.stage.setTransition(kind, 0);
      await tween(duration, (k) => (u.progress.value = k), kind === 'ink' ? (k) => k * k * (3 - 2 * k) : easeInOut);
      this.stage.commitTransition();
      this.stage.frozen = false;
      u.freeze.value = 0;
      document.querySelector('.freeze')?.remove();
      prev?.exit();
    } finally {
      this.busy = false;
    }
  }

  /** Freeze the current frame, punch in, slam the card, hold, then let the transition carry on. */
  private async freeze(card: FreezeCard) {
    this.stage.frozen = true;
    this.sfx.slam();
    const current = this.stage.active?.id;
    if (current) document.querySelectorAll(`[data-screen="${current}"]`).forEach((el) => el.classList.add('is-leaving'));
    void tween(0.16, (k) => (this.stage.u.freeze.value = k), easeOut);
    const el = h(
      'div',
      { class: 'freeze', role: 'img', 'aria-label': [card.name, card.tape, ...(card.lines ?? [])].filter(Boolean).join('. ') },
      h('p', { class: 'freeze__name' }, card.name),
      card.tape ? h('div', { class: 'freeze__tape' }, card.tape) : null,
      card.lines?.length
        ? h('div', { class: 'freeze__lines' }, ...card.lines.map((l, i) => h('p', { style: { animationDelay: `${0.45 + i * 0.22}s` } }, l)))
        : null,
    );
    ui().append(el);
    // Tap to skip the hold.
    const skip = new Promise<void>((r) => el.addEventListener('pointerdown', () => r(), { once: true }));
    await Promise.race([wait((card.hold ?? 1.9) * 1000), skip]);
    el.classList.add('is-out');
  }

  private showLoading(on: boolean) {
    if (on && !this.loading) {
      this.loading = h('div', { class: 'busy', role: 'progressbar', 'aria-label': 'Loading' });
      ui().append(this.loading);
    } else if (!on && this.loading) {
      this.loading.remove();
      this.loading = null;
    }
  }
}
