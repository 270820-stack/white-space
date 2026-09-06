import * as THREE from "three";

const MAX = 8000;
const DURATION = 1.5;
const STREAMS_MIN = 4;
const STREAMS_MAX = 5;
const RATE = 22;
const BLUE = [
  [0.0, 0.32, 1.0],
  [0.05, 0.7, 1.0],
  [0.0, 0.45, 1.0],
  [0.12, 0.55, 1.0],
  [0.0, 0.22, 0.85],
];

const _local = new THREE.Vector3();
const _world = new THREE.Vector3();

function pickBlue() {
  return BLUE[(Math.random() * BLUE.length) | 0];
}

function rand(a, b) {
  return a + Math.random() * (b - a);
}

export function createGlitch(scene) {
  const positions = new Float32Array(MAX * 3);
  const colors = new Float32Array(MAX * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setDrawRange(0, 0);

  const material = new THREE.PointsMaterial({
    size: 1.8,
    vertexColors: true,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    sizeAttenuation: true,
    toneMapped: false,
    fog: false,
  });

  const points = new THREE.Points(geometry, material);
  points.name = "ReplaceGlitch";
  points.frustumCulled = false;
  points.renderOrder = 8;
  points.visible = false;
  scene.add(points);

  const pool = [];
  for (let i = 0; i < MAX; i++) {
    pool.push({
      alive: false,
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      life: 0,
      max: 1,
      colX: 0,
      colZ: 0,
      r: 0,
      g: 0.4,
      b: 1,
    });
  }
  let cursor = 0;
  const emitters = [];

  function nextParticle() {
    const start = cursor;
    do {
      const p = pool[cursor];
      cursor = (cursor + 1) % MAX;
      if (!p.alive) return p;
    } while (cursor !== start);
    return pool[cursor];
  }

  function spawnFrom(emitter) {
    _local.set(
      emitter.ox + (Math.random() - 0.5) * emitter.halfW,
      emitter.oy + (Math.random() - 0.5) * emitter.band,
      emitter.oz + (Math.random() - 0.5) * 0.015,
    );
    _world.copy(_local).applyMatrix4(emitter.matrix);
    const p = nextParticle();
    const rgb = pickBlue();
    p.alive = true;
    p.colX = _world.x;
    p.colZ = _world.z;
    p.x = _world.x;
    p.y = _world.y;
    p.z = _world.z;
    p.vx = (Math.random() - 0.5) * 0.03;
    p.vy = rand(5.5, 9.2);
    p.vz = (Math.random() - 0.5) * 0.03;
    p.max = rand(1.35, 1.7);
    p.life = p.max;
    p.r = rgb[0];
    p.g = rgb[1];
    p.b = rgb[2];
  }

  return {
    burstSigns(signs) {
      for (const sign of signs) {
        sign.updateMatrixWorld(true);
        const height = sign.userData.height || 1.7;
        const n = STREAMS_MIN + Math.floor(Math.random() * (STREAMS_MAX - STREAMS_MIN + 1));
        const delays = [];
        for (let s = 0; s < n; s++) delays.push(rand(0, 0.45));
        delays.sort((a, b) => a - b);
        delays[0] = 0;
        for (let s = 0; s < n; s++) {
          emitters.push({
            matrix: sign.matrixWorld.clone(),
            ox: rand(-0.18, 0.18) * height,
            oy: rand(0.22, 0.82) * height,
            oz: rand(-0.04, 0.04),
            halfW: 0.014 * height,
            band: 0.032 * height,
            delay: delays[s],
            left: DURATION,
            acc: 0,
            rate: rand(6, 11),
          });
        }
      }
      points.visible = true;
    },
    update(dt) {
      if (emitters.length === 0 && !points.visible) return;

      const step = Math.min(dt, 0.05);
      for (let i = emitters.length - 1; i >= 0; i--) {
        const emitter = emitters[i];
        if (emitter.delay > 0) {
          emitter.delay -= step;
          continue;
        }
        if (emitter.left > 0) {
          emitter.acc += emitter.rate * step;
          while (emitter.acc >= 1) {
            emitter.acc -= 1;
            spawnFrom(emitter);
          }
          emitter.left -= step;
        } else {
          emitters.splice(i, 1);
        }
      }

      let alive = 0;
      for (let i = 0; i < MAX; i++) {
        const p = pool[i];
        if (!p.alive) continue;
        p.life -= step;
        if (p.life <= 0) {
          p.alive = false;
          continue;
        }
        p.x += p.vx * step;
        p.y += p.vy * step;
        p.z += p.vz * step;
        if (Math.random() < 0.08) {
          p.x = p.colX + (Math.random() - 0.5) * 0.04;
          p.z = p.colZ + (Math.random() - 0.5) * 0.03;
        }
        const fadeIn = Math.min(1, (p.max - p.life) / 0.1);
        const fadeOut = Math.min(1, p.life / 0.28);
        const fade = fadeIn * fadeOut;
        const idx = alive * 3;
        positions[idx] = p.x;
        positions[idx + 1] = p.y;
        positions[idx + 2] = p.z;
        colors[idx] = p.r * fade;
        colors[idx + 1] = p.g * fade;
        colors[idx + 2] = p.b * fade;
        alive += 1;
      }
      geometry.setDrawRange(0, alive);
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.color.needsUpdate = true;
      points.visible = alive > 0 || emitters.length > 0;
    },
  };
}
