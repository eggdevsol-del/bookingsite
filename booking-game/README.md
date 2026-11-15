# Ink Consult

A tattoo consult that plays like a game's character creator. It runs as a mobile web app (installable as a PWA) on WebGPU, with an automatic WebGL2 fallback.

**Flow:** title → client file (name, email, mobile, date of birth, password) → character select (filmed idle loop) → mark body areas on a live 3D body → swipe through theme sets → describe the idea → reference desk (photos print onto sheets of paper that the desk fan stirs) → final cut (body standing in the chosen theme) → budget on an ATM → printed receipt → back to the title.

Every answer autosaves to the server. "Save for later" keeps the draft, and clients reopen it from the title screen with their email and password. On submit, you get an email through Web3Forms with every answer, links to each photo, front and back pictures of the body with the chosen areas highlighted, and a link to a private page showing the whole consult.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
```

### On your phone (same Wi-Fi)

```bash
npm run phone        # https://<your-mac-ip>:5173
```

The certificate is self-signed, so the phone warns the first time. On iPhone tap **Show Details → visit this website**; on Android tap **Advanced → Proceed**. HTTPS is needed for WebGPU, tilt parallax and audio unlock.

Useful URL flags: `?hud` shows the backend and fps. `?webgl` forces the WebGL2 path. `?q=low` forces the low-quality tier.

## Turn on the email

1. In your Web3Forms dashboard, copy your access key.
2. Put it in a file called `.env` next to `package.json` (copy `.env.example`):

   ```
   WEB3FORMS_ACCESS_KEY=your-key
   ```

   `.env` is never committed. Restart the server after changing it. On Railway, set the same name as a service variable instead.

Until a key is set, consults are saved and the receipt links to a preview of exactly what would be emailed (`data/outbox/`). Web3Forms' free plan only accepts submissions from a browser, so the server compiles the email and the client's browser sends it.

Other settings (all optional):

| Variable | Default | Meaning |
|---|---|---|
| `PUBLIC_URL` | from the request | Base for links in the email |
| `DATA_DIR` | `./data` (or the Railway volume) | Where consults and photos are stored |
| `ARTIST_KEY` | none | Turns on `/artist?k=…`, a list of every consult |

Your brand words (wordmark, byline, studio name, currency) live in `shared/brand.mjs`; the app, the server and the email all read that one file.

## Deploy (Railway)

1. Create a service from this folder.
2. Add a volume (mounted at `/data`, picked up through `RAILWAY_VOLUME_MOUNT_PATH`) so photos survive deploys.
3. Build command: `npm ci && npm run build`. Start command: `npm start`.
4. Set `WEB3FORMS_ACCESS_KEY`.

One Node process serves the app, the API and the uploads. The PWA cache (`public/sw.js`) keeps the heavy art on the phone for return visits.

## How it's built

- `src/engine/stage.ts`: the renderer. Each screen renders off-screen; a final pass composites transitions (ink bleed, push, flash), the Guy-Ritchie freeze-frame grade, blur, lens fringe, grain and vignette. Resolution drops automatically when frames run long.
- `src/engine/backdrop.ts`: photographic sets with real depth (2.5D parallax from phone tilt or the mouse).
- `src/character/`: the 3D body. `regions.ts` decides every tattoo zone per pixel from the body's measurements (smooth boundaries, no gaps); the same shader draws the highlight, answers taps (read back from the GPU) and makes the email pictures. `character.ts` holds the skin (subsurface scattering), the knitted balaclava and the stencil-style highlight.
- `src/engine/audio.ts` + `sfx.ts`: the sound. The house music ("Pulse of the Deep", P Mason's own Suno track) starts on the title and loops forever: each repeat starts 40 bars in, on the beat, over the song's fade-out (`MUSIC.period`, measured by `scripts/music-loop.mjs`; re-run it for a new track). Levels live in `LEVELS` at the top of `audio.ts` (music 0.5, ambience 0.2, effects 0.15). Every scene has its own ambience bed (`src/content/soundscapes.ts`) and its own synthesised room, so a tap in the cathedral rings and a tap in the study stays dry. A speaker button (top right) mutes everything, and the choice is remembered.
- `src/engine/film.ts` + `cinema.ts`: the cinema set's live film: the artist's own footage (`public/media/cinema-film.mp4`, source in `art-src/raw/film/`) plays muted and looping in a `<video>` behind the red curtains, cut to the visible strip by the set's screen mask (`scripts/cinema-mask.mjs`). The screen flickers like a projector lamp while it loads. No YouTube.
- `src/screens/desk.ts`, `src/desk/`: the reference desk. A filmed desk plate with only the fan and the paper in 3D. The 3D camera is the camera the plate was painted for (`shared/desk-plate.mjs`), the lamp sits where the plate's lamp is, and shadows are cut into the film. Sheets are stiff paper simulations: only the edge facing the fan lifts, a few millimetres.
- `src/screens/`: one file per screen.
- `server/api.mjs`: accounts, autosave, uploads (50 MB each, 40 per consult), the email payload and the private consult page.
- `shared/catalog.mjs`: the single list of tattoo zones and themes, used by the app, the server and the email.

### Art pipeline

All art was generated with Morphic. Every generation id is in `art-src/generations.json`.

| Asset | Model |
|---|---|
| Theme sets, title, profile desk, ATM | Nano Banana Pro stills (with depth maps for parallax). The cinema is a still; its screen plays the live film |
| Reference desk plate | Nano Banana Pro, painted over a layout guide drawn from the 3D camera (`scripts/desk-guide.mjs`), then animated with Kling 3.0 |
| Music and ambience | P Mason's own track (made with Suno; check the plan it was made on allows commercial use) and ElevenLabs sound effects (one bed per scene), loudness-matched by `scripts/audio.mjs` |
| The two bodies (reference photos) | Seedream 5.5 |
| 3D bodies | Hyper3D Rodin Gen-2.5 |
| Film loops: title, character select, profile desk, the reference desk and 9 theme sets | Kling 3.0, made from the stills with a locked camera (animals hold still; only fur, feathers, fins and surroundings move). `scripts/videos.mjs` makes seamless crossfade loops (ping-pong only for the people on character select) and saves each loop's first frame as its poster |

```bash
npm run assets:images    # art-src/raw → public/media (WebP, phone sizes); add names to do only some
npm run assets:depth     # depth maps (Depth Anything V2, runs locally)
node scripts/videos.mjs name[=url] [--pingpong] [--full]   # seamless loops + matching poster stills
node scripts/audio.mjs                            # download + loudness-match the music and ambience
node scripts/desk-guide.mjs out.png               # the layout guide the desk plate was painted over
node scripts/cinema-mask.mjs                      # the cinema's curtain mask + film rectangle
npm run assets:models    # orient, simplify to ~80k triangles, compress, measure body landmarks
npm run shots:body       # screenshots of both bodies (ZONES=1 colours every tattoo zone)
node scripts/probe-scene.mjs "screen=desk" out.png 8 --sample "s.paperLifts().join(',')"   # one screen, watched
```

## Testing

```bash
npm run test:e2e         # plays the whole consult on an emulated iPhone in headless Chrome
```

Screenshots of every screen land in `test-output/`. Each run creates a test client in `data/`.

## Status (15 Nov 2026)

Verified:

- The full flow runs end to end on WebGPU in headless Chrome (emulated iPhone, Mac GPU): sign-up, body-area taps, theme swipe, idea, 4 uploads, summary, ATM entry, receipt.
- Taps land on the intended body areas.
- The production server serves the build.
- With your key in `.env`, the browser builds the exact Web3Forms request: key, sender "P Mason Tattoo Artist Consults", reply-to the client, every answer, and links to photos, pictures and the consult page. Checked by intercepting the request (`npm run test:e2e -- --mock-email`), so no email was actually sent.
- Links in the email use the address the client opened the app on. While you test on Wi-Fi they point at your Mac, so they only open at home. Once deployed they use the public address.

Not yet verified:

- How the sound actually sounds. Levels were measured, not listened to. iPhones play web audio only with the ringer switch off silent.
- The cinema film on a real iPhone. In headless Chrome it loads in about a second and plays behind the curtains. iOS may keep its sound muted; it then plays silently. The video is a fan compilation ("Top 10 UNFORGETTABLE Movie Scenes", Life Hacks & Tops), not from the studios. YouTube or the rights holders can block or remove it at any time, and showing it in a commercial app may not be allowed.

- Real phones: no frame rates have been measured on an iPhone or Android. Headless Chrome reported about 48 fps while taking screenshots, which says nothing about a phone.
- Instagram's in-app browser.
- A real Web3Forms send to your inbox (do one test consult on your phone).
- The Railway deploy.
- Installing as a PWA (the service worker only runs in production builds over trusted HTTPS).
