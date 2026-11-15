// Budget, ATM style: a handheld point-of-view shot of a street ATM. The live
// screen is painted into the photo's glass, the real keypad keys take the
// input, and the receipt prints over the blurred machine.
import * as THREE from 'three/webgpu';
import { Fn, uniform, uv, vec2, vec3, vec4, float, texture, mix, smoothstep, select, clamp, step, sin, hash, luminance } from 'three/tsl';
import { BaseScreen } from './base';
import { loadTexture, media } from '../engine/assets';
import { h, toast, formatMoney, tween, easeOut } from '../ui/dom';
import { api, ApiError } from '../app/api';
import { BRAND } from '../../shared/brand.mjs';
import { THEME_INDEX, LIMITS } from '../../shared/catalog.mjs';
import type { App } from '../app/context';
import type { SummaryScreen } from './summary';

const OVERSCAN = 1.04;
// Measured on public/media/atm.webp, as fractions of the image (top = 0).
const SCREEN = { left: 0.267, right: 0.734, top: 0.293, bottom: 0.493 };
type Key = { id: string; x: number; y: number; w: number; h: number };
const COLS = [0.346, 0.428, 0.507];
const ROWS = [0.609, 0.647, 0.685, 0.724];
const KEYS: Key[] = [
  ...['1', '2', '3', '4', '5', '6', '7', '8', '9', 'blank-l', '0', 'blank-r'].map((id, i) => ({ id, x: COLS[i % 3], y: ROWS[Math.floor(i / 3)], w: 0.066, h: 0.03 })),
  { id: 'cancel', x: 0.636, y: ROWS[0], w: 0.094, h: 0.03 },
  { id: 'correct', x: 0.636, y: ROWS[1], w: 0.094, h: 0.03 },
  { id: 'enter', x: 0.636, y: ROWS[2], w: 0.094, h: 0.03 },
  { id: 'blank-wide', x: 0.638, y: ROWS[3], w: 0.094, h: 0.03 },
];
const KEY_LABEL: Record<string, string> = { cancel: 'Clear', correct: 'Delete last digit', enter: 'Enter', 'blank-l': 'Unused key', 'blank-r': 'Unused key', 'blank-wide': 'Unused key' };

/**
 * Checks the budget the client typed before it is sent.
 * Return null to accept it, or a short message to show on the ATM screen.
 */
export function validateBudget(amount: number): string | null {
  if (amount <= 0) return 'PLEASE ENTER AN AMOUNT';
  // TODO(human): your studio's budget rules (minimum charge, a sanity check on very large amounts, …)
  return null;
}

type State = 'entry' | 'processing' | 'error' | 'done';

export class AtmScreen extends BaseScreen {
  readonly id = 'atm' as const;
  private canvas = document.createElement('canvas');
  private screenTex: THREE.CanvasTexture;
  private mesh: THREE.Mesh;
  private u = {
    offset: uniform(new THREE.Vector2()),
    zoom: uniform(1.25),
    pan: uniform(new THREE.Vector2(0, 0)),
    viewAspect: uniform(1),
    imageAspect: uniform(1200 / 2150),
    press: uniform(new THREE.Vector4(0, 0, 0, 0)),
    pressK: uniform(0),
    time: uniform(0),
    glow: uniform(1),
  };
  private colorNode = texture(new THREE.Texture());
  private depthNode = texture(new THREE.Texture());
  private digits = '';
  private state: State = 'entry';
  private message = '';
  private keyLayer: HTMLElement | null = null;
  private continueBtn: HTMLButtonElement | null = null;
  private countdown = 0;
  private previewUrl: string | null = null;

  constructor(app: App) {
    super(app, 40);
    this.canvas.width = 832;
    this.canvas.height = 640;
    this.screenTex = new THREE.CanvasTexture(this.canvas);
    this.screenTex.colorSpace = THREE.SRGBColorSpace;
    const screenNode = texture(this.screenTex);
    const { u, colorNode, depthNode } = this;

    const m = new THREE.MeshBasicNodeMaterial({ depthWrite: false, depthTest: false });
    m.colorNode = Fn(() => {
      const ratio = u.viewAspect.div(u.imageAspect);
      const b = uv();
      const fitted = select(ratio.greaterThan(1), vec2(b.x, b.y.sub(0.5).div(ratio).add(0.5)), vec2(b.x.sub(0.5).mul(ratio).add(0.5), b.y));
      const base = fitted.sub(0.5).div(u.zoom).add(0.5).add(u.pan);
      const d = depthNode.sample(base).r;
      const p = clamp(base.add(u.offset.mul(0.03).mul(d.sub(0.6))), 0.001, 0.999);
      const photo = colorNode.sample(p).rgb.toVar();
      // Image coordinates with the top at 0, to match the measured layout.
      const img = vec2(p.x, float(1).sub(p.y));
      // Pressed key: darker and a touch lower, as if pushed in.
      const pr = u.press;
      const inKey = step(pr.x, img.x).mul(step(img.x, pr.z)).mul(step(pr.y, img.y)).mul(step(img.y, pr.w));
      photo.mulAssign(float(1).sub(inKey.mul(u.pressK).mul(0.35)));
      // Live screen content on the glass, with the photo's raindrop reflections kept on top.
      const s = vec2(img.x.sub(SCREEN.left).div(SCREEN.right - SCREEN.left), img.y.sub(SCREEN.top).div(SCREEN.bottom - SCREEN.top));
      const inside = smoothstep(0.0, 0.012, s.x).mul(smoothstep(1.0, 0.988, s.x)).mul(smoothstep(0.0, 0.015, s.y)).mul(smoothstep(1.0, 0.985, s.y));
      const lcd = screenNode.sample(vec2(s.x, float(1).sub(s.y))).rgb;
      const scan = sin(s.y.mul(640 * 3.14159)).mul(0.04).add(0.96);
      const flicker = hash(u.time.mul(8).floor()).mul(0.03).add(0.97);
      const reflections = smoothstep(0.35, 0.9, luminance(photo)).mul(0.35);
      const screen = lcd.mul(scan).mul(flicker).mul(1.25).mul(u.glow).add(photo.mul(reflections));
      return vec4(mix(photo, screen, inside), 1);
    })();
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m);
    this.mesh.position.z = -50;
    this.mesh.frustumCulled = false;
    this.camera.add(this.mesh);
    void vec3;
  }

  protected async load() {
    const [color, depth] = await Promise.all([loadTexture(media('atm.webp')), loadTexture(media('atm-depth.webp'), { color: false })]);
    this.colorNode.value = color;
    this.depthNode.value = depth;
  }

  protected onEnter() {
    const c = this.app.store.consult;
    this.digits = c?.budget ? String(c.budget.amount) : '';
    this.state = 'entry';
    this.message = '';
    this.blur = 0;
    this.u.glow.value = 1;
    this.draw();
    this.app.store.set({ step: 'atm' });
    addEventListener('keydown', this.onKeyboard);
    requestAnimationFrame(() => this.placeKeys());
  }

  protected onExit() {
    removeEventListener('keydown', this.onKeyboard);
    clearInterval(this.countdown);
  }

  protected render() {
    this.keyLayer = h(
      'div',
      { class: 'atm-keys' },
      ...KEYS.map((k) =>
        h('button', {
          class: 'live',
          'data-key': k.id,
          'aria-label': KEY_LABEL[k.id] ?? k.id,
          onpointerdown: (e: PointerEvent) => {
            e.preventDefault();
            this.press(k);
          },
        }),
      ),
    );
    this.continueBtn = h('button', { class: 'btn live', onclick: () => this.press(KEYS.find((k) => k.id === 'enter')!) }, 'Continue');
    return h(
      'section',
      { class: 'atm-screen' },
      this.keyLayer,
      h('div', { class: 'btn-row' }, h('button', { class: 'btn btn--ghost live', onclick: () => void this.back() }, 'Back'), this.continueBtn),
    );
  }

  /** Where an image point lands on screen, through the cover-fit, zoom and pan. */
  private toScreen(x: number, yTop: number) {
    const ratio = this.u.viewAspect.value / this.u.imageAspect.value;
    const zoom = this.u.zoom.value;
    const pan = this.u.pan.value;
    const fx = (x - 0.5 - pan.x) * zoom + 0.5;
    const fy = (1 - yTop - 0.5 - pan.y) * zoom + 0.5;
    const bx = ratio > 1 ? fx : (fx - 0.5) / ratio + 0.5;
    const by = ratio > 1 ? (fy - 0.5) * ratio + 0.5 : fy;
    // The plane is drawn 4% larger than the view to hide its edges when the camera rolls.
    const vx = (bx - 0.5) * OVERSCAN + 0.5;
    const vy = (by - 0.5) * OVERSCAN + 0.5;
    return { x: vx * innerWidth, y: (1 - vy) * innerHeight };
  }

  private placeKeys() {
    if (!this.keyLayer) return;
    for (const k of KEYS) {
      const el = this.keyLayer.querySelector(`[data-key="${k.id}"]`) as HTMLElement;
      const a = this.toScreen(k.x - k.w / 2 - 0.006, k.y - k.h / 2 - 0.006);
      const b = this.toScreen(k.x + k.w / 2 + 0.006, k.y + k.h / 2 + 0.006);
      Object.assign(el.style, { left: `${a.x}px`, top: `${a.y}px`, width: `${b.x - a.x}px`, height: `${b.y - a.y}px` });
    }
  }

  private onKeyboard = (e: KeyboardEvent) => {
    if (this.app.stage.active !== this) return;
    const id = /^[0-9]$/.test(e.key) ? e.key : e.key === 'Backspace' ? 'correct' : e.key === 'Enter' ? 'enter' : e.key === 'Escape' ? 'cancel' : null;
    const k = id && KEYS.find((q) => q.id === id);
    if (k) this.press(k);
  };

  private press(k: Key) {
    if (this.state === 'processing' || this.state === 'done') return;
    this.u.press.value.set(k.x - k.w / 2, k.y - k.h / 2, k.x + k.w / 2, k.y + k.h / 2);
    void tween(0.22, (v) => (this.u.pressK.value = 1 - v), easeOut);
    navigator.vibrate?.(10);
    if (this.state === 'error') {
      this.state = 'entry';
      this.message = '';
    }
    const max = String(LIMITS.budgetMax).length;
    if (/^[0-9]$/.test(k.id)) {
      if (this.digits.length >= max || (this.digits === '' && k.id === '0')) return this.app.sfx.beep(420, 0.16);
      this.digits += k.id;
      this.app.sfx.beep(1250, 0.08);
    } else if (k.id === 'correct') {
      this.digits = this.digits.slice(0, -1);
      this.app.sfx.beep(900, 0.08);
    } else if (k.id === 'cancel') {
      this.digits = '';
      this.app.sfx.beep(600, 0.12);
    } else if (k.id === 'enter') {
      this.app.sfx.beep(1500, 0.1);
      void this.submit();
    } else this.app.sfx.beep(420, 0.16);
    this.draw();
  }

  private get amount() {
    return Math.min(LIMITS.budgetMax, Number(this.digits || '0'));
  }

  private async submit() {
    const problem = validateBudget(this.amount);
    if (problem) {
      this.state = 'error';
      this.message = problem;
      this.draw();
      return;
    }
    this.state = 'processing';
    this.draw();
    try {
      this.app.store.set({ budget: { amount: this.amount } });
      await this.app.store.flush();
      await (this.app.screen('summary') as SummaryScreen).snapshots.catch(() => {});
      const prep = await api.prepare();
      let detail = 'preview';
      if (prep.mode === 'web3forms') {
        const r = await api.sendWeb3Forms(prep.payload);
        if (!r.ok) throw new ApiError(`The email didn’t send (${r.message}). Please try again.`, 502);
        detail = r.message;
      } else this.previewUrl = prep.previewUrl;
      const { consult } = await api.confirm(true, detail);
      this.app.store.adopt(consult);
      this.state = 'done';
      this.draw();
      this.app.sfx.printer(1.8);
      this.showReceipt(prep.mode === 'outbox');
    } catch (err) {
      this.state = 'error';
      this.message = 'TRANSACTION DECLINED';
      this.draw();
      toast(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.', true);
    }
  }

  private showReceipt(preview: boolean) {
    const c = this.app.store.consult!;
    const theme = THEME_INDEX.get(c.theme ?? '');
    void tween(0.6, (k) => (this.blur = k * 16), easeOut);
    const line = (a: string, b: string) => h('div', { class: 'line' }, h('span', null, a), h('span', null, b));
    let left = 15;
    const count = h('span', { class: 'countdown' }, `Back to the title in ${left}s`);
    const done = () => {
      clearInterval(this.countdown);
      void this.app.director.show(this.app.screen('title'), { kind: 'ink' });
    };
    const receipt = h(
      'div',
      { class: 'receipt live', role: 'document', 'aria-label': 'Consult receipt' },
      h('h4', null, BRAND.studio.toUpperCase()),
      h('div', { class: 'c' }, 'CONSULT RECEIPT'),
      h('hr'),
      line('DATE', new Date(c.submittedAt ?? Date.now()).toLocaleString('en-NZ', { dateStyle: 'medium', timeStyle: 'short' })),
      line('REF', c.ref),
      line('CLIENT', c.profile.fullName),
      line('THEME', theme?.label ?? '—'),
      line('AREAS', String(c.regions.length)),
      line('REFERENCES', `${c.uploads.length} file${c.uploads.length === 1 ? '' : 's'}`),
      h('hr'),
      h('div', { class: 'c' }, 'IDEAL BUDGET'),
      h('div', { class: 'big' }, formatMoney(c.budget?.amount ?? this.amount, c.budget?.currency ?? BRAND.currency)),
      h('hr'),
      h('div', { class: 'c' }, preview ? 'SAVED · EMAIL NOT SET UP YET' : 'SENT TO THE ARTIST ✓'),
      h('div', { class: 'c' }, 'Keep your ref. You’ll hear back soon.'),
      preview && this.previewUrl ? h('div', { class: 'c' }, h('a', { href: this.previewUrl, target: '_blank', rel: 'noopener', style: { color: '#1d1a17' } }, 'See the email preview')) : null,
      h('div', { class: 'c', style: { fontSize: '22px', letterSpacing: '-1px', marginTop: '8px' }, 'aria-hidden': 'true' }, '▌▍▌▌▍▌▍▍▌▌▍▌▍▌▌▍▍▌'),
    );
    this.dom?.replaceChildren(h('div', { class: 'receipt-screen screen' }, receipt, count, h('button', { class: 'btn live', onclick: done }, 'Done')));
    this.countdown = window.setInterval(() => {
      left -= 1;
      count.textContent = `Back to the title in ${left}s`;
      if (left <= 0) done();
    }, 1000);
  }

  private async back() {
    this.app.sfx.tick();
    await this.app.director.show(this.app.screen('summary'), { kind: 'push' });
  }

  /** Paints the ATM's display. */
  private draw() {
    const g = this.canvas.getContext('2d')!;
    const { width: W, height: H } = this.canvas;
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0b2fb0');
    bg.addColorStop(1, '#0a1f78');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,0.06)';
    for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1);
    g.textAlign = 'center';
    g.fillStyle = '#e8f0ff';
    const mono = '"Courier New", ui-monospace, monospace';
    if (this.state === 'processing') {
      g.font = `bold 60px ${mono}`;
      g.fillText('PROCESSING', W / 2, H * 0.45);
      g.font = `28px ${mono}`;
      g.fillText('PLEASE WAIT …', W / 2, H * 0.58);
    } else if (this.state === 'done') {
      g.font = `bold 50px ${mono}`;
      g.fillText('TRANSACTION COMPLETE', W / 2, H * 0.42);
      g.font = `28px ${mono}`;
      g.fillText('PLEASE TAKE YOUR RECEIPT', W / 2, H * 0.56);
    } else {
      g.font = `bold 44px ${mono}`;
      g.fillText('PLEASE SELECT YOUR IDEAL', W / 2, 86);
      g.fillText('BUDGET FOR THIS PROJECT', W / 2, 140);
      g.fillStyle = '#ffffff';
      g.fillRect(70, 190, W - 140, 170);
      g.fillStyle = '#0a1f78';
      g.font = `bold 112px ${mono}`;
      const text = formatMoney(this.amount, BRAND.currency);
      g.fillText(text, W / 2, 312);
      if (this.digits && Math.floor(performance.now() / 500) % 2) {
        const w = g.measureText(text).width;
        g.fillRect(W / 2 + w / 2 + 8, 228, 7, 98);
      }
      g.fillStyle = this.state === 'error' ? '#ffd166' : '#c8d6ff';
      g.font = `bold 36px ${mono}`;
      g.fillText(this.state === 'error' ? this.message : 'ENTER AMOUNT ON THE KEYPAD', W / 2, 440);
      g.font = `bold 30px ${mono}`;
      g.fillStyle = '#c8d6ff';
      g.fillText('GREEN = OK   YELLOW = DELETE', W / 2, 520);
      g.fillText('RED = CLEAR', W / 2, 562);
    }
    this.screenTex.needsUpdate = true;
    if (this.continueBtn) this.continueBtn.disabled = this.state === 'processing' || this.state === 'done' || !this.digits;
  }

  update(_dt: number, t: number) {
    this.u.time.value = t;
    // Handheld: slow breathing sway plus small, quick hand tremor.
    const x = Math.sin(t * 0.9) * 0.35 + Math.sin(t * 2.1 + 1) * 0.15 + Math.sin(t * 7.3) * 0.03;
    const y = Math.sin(t * 0.7 + 2) * 0.3 + Math.sin(t * 1.7) * 0.12 + Math.sin(t * 8.1 + 0.4) * 0.025;
    this.u.offset.value.set(x + this.app.look.value.x * 0.3, y + this.app.look.value.y * 0.3);
    this.u.pan.value.set(x * 0.004, -0.01 + y * 0.004);
    this.mesh.rotation.z = Math.sin(t * 0.6) * 0.006;
    if (this.state === 'entry' && this.digits) this.draw();
  }

  protected onResize() {
    const hgt = 2 * 50 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    this.mesh.scale.set(hgt * this.camera.aspect * OVERSCAN, hgt * OVERSCAN, 1);
    this.u.viewAspect.value = this.camera.aspect;
    // Phones see the screen and keypad close up; wide screens step back so it all fits.
    const ratio = this.camera.aspect / this.u.imageAspect.value;
    this.u.zoom.value = ratio > 1 ? Math.max(0.6, 1 / (ratio * 0.52)) : 1.22;
    requestAnimationFrame(() => this.placeKeys());
  }
}
