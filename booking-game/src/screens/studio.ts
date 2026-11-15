// The photo studio the 3D body stands in. Light comes mostly from large
// softboxes captured into an environment map (image-based lighting), the way
// a real portrait studio lights skin: broad, soft and directional. One spot
// light adds the key shadow and crisp highlights, and two rim spots backlight
// the silhouette so the skin's subsurface glow shows at the edges.
import * as THREE from 'three/webgpu';
import { Fn, screenUV, mix, color, smoothstep, length, vec2, uv, float, vec4, positionWorld, normalize, reflector, exp, abs } from 'three/tsl';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

let roomEnv: THREE.Texture | null = null;
/** Neutral room reflections, used by the desk and theme stages. */
export function environment(renderer: THREE.WebGPURenderer) {
  if (!roomEnv) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    roomEnv = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  }
  return roomEnv;
}

let studioEnv: THREE.Texture | null = null;
/** A dark studio with real softboxes, as an environment map for photographic skin lighting. */
export function softboxEnvironment(renderer: THREE.WebGPURenderer) {
  if (studioEnv) return studioEnv;
  const env = new THREE.Scene();
  // Dark room: a hint of warm floor bounce below, near-black walls and ceiling.
  const roomMat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide });
  roomMat.colorNode = Fn(() => {
    const up = normalize(positionWorld).y;
    return mix(color('#2a1a16').mul(0.09), color('#0d0b10').mul(0.035), smoothstep(-0.3, 0.2, up));
  })();
  env.add(new THREE.Mesh(new THREE.SphereGeometry(14, 48, 24), roomMat));
  const panel = (w: number, h: number, pos: [number, number, number], tint: string, strength: number, round = false) => {
    const m = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    // Softboxes are brightest in the middle and fall off toward the edges.
    m.colorNode = color(tint).mul(strength).mul(round ? smoothstep(0.5, 0.15, length(uv().sub(0.5))) : smoothstep(0.0, 0.18, uv().x).mul(smoothstep(1.0, 0.82, uv().x)).mul(smoothstep(0.0, 0.1, uv().y)).mul(smoothstep(1.0, 0.9, uv().y)).mul(0.6).add(0.4));
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
    mesh.position.set(...pos);
    mesh.lookAt(0, 1.0, 0);
    env.add(mesh);
  };
  // Matches the character-select film: warm amber key from the viewer's upper left,
  // a magenta-violet rim from behind on the right, a low warm glow on the back wall.
  panel(1.9, 2.5, [-2.4, 2.7, 2.6], '#ffd9b0', 6.2); // key: large warm softbox, viewer's upper left
  panel(2.4, 2.4, [3.4, 1.3, 1.8], '#b9a8d8', 0.35); // fill: dim, cool violet, opposite side
  panel(0.5, 3.0, [2.4, 1.7, -2.6], '#e04aa8', 5.0); // rim strip: magenta-violet, back-right
  panel(3.2, 0.5, [-0.4, 0.4, -3.2], '#ff8a3d', 1.2); // low warm glow on the back wall
  panel(2.2, 2.2, [0, 4.4, 0.6], '#fff4e6', 0.6, true); // overhead: soft top light
  const pmrem = new THREE.PMREMGenerator(renderer);
  studioEnv = pmrem.fromScene(env, 0.015).texture;
  return studioEnv;
}

export interface StudioLights {
  key: THREE.SpotLight;
  rimA: THREE.SpotLight;
  rimB: THREE.SpotLight;
}

export function buildStudio(scene: THREE.Scene, renderer: THREE.WebGPURenderer, shadows: boolean): StudioLights {
  scene.environment = softboxEnvironment(renderer);
  scene.environmentIntensity = 1.0;
  scene.backgroundNode = Fn(() => {
    const st = screenUV; // top-left origin
    // Warm amber haze falling from the upper left, as in the film.
    const haze = smoothstep(0.75, 0.0, length(st.sub(vec2(0.05, 0.12)).mul(vec2(1.0, 1.5))));
    // Low glow on the back wall behind the legs, orange fading to magenta on the right.
    const band = exp(abs(st.y.sub(0.71)).div(0.025).pow(2).negate()).mul(smoothstep(0.6, 0.1, abs(st.x.sub(0.45))));
    const bandCol = mix(color('#d0662a'), color('#a43c78'), smoothstep(0.3, 0.9, st.x));
    const violet = smoothstep(1.0, 0.3, length(st.sub(vec2(0.95, 0.35)))).mul(0.5);
    const base = color('#030204')
      .add(color('#5a3016').mul(haze.mul(haze)).mul(0.22))
      .add(color('#24123a').mul(violet).mul(0.25))
      .add(bandCol.mul(band).mul(0.16));
    return vec4(base, 1);
  })();

  // Glossy black studio floor that fades into the dark.
  // Polished black floor with a real (slightly soft) mirror reflection of the body, as in the film.
  const reflection = reflector({ resolutionScale: 0.5 });
  reflection.target.rotateX(-Math.PI / 2);
  scene.add(reflection.target);
  // Black lacquer: the surface itself stays black; only the mirror image of the body shows in it.
  const floorMat = new THREE.MeshStandardNodeMaterial({ color: '#000000', roughness: 1, metalness: 0, transparent: true });
  floorMat.envNode = color('#000000');
  const fade = smoothstep(0.5, 0.12, length(uv().sub(0.5)));
  floorMat.opacityNode = fade;
  floorMat.emissiveNode = reflection.rgb.mul(0.28).mul(fade);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(2.6, 64), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Key: matches the softbox direction; gives the body its shadow and a crisp specular.
  const key = new THREE.SpotLight('#ffd8b0', 26, 14, 0.55, 0.9, 2);
  key.position.set(-2.4, 3.5, 2.9);
  key.target.position.set(0, 0.95, 0);
  key.castShadow = shadows;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0003;
  key.shadow.normalBias = 0.015;
  key.shadow.radius = 4;
  key.shadow.camera.near = 1.5;
  key.shadow.camera.far = 9;
  scene.add(key, key.target);

  // Rims: backlight the silhouette (this is what drives the skin's subsurface glow).
  const rimA = new THREE.SpotLight('#e04aa8', 14, 12, 0.6, 1, 2);
  rimA.position.set(2.2, 2.7, -2.8);
  rimA.target.position.set(0, 1.1, 0);
  const rimB = new THREE.SpotLight('#ff8a3d', 7, 12, 0.7, 1, 2);
  rimB.position.set(-2.0, 1.0, -2.6);
  rimB.target.position.set(0, 1.0, 0);
  scene.add(rimA, rimA.target, rimB, rimB.target);
  return { key, rimA, rimB };
}
