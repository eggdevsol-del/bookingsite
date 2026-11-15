// "Your idea": the client's body (with marked areas) on the left, their file on
// the right, and the idea box in the bottom third. At least 10 characters.
import { BaseScreen } from './base';
import { Staging } from './staged';
import { Character } from '../character/character';
import { h } from '../ui/dom';
import { REGIONS, REGION_INDEX, THEME_INDEX, LIMITS } from '../../shared/catalog.mjs';
import { ageOf, type App } from '../app/context';

export class IdeaScreen extends BaseScreen {
  readonly id = 'idea' as const;
  private staging: Staging;
  private character: Character | null = null;
  private btn: HTMLButtonElement | null = null;
  private counter: HTMLElement | null = null;

  constructor(app: App) {
    super(app, 32);
    this.staging = new Staging(this.scene, this.camera, app.stage.renderer, app.stage.quality.shadows);
    this.staging.backdrop.u.dim.value = 0.45;
    this.staging.backdrop.u.desat.value = 0.25;
    this.staging.backdrop.u.lod.value = 2.5;
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
    this.app.store.set({ step: 'idea' });
  }

  protected render() {
    const c = this.app.store.consult!;
    const theme = THEME_INDEX.get(c.theme ?? '');
    const age = ageOf(c.profile.dob);
    const row = (k: string, v: string) => h('div', null, h('dt', null, k), h('dd', null, v));
    const textarea = h('textarea', {
      class: 'live',
      rows: 4,
      maxlength: LIMITS.ideaMax,
      placeholder: 'What should it show? The story or meaning behind it, size, black & grey or colour, anything that matters…',
      value: c.idea ?? '',
      oninput: () => this.onInput(textarea.value),
      onfocus: () => setTimeout(() => this.layout(), 350),
      onblur: () => setTimeout(() => this.layout(), 350),
    });
    this.counter = h('div', { class: 'counter' });
    this.btn = h('button', { class: 'btn btn--block live', onclick: () => void this.next() }, 'Continue');
    const root = h(
      'section',
      { class: 'idea-screen' },
      h('div', null, h('span', { class: 'kicker' }, 'The pitch'), h('h2', { class: 'title', style: { fontSize: 'clamp(32px,8.5vw,56px)' } }, 'Tell me the', h('br'), h('span', { class: 'title--grad' }, 'story'))),
      h(
        'div',
        { class: 'idea-grid' },
        h('div', { class: 'idea-figure', 'aria-hidden': 'true' }),
        h(
          'div',
          { class: 'idea-details panel live' },
          h(
            'dl',
            { class: 'dl' },
            row('Client', c.profile.fullName),
            row('Contact', `${c.profile.email}\n${c.profile.phone}`),
            row('Born', `${c.profile.dob}${age !== null ? ` · ${age}` : ''}`),
            row('Theme', theme?.label ?? '—'),
            row('Placement', c.regions.map((r) => REGIONS[REGION_INDEX.get(r)!]?.label).join(', ') || '—'),
          ),
        ),
      ),
      h('label', { class: 'idea-box panel field' }, h('span', null, 'Describe your idea'), textarea, this.counter, this.btn),
    );
    this.onInput(c.idea ?? '', false);
    return root;
  }

  private onInput(value: string, save = true) {
    const n = value.trim().length;
    if (this.counter) {
      this.counter.textContent = n >= LIMITS.ideaMin ? `${n} characters` : `${n} / ${LIMITS.ideaMin} characters minimum`;
      this.counter.classList.toggle('ok', n >= LIMITS.ideaMin);
    }
    if (this.btn) this.btn.disabled = n < LIMITS.ideaMin;
    if (save) this.app.store.set({ idea: value });
  }

  /** Frame the body into the empty left cell of the grid, wherever the layout put it. */
  private layout() {
    const fig = this.dom?.querySelector('.idea-figure') as HTMLElement | null;
    if (!fig) return;
    const r = fig.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return;
    this.staging.frame({ left: r.left / innerWidth, right: r.right / innerWidth, top: r.top / innerHeight, bottom: r.bottom / innerHeight });
  }

  private async next() {
    const idea = (this.dom?.querySelector('textarea') as HTMLTextAreaElement | null)?.value ?? '';
    if (idea.trim().length < LIMITS.ideaMin) return;
    (document.activeElement as HTMLElement | null)?.blur();
    this.app.sfx.tick();
    this.app.store.set({ idea });
    void this.app.store.flush().catch(() => {});
    await this.app.director.show(this.app.screen('desk'), { kind: 'ink', origin: [0.5, 0.2] });
  }

  update(dt: number, t: number) {
    const c = this.character;
    if (c && c.root.parent === this.scene) {
      c.root.rotation.y = Math.sin(t * 0.35) * 0.6;
      c.update(dt);
    }
    this.staging.update(dt);
    const { look } = this.app;
    this.staging.backdrop.u.offset.value.set(look.value.x, look.value.y);
  }

  protected onResize() {
    requestAnimationFrame(() => this.layout());
    setTimeout(() => this.layout(), 1300);
  }
}
