import type { Stage, Screen } from '../engine/stage';
import type { Director } from './director';
import type { Store } from './store';
import type { Sfx } from '../engine/sfx';
import type { AudioEngine } from '../engine/audio';
import type { LookInput } from '../engine/input';

export type ScreenId = 'title' | 'profile' | 'login' | 'gender' | 'body' | 'theme' | 'idea' | 'desk' | 'summary' | 'atm';

/** Shared services every screen can use. */
export interface App {
  stage: Stage;
  director: Director;
  store: Store;
  sfx: Sfx;
  /** Scene ambience, music and room acoustics. */
  audio: AudioEngine;
  look: LookInput;
  screen(id: ScreenId): Screen;
  /** Sends the client to the right screen for where their consult is up to. */
  resume(): void;
}

/** Converts a pointer position to the 0..1 (y up) coordinates the ink transition uses. */
export function originOf(e: { clientX: number; clientY: number }): [number, number] {
  return [e.clientX / innerWidth, 1 - e.clientY / innerHeight];
}

export function firstName(full: string | undefined) {
  return (full ?? '').trim().split(/\s+/)[0] || 'You';
}

export function ageOf(dob: string | undefined) {
  if (!dob) return null;
  const d = new Date(`${dob}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const n = new Date();
  let a = n.getFullYear() - d.getFullYear();
  if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) a--;
  return a;
}
