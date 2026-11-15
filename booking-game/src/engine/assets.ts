import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const textures = new Map<string, Promise<THREE.Texture>>();
const videos = new Map<string, Promise<{ video: HTMLVideoElement; texture: THREE.VideoTexture }>>();
const models = new Map<string, Promise<THREE.Group>>();
const texLoader = new THREE.TextureLoader();
const gltfLoader = new GLTFLoader();
gltfLoader.setMeshoptDecoder(MeshoptDecoder);

export const media = (name: string) => `/media/${name}`;

/** Loads (once) and returns a texture. Colour textures are sRGB; data maps such as depth are linear. */
export function loadTexture(url: string, { color = true, mips = true } = {}): Promise<THREE.Texture> {
  const key = `${url}|${color}|${mips}`;
  let p = textures.get(key);
  if (!p) {
    p = texLoader.loadAsync(url).then((t) => {
      t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.generateMipmaps = mips;
      t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.anisotropy = 4;
      return t;
    });
    textures.set(key, p);
    p.catch(() => textures.delete(key));
  }
  return p;
}

/** Muted, inline, looping video ready to use as a texture. Resolves once a frame is decodable. */
export function loadVideo(url: string): Promise<{ video: HTMLVideoElement; texture: THREE.VideoTexture }> {
  let p = videos.get(url);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.src = url;
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.crossOrigin = 'anonymous';
      video.setAttribute('webkit-playsinline', '');
      const done = () => {
        const texture = new THREE.VideoTexture(video);
        texture.colorSpace = THREE.SRGBColorSpace;
        resolve({ video, texture });
      };
      video.addEventListener('loadeddata', done, { once: true });
      video.addEventListener('error', () => reject(new Error(`video failed: ${url}`)), { once: true });
      video.load();
    });
    videos.set(url, p);
    p.catch(() => videos.delete(url));
  }
  return p;
}

export function loadModel(url: string): Promise<THREE.Group> {
  let p = models.get(url);
  if (!p) {
    p = gltfLoader.loadAsync(url).then((g) => g.scene);
    models.set(url, p);
    p.catch(() => models.delete(url));
  }
  return p;
}

/** Plays a video if the browser allows; muted inline video normally autoplays everywhere. */
export function playVideo(video: HTMLVideoElement) {
  const p = video.play();
  if (p) p.catch(() => {});
}
