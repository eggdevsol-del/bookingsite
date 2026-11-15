// Profile setup ("character file") and the returning-client login. Both sit on
// the dossier-desk shot with tilt parallax.
import { BaseScreen } from './base';
import { Backdrop } from '../engine/backdrop';
import { loadTexture, loadVideo, media, playVideo } from '../engine/assets';
import { h, toast } from '../ui/dom';
import { api, ApiError } from '../app/api';
import { BRAND } from '../../shared/brand.mjs';
import { ageOf, firstName, type App } from '../app/context';

type Mode = 'register' | 'login';

const today = () => new Date().toISOString().slice(0, 10);

export class ProfileScreen extends BaseScreen {
  readonly id: 'profile' | 'login';
  private backdrop = new Backdrop({ strength: 0.045, focus: 0.45 });
  private sending = false;
  private video: HTMLVideoElement | null = null;

  constructor(app: App, private mode: Mode) {
    super(app, 40);
    this.id = mode === 'register' ? 'profile' : 'login';
    this.backdrop.attach(this.camera);
    this.backdrop.u.dim.value = 0.2;
  }

  protected async load() {
    const [img, depth] = await Promise.all([loadTexture(media('profile.webp')), loadTexture(media('profile-depth.webp'), { color: false })]);
    this.backdrop.setImage(img, depth);
    loadVideo(media('profile-loop.mp4'))
      .then(({ video, texture }) => {
        this.video = video;
        this.backdrop.setImage(texture, depth);
        if (this.dom) playVideo(video);
      })
      .catch(() => {});
  }

  protected onEnter() {
    if (this.video) playVideo(this.video);
  }

  protected onExit() {
    this.video?.pause();
  }

  protected render() {
    return this.mode === 'register' ? this.renderRegister() : this.renderLogin();
  }

  private field(name: string, label: string, input: Record<string, unknown>) {
    return h('label', { class: 'field', 'data-field': name }, h('span', null, label), h('input', { name, ...input }), h('small'));
  }

  private renderRegister() {
    const form = h(
      'form',
      { class: 'form', novalidate: true, onsubmit: (e: Event) => (e.preventDefault(), void this.submitRegister(form)) },
      this.field('fullName', 'Full name', { autocomplete: 'name', placeholder: 'First and last name', required: true, maxlength: 120 }),
      this.field('email', 'Email', { type: 'email', autocomplete: 'email', inputmode: 'email', placeholder: 'you@example.com', required: true }),
      h(
        'div',
        { class: 'row2' },
        this.field('phone', 'Mobile', { type: 'tel', autocomplete: 'tel', inputmode: 'tel', placeholder: '021 123 4567', required: true }),
        this.field('dob', 'Date of birth', { type: 'date', autocomplete: 'bday', max: today(), required: true }),
      ),
      this.field('password', 'Choose a password', {
        type: 'password',
        autocomplete: 'new-password',
        placeholder: 'So you can come back to it',
        minlength: 8,
        required: true,
      }),
      h(
        'label',
        { class: 'check' },
        h('input', { type: 'checkbox', name: 'consent' }),
        h(
          'span',
          null,
          `I agree that ${BRAND.studio} can store my details and photos to plan my tattoo, and contact me about it. Nothing is shared or sold, and I can ask for it to be deleted at any time.`,
        ),
      ),
      h('p', { class: 'form-error', role: 'alert' }),
      h('button', { class: 'btn btn--block', type: 'submit' }, 'Create my file'),
    );
    return h(
      'section',
      { class: 'profile-screen' },
      h('span', { class: 'file-tag' }, 'Client file · New'),
      h('h2', { class: 'title' }, 'Who’s getting', h('br'), h('span', { class: 'title--grad' }, 'tattooed?')),
      h('div', { class: 'panel' }, form),
      h('button', { class: 'link live', type: 'button', onclick: () => void this.back() }, '← Back to title'),
    );
  }

  private renderLogin() {
    const form = h(
      'form',
      { class: 'form', novalidate: true, onsubmit: (e: Event) => (e.preventDefault(), void this.submitLogin(form)) },
      this.field('email', 'Email', { type: 'email', autocomplete: 'email', inputmode: 'email', required: true }),
      this.field('password', 'Password', { type: 'password', autocomplete: 'current-password', required: true }),
      h('p', { class: 'form-error', role: 'alert' }),
      h('button', { class: 'btn btn--block', type: 'submit' }, 'Open my consult'),
    );
    return h(
      'section',
      { class: 'profile-screen' },
      h('span', { class: 'file-tag' }, 'Client file · Returning'),
      h('h2', { class: 'title' }, 'Welcome', h('br'), h('span', { class: 'title--grad' }, 'back')),
      h('div', { class: 'panel' }, form),
      h('button', { class: 'link live', type: 'button', onclick: () => void this.back() }, '← Back to title'),
    );
  }

  private markBad(form: HTMLFormElement, name: string, message: string) {
    const f = form.querySelector(`[data-field="${name}"]`);
    if (!f) return;
    f.classList.add('is-bad');
    f.querySelector('small')!.textContent = message;
  }

  private clearErrors(form: HTMLFormElement) {
    form.querySelectorAll('.is-bad').forEach((f) => {
      f.classList.remove('is-bad');
      f.querySelector('small')!.textContent = '';
    });
    form.querySelector('.form-error')!.textContent = '';
  }

  private async submitRegister(form: HTMLFormElement) {
    if (this.sending) return;
    this.clearErrors(form);
    const v = (n: string) => ((form.elements.namedItem(n) as HTMLInputElement).value ?? '').trim();
    const data = {
      fullName: v('fullName'),
      email: v('email'),
      phone: v('phone'),
      dob: v('dob'),
      password: (form.elements.namedItem('password') as HTMLInputElement).value,
      consent: (form.elements.namedItem('consent') as HTMLInputElement).checked,
    };
    let ok = true;
    if (data.fullName.length < 2) (this.markBad(form, 'fullName', 'Please enter your full name'), (ok = false));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email)) (this.markBad(form, 'email', 'Please enter a valid email'), (ok = false));
    if (!/^[+()\d\s-]{6,30}$/.test(data.phone)) (this.markBad(form, 'phone', 'Please enter a valid number'), (ok = false));
    const age = ageOf(data.dob);
    if (age === null || age < 0 || age > 120) (this.markBad(form, 'dob', 'Please enter your date of birth'), (ok = false));
    if (data.password.length < 8) (this.markBad(form, 'password', 'At least 8 characters'), (ok = false));
    if (!data.consent) ((form.querySelector('.form-error')!.textContent = 'Please tick the box to continue.'), (ok = false));
    if (!ok) return;

    this.sending = true;
    const btn = form.querySelector('button[type=submit]') as HTMLButtonElement;
    btn.disabled = true;
    try {
      const { consult } = await api.register(data);
      this.app.store.adopt(consult);
      this.app.sfx.tick();
      const name = firstName(consult.profile.fullName);
      void this.app.director.show(this.app.screen('gender'), {
        kind: 'ink',
        origin: [0.5, 0.55],
        freeze: {
          name,
          tape: age !== null ? `Age ${age}` : 'The client',
          lines: ['The client.', 'File opened. No turning back.'],
        },
      });
    } catch (err) {
      form.querySelector('.form-error')!.textContent = err instanceof ApiError ? err.message : 'Something went wrong. Please try again.';
    } finally {
      this.sending = false;
      btn.disabled = false;
    }
  }

  private async submitLogin(form: HTMLFormElement) {
    if (this.sending) return;
    this.clearErrors(form);
    const email = (form.elements.namedItem('email') as HTMLInputElement).value.trim();
    const password = (form.elements.namedItem('password') as HTMLInputElement).value;
    this.sending = true;
    try {
      const { consult } = await api.login(email, password);
      this.app.store.adopt(consult);
      if (!consult) {
        toast('No consult found on this account yet.');
        return;
      }
      this.app.resume();
    } catch (err) {
      form.querySelector('.form-error')!.textContent = err instanceof ApiError ? err.message : 'Something went wrong. Please try again.';
    } finally {
      this.sending = false;
    }
  }

  private async back() {
    (document.activeElement as HTMLElement | null)?.blur();
    await this.app.director.show(this.app.screen('title'), { kind: 'push' });
  }

  update(_dt: number, t: number) {
    const { look } = this.app;
    this.backdrop.u.offset.value.set(look.value.x, look.value.y);
    this.backdrop.u.zoom.value = 1.08 + Math.sin(t * 0.09) * 0.01;
  }

  protected onResize() {
    this.backdrop.fit(this.camera);
  }
}
