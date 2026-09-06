import * as THREE from "three";

const RED = 0xff1a1a;
const GREEN = 0x1ee85a;
const FADE_IN = 0.05;
const FADE_OUT = 0.22;

function makeBoxGeometry() {
  const hw = 0.5;
  const hh = 0.5;
  const t = 0.11;
  const positions = new Float32Array([
    -hw, -hh, 0, hw, -hh, 0,
    hw, -hh, 0, hw, hh, 0,
    hw, hh, 0, -hw, hh, 0,
    -hw, hh, 0, -hw, -hh, 0,
    -hw, -hh, 0, -hw + t, -hh, 0,
    -hw, -hh, 0, -hw, -hh + t, 0,
    hw, -hh, 0, hw - t, -hh, 0,
    hw, -hh, 0, hw, -hh + t, 0,
    hw, hh, 0, hw - t, hh, 0,
    hw, hh, 0, hw, hh - t, 0,
    -hw, hh, 0, -hw + t, hh, 0,
    -hw, hh, 0, -hw, hh - t, 0,
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return geometry;
}

const sharedEdge = makeBoxGeometry();
const sharedFill = new THREE.PlaneGeometry(1, 1);

function makeItem() {
  const root = new THREE.Group();
  const fill = new THREE.Mesh(
    sharedFill,
    new THREE.MeshBasicMaterial({
      color: RED,
      transparent: true,
      opacity: 0.07,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    }),
  );
  const edge = new THREE.LineSegments(
    sharedEdge,
    new THREE.LineBasicMaterial({
      color: RED,
      transparent: true,
      opacity: 1,
      toneMapped: false,
      fog: false,
    }),
  );
  fill.renderOrder = 6;
  edge.renderOrder = 7;
  root.add(fill, edge);
  root.visible = false;
  return { root, fill, edge, sign: null };
}

function tint(item, hex) {
  item.fill.material.color.setHex(hex);
  item.edge.material.color.setHex(hex);
}

export function createSelectBoxes(scene) {
  const group = new THREE.Group();
  group.name = "SelectBoxes";
  scene.add(group);
  const pool = [];
  let fade = 0;
  let fadeDir = 0;

  function show(signs) {
    while (pool.length < signs.length) {
      const item = makeItem();
      group.add(item.root);
      pool.push(item);
    }
    for (let i = 0; i < pool.length; i++) {
      const item = pool[i];
      item.sign = signs[i] || null;
      item.root.visible = !!item.sign;
      if (item.sign) tint(item, RED);
    }
    fadeDir = 1;
    fade = Math.max(fade, 0.2);
  }

  function confirm() {
    for (const item of pool) {
      if (item.sign) tint(item, GREEN);
    }
    fadeDir = 1;
    fade = 1;
  }

  function hide() {
    fadeDir = -1;
    if (fade <= 0.01) {
      for (const item of pool) {
        item.sign = null;
        item.root.visible = false;
      }
      fadeDir = 0;
      fade = 0;
    }
  }

  function update(dt, camera) {
    if (fadeDir > 0) fade = Math.min(1, fade + dt / FADE_IN);
    else if (fadeDir < 0) fade = Math.max(0, fade - dt / FADE_OUT);
    if (fade <= 0 && fadeDir < 0) {
      for (const item of pool) {
        item.sign = null;
        item.root.visible = false;
      }
      fadeDir = 0;
    }
    const pulse = 0.82 + 0.18 * Math.sin(performance.now() * 0.011);
    for (const item of pool) {
      const sign = item.sign;
      if (!sign) continue;
      const h = sign.userData.height || 2.8;
      const w = Math.max((sign.userData.halfW || 0.22) * 2.55, h * 0.36);
      item.root.position.set(sign.position.x, h * 0.5, sign.position.z);
      item.root.scale.set(w, h * 1.06, 1);
      item.root.lookAt(camera.position.x, item.root.position.y, camera.position.z);
      item.root.visible = fade > 0.01;
      item.fill.material.opacity = 0.055 * fade;
      item.edge.material.opacity = fade * pulse;
    }
  }

  return { show, confirm, hide, update };
}
