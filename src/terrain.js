import * as THREE from "three";

function edgeSwell(radius) {
  const u = Math.min(1, Math.max(0, (radius - 6) / 32));
  return u * u * (3 - 2 * u);
}

export function groundHeight(x, z) {
  const swell = 0.7 + 0.3 * edgeSwell(Math.hypot(x, z));
  const wave =
    Math.sin(x * 0.21 + 0.4) * Math.cos(z * 0.17 + 0.8) * 0.82 +
    Math.sin(x * 0.12 - z * 0.1 + 0.2) * 0.5 +
    Math.cos(z * 0.26 + x * 0.06) * 0.2;
  return wave * swell;
}

const SWAP_LO = -0.6;
const SWAP_HI = 0.8;
const EASE_IN = 0.7;
const EASE_OUT = 0.85;

let solidGeo = null;
let solidPos = null;
let wirePos = null;
let wireMat = null;
let restY = null;
let phase = 0;
let envelope = 0;
let mode = "idle";
let easeT = 0;
let easeFrom = 0;
let settleResolve = null;

function smoothstep(t) {
  const u = Math.max(0, Math.min(1, t));
  return u * u * (3 - 2 * u);
}

function waveUnit(x, z, p) {
  const a = Math.sin(x * 0.155 + p) * Math.cos(z * 0.132 + 0.6);
  const b = Math.sin(x * 0.072 - z * 0.118 + p * 0.62);
  const c = Math.cos(z * 0.09 + x * 0.04 - p * 0.38);
  const n = a * 0.56 + b * 0.5 + c * 0.28;
  return Math.max(-1, Math.min(1, n * 0.92));
}

function swapDisplacement(x, z) {
  if (envelope <= 1e-6) return 0;
  const u = waveUnit(x, z, phase);
  let d = (u < 0 ? u * -SWAP_LO : u * SWAP_HI) * envelope;
  if (d < SWAP_LO) d = SWAP_LO;
  if (d > SWAP_HI) d = SWAP_HI;
  return d;
}

export function liveGroundHeight(x, z) {
  return groundHeight(x, z) + swapDisplacement(x, z);
}

function paintLines(white) {
  if (!wireMat) return;
  wireMat.color.setHex(white ? 0xffffff : 0x000000);
}

function writeHeights(displaced) {
  if (!solidPos || !wirePos || !restY) return;
  const count = solidPos.count;
  if (displaced) {
    for (let i = 0; i < count; i++) {
      const y = restY[i] + swapDisplacement(solidPos.getX(i), solidPos.getZ(i));
      solidPos.setY(i, y);
      wirePos.setY(i, y + 0.02);
    }
  } else {
    for (let i = 0; i < count; i++) {
      const y = restY[i];
      solidPos.setY(i, y);
      wirePos.setY(i, y + 0.02);
    }
    solidGeo.computeVertexNormals();
  }
  solidPos.needsUpdate = true;
  wirePos.needsUpdate = true;
}

function finishSettle() {
  envelope = 0;
  mode = "idle";
  writeHeights(false);
  paintLines(false);
  const done = settleResolve;
  settleResolve = null;
  if (done) done();
}

export function beginTerrainSwap() {
  easeFrom = envelope;
  easeT = 0;
  mode = "in";
  paintLines(true);
}

export function endTerrainSwap() {
  if (mode === "idle" && envelope <= 1e-6) {
    finishSettle();
    return Promise.resolve();
  }
  easeFrom = envelope;
  easeT = 0;
  mode = "out";
  paintLines(true);
  return new Promise((resolve) => {
    settleResolve = resolve;
  });
}

export function updateTerrainSwap(dt) {
  if (mode === "idle") return;
  const step = Math.min(Math.max(dt, 0), 0.05);
  phase += step * 1.05;

  if (mode === "in") {
    easeT += step;
    const u = smoothstep(easeT / EASE_IN);
    envelope = easeFrom + (1 - easeFrom) * u;
    if (easeT >= EASE_IN) {
      envelope = 1;
      mode = "hold";
    }
    writeHeights(true);
    return;
  }

  if (mode === "hold") {
    envelope = 1;
    writeHeights(true);
    return;
  }

  easeT += step;
  const u = smoothstep(easeT / EASE_OUT);
  envelope = easeFrom * (1 - u);
  if (easeT >= EASE_OUT || envelope <= 1e-4) {
    finishSettle();
    return;
  }
  writeHeights(true);
}

export function createTerrain() {
  const geo = new THREE.PlaneGeometry(160, 160, 180, 180);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, groundHeight(pos.getX(i), pos.getZ(i)));
  }
  geo.computeVertexNormals();

  const solid = new THREE.Mesh(
    geo,
    new THREE.MeshLambertMaterial({ color: 0xffffff }),
  );
  solid.receiveShadow = true;
  solid.name = "Floor";

  const wireGeo = geo.clone();
  const wireAttr = wireGeo.attributes.position;
  for (let i = 0; i < wireAttr.count; i++) {
    wireAttr.setY(i, wireAttr.getY(i) + 0.02);
  }
  const wire = new THREE.Mesh(
    wireGeo,
    new THREE.MeshBasicMaterial({
      color: 0x000000,
      wireframe: true,
      transparent: true,
      opacity: 0.86,
      fog: true,
      depthWrite: false,
    }),
  );
  wire.name = "Landscape";
  wire.renderOrder = 2;

  solidGeo = geo;
  solidPos = pos;
  wirePos = wireAttr;
  wireMat = wire.material;
  restY = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) restY[i] = pos.getY(i);

  return { solid, wire };
}
