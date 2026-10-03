import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { groundHeight, liveGroundHeight } from "./terrain.js?v=14";

const FIGURE_URLS = ["./assets/figures/figure-22.png"];
const MODEL_URL = "./assets/models/voxel-figure-low.glb";

const SIGN_COUNT = 50;
const MIN_RADIUS = 6;
const MAX_RADIUS = 40;
const MIN_SEPARATION = 3.5;
const HEIGHT_RANGE = [1.35, 5.6];
const GIANT_RANGE = [8, 14];
const BURIED_MAX = GIANT_RANGE[1] * 2;
const grommetMat = new THREE.MeshStandardMaterial({
  color: 0x454545,
  roughness: 0.42,
  metalness: 0.55,
});
const grommetGeo = new THREE.TorusGeometry(0.022, 0.007, 6, 12);

function pickLift(height, buried) {
  if (buried) return -(height * (0.38 + Math.random() * 0.16));
  return 0.32 + Math.random() * 0.9;
}

function pickTilt() {
  if (Math.random() < 0.5) return null;
  const angle = THREE.MathUtils.degToRad(5 + Math.random() * 11);
  const dir = Math.random() * Math.PI * 2;
  return { x: Math.sin(dir) * angle, z: Math.cos(dir) * angle };
}

function pickHeight(maxHeight = HEIGHT_RANGE[1]) {
  const lo = HEIGHT_RANGE[0];
  const span = maxHeight - lo;
  const u = Math.random();
  if (u < 0.34) return lo + Math.random() * span * 0.28;
  if (u > 0.66) return maxHeight - Math.random() * span * 0.28;
  return lo + span * (0.32 + Math.random() * 0.36);
}

function pickSpreadHeights(count, lo, hi) {
  if (count <= 0) return [];
  const span = hi - lo;
  if (count <= 1) return [lo + span * (0.2 + Math.random() * 0.6)];
  const heights = [];
  const gap = span / (count + 1);
  for (let i = 0; i < count; i++) {
    const center = lo + gap * (i + 1);
    const jitter = (Math.random() - 0.5) * gap * 0.5;
    heights.push(THREE.MathUtils.clamp(center + jitter, lo, hi));
  }
  heights.sort((a, b) => a - b);
  const minGap = 0.85;
  for (let i = 1; i < heights.length; i++) {
    if (heights[i] - heights[i - 1] < minGap) {
      heights[i] = Math.min(hi, heights[i - 1] + minGap);
    }
  }
  return heights;
}

function assignGiantHeights(pts) {
  if (!pts.length) return;
  const count = Math.min(pts.length, 1 + ((Math.random() * 4) | 0));
  const order = pts.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [order[i], order[j]] = [order[j], order[i]];
  }
  const buriedPts = [];
  const openPts = [];
  for (let i = 0; i < count; i++) {
    const pt = pts[order[i]];
    if (pt.buried) buriedPts.push(pt);
    else openPts.push(pt);
  }
  const buriedHeights = pickSpreadHeights(buriedPts.length, GIANT_RANGE[0], BURIED_MAX);
  const openHeights = pickSpreadHeights(openPts.length, GIANT_RANGE[0], GIANT_RANGE[1]);
  buriedPts.forEach((pt, i) => {
    pt.height = buriedHeights[i];
  });
  openPts.forEach((pt, i) => {
    pt.height = openHeights[i];
  });
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
        figure: pts.length % FIGURE_URLS.length,
      });
    }
  }
  const planted = pickSubset(pts.length, 0.5);
  for (let i = 0; i < pts.length; i++) {
    const level = planted.has(i);
    pts[i].planted = level;
    pts[i].buried = !level && Math.random() < 0.5;
    pts[i].height = pickHeight(pts[i].buried ? BURIED_MAX : HEIGHT_RANGE[1]);
  }
  assignGiantHeights(pts);
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

function pickSubset(count, chance) {
  const n = Math.round(count * chance);
  const order = Array.from({ length: count }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [order[i], order[j]] = [order[j], order[i]];
  }
  return new Set(order.slice(0, n));
}

function makePhotoMaterial(texture) {
  const mat = new THREE.MeshLambertMaterial({
    map: texture,
    color: 0xffffff,
    side: THREE.DoubleSide,
    toneMapped: false,
    transparent: true,
    alphaTest: 0.18,
  });
  mat.shadowSide = THREE.FrontSide;
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <opaque_fragment>",
      `float lit = dot( outgoingLight, vec3( 0.299, 0.587, 0.114 ) );
			float ref = max( dot( diffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) ), 0.04 );
			float shade = clamp( lit / ( ref * 0.42 ), 0.0, 1.0 );
			vec3 shaped = diffuseColor.rgb * mix( 0.32, 1.48, shade );
			gl_FragColor = vec4( shaped, diffuseColor.a );`,
    );
  };
  return mat;
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
  return { geometry, modelH, modelW, modelD, box: bb.clone() };
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
    const level = place.planted;
    const sign = new THREE.Group();
    sign.userData.lift = level ? 0 : pickLift(height, place.buried);
    sign.position.set(
      place.x,
      sign.userData.lift + groundHeight(place.x, place.z),
      place.z,
    );
    sign.rotation.y = place.yaw;
    const tilt = level ? null : pickTilt();
    if (tilt) {
      sign.rotation.x = tilt.x;
      sign.rotation.z = tilt.z;
    }
    sign.userData.height = height;
    sign.userData.aspect = model.modelW / model.modelH;
    sign.userData.fullHalfW = model.modelW * 0.5 * scale;
    sign.userData.halfW = sign.userData.fullHalfW;
    sign.userData.halfD = model.modelD * 0.5 * scale;

    const mat = makePhotoMaterial(texture);
    const mesh = new THREE.Mesh(model.geometry, mat);
    mesh.name = "Board";
    mesh.scale.setScalar(scale);
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    sign.add(mesh);

    const grommet = new THREE.Mesh(grommetGeo, grommetMat);
    grommet.position.set(0, height * 0.97, 0);
    grommet.rotation.x = Math.PI / 2;
    grommet.scale.setScalar(THREE.MathUtils.clamp(height / 2.7, 0.55, 1.85));
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
    sign.position.y = sign.userData.lift + liveGroundHeight(sign.position.x, sign.position.z);
    moved = true;
  }
  if (moved) group.updateMatrixWorld(true);
}

export function syncSignHeights(group) {
  if (!group) return;
  let moved = false;
  for (const sign of group.children) {
    const y = sign.userData.lift + liveGroundHeight(sign.position.x, sign.position.z);
    if (sign.position.y === y) continue;
    sign.position.y = y;
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
