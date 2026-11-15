// The single owner of body-area and theme names. The app, the server and the
// email all read these lists, so a region id always means the same place.

const sides = [
  ['l', 'Left'],
  ['r', 'Right'],
];

/**
 * The selectable tattoo zones. Every zone touches its neighbours with no gap; the
 * shader in src/character/regions.ts decides which zone each point of skin is in.
 * Hands are deliberately not selectable.
 * @type {{id: string, label: string, group: string}[]}
 */
export const REGIONS = [
  { id: 'face', label: 'Face', group: 'Head & neck' },
  { id: 'head-top', label: 'Top of head', group: 'Head & neck' },
  { id: 'head-back', label: 'Back of head', group: 'Head & neck' },
  ...sides.map(([s, S]) => ({ id: `head-side-${s}`, label: `${S} side of head`, group: 'Head & neck' })),
  { id: 'neck-front', label: 'Front of neck', group: 'Head & neck' },
  { id: 'neck-back', label: 'Back of neck', group: 'Head & neck' },
  ...sides.map(([s, S]) => ({ id: `neck-side-${s}`, label: `${S} side of neck`, group: 'Head & neck' })),

  ...sides.map(([s, S]) => ({ id: `traps-${s}`, label: `${S} trap`, group: 'Torso' })),
  ...sides.map(([s, S]) => ({ id: `chest-${s}`, label: `${S} pec`, group: 'Torso' })),
  { id: 'stomach', label: 'Stomach', group: 'Torso' },
  ...sides.map(([s, S]) => ({ id: `ribs-${s}`, label: `${S} ribs`, group: 'Torso' })),
  { id: 'back', label: 'Back', group: 'Torso' },
  ...sides.map(([s, S]) => ({ id: `buttock-${s}`, label: `${S} buttock`, group: 'Torso' })),

  ...sides.flatMap(([s, S]) => [
    { id: `shoulder-${s}`, label: `${S} shoulder`, group: 'Arms' },
    { id: `upper-arm-outer-${s}`, label: `${S} upper arm (outer)`, group: 'Arms' },
    { id: `inner-bicep-${s}`, label: `${S} inner bicep`, group: 'Arms' },
    { id: `forearm-outer-${s}`, label: `${S} forearm (outer)`, group: 'Arms' },
    { id: `forearm-inner-${s}`, label: `${S} forearm (inner)`, group: 'Arms' },
  ]),

  ...sides.flatMap(([s, S]) => [
    { id: `thigh-front-${s}`, label: `${S} upper thigh (front)`, group: 'Legs' },
    { id: `thigh-outer-${s}`, label: `${S} thigh (side)`, group: 'Legs' },
    { id: `thigh-back-${s}`, label: `${S} thigh (back)`, group: 'Legs' },
    { id: `thigh-inner-${s}`, label: `${S} inner thigh`, group: 'Legs' },
    { id: `knee-${s}`, label: `${S} knee`, group: 'Legs' },
    { id: `knee-back-${s}`, label: `Back of ${s === 'l' ? 'left' : 'right'} knee`, group: 'Legs' },
    { id: `shin-${s}`, label: `${S} shin to ankle`, group: 'Legs' },
    { id: `calf-${s}`, label: `${S} calf to ankle`, group: 'Legs' },
    { id: `calf-outer-${s}`, label: `${S} outer calf to ankle`, group: 'Legs' },
    { id: `calf-inner-${s}`, label: `${S} inner calf to ankle`, group: 'Legs' },
    { id: `foot-${s}`, label: `${S} foot`, group: 'Legs' },
  ]),
];

export const REGION_INDEX = new Map(REGIONS.map((r, i) => [r.id, i]));

/**
 * Each theme's backdrop, atmosphere and the light that falls on the
 * character when it stands inside the scene.
 * particles.kind: dust | petals | embers | pollen
 */
export const THEMES = [
  {
    id: 'japanese', label: 'Japanese Realism', image: 'theme-japanese',
    particles: { kind: 'petals', color: '#ffc4d6', count: 70, wind: [0.18, -0.12] },
    light: { key: '#9fb6ff', keyIntensity: 1.6, rim: '#ffb066', rimIntensity: 2.4 },
  },
  {
    id: 'portraits', label: 'Portraits', image: 'theme-portraits',
    particles: null,
    light: { key: '#ffd2a1', keyIntensity: 2.2, rim: '#ff9a5c', rimIntensity: 1.6 },
  },
  {
    id: 'renaissance', label: 'Renaissance', image: 'theme-renaissance',
    particles: null,
    light: { key: '#ffdcaa', keyIntensity: 2.6, rim: '#ffefcf', rimIntensity: 1.8 },
  },
  {
    id: 'illustrative', label: 'Illustrative', image: 'theme-illustrative',
    particles: null,
    light: { key: '#ffe0b0', keyIntensity: 1.9, rim: '#8fb8ff', rimIntensity: 1.8 },
  },
  {
    id: 'popculture', label: 'Pop Culture & Movies', image: 'theme-popculture',
    // The old curtained picture palace. Its loop is the first 4.2 s of the original film (the
    // projector haze drifts, the TVs flicker); the smoke puff over the seats is patched out.
    // The film's full 16:9 rectangle behind the curtains (image fractions), the screen's depth
    // for gyro parallax, and the mask of the strip visible between the curtains. All three come
    // from scripts/cinema-mask.mjs.
    screen: { left: -0.0365, right: 0.4707, top: 0.3328, bottom: 0.492, depth: 0.0051, mask: 'theme-popculture-screen.png' },
    // The screen plays this YouTube video live on the theme carousel, looping only start..end
    // (seconds). Swap the id to change films. If it can't play, the screen stays lit white.
    particles: null,
    light: { key: '#c9e2ff', keyIntensity: 2.0, rim: '#ff3fb4', rimIntensity: 2.8 },
  },
  {
    id: 'mythology', label: 'Ancient Mythology', image: 'theme-mythology',
    particles: { kind: 'embers', color: '#ffb35c', count: 60, wind: [0.12, 0.2] },
    light: { key: '#ffcf8a', keyIntensity: 2.4, rim: '#8ea6ff', rimIntensity: 1.6 },
  },
  {
    id: 'religious', label: 'Religious', image: 'theme-religious',
    particles: null,
    light: { key: '#fff1d6', keyIntensity: 2.3, rim: '#b48cff', rimIntensity: 1.6 },
  },
  {
    id: 'floral', label: 'Floral', image: 'theme-floral',
    particles: { kind: 'petals', color: '#ffd0dc', count: 55, wind: [0.1, -0.1] },
    light: { key: '#fff0d8', keyIntensity: 2.2, rim: '#ffd09a', rimIntensity: 1.8 },
  },
  {
    id: 'wildlife', label: 'Wildlife & Mother Nature', image: 'theme-wildlife',
    particles: { kind: 'pollen', color: '#fff2b8', count: 80, wind: [0.05, 0.02] },
    light: { key: '#ffe9bf', keyIntensity: 2.2, rim: '#bfe3ff', rimIntensity: 1.4 },
  },
  {
    id: 'cultural', label: 'Cultural', image: 'theme-cultural',
    particles: null,
    light: { key: '#ffcf96', keyIntensity: 2.1, rim: '#ff8a4a', rimIntensity: 1.8 },
  },
  {
    id: 'other', label: 'Something Else', image: 'title',
    particles: null,
    light: { key: '#ffb98a', keyIntensity: 2.0, rim: '#ff4fa3', rimIntensity: 2.6 },
  },
];

export const THEME_INDEX = new Map(THEMES.map((t) => [t.id, t]));

export const GENDERS = [
  { id: 'male', label: 'Male' },
  { id: 'female', label: 'Female' },
];

export const LIMITS = {
  fileBytes: 50 * 1024 * 1024,
  filesPerConsult: 40,
  thumbBytes: 4 * 1024 * 1024,
  snapshotBytes: 8 * 1024 * 1024,
  jsonBytes: 64 * 1024,
  ideaMin: 10,
  ideaMax: 4000,
  budgetMax: 1_000_000,
};
