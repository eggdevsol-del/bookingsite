// Reference desk: a filmed antique partners desk with a green leather top
// (public/media/desk-loop.mp4), seen from a seated, high angle. Only the fan and
// the sheets of paper are 3D. The 3D camera is the camera the plate was made
// with (shared/desk-plate.mjs), so the sheets lie on the filmed leather. One
// warm spot light stands where the plate's off-screen lamp is, a shadow catcher
// cuts the sheets' and the fan's shadows into the film, and each sheet has a
// soft contact shadow where it touches the leather. Uploaded photos are
// printed onto a new sheet before it floats down onto the desk.
import * as THREE from 'three/webgpu';
import { Fn, uv, float, smoothstep, abs, vec2, color, length, max, min, normalize, positionWorld, mix, uniform } from 'three/tsl';
import { BaseScreen } from './base';
import { Backdrop } from '../engine/backdrop';
import { loadTexture, loadVideo, media, playVideo } from '../engine/assets';
import { DeskFan } from '../desk/fan';
import { Paper, paperCanvas, PAPER_W, PAPER_H } from '../desk/papers';
import { h, toast, ui } from '../ui/dom';
import { api, ApiError, type Upload } from '../app/api';
import { LIMITS } from '../../shared/catalog.mjs';
import { DESK_PLATE } from '../../shared/desk-plate.mjs';
import type { App } from '../app/context';

const CAM = DESK_PLATE.camera;
const LAMP = new THREE.Vector3().fromArray(DESK_PLATE.lamp);
/** Middle of the paper area; the lamp's pool and the fan both point here. */
const CENTRE = new THREE.Vector3(-0.02, 0, -0.15);
const FAN_AT = new THREE.Vector3(0.15, 0, -0.41);

// Where sheets go (x, z), all inside the strip of leather a portrait phone shows between the
// heading and the buttons. The first two hold the blank sheets that are always on the desk.
const SLOTS: [number, number][] = [
  [-0.04, -0.16], [0.06, -0.1], [-0.1, -0.22], [0.03, -0.2], [-0.06, -0.06], [0.08, -0.03],
  [-0.12, -0.1], [0.0, -0.28], [0.07, -0.15], [-0.03, -0.1], [-0.09, -0.3], [0.05, -0.06],
];

interface Item {
  key: string;
  file?: File;
  upload?: Upload;
  thumb?: Blob | null;
  paper: Paper | null;
  pill: HTMLElement;
  progress: number;
  failed?: string;
  /** Object URL for the close-up viewer, made on first open. */
  view?: string;
}

/**
 * Decodes a photo small enough to print on a sheet. createImageBitmap decodes off the main
 * thread and shrinks while it decodes, so even a 50 MB camera photo is ready in a moment.
 * Null when the browser can't read the format (e.g. HEIC outside Safari).
 */
async function decodePhoto(file: Blob, max = 1024): Promise<HTMLCanvasElement | null> {
  let src: ImageBitmap | HTMLImageElement;
  try {
    src = await createImageBitmap(file, { resizeWidth: max, resizeQuality: 'medium' });
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      src = img;
    } catch {
      return null;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  const w = 'naturalWidth' in src ? src.naturalWidth : src.width;
  const hh = 'naturalHeight' in src ? src.naturalHeight : src.height;
  const s = Math.min(1, max / Math.max(w, hh));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * s));
  c.height = Math.max(1, Math.round(hh * s));
  c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
  if ('close' in src) src.close();
  return c;
}

/** A dim panelled study with the lamp's bright shade in one direction, for reflections in the fan's chrome. */
function studyEnvironment(renderer: THREE.WebGPURenderer) {
  const env = new THREE.Scene();
  const room = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide });
  room.colorNode = Fn(() => {
    const d = normalize(positionWorld);
    // Dark wood all round; the green leather below bounces a little lamplight.
    return mix(color('#1a0f08').mul(0.06), color('#2a4a2c').mul(0.1), smoothstep(0.05, -0.5, d.y));
  })();
  env.add(new THREE.Mesh(new THREE.SphereGeometry(5, 32, 16), room));
  const shade = new THREE.MeshBasicNodeMaterial();
  shade.colorNode = color('#ffd2a0').mul(25);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 8), shade);
  bulb.position.copy(LAMP.clone().sub(CENTRE).normalize().multiplyScalar(3));
  env.add(bulb);
  return new THREE.PMREMGenerator(renderer).fromScene(env, 0.02).texture;
}

/** The soft dark line where a sheet meets the leather (light can't reach right under its edge). */
function contactShadow(center: THREE.Vector3, angle: number, y: number) {
  const pad = 0.03;
  const strength = uniform(0);
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  m.colorNode = color('#050302');
  m.opacityNode = Fn(() => {
    const p = uv().sub(0.5).mul(vec2(PAPER_W + pad, PAPER_H + pad));
    const q = abs(p).sub(vec2(PAPER_W / 2, PAPER_H / 2));
    const d = length(max(q, 0)).add(min(max(q.x, q.y), 0)); // metres outside the sheet's edge
    return smoothstep(0.014, -0.002, d).mul(0.5).mul(strength);
  })();
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(PAPER_W + pad, PAPER_H + pad), m);
  mesh.rotation.set(-Math.PI / 2, 0, -angle);
  // Just under its own sheet, so where it overlaps a lower sheet it shades that sheet too.
  mesh.position.set(center.x, y, center.z);
  mesh.renderOrder = 1;
  return { mesh, strength };
}

export class DeskScreen extends BaseScreen {
  readonly id = 'desk' as const;
  private fan = new DeskFan();
  private backdrop = new Backdrop({ strength: 0, distance: 30 });
  private plate: HTMLVideoElement | null = null;
  private papers: Paper[] = [];
  private items: Item[] = [];
  private input: HTMLInputElement | null = null;
  private listEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private primary: HTMLButtonElement | null = null;
  private secondary: HTMLButtonElement | null = null;
  private queue: Item[] = [];
  private active = 0;
  private time = 0;
  private rustleClock = 0;
  private viewer: HTMLElement | null = null;
  private ray = new THREE.Raycaster();
  private aimYaw = Math.atan2(CENTRE.x - FAN_AT.x, CENTRE.z - FAN_AT.z);
  /** Air velocity at a point (written to out) and its strength 0..1: a narrow jet from the fan's head. */
  private wind = (x: number, y: number, z: number, out: THREE.Vector3) => {
    const o = this.fan.outlet;
    const d = this.fan.direction;
    const rx = x - o.x;
    const ry = y - o.y;
    const rz = z - o.z;
    const along = rx * d.x + ry * d.y + rz * d.z;
    if (along <= 0) {
      out.set(0, 0, 0);
      return 0;
    }
    const px = rx - d.x * along;
    const py = ry - d.y * along;
    const pz = rz - d.z * along;
    const radial = Math.sqrt(px * px + py * py + pz * pz);
    // A small desk fan's jet stays narrow: a sheet only feels it while the head points at it.
    const cone = 0.035 + along * 0.16;
    const f = Math.exp(-((radial / cone) ** 2)) / (1 + along * along * 2.5);
    out.set(d.x * f, d.y * f, d.z * f);
    // Air only gets under an edge right at the leather; once the edge is up ~1 cm the draught
    // passes over it instead, so sheets lift a few millimetres and no more.
    return f * Math.max(0, 1 - (y - 0.001) / 0.014);
  };

  constructor(app: App) {
    super(app, CAM.vfov);
    this.backdrop.attach(this.camera);
    this.backdrop.u.zoom.value = 1; // the plate must map 1:1 onto the camera
    this.backdrop.u.lod.value = 0;
    this.backdrop.u.dim.value = 0.2; // a dim study, lit only by the lamp
    this.scene.add(this.fan.root);
    this.fan.root.position.copy(FAN_AT);
    this.fan.root.scale.setScalar(0.85);
    this.camera.position.fromArray(CAM.pos);
    this.camera.lookAt(new THREE.Vector3().fromArray(CAM.look));
    this.listenForTaps();
  }

  /** A tap (not a drag) on a printed sheet opens that photo close up. */
  private listenForTaps() {
    let down: { x: number; y: number; t: number } | null = null;
    addEventListener('pointerdown', (e) => {
      down = e.target === this.app.stage.renderer.domElement ? { x: e.clientX, y: e.clientY, t: performance.now() } : null;
    });
    addEventListener('pointerup', (e) => {
      const d = down;
      down = null;
      if (!d || this.app.stage.active !== this || this.viewer) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 12 || performance.now() - d.t > 500) return;
      const item = this.itemAt(e.clientX, e.clientY);
      if (item) this.openViewer(item, e.clientX, e.clientY);
    });
  }

  /** The uploaded photo whose sheet is under a screen point (the topmost, if they overlap). */
  private itemAt(x: number, y: number): Item | null {
    const { width, height } = this.app.stage.size;
    this.ray.setFromCamera(new THREE.Vector2((x / width) * 2 - 1, -(y / height) * 2 + 1), this.camera);
    const sheets = this.items.filter((i) => i.paper).map((i) => i.paper!.mesh);
    for (const m of sheets) m.geometry.computeBoundingSphere(); // the cloth moves
    const hit = this.ray.intersectObjects(sheets, false)[0];
    return hit ? this.items.find((i) => i.paper?.mesh === hit.object) ?? null : null;
  }

  /** The best picture of an item for the viewer: the original if the browser can show it, else its preview. */
  private viewUrl(item: Item) {
    if (item.view) return item.view;
    const f = item.file;
    if (f && /^image\/(jpeg|png|gif|webp|avif)$/.test(f.type)) item.view = URL.createObjectURL(f);
    else if (item.thumb) item.view = URL.createObjectURL(item.thumb);
    else if (item.upload?.hasThumb) return `/api/files/${item.upload.id}-thumb`;
    else if (item.upload) return `/api/files/${item.upload.id}`;
    return item.view ?? '';
  }

  /** The photo rises from where it was tapped to fill the screen, with Close and Delete. */
  private openViewer(item: Item, fromX = innerWidth / 2, fromY = innerHeight / 2) {
    if (this.viewer) return;
    this.app.sfx.whoosh(0.4);
    const busy = !item.upload && !item.failed;
    // The tap that opened the viewer is followed by its click, which would land on the backdrop.
    const opened = performance.now();
    const close = () => {
      if (!this.viewer) return;
      const v = this.viewer;
      this.viewer = null;
      v.classList.remove('is-open');
      removeEventListener('keydown', onKey);
      setTimeout(() => v.remove(), 320);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    const del: HTMLButtonElement = h(
      'button',
      {
        class: 'btn btn--ghost live',
        disabled: busy,
        // Two taps: the first arms it, so a stray tap can't delete a photo.
        onclick: () => {
          if (!del.classList.contains('is-armed')) {
            del.classList.add('is-armed');
            del.textContent = 'Tap again to delete';
            return;
          }
          void this.deleteItem(item).then((ok) => ok && close());
        },
      },
      busy ? 'Uploading…' : 'Delete photo',
    );
    const img = h('img', { class: 'photo-viewer__img', src: this.viewUrl(item), alt: item.upload?.name ?? item.file?.name ?? 'Reference photo' });
    const v = h(
      'div',
      { class: 'photo-viewer live', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Reference photo', onclick: (e: Event) => e.target === v && performance.now() - opened > 400 && close() },
      h('button', { class: 'photo-viewer__close live', 'aria-label': 'Close', onclick: close }, '✕'),
      img,
      h('div', { class: 'photo-viewer__bar' }, del),
    );
    // Rise from the tap: start small at that point, then open to the middle.
    v.style.setProperty('--from-x', `${fromX - innerWidth / 2}px`);
    v.style.setProperty('--from-y', `${fromY - innerHeight / 2}px`);
    ui().append(v);
    this.viewer = v;
    addEventListener('keydown', onKey);
    requestAnimationFrame(() => requestAnimationFrame(() => v.classList.add('is-open')));
  }

  /** Removes a photo: from the server (if it got there), the desk and the list. */
  private async deleteItem(item: Item): Promise<boolean> {
    if (item.upload) {
      try {
        await api.deleteUpload(item.upload.id);
      } catch (err) {
        toast(err instanceof ApiError ? err.message : 'Could not delete that photo', true);
        return false;
      }
      const list = this.app.store.consult?.uploads;
      const i = list?.findIndex((u) => u.id === item.upload!.id) ?? -1;
      if (list && i >= 0) list.splice(i, 1);
    }
    this.queue = this.queue.filter((q) => q !== item);
    if (item.paper) {
      const p = item.paper;
      this.scene.remove(p.mesh, p.mesh.userData.contact);
      p.dispose();
      this.papers = this.papers.filter((q) => q !== p);
    }
    if (item.view) URL.revokeObjectURL(item.view);
    this.items = this.items.filter((i) => i !== item);
    this.app.sfx.rustle(0.6);
    this.renderList();
    return true;
  }

  protected async load() {
    const still = await loadTexture(media('desk.webp'));
    this.backdrop.setImage(still, null);
    // The film swaps in once it can play; its first frame is the still, so the swap is invisible.
    loadVideo(media('desk-loop.mp4'))
      .then(({ video, texture }) => {
        this.plate = video;
        this.backdrop.setImage(texture, null);
        if (this.app.stage.active === this || this.app.stage.incoming === this) playVideo(video);
      })
      .catch(() => {});
    this.onResize(this.app.stage.size.width, this.app.stage.size.height);

    const r = this.app.stage.renderer;
    const shadows = this.app.stage.quality.shadows;
    // The plate's lamp, just above the top left of the frame: warm, with a soft-edged pool.
    const lamp = new THREE.SpotLight('#ffeedd', 1.5, 0, 0.95, 1, 2);
    lamp.position.copy(LAMP);
    lamp.target.position.set(-0.11, 0, -0.04);
    lamp.castShadow = shadows;
    lamp.shadow.mapSize.set(2048, 2048);
    lamp.shadow.bias = -0.0002;
    lamp.shadow.normalBias = 0.0015;
    lamp.shadow.radius = 3;
    Object.assign(lamp.shadow.camera, { near: 0.15, far: 2 });
    this.scene.add(lamp, lamp.target);
    // Faint fill: warm room above, a hint of green bounced off the leather below.
    this.scene.add(new THREE.HemisphereLight('#4a3424', '#1c2e1e', 0.12));
    this.scene.environment = studyEnvironment(r);
    this.scene.environmentIntensity = 0.7;

    // The filmed leather receives the 3D shadows.
    const catcher = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.6), new THREE.ShadowMaterial({ color: '#0b0603', opacity: 0.6 }));
    catcher.rotation.x = -Math.PI / 2;
    catcher.position.y = 0.0001;
    catcher.receiveShadow = true;
    this.scene.add(catcher);

    // Two blank sheets are always on the desk.
    for (let i = 0; i < 2; i++) this.addPaper(paperCanvas(null), 0);
  }

  /** Lays a sheet in the next slot; with `drop` it floats down from that height. */
  private addPaper(canvas: HTMLCanvasElement, drop: number): Paper {
    const n = this.papers.length;
    const [sx, sz] = SLOTS[n % SLOTS.length];
    const round = Math.floor(n / SLOTS.length);
    const jitter = round * 0.04;
    const center = new THREE.Vector3(sx + (Math.random() - 0.5) * jitter, 0, sz + (Math.random() - 0.5) * jitter);
    const angle = (Math.random() - 0.5) * 0.6;
    // Sheets overlapping earlier ones lie on top of them, and pin them down.
    const below = this.papers.filter((p) => p.mesh.userData.center.distanceTo(center) < 0.2);
    for (const p of below) p.covered = true;
    // One layer above the highest sheet it overlaps (not the count: a sheet over only the top of a pile
    // would otherwise share that sheet's height and clip into it).
    const under = below.reduce((m, b) => Math.max(m, b.layer + 1), 0);
    const p = new Paper(center, angle, under, canvas, drop);
    p.mesh.userData.center = center;
    const contact = contactShadow(center, angle, p.floor - 0.0002);
    p.mesh.userData.contact = contact.mesh;
    this.scene.add(contact.mesh, p.mesh);
    this.papers.push(p);
    if (drop > 0) {
      p.onLand = () => {
        contact.strength.value = 1;
        this.app.sfx.paperDrop();
      };
    } else contact.strength.value = 1;
    return p;
  }

  protected onEnter() {
    this.app.store.set({ step: 'desk' });
    if (this.plate) playVideo(this.plate);
    // Sheets for anything uploaded on an earlier visit, printed before they appear.
    const known = new Set(this.items.map((i) => i.upload?.id));
    for (const u of this.app.store.consult?.uploads ?? []) {
      if (known.has(u.id)) continue;
      const item: Item = { key: u.id, upload: u, paper: null, pill: this.pill(u.name), progress: 1 };
      this.items.push(item);
      void this.placeExisting(item);
    }
    this.renderList();
  }

  protected onExit() {
    this.plate?.pause();
    this.viewer?.remove();
    this.viewer = null;
  }

  private async placeExisting(item: Item) {
    let canvas: HTMLCanvasElement | null = null;
    if (item.upload?.hasThumb) {
      try {
        const res = await fetch(`/api/files/${item.upload.id}-thumb`);
        const blob = res.ok ? await res.blob() : null;
        const img = blob ? await decodePhoto(blob) : null;
        if (img && blob) {
          canvas = paperCanvas(img, img.width, img.height);
          item.pill.querySelector('img')?.setAttribute('src', URL.createObjectURL(blob));
        }
      } catch {
        /* printed as a label below */
      }
    }
    item.paper = this.addPaper(canvas ?? paperCanvas(null, 1, 1, item.upload?.name ?? 'Photo'), 0);
  }

  protected render() {
    this.input = h('input', {
      type: 'file',
      multiple: true,
      accept: 'image/*,.heic,.heif',
      style: { display: 'none' },
      onchange: () => {
        const files = [...(this.input?.files ?? [])];
        this.input!.value = '';
        this.addFiles(files);
      },
    });
    this.listEl = h('div', { class: 'file-list live' });
    this.statusEl = h('p', { class: 'upload-status', 'aria-live': 'polite' });
    this.primary = h('button', { class: 'btn btn--block live', onclick: () => this.input?.click() }, 'Upload references & body photos');
    this.secondary = h('button', { class: 'btn btn--ghost btn--block live', onclick: () => void this.next() }, 'Continue without references');
    return h(
      'section',
      { class: 'desk-screen' },
      h('div', null, h('span', { class: 'kicker' }, 'References'), h('h2', { class: 'title', style: { fontSize: 'clamp(34px,9vw,58px)' } }, 'Show me your', h('br'), h('span', { class: 'title--grad' }, 'vision')), h('p', { class: 'lede' }, 'Add reference images and photos of the area to be tattooed. Up to 50 MB each — choose them all at once.')),
      h('div', { style: { display: 'grid', gap: '10px' } }, this.listEl, this.statusEl, this.primary, this.secondary, this.input),
    );
  }

  private pill(name: string) {
    // Tapping a pill opens its photo too (the item is looked up when tapped: pills are made first).
    const pill: HTMLElement = h(
      'div',
      {
        class: 'file-pill live',
        role: 'button',
        tabindex: '0',
        'aria-label': `View ${name}`,
        onclick: (e: Event) => {
          if ((e.target as HTMLElement).closest('button')) return; // the retry button
          const item = this.items.find((i) => i.pill === pill);
          const r = pill.getBoundingClientRect();
          if (item) this.openViewer(item, r.left + r.width / 2, r.top + r.height / 2);
        },
      },
      h('img', { alt: '' }),
      h('span', null, name),
      h('div', { class: 'bar' }, h('i')),
    );
    return pill;
  }

  private addFiles(files: File[]) {
    const room = LIMITS.filesPerConsult - this.items.filter((i) => !i.failed).length;
    if (files.length > room) toast(`You can add ${room} more file${room === 1 ? '' : 's'}.`, true);
    for (const file of files.slice(0, Math.max(0, room))) {
      const item: Item = { key: `${file.name}-${file.size}-${Math.random()}`, file, paper: null, pill: this.pill(file.name), progress: 0 };
      this.items.push(item);
      if (file.size > LIMITS.fileBytes) {
        item.failed = 'Over 50 MB';
        item.pill.classList.add('is-bad');
        item.pill.querySelector('span')!.textContent = `${file.name} — over 50 MB`;
        continue;
      }
      this.queue.push(item);
      void this.preparePaper(item);
    }
    this.renderList();
    this.pump();
  }

  /** Prints the photo, then drops the printed sheet onto the desk; the upload carries on underneath. */
  private async preparePaper(item: Item) {
    const img = await decodePhoto(item.file!);
    const canvas = img ? paperCanvas(img, img.width, img.height) : paperCanvas(null, 1, 1, 'Photo received');
    item.paper = this.addPaper(canvas, 0.16);
    this.app.sfx.tick();
    // A small JPEG preview travels with the original (for the pill here and the artist's page).
    if (img) {
      img.toBlob(
        (blob) => {
          item.thumb = blob;
          if (blob) item.pill.querySelector('img')?.setAttribute('src', URL.createObjectURL(blob));
        },
        'image/jpeg',
        0.84,
      );
    } else item.thumb = null;
  }

  private pump() {
    while (this.active < 2 && this.queue.length) {
      const item = this.queue.shift()!;
      this.active++;
      void this.uploadOne(item).finally(() => {
        this.active--;
        this.pump();
        this.renderList();
      });
    }
    this.renderList();
  }

  private async uploadOne(item: Item) {
    // Wait briefly for the preview so it can travel with the original.
    for (let i = 0; i < 40 && item.thumb === undefined; i++) await new Promise((r) => setTimeout(r, 50));
    try {
      item.upload = await api.upload(item.file!, item.thumb ?? null, (k) => {
        item.progress = k;
        const bar = item.pill.querySelector('.bar i') as HTMLElement;
        bar.style.width = `${Math.round(k * 100)}%`;
      });
      item.progress = 1;
      if (this.app.store.consult) this.app.store.consult.uploads.push(item.upload);
    } catch (err) {
      item.failed = err instanceof ApiError ? err.message : 'Upload failed';
      item.pill.classList.add('is-bad');
      item.pill.append(h('button', { class: 'live', 'aria-label': 'Retry upload', onclick: () => this.retry(item) }, '↻'));
      toast(`${item.file?.name}: ${item.failed}`, true);
    }
  }

  private retry(item: Item) {
    item.failed = undefined;
    item.pill.classList.remove('is-bad');
    item.pill.querySelector('button')?.remove();
    this.queue.push(item);
    this.pump();
  }

  private renderList() {
    if (!this.listEl || !this.statusEl || !this.primary || !this.secondary) return;
    this.listEl.replaceChildren(...this.items.map((i) => i.pill));
    const done = this.items.filter((i) => i.upload).length;
    const busy = this.queue.length + this.active;
    this.statusEl.replaceChildren(
      busy ? h('span', null, 'Uploading ', h('b', null, `${done} of ${done + busy}`), '…') : done ? h('span', null, h('b', null, `${done}`), ` file${done === 1 ? '' : 's'} on the desk`) : '',
    );
    this.primary.textContent = done || busy ? 'Add more' : 'Upload references & body photos';
    this.primary.classList.toggle('btn--ghost', done > 0 && !busy);
    this.secondary.textContent = done || busy ? 'Continue' : 'Continue without references';
    this.secondary.classList.toggle('btn--ghost', !(done > 0 && !busy));
    this.secondary.disabled = busy > 0;
  }

  /** For tests: how far each sheet is currently lifted off the desk, in millimetres. */
  paperLifts() {
    return this.papers.map((p) => Math.round(p.maxLift() * 1000));
  }

  private async next() {
    if (this.queue.length || this.active) return;
    this.app.sfx.tick();
    await this.app.director.show(this.app.screen('summary'), { kind: 'push' });
  }

  update(dt: number, t: number) {
    this.time = t;
    this.fan.update(dt, this.aimYaw, 0.5);
    // The fan's hum follows its head as it swings (it stands right of centre).
    this.app.audio.pan('amb-fan', 0.3 + this.fan.swing * 0.35);
    const h2 = Math.min(dt, 1 / 30) / 2;
    let lift = 0;
    for (const p of this.papers) {
      for (let s = 0; s < 2; s++) p.step(h2, this.wind, this.time);
      // Collide with every sheet underneath (papers are kept in laying order, lower layers first).
      for (const q of this.papers) if (q.layer < p.layer && q.mesh.userData.center.distanceTo(p.mesh.userData.center) < 0.3) p.restOn(q);
      lift = Math.max(lift, p.maxLift());
    }
    // Paper crackles faintly while an edge is up in the air.
    const amount = THREE.MathUtils.clamp((lift - 0.002) / 0.008, 0, 1);
    this.rustleClock -= dt;
    if (amount > 0 && this.rustleClock <= 0) {
      this.app.sfx.rustle(amount);
      this.rustleClock = 0.04 + Math.random() * 0.1 / (amount + 0.25);
    }
  }

  protected onResize(w: number, h2: number) {
    // The plate fills the view (cover fit). When the view is wider than the plate its top and bottom
    // are cropped, so the lens narrows to match; when narrower, only the sides go and the lens stays.
    const plateAspect = this.backdrop.u.imageAspect.value;
    const ratio = w / h2 / plateAspect;
    const half = THREE.MathUtils.degToRad(CAM.vfov / 2);
    this.camera.fov = ratio > 1 ? THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(half) / ratio)) : CAM.vfov;
    this.camera.updateProjectionMatrix();
    this.backdrop.fit(this.camera);
  }
}
