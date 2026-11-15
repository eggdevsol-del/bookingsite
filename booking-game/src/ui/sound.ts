// The sound on/off button, top right on every screen. The choice is remembered.
import { h } from './dom';
import type { AudioEngine } from '../engine/audio';

const ON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.6a7.6 7.6 0 0 1 0 10.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
const OFF =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor"/><path d="M16 9.5l5 5M21 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';

export function soundToggle(audio: AudioEngine) {
  const btn = h('button', { class: 'sound-toggle live', type: 'button' }) as HTMLButtonElement;
  const show = (on: boolean) => {
    btn.innerHTML = on ? ON : OFF;
    btn.setAttribute('aria-label', on ? 'Turn sound off' : 'Turn sound on');
    btn.setAttribute('aria-pressed', String(!on));
  };
  show(!audio.muted);
  audio.onToggle(show);
  btn.addEventListener('click', () => {
    audio.setMuted(!audio.muted);
    audio.unlock(); // this click is a gesture: start audio now if it never started
  });
  return btn;
}
