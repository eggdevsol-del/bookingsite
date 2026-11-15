// The final cut: the client's body standing inside their chosen world, with
// the whole consult on a card. Continue goes to the budget ATM; Save for later
// keeps the draft for their next login. A sent consult shows here read-only.
import * as THREE from 'three/webgpu';
import { BaseScreen } from './base';
import { Staging } from './staged';
import { buildStudio } from './studio';
import { Character } from '../character/character';
import { h, toast, formatMoney } from '../ui/dom';
import { api } from '../app/api';
import { REGIONS, REGION_INDEX, THEME_INDEX } from '../../shared/catalog.mjs';
import { ageOf, firstName, type App } from '../app/context';

export class SummaryScreen extends BaseScreen {
  readonly id = 'summary' as const;
  private staging: Staging;
  private character: Character | null = null;
  private snapScene = new THREE.Scene();
  private snapCamera = new THREE.PerspectiveCamera(28, 768 / 1024, 0.1, 50);
  /** Resolves once the front and back pictures for the email are uploaded. */
  snapshots: Promise<void> = Promise.resolve();

  constructor(app: App) {
    super(app, 34);
    this.staging = new Staging(this.scene, this.camera, app.stage.renderer, app.stage.quality.shadows);
    this.staging.animated = true;
    buildStudio(this.snapScene, app.stage.renderer, true);
  }

  protected async load() {
    const c = this.app.store.consult;
    this.resetLoad();
    const [character] = await Promise.all([Character.load(c?.gender ?? 'female'), this.staging.setTheme(c?.theme ?? null)]);
    this.character = character;
  }

  protected onEnter() {
    const c = this.character;
    if (c) {
      this.staging.attach(c);
      c.setSelected(this.app.store.consult?.regions ?? []);
    }
    this.layout();
    this.staging.resume();
    if (this.app.store.editable) {
      this.app.store.set({ step: 'summary' });
      this.snapshots = this.captureSnapshots();
    }
  }

  protected onExit() {
    this.staging.pause();
  }

  /** Renders the body front and back in a clean studio for the email and the artist page. */
  private async captureSnapshots() {
    const c = this.character;
    if (!c) return;
    const H = c.meta.height;
    // Frame head to toe with a small margin, so the marked areas read clearly in the email.
    const dist = (H * 1.1) / (2 * Math.tan(THREE.MathUtils.degToRad(this.snapCamera.fov / 2)));
    this.snapCamera.position.set(0, H * 0.5, dist);
    this.snapCamera.lookAt(0, H * 0.5, 0);
    const back = this.scene;
    const shots: [string, Promise<Blob>][] = [];
    try {
      this.snapScene.add(c.root);
      for (const [view, yaw] of [['front', 0], ['back', Math.PI]] as const) {
        c.root.rotation.set(0, yaw, 0);
        c.root.updateMatrixWorld(true);
        shots.push([view, this.app.stage.snapshot(this.snapScene, this.snapCamera, 768, 1024)]);
      }
    } finally {
      back.add(c.root);
      c.root.rotation.set(0, 0, 0);
    }
    for (const [view, p] of shots) {
      try {
        await api.snapshot(view as 'front' | 'back', await p);
      } catch {
        /* the consult still works without pictures */
      }
    }
  }

  protected render() {
    const c = this.app.store.consult!;
    const theme = THEME_INDEX.get(c.theme ?? '');
    const age = ageOf(c.profile.dob);
    const sent = c.status === 'submitted';
    const row = (k: string, v: Node | string) => h('div', null, h('dt', null, k), h('dd', null, v));
    const card = h(
      'div',
      { class: 'summary-card panel live' },
      sent ? h('p', { class: 'status-banner' }, `Sent ${new Date(c.submittedAt!).toLocaleString('en-NZ', { dateStyle: 'medium', timeStyle: 'short' })} · ref ${c.ref}`) : null,
      h('h2', null, c.profile.fullName),
      h(
        'dl',
        { class: 'dl' },
        row('Contact', `${c.profile.email} · ${c.profile.phone}`),
        row('Born', `${c.profile.dob}${age !== null ? ` (${age})` : ''}`),
        row('Body', c.gender === 'male' ? 'Male' : 'Female'),
        row('Theme', theme?.label ?? '—'),
        row('Placement', h('div', { class: 'regions' }, ...c.regions.map((r) => h('span', null, REGIONS[REGION_INDEX.get(r)!]?.label ?? r)))),
        row('Idea', h('p', { class: 'idea-text', style: { margin: 0 } }, c.idea)),
        row(
          `References (${c.uploads.length})`,
          c.uploads.length
            ? h('div', { class: 'thumbs' }, ...c.uploads.slice(0, 12).map((u) => (u.hasThumb ? h('img', { src: `/api/files/${u.id}-thumb`, alt: u.name, loading: 'lazy' }) : h('span', null, u.name))))
            : 'None',
        ),
        c.budget ? row('Budget', formatMoney(c.budget.amount, c.budget.currency)) : null,
      ),
    );
    const buttons = sent
      ? h(
          'div',
          { class: 'btn-row' },
          h('button', { class: 'btn btn--ghost live', onclick: () => void this.toTitle() }, 'Title screen'),
          h('button', { class: 'btn btn--ghost live', onclick: () => void this.logout() }, 'Log out'),
        )
      : h(
          'div',
          { class: 'btn-row' },
          h('button', { class: 'btn btn--ghost live', onclick: () => void this.saveForLater() }, 'Save for later'),
          h('button', { class: 'btn live', onclick: () => void this.next() }, 'Continue'),
        );
    return h(
      'section',
      { class: 'summary-screen' },
      h('div', { class: 'summary-head', style: { position: 'absolute', top: 'var(--top)', left: 'var(--pad)' } }, h('span', { class: 'kicker' }, sent ? 'Your consult' : 'Final cut'), h('h2', { class: 'title', style: { fontSize: 'clamp(30px,8vw,52px)' } }, firstName(c.profile.fullName), h('br'), h('span', { class: 'title--grad' }, theme?.label ?? ''))),
      h('div', { style: { flex: '1' } }),
      card,
      buttons,
    );
  }

  /** Stand the body in the open space between the heading and the card. */
  private layout() {
    const head = this.dom?.querySelector('.summary-head')?.getBoundingClientRect();
    const card = this.dom?.querySelector('.summary-card')?.getBoundingClientRect();
    if (!head || !card) return;
    if (innerWidth > innerHeight) {
      this.staging.frame({ left: 0.04, right: 0.46, top: 0.06, bottom: 0.97 });
      return;
    }
    const top = Math.min(0.3, head.bottom / innerHeight - 0.02);
    const bottom = Math.max(top + 0.22, card.top / innerHeight + 0.02);
    this.staging.frame({ left: 0.2, right: 0.8, top, bottom });
  }

  private async saveForLater() {
    this.app.sfx.tick();
    try {
      await this.app.store.flush();
      toast('Saved. Open it any time from the title screen with your email and password.');
      await this.app.director.show(this.app.screen('title'), { kind: 'push' });
    } catch {
      /* the store already showed why */
    }
  }

  private async next() {
    this.app.sfx.tick();
    await this.app.director.show(this.app.screen('atm'), {
      kind: 'ink',
      freeze: { name: 'One more thing', tape: 'The budget', lines: ['Every job has a number.'], hold: 1.4 },
    });
  }

  private async toTitle() {
    await this.app.director.show(this.app.screen('title'), { kind: 'push' });
  }

  private async logout() {
    await api.logout().catch(() => {});
    this.app.store.adopt(null);
    await this.toTitle();
  }

  update(dt: number, t: number) {
    const c = this.character;
    if (c && c.root.parent === this.scene) {
      c.root.rotation.y = Math.sin(t * 0.3) * 0.45;
      c.update(dt);
    }
    this.staging.update(dt);
    const { look } = this.app;
    this.staging.backdrop.u.offset.value.set(look.value.x, look.value.y);
    this.staging.backdrop.u.zoom.value = 1.05 + Math.sin(t * 0.06) * 0.01;
  }

  protected onResize() {
    // After the entry animation settles, so the measured boxes are final.
    requestAnimationFrame(() => this.layout());
    setTimeout(() => this.layout(), 1300);
  }
}
