// What every scene sounds like: its ambience bed(s) under the house music, and
// the acoustics its taps and whooshes ring in. Big stone rooms get
// long, bright tails; furnished rooms short, dark ones; outdoors almost none.
import type { Room, Soundscape } from '../engine/audio';
import type { ScreenId } from '../app/context';

export const ROOMS = {
  /** Furnished tattoo studio: medium room, soft furnishings. */
  studio: { decay: 0.9, predelay: 0.012, wet: 0.2, damp: 4200 },
  /** Small study full of books: short and dark. */
  study: { decay: 0.55, predelay: 0.006, wet: 0.14, damp: 3200 },
  /** Big empty photo studio with a hard floor. */
  photo: { decay: 1.7, predelay: 0.025, wet: 0.28, damp: 6500 },
  /** Night street: just a slap off the buildings. */
  street: { decay: 0.45, predelay: 0.018, wet: 0.1, damp: 5200 },
  outdoors: { decay: 0.35, predelay: 0.01, wet: 0.06, damp: 3000 },
  /** Wood-panelled gallery. */
  gallery: { decay: 1.1, predelay: 0.016, wet: 0.2, damp: 4000 },
  /** Vaulted stone workshop. */
  stone: { decay: 2.8, predelay: 0.035, wet: 0.34, damp: 5200 },
  attic: { decay: 0.7, predelay: 0.008, wet: 0.16, damp: 3600 },
  /** Big room, but carpet and acoustic panels soak it up. */
  cinema: { decay: 0.8, predelay: 0.03, wet: 0.14, damp: 2600 },
  /** Huge stone nave: very long and bright. */
  cathedral: { decay: 5.2, predelay: 0.06, wet: 0.45, damp: 4600 },
  /** Glass and tile: lively and bright. */
  glasshouse: { decay: 1.5, predelay: 0.02, wet: 0.26, damp: 8000 },
  /** Polished stone museum hall. */
  museum: { decay: 2.6, predelay: 0.045, wet: 0.34, damp: 5600 },
} satisfies Record<string, Room>;

/** Each theme set's bed and room. */
const THEME_SOUND: Record<string, { bed: string; room: Room }> = {
  japanese: { bed: 'amb-garden', room: ROOMS.outdoors },
  portraits: { bed: 'amb-portraits', room: ROOMS.gallery },
  renaissance: { bed: 'amb-renaissance', room: ROOMS.stone },
  illustrative: { bed: 'amb-attic', room: ROOMS.attic },
  popculture: { bed: 'amb-cinema', room: ROOMS.cinema },
  mythology: { bed: 'amb-mythology', room: ROOMS.outdoors },
  religious: { bed: 'amb-cathedral', room: ROOMS.cathedral },
  floral: { bed: 'amb-glasshouse', room: ROOMS.glasshouse },
  wildlife: { bed: 'amb-forest', room: ROOMS.outdoors },
  cultural: { bed: 'amb-museum', room: ROOMS.museum },
  other: { bed: 'amb-studio', room: ROOMS.studio },
};

const themeSound = (themeId: string | null | undefined) => THEME_SOUND[themeId ?? ''] ?? THEME_SOUND.other;

/** The bed to warm up before swiping to a theme. */
export const themeBed = (themeId: string) => themeSound(themeId).bed;

/** A theme set on its own (the theme carousel): the set's ambience up front, under the music. */
export function themeScape(themeId: string | null | undefined): Soundscape {
  const t = themeSound(themeId);
  return { beds: [{ id: t.bed, gain: 0.6 }], room: t.room };
}

/**
 * The soundscape for a screen; screens set in a theme use the client's chosen theme. The house
 * music plays over all of them (src/engine/audio.ts), so the beds sit underneath it.
 */
export function soundFor(screen: ScreenId, themeId: string | null | undefined): Soundscape {
  switch (screen) {
    case 'title':
      return { beds: [{ id: 'amb-studio', gain: 0.3 }], room: ROOMS.studio };
    case 'profile':
    case 'login':
      return { beds: [{ id: 'amb-study', gain: 0.45 }], room: ROOMS.study };
    case 'gender':
      return { beds: [{ id: 'amb-photo', gain: 0.3 }], room: ROOMS.photo };
    case 'body':
      return { beds: [{ id: 'amb-photo', gain: 0.45 }], room: ROOMS.photo };
    case 'theme':
      return themeScape(themeId);
    case 'idea':
    case 'summary': {
      // The body stands in the chosen set: its ambience, quietly.
      const t = themeSound(themeId);
      return { beds: [{ id: t.bed, gain: 0.3 }], room: t.room };
    }
    case 'desk':
      return { beds: [{ id: 'amb-fan', gain: 0.45 }, { id: 'amb-study', gain: 0.2 }], room: ROOMS.study };
    case 'atm':
      return { beds: [{ id: 'amb-street', gain: 0.55 }], room: ROOMS.street };
  }
}
