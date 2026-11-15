// Placement: the client turns and zooms the live 3D body and taps the areas
// they want tattooed. Selected areas light up in ink colours.
import * as THREE from 'three/webgpu';
import { pass, mrt, normalView, screenUV, builtinAOContext } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { BaseScreen } from './base';
import { buildStudio } from './studio';
import { Character } from '../character/character';
import { BodyOrbit } from '../character/orbit';
import { h } from '../ui/dom';
import { REGIONS, REGION_INDEX } from '../../shared/catalog.mjs';
import type { App } from '../app/context';

const label = (id: string) => REGIONS[REGION_INDEX.get(id)!]?.label ?? id;
let hintSeen = false;

export class BodyScreen extends BaseScreen {
  readonly id = 'body' as const;
  character: Character | null = null;
  private orbit: BodyOrbit;
  private raycaster = new THREE.Raycaster();
  private chips: HTMLElement | null = null;
  private continueBtn: HTMLButtonElement | null = null;
  private hint: HTMLElement | null = null;
  private post: { quad: THREE.QuadMesh; passes: THREE.PassNode[] } | null = null;

  constructor(app: App) {
    super(app, 30);
    buildStudio(this.scene, app.stage.renderer, app.stage.quality.shadows);
    this.orbit = new BodyOrbit(this.camera, app.stage.renderer.domElement, { minDistance: 0.55, maxDistance: 4, minY: 0.2, maxY: 1.6 });
    this.orbit.enabled = false;
    this.orbit.onTap = (x, y) => this.tap(x, y);
    this.orbit.onDoubleTap = (x, y) => this.focusAt(x, y);
    this.orbit.onInteract = () => this.dismissHint();
  }

  protected async load() {
    const gender = this.app.store.consult?.gender ?? 'female';
    const c = await Character.load(gender);
    // Compile shaders before the first frame so the transition does not hitch.
    await this.app.stage.renderer.compileAsync(c.root, this.camera, this.scene).catch(() => {});
  }

  preload() {
    // The body depends on the chosen gender, so reload when it changes.
    const want = this.app.store.consult?.gender ?? 'female';
    if (this.character && this.character.gender !== want) this.resetLoad();
    return super.preload();
  }

  protected onEnter() {
    const gender = this.app.store.consult?.gender ?? 'female';
    void Character.load(gender).then((c) => {
      if (this.character && this.character !== c) this.scene.remove(this.character.root);
      this.character = c;
      c.root.rotation.set(0, 0, 0);
      c.root.position.set(0, 0, 0);
      c.u.strength.value = 1;
      c.u.zoneLines.value = 0.35;
      this.scene.add(c.root);
      c.setSelected(this.app.store.consult?.regions ?? []);
      this.orbit.turntable = c.root;
      this.frame(true);
      this.renderChips();
    });
    this.orbit.enabled = true;
    this.app.store.set({ step: 'body' });
  }

  protected onExit() {
    if (this.character) this.character.u.zoneLines.value = 0;
    this.orbit.enabled = false;
    this.orbit.turntable = null;
  }

  protected render() {
    this.chips = h('div', { class: 'chips', 'aria-live': 'polite' });
    this.continueBtn = h('button', { class: 'btn btn--block live', disabled: true, onclick: () => void this.next() }, 'Continue');
    const view = (label: string, yaw: number) =>
      h('button', { class: 'chip live', onclick: () => (this.app.sfx.tick(), this.orbit.flyTo({ yaw })) }, label);
    const root = h(
      'section',
      { class: 'body-screen' },
      h(
        'div',
        { class: 'body-top' },
        h('div', null, h('span', { class: 'kicker' }, 'Placement'), h('h2', { class: 'title', style: { fontSize: 'clamp(34px,9vw,60px)' } }, 'Mark your', h('br'), h('span', { class: 'title--grad' }, 'areas'))),
        h('div', { class: 'view-toggle' }, view('Front', 0), view('Back', Math.PI), h('button', { class: 'chip live', onclick: () => this.frame(false) }, 'Reset')),
      ),
      h('div', { class: 'body-bottom' }, this.chips, this.continueBtn),
    );
    if (!hintSeen) {
      this.hint = h(
        'div',
        { class: 'hint live', role: 'dialog', 'aria-label': 'How to choose areas' },
        h('h3', null, 'Find your spot'),
        h(
          'ul',
          null,
          h('li', null, h('i', null, '↔'), 'Drag to turn the body, up and down to move along it'),
          h('li', null, h('i', null, '⤢'), 'Pinch to zoom into a limb'),
          h('li', null, h('i', null, '●'), 'Tap an area to mark it. Tap again to remove it'),
          h('li', null, h('i', null, '⧉'), 'Double-tap to zoom in or out'),
        ),
        h('button', { class: 'btn btn--block', onclick: () => this.dismissHint() }, 'Got it'),
      );
      root.append(this.hint);
    }
    return root;
  }

  private dismissHint() {
    if (!this.hint) return;
    hintSeen = true;
    const el = this.hint;
    this.hint = null;
    el.classList.add('is-gone');
    setTimeout(() => el.remove(), 400);
  }

  /** Full-body framing that fits portrait phones and wide screens alike. */
  private frame(snap: boolean) {
    const c = this.character;
    if (!c) return;
    const H = c.meta.height;
    const halfFov = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const dv = (H * 0.62) / Math.tan(halfFov);
    const dh = (0.62 * 1.15) / (Math.tan(halfFov) * this.camera.aspect);
    const dist = Math.max(dv, dh);
    this.orbit.limits = { minDistance: 0.5, maxDistance: dist, minY: 0.15, maxY: H * 0.95 };
    this.orbit.flyTo({ yaw: 0, pitch: 0.05, distance: dist, targetY: H * 0.5, targetX: 0 });
    if (snap) this.orbit.snap();
  }

  /** Surface point under the finger (for double-tap zoom). */
  private surfaceAt(x: number, y: number) {
    const c = this.character;
    if (!c) return null;
    const ndc = new THREE.Vector2((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.intersectObject(c.mesh, false)[0] ?? null;
  }

  /** Zone under the finger, read from the same shader that draws the zones. */
  async zoneAt(x: number, y: number) {
    const c = this.character;
    if (!c) return null;
    return c.pick(this.app.stage.renderer, this.camera, x, y, innerWidth, innerHeight);
  }

  private async tap(x: number, y: number) {
    if (this.hint) return;
    const c = this.character;
    const id = await this.zoneAt(x, y);
    if (!id || !c) return;
    const on = c.toggle(id);
    this.app.sfx.tick();
    navigator.vibrate?.(on ? 12 : [6, 30, 6]);
    this.popLabel(x, y, `${label(id)} ${on ? '✓' : '— removed'}`);
    this.commit();
  }

  private focusAt(x: number, y: number) {
    if (this.orbit.zoomedIn) return this.frame(false);
    const hit = this.surfaceAt(x, y);
    if (!hit) return;
    this.orbit.flyTo({ distance: 1.05, targetY: hit.point.y, targetX: hit.point.x * 0.8 });
  }

  private popLabel(x: number, y: number, text: string) {
    const el = h('div', { class: 'region-pop', style: { left: `${x}px`, top: `${y}px` } }, text);
    this.dom?.append(el);
    setTimeout(() => el.remove(), 1300);
  }

  private commit() {
    const ids = [...(this.character?.selected ?? [])];
    this.app.store.set({ regions: ids });
    this.renderChips();
  }

  private renderChips() {
    if (!this.chips || !this.continueBtn) return;
    const ids = [...(this.character?.selected ?? [])].sort((a, b) => REGION_INDEX.get(a)! - REGION_INDEX.get(b)!);
    this.chips.replaceChildren(
      ...(ids.length
        ? ids.map((id) =>
            h(
              'button',
              {
                class: 'chip is-on live',
                'aria-label': `Remove ${label(id)}`,
                onclick: () => {
                  this.character?.toggle(id);
                  this.commit();
                },
              },
              label(id),
              h('b', null, '×'),
            ),
          )
        : [h('span', { class: 'lede', style: { margin: 0 } }, 'Tap the body to mark where you want your tattoo.')]),
    );
    this.continueBtn.disabled = ids.length === 0;
  }

  private async next() {
    const c = this.character;
    if (!c || !c.selected.size) return;
    this.app.sfx.tick();
    void this.app.store.flush().catch(() => {});
    const ids = [...c.selected].sort((a, b) => REGION_INDEX.get(a)! - REGION_INDEX.get(b)!);
    const more = ids.length > 4 ? [`+ ${ids.length - 4} more`] : [];
    await this.app.director.show(this.app.screen('theme'), {
      kind: 'ink',
      freeze: {
        name: label(ids[0]),
        tape: `${ids.length} area${ids.length > 1 ? 's' : ''} marked`,
        lines: [...ids.slice(1, 4).map(label), ...more],
        hold: 1.7,
      },
    });
  }

  update(dt: number) {
    this.orbit.update(dt);
    this.character?.update(dt);
  }

  /**
   * Static scene, so it can afford more than the others: a depth+normal pre-pass feeds
   * ground-truth ambient occlusion (GTAO), applied to the soft studio light only, so
   * armpits, fingers, creases and the feet on the floor darken the way they do in a photo.
   */
  renderTo(renderer: THREE.WebGPURenderer, target: THREE.RenderTarget) {
    if (this.app.stage.quality.msaa === 0) {
      // Low tier: skip the extra passes.
      renderer.setRenderTarget(target);
      renderer.render(this.scene, this.camera);
      return;
    }
    if (!this.post) {
      const prePass = pass(this.scene, this.camera);
      prePass.setMRT(mrt({ output: normalView }));
      const aoNode = ao(prePass.getTextureNode('depth'), prePass.getTextureNode(), this.camera);
      aoNode.resolutionScale = 0.5;
      aoNode.radius.value = 0.16;
      const scenePass = pass(this.scene, this.camera, { samples: this.app.stage.quality.msaa });
      scenePass.contextNode = builtinAOContext(aoNode.getTextureNode().sample(screenUV).r);
      const material = new THREE.NodeMaterial();
      material.fragmentNode = scenePass;
      this.post = { quad: new THREE.QuadMesh(material), passes: [prePass, scenePass] };
    }
    const s = this.app.stage.renderScale;
    for (const p of this.post.passes) if (Math.abs(p.getResolutionScale() - s) > 0.01) p.setResolutionScale(s);
    renderer.setRenderTarget(target);
    this.post.quad.render(renderer);
  }

  protected onResize() {
    if (this.app.stage.active === this) this.frame(false);
  }
}
