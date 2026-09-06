import * as THREE from "three";

const MAX = 4200;
const DURATION = 2.2;
const COLUMNS_MIN = 5;
const COLUMNS_MAX = 8;

const LIGHT = [
  [0.96, 0.96, 0.97],
  [0.9, 0.91, 0.93],
  [0.84, 0.87, 0.91],
  [0.78, 0.86, 0.94],
  [0.92, 0.94, 0.97],
  [0.88, 0.9, 0.92],
];

const ACCENT = [
  [0.1, 0.38, 0.98],
  [0.18, 0.52, 1.0],
  [0.98, 0.42, 0.08],
  [0.98, 0.78, 0.16],
  [0.22, 0.82, 0.38],
  [0.95, 0.22, 0.28],
];

const _world = new THREE.Vector3();
const _color = new THREE.Color();

function rand(a, b) {
  return a + Math.random() * (b - a);
}

function pickColor() {
  const u = Math.random();
  if (u < 0.82) return LIGHT[(Math.random() * LIGHT.length) | 0];
  if (u < 0.93) return [0.7 + Math.random() * 0.18, 0.82 + Math.random() * 0.12, 0.94];
  return ACCENT[(Math.random() * ACCENT.length) | 0];
}

function pickRise() {
  const u = Math.random();
  if (u < 0.62) return { life: rand(0.32, 0.7), rise: rand(1.8, 4.2) };
  if (u < 0.88) return { life: rand(0.7, 1.25), rise: rand(4.5, 8.5) };
  return { life: rand(1.6, 2.5), rise: rand(10, 16) };
}

export function createGlitch(scene) {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = new THREE.MeshBasicMaterial({
    toneMapped: false,
    fog: false,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      "#include <project_vertex>",
      `
			vec3 ipos = vec3( instanceMatrix[3] );
			float iw = length( instanceMatrix[0].xyz );
			float ih = length( instanceMatrix[1].xyz );
			vec3 right = vec3( viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0] );
			vec3 world = ipos + right * position.x * iw + vec3( 0.0, position.y * ih, 0.0 );
			vec4 mvPosition = viewMatrix * vec4( world, 1.0 );
			gl_Position = projectionMatrix * mvPosition;
			`,
    );
  };
  material.customProgramCacheKey = () => "glitch-slivers2";

  const mesh = new THREE.InstancedMesh(geometry, material, MAX);
  mesh.name = "ReplaceGlitch";
  mesh.frustumCulled = false;
  mesh.renderOrder = 8;
  mesh.count = 0;
  mesh.visible = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < MAX; i++) mesh.setColorAt(i, _color.setRGB(1, 1, 1));
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  scene.add(mesh);

  const matArr = mesh.instanceMatrix.array;
  const colArr = mesh.instanceColor.array;

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
      w: 0.01,
      h: 0.04,
      life: 0,
      max: 1,
      y0: 0,
      rise: 4,
      colX: 0,
      r: 1,
      g: 1,
      b: 1,
    });
  }
  let cursor = 0;
  const live = [];
  const emitters = [];

  function nextParticle() {
    if (live.length >= MAX) return null;
    const start = cursor;
    do {
      const p = pool[cursor];
      cursor = (cursor + 1) % MAX;
      if (!p.alive) return p;
    } while (cursor !== start);
    return null;
  }

  function spawnRect(x, y, z, w, h, rgb) {
    const p = nextParticle();
    if (!p) return;
    const span = pickRise();
    p.alive = true;
    p.colX = x;
    p.x = x;
    p.y = y;
    p.z = z;
    p.y0 = y;
    p.rise = span.rise;
    p.w = w;
    p.h = h;
    p.vx = (Math.random() - 0.5) * 0.03;
    p.vy = rand(5.5, 9.2);
    p.vz = (Math.random() - 0.5) * 0.03;
    p.max = span.life;
    p.life = span.life;
    p.r = rgb[0];
    p.g = rgb[1];
    p.b = rgb[2];
    live.push(p);
  }

  function spawnFrom(emitter) {
    const h = emitter.height;
    const cluster = emitter.clusters[(Math.random() * emitter.clusters.length) | 0];
    const tight = Math.random() < 0.72;
    const lx = tight ? cluster.x + (Math.random() - 0.5) * emitter.tightW : rand(-0.42, 0.42) * h;
    const ly = tight ? cluster.y + (Math.random() - 0.5) * emitter.tightH : rand(0.04, 0.96) * h;
    const lz = cluster.z + (Math.random() - 0.5) * 0.03;
    _world.set(lx, ly, lz).applyMatrix4(emitter.matrix);

    const slim = Math.random() < 0.78;
    const rw = slim ? rand(0.007, 0.022) * h : rand(0.022, 0.052) * h;
    const rh = slim ? rand(0.035, 0.18) * h : rand(0.16, 0.52) * h;
    spawnRect(_world.x, _world.y, _world.z, rw, rh, pickColor());
  }

  function spawnColumn(emitter) {
    const h = emitter.height;
    const cluster = emitter.clusters[(Math.random() * emitter.clusters.length) | 0];
    const lx = cluster.x + (Math.random() - 0.5) * emitter.tightW * 0.7;
    const lz = cluster.z + (Math.random() - 0.5) * 0.02;
    let ly = cluster.y + rand(-0.18, 0.08) * h;
    const n = 4 + ((Math.random() * 7) | 0);
    const rgb = Math.random() < 0.14 ? ACCENT[(Math.random() * ACCENT.length) | 0] : pickColor();
    const w = rand(0.006, 0.02) * h;
    for (let i = 0; i < n; i++) {
      const rh = rand(0.028, 0.14) * h;
      _world.set(lx + (Math.random() - 0.5) * 0.006 * h, ly + rh * 0.5, lz).applyMatrix4(emitter.matrix);
      spawnRect(_world.x, _world.y, _world.z, w * rand(0.7, 1.3), rh, Math.random() < 0.88 ? rgb : pickColor());
      ly += rh + rand(0, 0.006) * h;
    }
  }

  return {
    burstSigns(signs) {
      for (const sign of signs) {
        sign.updateMatrixWorld(true);
        const height = sign.userData.height || 1.7;
        const n = COLUMNS_MIN + ((Math.random() * (COLUMNS_MAX - COLUMNS_MIN + 1)) | 0);
        const clusters = [];
        for (let c = 0; c < 3 + ((Math.random() * 3) | 0); c++) {
          clusters.push({
            x: rand(-0.16, 0.16) * height,
            y: rand(0.18, 0.82) * height,
            z: rand(-0.03, 0.04),
          });
        }
        const delays = [];
        for (let s = 0; s < n; s++) delays.push(rand(0, 0.38));
        delays.sort((a, b) => a - b);
        delays[0] = 0;
        for (let s = 0; s < n; s++) {
          emitters.push({
            matrix: sign.matrixWorld.clone(),
            height,
            clusters,
            tightW: 0.1 * height,
            tightH: 0.22 * height,
            delay: delays[s],
            left: DURATION,
            acc: 0,
            rate: rand(22, 40),
            colAcc: 0,
            colRate: rand(2, 5),
          });
        }
      }
      mesh.visible = true;
    },
    update(dt) {
      if (emitters.length === 0 && live.length === 0) {
        if (mesh.visible) {
          mesh.visible = false;
          mesh.count = 0;
        }
        return;
      }

      const step = Math.min(dt, 0.05);
      const full = live.length > MAX * 0.88;
      for (let i = emitters.length - 1; i >= 0; i--) {
        const emitter = emitters[i];
        if (emitter.delay > 0) {
          emitter.delay -= step;
          continue;
        }
        if (emitter.left > 0) {
          if (!full) {
            emitter.acc += emitter.rate * step;
            while (emitter.acc >= 1) {
              emitter.acc -= 1;
              spawnFrom(emitter);
            }
            emitter.colAcc += emitter.colRate * step;
            while (emitter.colAcc >= 1) {
              emitter.colAcc -= 1;
              spawnColumn(emitter);
            }
          }
          emitter.left -= step;
        } else {
          emitters.splice(i, 1);
        }
      }

      let alive = 0;
      for (let i = live.length - 1; i >= 0; i--) {
        const p = live[i];
        p.life -= step;
        p.x += p.vx * step;
        p.y += p.vy * step;
        p.z += p.vz * step;
        if (p.life <= 0 || p.y > p.y0 + p.rise) {
          p.alive = false;
          live[i] = live[live.length - 1];
          live.pop();
          continue;
        }
        const risen = (p.y - p.y0) / p.rise;
        const fadeIn = Math.min(1, (p.max - p.life) / 0.05);
        const fadeOut = Math.min(1, p.life / 0.18, 1 - risen);
        const fade = fadeIn * Math.max(0, fadeOut);
        const o = alive * 16;
        matArr[o] = p.w;
        matArr[o + 1] = 0;
        matArr[o + 2] = 0;
        matArr[o + 3] = 0;
        matArr[o + 4] = 0;
        matArr[o + 5] = p.h;
        matArr[o + 6] = 0;
        matArr[o + 7] = 0;
        matArr[o + 8] = 0;
        matArr[o + 9] = 0;
        matArr[o + 10] = 1;
        matArr[o + 11] = 0;
        matArr[o + 12] = p.x;
        matArr[o + 13] = p.y;
        matArr[o + 14] = p.z;
        matArr[o + 15] = 1;
        const c = alive * 3;
        colArr[c] = p.r * fade;
        colArr[c + 1] = p.g * fade;
        colArr[c + 2] = p.b * fade;
        alive += 1;
      }
      mesh.count = alive;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
      mesh.visible = alive > 0 || emitters.length > 0;
    },
  };
}
