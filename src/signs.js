import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const FIGURE_URLS = ["./assets/figures/figure-22.png"];
const MODEL_URL = "./assets/models/voxel-figure-low.glb";

const SIGN_COUNT = 50;
const MIN_RADIUS = 6;
const MAX_RADIUS = 40;
const MIN_SEPARATION = 2.8;
const HEIGHT_RANGE = [2.35, 3.55];
const grommetMat = new THREE.MeshStandardMaterial({
  color: 0x454545,
  roughness: 0.42,
  metalness: 0.55,
});
const grommetGeo = new THREE.TorusGeometry(0.022, 0.007, 6, 12);

function pickHeight() {
  const span = HEIGHT_RANGE[1] - HEIGHT_RANGE[0];
  const u = Math.random();
  if (u < 0.14) return HEIGHT_RANGE[0] + Math.random() * span * 0.22;
  if (u > 0.86) return HEIGHT_RANGE[1] - Math.random() * span * 0.22;
  return HEIGHT_RANGE[0] + span * 0.28 + Math.random() * span * 0.44;
}

function scatterPositions(count) {
  const pts = [];
  let attempts = 0;
  const minR2 = MIN_RADIUS * MIN_RADIUS;
  const maxR2 = MAX_RADIUS * MAX_RADIUS;
  const sep2 = MIN_SEPARATION * MIN_SEPARATION;

  while (pts.length < count && attempts < 8000) {
    attempts += 1;
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.sqrt(Math.random() * (maxR2 - minR2) + minR2);
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    if (pts.every((p) => (p.x - x) ** 2 + (p.z - z) ** 2 >= sep2)) {
      pts.push({
        x,
        z,
        yaw: Math.random() * Math.PI * 2,
        height: pickHeight(),
        figure: pts.length % FIGURE_URLS.length,
      });
    }
  }
  return pts;
}

function ensureUV(geometry, count) {
  let uv = geometry.getAttribute("uv");
  if (!uv || uv.count !== count) {
    uv = new THREE.BufferAttribute(new Float32Array(count * 2), 2);
    geometry.setAttribute("uv", uv);
  }
  return uv;
}

function setFrontPlanarUVs(geometry) {
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  const pos = geometry.getAttribute("position");
  const uv = ensureUV(geometry, pos.count);
  const x0 = bb.min.x;
  const y0 = bb.min.y;
  const sx = Math.max(1e-6, bb.max.x - bb.min.x);
  const sy = Math.max(1e-6, bb.max.y - bb.min.y);
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, (pos.getX(i) - x0) / sx, (pos.getY(i) - y0) / sy);
  }
  uv.needsUpdate = true;
  return bb;
}

function makePhotoMaterial(texture) {
  return new THREE.MeshBasicMaterial({
    map: texture,
    color: 0xffffff,
    side: THREE.DoubleSide,
    toneMapped: false,
    transparent: true,
    alphaTest: 0.18,
  });
}

function prepTexture(texture) {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function loadTexture(url) {
  const loader = new THREE.TextureLoader();
  return new Promise((resolve, reject) => {
    loader.load(url, (tex) => resolve(prepTexture(tex)), undefined, reject);
  });
}

async function loadVoxelGeometry() {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(MODEL_URL);
  let src = null;
  gltf.scene.traverse((obj) => {
    if (obj.isMesh && !src) src = obj;
  });
  if (!src) throw new Error("Voxel figure mesh missing");
  const geometry = src.geometry;
  geometry.computeVertexNormals();
  const bb = setFrontPlanarUVs(geometry);
  geometry.computeBoundingSphere();
  const modelH = Math.max(1e-6, bb.max.y - bb.min.y);
  const modelW = Math.max(1e-6, bb.max.x - bb.min.x);
  const modelD = Math.max(1e-6, bb.max.z - bb.min.z);
  return { geometry, modelH, modelW, modelD };
}

export async function createSigns(scene) {
  const [texture, model] = await Promise.all([loadTexture(FIGURE_URLS[0]), loadVoxelGeometry()]);

  const root = new THREE.Group();
  root.name = "Signs";
  root.userData.geometry = model.geometry;
  root.userData.modelH = model.modelH;
  root.userData.defaultTexture = texture;

  const placements = scatterPositions(SIGN_COUNT);

  for (let i = 0; i < placements.length; i++) {
    const place = placements[i];
    const height = place.height;
    const scale = height / model.modelH;
    const sign = new THREE.Group();
    sign.position.set(place.x, 0, place.z);
    sign.rotation.y = place.yaw;
    sign.userData.height = height;
    sign.userData.aspect = model.modelW / model.modelH;
    sign.userData.halfW = model.modelW * 0.5 * scale;
    sign.userData.halfD = model.modelD * 0.5 * scale;

    const mesh = new THREE.Mesh(model.geometry, makePhotoMaterial(texture));
    mesh.name = "Board";
    mesh.scale.setScalar(scale);
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    sign.add(mesh);

    const grommet = new THREE.Mesh(grommetGeo, grommetMat);
    grommet.position.set(0, height * 0.97, 0);
    grommet.rotation.x = Math.PI / 2;
    grommet.name = "Grommet";
    sign.add(grommet);

    root.add(sign);
  }

  scene.add(root);
  root.updateMatrixWorld(true);
  assignWalks(root.children);

  const anchors = [];
  for (const sign of root.children) {
    const attach = new THREE.Vector3(0, sign.userData.height * 0.97, 0);
    sign.localToWorld(attach);
    anchors.push(attach);
  }

  return { group: root, anchors };
}

function distPointSeg2(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-8) return (px - ax) ** 2 + (pz - az) ** 2;
  let t = ((px - ax) * dx + (pz - az) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  const x = ax + dx * t;
  const z = az + dz * t;
  return (px - x) ** 2 + (pz - z) ** 2;
}

function distSegSeg2(ax, az, bx, bz, cx, cz, dx, dz) {
  return Math.min(
    distPointSeg2(ax, az, cx, cz, dx, dz),
    distPointSeg2(bx, bz, cx, cz, dx, dz),
    distPointSeg2(cx, cz, ax, az, bx, bz),
    distPointSeg2(dx, dz, ax, az, bx, bz),
  );
}

function footRadius(sign) {
  return Math.max(sign.userData.halfW || 0.2, 0.2) + 0.22;
}

function assignWalks(signs) {
  const items = [...signs].map((sign) => ({
    sign,
    x: sign.position.x,
    z: sign.position.z,
    r: footRadius(sign),
  }));
  const walkers = [];
  for (let i = items.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [items[i], items[j]] = [items[j], items[i]];
  }
  const need = 10;
  const pad = 0.4;
  for (const item of items) {
    if (walkers.length >= need) break;
    let found = null;
    for (let t = 0; t < 28 && !found; t++) {
      const ang = Math.random() * Math.PI * 2;
      const half = 0.35 + Math.random() * 0.55;
      const ax = item.x - Math.cos(ang) * half;
      const az = item.z - Math.sin(ang) * half;
      const bx = item.x + Math.cos(ang) * half;
      const bz = item.z + Math.sin(ang) * half;
      const ar = Math.hypot(ax, az);
      const br = Math.hypot(bx, bz);
      if (ar < MIN_RADIUS || br < MIN_RADIUS || ar > MAX_RADIUS || br > MAX_RADIUS) continue;
      let ok = true;
      for (const other of items) {
        if (other === item) continue;
        const need2 = (item.r + other.r + pad) ** 2;
        const walk = other.sign.userData.walk;
        const d2 = walk
          ? distSegSeg2(ax, az, bx, bz, walk.ax, walk.az, walk.bx, walk.bz)
          : distPointSeg2(other.x, other.z, ax, az, bx, bz);
        if (d2 < need2) {
          ok = false;
          break;
        }
      }
      if (ok) {
        found = {
          ax,
          az,
          bx,
          bz,
          phase: Math.random() * Math.PI * 2,
          speed: 0.14 + Math.random() * 0.09,
          moving: Math.random() > 0.45,
          wait: 0.4 + Math.random() * 3.5,
        };
      }
    }
    if (found) {
      item.sign.userData.walk = found;
      walkers.push(item);
    }
  }
}

function nextWalkWait(moving) {
  return moving ? 1.6 + Math.random() * 5.2 : 1.1 + Math.random() * 4.8;
}

export function updateSigns(group, dt) {
  let moved = false;
  for (const sign of group.children) {
    const walk = sign.userData.walk;
    if (!walk) continue;
    walk.wait -= dt;
    if (walk.wait <= 0) {
      walk.moving = !walk.moving;
      walk.wait = nextWalkWait(walk.moving);
    }
    if (!walk.moving) continue;
    walk.phase += walk.speed * dt;
    const u = 0.5 - 0.5 * Math.cos(walk.phase);
    sign.position.x = walk.ax + (walk.bx - walk.ax) * u;
    sign.position.z = walk.az + (walk.bz - walk.az) * u;
    moved = true;
  }
  if (moved) group.updateMatrixWorld(true);
}

function liveMaps(group) {
  const used = new Set();
  for (const sign of group.children) {
    const mesh = sign.getObjectByName("Board");
    if (mesh?.material?.map) used.add(mesh.material.map);
  }
  return used;
}

export function pickSwapSigns(group, count) {
  const signs = [...group.children];
  for (let i = signs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [signs[i], signs[j]] = [signs[j], signs[i]];
  }
  const n = Math.max(1, Math.min(count, signs.length));
  return signs.slice(0, n);
}

export async function applyDroppedFigure(group, event, targets) {
  let texture;
  if (event.canvas) {
    texture = prepTexture(new THREE.CanvasTexture(event.canvas));
  } else {
    const src = event.src.startsWith("blob:") || event.src.startsWith("data:")
      ? event.src
      : `${event.src}?v=${event.id}`;
    texture = await loadTexture(src);
  }
  const previous = liveMaps(group);
  const signs = targets && targets.length ? targets : pickSwapSigns(group, event.count);
  const replaced = [];
  for (let i = 0; i < signs.length; i++) {
    const sign = signs[i];
    const mesh = sign.getObjectByName("Board");
    if (!mesh || !mesh.material) continue;
    mesh.material.map = texture;
    mesh.material.needsUpdate = true;
    replaced.push(sign);
  }
  const keep = liveMaps(group);
  keep.add(group.userData.defaultTexture);
  for (const map of previous) {
    if (!keep.has(map)) map.dispose();
  }
  return replaced;
}
