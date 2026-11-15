import './styles.css';
import { Stage, type Screen } from './engine/stage';
import { Sfx } from './engine/sfx';
import { AudioEngine } from './engine/audio';
import { soundToggle } from './ui/sound';
import { LookInput } from './engine/input';
import { Director } from './app/director';
import { Store } from './app/store';
import { h, ui } from './ui/dom';
import type { App, ScreenId } from './app/context';
import { TitleScreen } from './screens/title';
import { ProfileScreen } from './screens/profile';
import { GenderScreen } from './screens/gender';
import { BodyScreen } from './screens/body';
import { ThemeScreen } from './screens/theme';
import { IdeaScreen } from './screens/idea';
import { DeskScreen } from './screens/desk';
import { SummaryScreen } from './screens/summary';
import { AtmScreen } from './screens/atm';
import { Character } from './character/character';

const bootBar = document.querySelector('.boot__bar i') as HTMLElement;
const t0 = performance.now();
const progress = (k: number, step = '') => {
  bootBar.style.width = `${Math.round(k * 100)}%`;
  if (import.meta.env.DEV && step) console.info(`[boot] ${step} at ${Math.round(performance.now() - t0)} ms`);
};

async function main() {
  progress(0.1);
  const canvas = document.getElementById('stage') as HTMLCanvasElement;
  const stage = await Stage.create(canvas);
  Character.supersample = stage.quality.msaa > 0;
  progress(0.35, `renderer ready (${stage.backend})`);
  const audio = new AudioEngine();
  const sfx = new Sfx(audio);
  const look = new LookInput();
  const store = new Store();
  const director = new Director(stage, sfx);

  const screens = new Map<ScreenId, Screen>();
  const factories: Record<ScreenId, (app: App) => Screen> = {
    title: (a) => new TitleScreen(a),
    profile: (a) => new ProfileScreen(a, 'register'),
    login: (a) => new ProfileScreen(a, 'login'),
    gender: (a) => new GenderScreen(a),
    body: (a) => new BodyScreen(a),
    theme: (a) => new ThemeScreen(a),
    idea: (a) => new IdeaScreen(a),
    desk: (a) => new DeskScreen(a),
    summary: (a) => new SummaryScreen(a),
    atm: (a) => new AtmScreen(a),
  };

  const app: App = {
    stage,
    director,
    store,
    sfx,
    audio,
    look,
    screen(id) {
      let s = screens.get(id);
      if (!s) {
        s = factories[id](app);
        screens.set(id, s);
      }
      return s;
    },
    resume() {
      const c = store.consult;
      let id: ScreenId = 'title';
      if (c?.status === 'submitted') id = 'summary';
      else if (c) {
        const byStep: Record<string, ScreenId> = { gender: 'gender', body: 'body', theme: 'theme', idea: 'idea', desk: 'desk', summary: 'summary', atm: 'summary' };
        id = !c.gender ? 'gender' : !c.regions.length ? 'body' : (byStep[c.step] ?? 'gender');
      }
      void director.show(app.screen(id), { kind: 'ink' });
    },
  };

  // Start audio on the first touch, click or key anywhere (browsers only allow it from a gesture;
  // iOS counts touchend and click, not pointerdown, so listen for all of them until it runs).
  const unlock = () => {
    audio.unlock();
    if (audio.ctx?.state === 'running' || audio.muted) for (const e of GESTURES) removeEventListener(e, unlock, true);
  };
  const GESTURES = ['pointerdown', 'touchend', 'click', 'keydown'] as const;
  for (const e of GESTURES) addEventListener(e, unlock, true);
  // Try to start the music on the title straight away: browsers that allow sound before a tap (e.g. a
  // returning visitor on desktop) play it now; the rest (iPhone always) start it on the first touch.
  audio.unlock();
  ui().append(soundToggle(audio));

  await store.refresh().catch(() => store.adopt(null));
  progress(0.55, 'session checked');

  // Dev-only shortcut for art direction: /?screen=body&gender=male opens a screen directly with a
  // throwaway, unsaved consult (status "preview" is not editable, so nothing is sent to the server).
  const params = new URLSearchParams(location.search);
  const jump = import.meta.env.DEV ? (params.get('screen') as ScreenId | null) : null;
  if (jump) {
    store.adopt({
      id: 'preview', ref: 'IC-PREVIEW', status: 'preview' as never, createdAt: '', updatedAt: '', submittedAt: null,
      profile: { fullName: 'Preview Client', email: 'preview@example.com', phone: '021 000 0000', dob: '1995-01-01' },
      gender: params.get('gender') === 'female' ? 'female' : 'male',
      regions: (params.get('regions') ?? '').split(',').filter(Boolean),
      theme: params.get('theme') ?? 'japanese', idea: 'Preview idea text.', budget: null, step: jump,
      uploads: [], snapshots: { front: false, back: false }, email: null,
    });
    const s = app.screen(jump);
    await s.preload();
    progress(1, `jumped to ${jump}`);
    stage.start((dt, t) => look.update(dt, t));
    document.getElementById('boot')?.remove();
    await director.start(s);
    (window as any).__ink = app;
    return;
  }
  const title = app.screen('title');
  await title.preload();
  progress(1, 'title loaded');
  stage.start((dt, t) => look.update(dt, t));
  document.getElementById('boot')!.classList.add('gone');
  setTimeout(() => document.getElementById('boot')?.remove(), 900);
  await director.start(title);


  if (new URLSearchParams(location.search).has('hud')) {
    const hud = h('div', { class: 'hud' });
    ui().append(hud);
    setInterval(() => (hud.textContent = `${stage.backend} · ${stage.fps.value.toFixed(0)} fps`), 500);
  }
  (window as any).__ink = app; // handy in the console while testing
}

main().catch((err) => {
  console.error(err);
  const boot = document.getElementById('boot');
  boot?.append(h('p', { class: 'boot__error' }, 'This device couldn’t start the 3D view. Please try the latest Safari or Chrome.'));
});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
