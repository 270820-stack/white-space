import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { pluckHarp } from "./harp.js?v=6";

const WIRE_COLORS = [
  0xc0392b, 0x27ae60, 0x8b6914, 0xd4a017, 0xa93226, 0x1e8449, 0xb7950b, 0x6e2c00,
  0x2471a3, 0x1a5276, 0xd35400, 0xe67e22, 0x6c3483, 0x7d3c98, 0x117a65, 0x0e6655,
  0x922b21, 0xb9770e, 0x1c2833, 0x5d6d7e, 0xcb4335, 0x196f3d, 0x4a235a, 0x1abc9c,
];
const SKY_PER_SIGN = [1, 2, 2, 3, 3, 3, 4, 4, 5, 6];
const SKY_NODES = 28;
const CROSS_NODES = 32;
const AIR_NODES = 26;
const DRAPE_LINKS = 22;
const AIR_LINKS = 34;
const GRAVITY = new THREE.Vector3(0, -9.5, 0);
const DAMPING = 0.982;
const ITERATIONS = 10;
const MAX_TURN_COS = Math.cos(THREE.MathUtils.degToRad(40));
const COLLIDE_CELL = 4;
const PLAYER_RADIUS = 0.48;
const CLICK_RADIUS = 0.55;
const REACH = 30;
const REACH_SQ = REACH * REACH;
const FLOOR_Y = 0.02;
const LINE_WIDTH = 0.03;
const SHADOW_CHEST_Y = 2.35 * 0.58;
const LIGHT_RAY = new THREE.Vector3(6.5, 19, -4.5).normalize().negate();
const SHADOW_MAX_SEGS = 2200;
const GLOW_TIME = 1;
const TIP_IGNORE = 0.3;

const _diff = new THREE.Vector3();
const _push = new THREE.Vector3();
const _closest = new THREE.Vector3();
const _local = new THREE.Vector3();
const _world = new THREE.Vector3();
const _hsl = { h: 0, s: 0, l: 0 };
const _neon = new THREE.Color();
const _gStep = new THREE.Vector3();
const _shadowA = new THREE.Vector3();
const _shadowB = new THREE.Vector3();
const _pin = new THREE.Vector3();
const _toHit = new THREE.Vector3();
const _ndcHit = new THREE.Vector3();
const _occlude = new THREE.Raycaster();
_occlude.near = 0.15;

function neonColor(out, base, k) {
  base.getHSL(_hsl);
  const warm = _hsl.h < 0.22 || _hsl.h > 0.88;
  _hsl.h = warm ? _hsl.h + 0.038 * k : _hsl.h - 0.048 * k;
  _hsl.s = Math.min(1, _hsl.s * (1 + 0.4 * k) + 0.12 * k);
  _hsl.l = Math.min(0.7, _hsl.l + 0.32 * k);
  out.setHSL(_hsl.h, _hsl.s, _hsl.l);
  return out;
}

function lerpVec(out, a, b, t) {
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  out.z = a.z + (b.z - a.z) * t;
  return out;
}

function makeNodes(start, end, count, extra) {
  const nodes = [];
  const tmp = new THREE.Vector3();
  const chord = start.distanceTo(end);
  const sag = extra * chord * 0.15;
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    lerpVec(tmp, start, end, t);
    tmp.y -= sag * 4 * t * (1 - t);
    const pos = tmp.clone();
    nodes.push({
      pos,
      prev: pos.clone(),
      pinned: i === 0 || i === count - 1,
    });
  }
  const rest = chord * (1 + extra) / (count - 1);
  return { nodes, rest };
}

function constrain(nodes, rest) {
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i];
    const b = nodes[i + 1];
    _diff.subVectors(b.pos, a.pos);
    const dist = _diff.length();
    if (dist < 1e-6) continue;
    const corr = ((dist - rest) / dist) * 0.5;
    _diff.multiplyScalar(corr);
    if (!a.pinned && !b.pinned) {
      a.pos.add(_diff);
      b.pos.sub(_diff);
    } else if (a.pinned && !b.pinned) {
      b.pos.sub(_diff.multiplyScalar(2));
    } else if (!a.pinned && b.pinned) {
      a.pos.add(_diff.multiplyScalar(2));
    }
  }
}

function projectFloor(out, x, y, z) {
  const t = y / -LIGHT_RAY.y;
  out.set(x + LIGHT_RAY.x * t, 0.02, z + LIGHT_RAY.z * t);
}

function clipLow(ax, ay, az, bx, by, bz, outA, outB) {
  if (ay >= SHADOW_CHEST_Y && by >= SHADOW_CHEST_Y) return false;
  let x0 = ax;
  let y0 = ay;
  let z0 = az;
  let x1 = bx;
  let y1 = by;
  let z1 = bz;
  if (ay > SHADOW_CHEST_Y) {
    const u = (SHADOW_CHEST_Y - by) / (ay - by);
    x0 = bx + (ax - bx) * u;
    y0 = SHADOW_CHEST_Y;
    z0 = bz + (az - bz) * u;
  }
  if (by > SHADOW_CHEST_Y) {
    const u = (SHADOW_CHEST_Y - ay) / (by - ay);
    x1 = ax + (bx - ax) * u;
    y1 = SHADOW_CHEST_Y;
    z1 = az + (bz - az) * u;
  }
  projectFloor(outA, x0, y0, z0);
  projectFloor(outB, x1, y1, z1);
  return true;
}

function softenBends(nodes) {
  for (let i = 1; i < nodes.length - 1; i++) {
    const curr = nodes[i];
    if (curr.pinned) continue;
    const prev = nodes[i - 1].pos;
    const p = curr.pos;
    const next = nodes[i + 1].pos;
    const ax = p.x - prev.x;
    const ay = p.y - prev.y;
    const az = p.z - prev.z;
    const bx = next.x - p.x;
    const by = next.y - p.y;
    const bz = next.z - p.z;
    const al = Math.hypot(ax, ay, az);
    const bl = Math.hypot(bx, by, bz);
    if (al < 1e-6 || bl < 1e-6) continue;
    const dot = (ax * bx + ay * by + az * bz) / (al * bl);
    if (dot >= MAX_TURN_COS) continue;
    const k = Math.min(0.52, (MAX_TURN_COS - dot) * 0.72);
    p.x += ((prev.x + next.x) * 0.5 - p.x) * k;
    p.y += ((prev.y + next.y) * 0.5 - p.y) * k;
    p.z += ((prev.z + next.z) * 0.5 - p.z) * k;
  }
}

function makeDrapeNodes(start, end, count) {
  const nodes = [];
  const along = Math.hypot(end.x - start.x, end.z - start.z);
  const dropA = Math.max(0.08, start.y - FLOOR_Y);
  const dropB = Math.max(0.08, end.y - FLOOR_Y);
  const rest = (dropA + along + dropB + 0.9) / (count - 1);
  const edge = 0.22;

  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const x = start.x + (end.x - start.x) * t;
    const z = start.z + (end.z - start.z) * t;
    let y;
    if (t < edge) {
      const u = t / edge;
      y = start.y + (FLOOR_Y - start.y) * (u * u * (3 - 2 * u));
    } else if (t > 1 - edge) {
      const u = (t - (1 - edge)) / edge;
      y = FLOOR_Y + (end.y - FLOOR_Y) * (u * u * (3 - 2 * u));
    } else {
      y = FLOOR_Y;
    }
    const pos = new THREE.Vector3(x, y, z);
    nodes.push({
      pos,
      prev: pos.clone(),
      pinned: i === 0 || i === count - 1,
    });
  }
  return { nodes, rest };
}

function collideFloor(nodes, radius = 0) {
  const y = FLOOR_Y + radius;
  for (const node of nodes) {
    if (node.pinned) continue;
    if (node.pos.y >= y) continue;
    const vx = node.pos.x - node.prev.x;
    const vz = node.pos.z - node.prev.z;
    node.pos.y = y;
    node.prev.y = y;
    node.prev.x = node.pos.x - vx * 0.45;
    node.prev.z = node.pos.z - vz * 0.45;
  }
}

function collidePlayer(nodes, spheres) {
  for (const node of nodes) {
    if (node.pinned) continue;
    for (const sphere of spheres) {
      _diff.subVectors(node.pos, sphere.center);
      const dist = _diff.length();
      if (dist >= sphere.radius || dist < 1e-5) continue;
      _push.copy(_diff).multiplyScalar((sphere.radius - dist) / dist);
      node.pos.add(_push);
      node.pos.x += sphere.vx * 0.04;
      node.pos.z += sphere.vz * 0.04;
    }
  }
}

function bucketColliders(colliders) {
  const buckets = new Map();
  for (const c of colliders) {
    const span = Math.sqrt(c.r2);
    const i0 = Math.floor((c.x - span) / COLLIDE_CELL);
    const i1 = Math.floor((c.x + span) / COLLIDE_CELL);
    const j0 = Math.floor((c.z - span) / COLLIDE_CELL);
    const j1 = Math.floor((c.z + span) / COLLIDE_CELL);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const key = `${i},${j}`;
        let list = buckets.get(key);
        if (!list) {
          list = [];
          buckets.set(key, list);
        }
        list.push(c);
      }
    }
  }
  return buckets;
}

function collideSigns(nodes, buckets, radius) {
  const tip2 = TIP_IGNORE * TIP_IGNORE;
  const start = nodes[0].pos;
  const end = nodes[nodes.length - 1].pos;
  const r = radius;
  const r2 = r * r;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.pinned) continue;
    const p = node.pos;
    if (p.distanceToSquared(start) < tip2 || p.distanceToSquared(end) < tip2) continue;
    const ci = Math.floor(p.x / COLLIDE_CELL);
    const cj = Math.floor(p.z / COLLIDE_CELL);
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        const list = buckets.get(`${ci + di},${cj + dj}`);
        if (!list) continue;
        for (let s = 0; s < list.length; s++) {
          const c = list[s];
          const dx = p.x - c.x;
          const dz = p.z - c.z;
          if (dx * dx + dz * dz > c.r2) continue;
      _local.copy(p).applyMatrix4(c.inv);
      const hx = c.hx + r;
      const hz = c.hz + r;
      const y0 = c.y0 - r;
      const y1 = c.y1 + r;
      if (_local.x < -hx || _local.x > hx || _local.z < -hz || _local.z > hz) continue;
      if (_local.y < y0 || _local.y > y1) continue;
      const px = THREE.MathUtils.clamp(_local.x, -c.hx, c.hx);
      const py = THREE.MathUtils.clamp(_local.y, c.y0, c.y1);
      const pz = THREE.MathUtils.clamp(_local.z, -c.hz, c.hz);
      const ox = _local.x - px;
      const oy = _local.y - py;
      const oz = _local.z - pz;
      const d2 = ox * ox + oy * oy + oz * oz;
      if (d2 < 1e-8) {
        const ex = c.hx - Math.abs(_local.x);
        const ey = Math.min(_local.y - c.y0, c.y1 - _local.y);
        const ez = c.hz - Math.abs(_local.z);
        if (ez <= ex && ez <= ey) _local.z = _local.z >= 0 ? c.hz + r : -c.hz - r;
        else if (ex <= ey) _local.x = _local.x >= 0 ? c.hx + r : -c.hx - r;
        else _local.y = _local.y - c.hy >= 0 ? c.y1 + r : c.y0 - r;
      } else if (d2 < r2) {
        const push = (r - Math.sqrt(d2)) / Math.sqrt(d2);
        _local.x += ox * push;
        _local.y += oy * push;
        _local.z += oz * push;
      } else {
        continue;
      }
      p.copy(_world.copy(_local).applyMatrix4(c.world));
        }
      }
    }
  }
}

function sampleRope(nodes, count, buffer) {
  const last = nodes.length - 1;
  if (last < 1) return buffer;
  const head = nodes[0].pos;
  const tail = nodes[last].pos;
  buffer[0] = head.x;
  buffer[1] = head.y;
  buffer[2] = head.z;
  const end = (count - 1) * 3;
  buffer[end] = tail.x;
  buffer[end + 1] = tail.y;
  buffer[end + 2] = tail.z;
  for (let i = 1; i < count - 1; i++) {
    const t = (i / (count - 1)) * last;
    const i1 = Math.min(last - 1, t | 0);
    const f = t - i1;
    const p0 = nodes[Math.max(0, i1 - 1)].pos;
    const p1 = nodes[i1].pos;
    const p2 = nodes[Math.min(last, i1 + 1)].pos;
    const p3 = nodes[Math.min(last, i1 + 2)].pos;
    const t2 = f * f;
    const t3 = t2 * f;
    buffer[i * 3] =
      0.5 *
      (2 * p1.x +
        (-p0.x + p2.x) * f +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
    buffer[i * 3 + 1] =
      0.5 *
      (2 * p1.y +
        (-p0.y + p2.y) * f +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
    buffer[i * 3 + 2] =
      0.5 *
      (2 * p1.z +
        (-p0.z + p2.z) * f +
        (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 +
        (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3);
  }
  return buffer;
}

function prepCableMap(tex) {
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

function colorMaterial(color, width, height, cableMapUniform, lineWidth) {
  const mat = new LineMaterial({
    color,
    linewidth: lineWidth,
    worldUnits: true,
    fog: true,
    alphaToCoverage: false,
    depthTest: true,
    transparent: false,
  });
  const pr = Math.min(window.devicePixelRatio || 1, 1.25);
  mat.resolution.set(width * pr, height * pr);
  mat.customProgramCacheKey = () => "cable-plastic3";
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.cableMap = cableMapUniform;
    shader.vertexShader =
      "varying vec2 vCableUv;\n" +
      shader.vertexShader.replace(
        "gl_Position = clip;",
        "vCableUv = vec2( position.x * 0.5 + 0.5, clamp( position.y, 0.0, 1.0 ) );\n\t\t\tgl_Position = clip;",
      );
    shader.fragmentShader =
      "varying vec2 vCableUv;\nuniform sampler2D cableMap;\n" +
      shader.fragmentShader.replace(
        "vec4 diffuseColor = vec4( diffuse, alpha );",
        `vec4 diffuseColor = vec4( diffuse, alpha );
			float across = abs( vCableUv.x - 0.5 ) * 2.0;
			float tube = pow( 1.0 - across, 0.42 );
			vec2 cableUv = vec2( vCableUv.x, vCableUv.y * 3.2 );
			float grain = dot( texture2D( cableMap, cableUv ).rgb, vec3( 0.299, 0.587, 0.114 ) );
			grain = 0.78 + ( grain - 0.5 ) * 0.55;
			float plastic = mix( 0.52, 1.22, tube ) * grain;
			diffuseColor.rgb *= plastic;`,
      );
  };
  return mat;
}

function pickColor() {
  return WIRE_COLORS[(Math.random() * WIRE_COLORS.length) | 0];
}

function pickWidth() {
  const u = Math.random();
  if (u < 0.18) return 0.013 + Math.random() * 0.008;
  if (u < 0.72) return 0.022 + Math.random() * 0.016;
  return 0.038 + Math.random() * 0.02;
}

function skyCount() {
  return SKY_PER_SIGN[(Math.random() * SKY_PER_SIGN.length) | 0];
}

function attachLocals(sign) {
  const h = sign.userData.height;
  const w = Math.max(0.11, h * (sign.userData.aspect || 0.5) * 0.4);
  return [
    new THREE.Vector3(0, h * 0.97, 0),
    new THREE.Vector3(-w * 0.2, h * 0.91, 0),
    new THREE.Vector3(w * 0.2, h * 0.91, 0),
    new THREE.Vector3(-w * 0.72, h * 0.74, 0.012),
    new THREE.Vector3(w * 0.72, h * 0.74, 0.012),
    new THREE.Vector3(-w * 0.5, h * 0.58, -0.01),
    new THREE.Vector3(w * 0.5, h * 0.58, -0.01),
    new THREE.Vector3(0, h * 0.63, 0.02),
    new THREE.Vector3(0, h * 0.44, -0.016),
    new THREE.Vector3(-w * 0.28, h * 0.36, 0),
    new THREE.Vector3(w * 0.28, h * 0.36, 0),
  ];
}

function toWorld(sign, local) {
  return local.clone().applyMatrix4(sign.matrixWorld);
}

function makeColliders(signs) {
  const colliders = [];
  for (const sign of signs) {
    const h = sign.userData.height;
    const aspect = sign.userData.aspect || 0.5;
    const hx = sign.userData.halfW || Math.max(0.12, h * aspect * 0.3);
    const hz = sign.userData.halfD || 0.07;
    const r = Math.hypot(hx, hz) + 0.55;
    colliders.push({
      x: sign.position.x,
      z: sign.position.z,
      r2: r * r,
      hx,
      hz,
      hy: h * 0.5,
      y0: 0.02,
      y1: h,
      inv: new THREE.Matrix4().copy(sign.matrixWorld).invert(),
      world: sign.matrixWorld.clone(),
    });
  }
  return colliders;
}

export function createWires(scene, signs) {
  const group = new THREE.Group();
  group.name = "Wires";
  group.frustumCulled = false;
  scene.add(group);

  const width = window.innerWidth;
  const height = window.innerHeight;
  const materials = [];
  const matCache = new Map();
  const ropes = [];
  const pending = [];
  const whiteMap = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  whiteMap.needsUpdate = true;
  const cableMapUniform = { value: whiteMap };
  new THREE.TextureLoader().load("./assets/textures/cable-plastic.png?v=1", (tex) => {
    cableMapUniform.value = prepCableMap(tex);
  });

  const signList = signs.group.children;
  const boards = [];
  for (let i = 0; i < signList.length; i++) {
    const mesh = signList[i].getObjectByName("Board");
    if (mesh) boards.push(mesh);
  }
  const colliders = makeColliders(signList);
  let colliderBuckets = bucketColliders(colliders);
  const grommetGeo = new THREE.TorusGeometry(0.015, 0.005, 5, 10);
  const grommetMat = new THREE.MeshStandardMaterial({
    color: 0x454545,
    roughness: 0.42,
    metalness: 0.55,
  });

  function sharedMaterial(hex, lineWidth) {
    const key = `${hex}-${lineWidth < 0.02 ? "s" : lineWidth < 0.035 ? "m" : "l"}`;
    let mat = matCache.get(key);
    if (mat) return mat;
    const w = lineWidth < 0.02 ? 0.016 : lineWidth < 0.035 ? 0.028 : 0.048;
    mat = colorMaterial(hex, width, height, cableMapUniform, w);
    matCache.set(key, mat);
    materials.push(mat);
    return mat;
  }

  function addRope(start, end, nodeCount, renderCount, extra, hex, opts = {}) {
    const drape = !!opts.drape;
    const lineWidth = opts.width || LINE_WIDTH;
    const { nodes, rest } = drape ? makeDrapeNodes(start, end, nodeCount) : makeNodes(start, end, nodeCount, extra);
    constrain(nodes, rest);
    softenBends(nodes);
    collideFloor(nodes, lineWidth * 0.5);
    pending.push({
      nodes,
      rest,
      renderCount,
      hex,
      lineWidth,
      drape,
      attachA: opts.attachA || null,
      attachB: opts.attachB || null,
    });
  }

  function flushRope(spec) {
    const positions = new Float32Array(spec.renderCount * 3);
    sampleRope(spec.nodes, spec.renderCount, positions);
    const geometry = new LineGeometry();
    geometry.setPositions(positions);
    const mat = sharedMaterial(spec.hex, spec.lineWidth);
    const line = new Line2(geometry, mat);
    line.frustumCulled = false;
    group.add(line);
    ropes.push({
      nodes: spec.nodes,
      rest: spec.rest,
      geometry,
      positions,
      line,
      renderCount: spec.renderCount,
      drape: spec.drape,
      note: ropes.length,
      mat,
      sharedMat: mat,
      baseColor: new THREE.Color(spec.hex),
      glow: 0,
      width: spec.lineWidth,
      glowWidth: spec.lineWidth * 2.55,
      attachA: spec.attachA,
      attachB: spec.attachB,
    });
  }

  function pumpRopes() {
    let n = 14;
    while (n-- > 0 && pending.length) flushRope(pending.shift());
    if (pending.length) requestAnimationFrame(pumpRopes);
  }

  for (let i = 0; i < signList.length; i++) {
    const sign = signList[i];
    const locals = attachLocals(sign);
    const skyLocals = locals.filter((p) => p.y >= sign.userData.height * 0.7);
    const skyPool = skyLocals.length ? skyLocals : locals.slice(0, 3);
    for (let a = skyPool.length - 1; a > 0; a--) {
      const b = (Math.random() * (a + 1)) | 0;
      [skyPool[a], skyPool[b]] = [skyPool[b], skyPool[a]];
    }
    const count = skyCount();
    for (let k = 0; k < count; k++) {
      const local = skyPool[k % skyPool.length];
      const start = toWorld(sign, local);
      if (local.y < sign.userData.height * 0.88) {
        const grommet = new THREE.Mesh(grommetGeo, grommetMat);
        grommet.position.copy(local);
        grommet.rotation.x = Math.PI / 2;
        sign.add(grommet);
      }
      const yaw = Math.random() * Math.PI * 2;
      const pitch = THREE.MathUtils.degToRad(50 + Math.random() * 34);
      const reach = 38 + Math.random() * 48;
      const sky = new THREE.Vector3(
        start.x + Math.cos(yaw) * Math.cos(pitch) * reach,
        Math.max(start.y + 24, start.y + Math.sin(pitch) * reach),
        start.z + Math.sin(yaw) * Math.cos(pitch) * reach,
      );
      const nodes = SKY_NODES + ((Math.random() * 8) | 0);
      addRope(start, sky, nodes, nodes * 2, 0.01 + Math.random() * 0.018, pickColor(), {
        width: pickWidth(),
        attachA: { sign, local },
      });
    }
  }

  const pairCount = new Map();
  function pairKey(a, b) {
    return a < b ? `${a}-${b}` : `${b}-${a}`;
  }
  function canPair(a, b) {
    if (a === b) return false;
    return (pairCount.get(pairKey(a, b)) || 0) < 2;
  }
  function markPair(a, b) {
    const key = pairKey(a, b);
    pairCount.set(key, (pairCount.get(key) || 0) + 1);
  }

  function randomAttach(sign) {
    const locals = attachLocals(sign);
    const local = locals[(Math.random() * locals.length) | 0];
    return { sign, local, world: toWorld(sign, local) };
  }

  let drapes = 0;
  let guard = 0;
  while (drapes < DRAPE_LINKS && guard < 900) {
    guard += 1;
    const a = (Math.random() * signList.length) | 0;
    const b = (Math.random() * signList.length) | 0;
    if (!canPair(a, b)) continue;
    const pa = randomAttach(signList[a]);
    const pb = randomAttach(signList[b]);
    const dist = pa.world.distanceTo(pb.world);
    if (dist < 3.2 || dist > 18) continue;
    markPair(a, b);
    addRope(pa.world, pb.world, CROSS_NODES, CROSS_NODES * 2, 0, pickColor(), {
      drape: true,
      width: pickWidth(),
      attachA: pa,
      attachB: pb,
    });
    drapes += 1;
  }

  let airs = 0;
  guard = 0;
  while (airs < AIR_LINKS && guard < 900) {
    guard += 1;
    const a = (Math.random() * signList.length) | 0;
    const b = (Math.random() * signList.length) | 0;
    if (!canPair(a, b)) continue;
    const pa = randomAttach(signList[a]);
    const pb = randomAttach(signList[b]);
    const dist = pa.world.distanceTo(pb.world);
    if (dist < 2.8 || dist > 20) continue;
    markPair(a, b);
    addRope(pa.world, pb.world, AIR_NODES, AIR_NODES * 2, 0.03 + Math.random() * 0.1, pickColor(), {
      width: pickWidth(),
      attachA: pa,
      attachB: pb,
    });
    airs += 1;
  }

  pumpRopes();

  const shadowPos = new Float32Array(SHADOW_MAX_SEGS * 6);
  const shadowGeo = new THREE.BufferGeometry();
  shadowGeo.setAttribute("position", new THREE.BufferAttribute(shadowPos, 3));
  shadowGeo.setDrawRange(0, 0);
  const shadowLines = new THREE.LineSegments(
    shadowGeo,
    new THREE.LineBasicMaterial({
      color: 0x3a3a3a,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      fog: true,
    }),
  );
  shadowLines.name = "CableShadows";
  shadowLines.frustumCulled = false;
  shadowLines.renderOrder = 1;
  scene.add(shadowLines);

  const spheres = [
    { center: new THREE.Vector3(), radius: PLAYER_RADIUS, vx: 0, vz: 0 },
    { center: new THREE.Vector3(), radius: PLAYER_RADIUS * 0.85, vx: 0, vz: 0 },
  ];

  function update(dt, playerPos, playerVel) {
    const step = Math.min(dt, 0.033);
    spheres[0].center.set(playerPos.x, 0.85, playerPos.z);
    spheres[1].center.set(playerPos.x, 1.48, playerPos.z);
    spheres[0].vx = spheres[1].vx = playerVel.x;
    spheres[0].vz = spheres[1].vz = playerVel.z;

    let moving = false;
    for (let i = 0; i < signList.length; i++) {
      const sign = signList[i];
      if (!sign.userData.walk) continue;
      moving = true;
      const c = colliders[i];
      c.x = sign.position.x;
      c.z = sign.position.z;
      c.world.copy(sign.matrixWorld);
      c.inv.copy(c.world).invert();
    }
    if (moving) colliderBuckets = bucketColliders(colliders);

    _gStep.copy(GRAVITY).multiplyScalar(step * step);
    for (const rope of ropes) {
      if (rope.attachA) {
        _pin.copy(rope.attachA.local).applyMatrix4(rope.attachA.sign.matrixWorld);
        rope.nodes[0].pos.copy(_pin);
        rope.nodes[0].prev.copy(_pin);
      }
      if (rope.attachB) {
        _pin.copy(rope.attachB.local).applyMatrix4(rope.attachB.sign.matrixWorld);
        const last = rope.nodes[rope.nodes.length - 1];
        last.pos.copy(_pin);
        last.prev.copy(_pin);
      }
      for (const node of rope.nodes) {
        if (node.pinned) continue;
        _diff.copy(node.pos).sub(node.prev).multiplyScalar(DAMPING);
        node.prev.copy(node.pos);
        node.pos.add(_diff).add(_gStep);
      }
      collidePlayer(rope.nodes, spheres);
      collideFloor(rope.nodes, rope.width * 0.5);
      for (let i = 0; i < ITERATIONS; i++) {
        constrain(rope.nodes, rope.rest);
        softenBends(rope.nodes);
        collideFloor(rope.nodes, rope.width * 0.5);
      }
      collideSigns(rope.nodes, colliderBuckets, rope.width * 0.55);
      softenBends(rope.nodes);
      sampleRope(rope.nodes, rope.renderCount, rope.positions);
      const floorY = FLOOR_Y + rope.width * 0.5;
      for (let i = 0; i < rope.renderCount; i++) {
        rope.positions[i * 3 + 1] = Math.max(floorY, rope.positions[i * 3 + 1]);
      }
      rope.geometry.setPositions(rope.positions);
      if (rope.glow > 0) {
        rope.glow = Math.max(0, rope.glow - step / GLOW_TIME);
        const k = rope.glow;
        neonColor(_neon, rope.baseColor, k);
        rope.mat.color.copy(_neon);
        rope.mat.linewidth = rope.width + (rope.glowWidth - rope.width) * k;
        rope.mat.toneMapped = k < 0.08;
      } else {
        rope.mat.color.copy(rope.baseColor);
        rope.mat.linewidth = rope.width;
        rope.mat.toneMapped = true;
      }
    }
    let segs = 0;
    for (const rope of ropes) {
      const nodes = rope.nodes;
      for (let i = 0; i < nodes.length - 1 && segs < SHADOW_MAX_SEGS; i++) {
        const a = nodes[i].pos;
        const b = nodes[i + 1].pos;
        if (!clipLow(a.x, a.y, a.z, b.x, b.y, b.z, _shadowA, _shadowB)) continue;
        const o = segs * 6;
        shadowPos[o] = _shadowA.x;
        shadowPos[o + 1] = _shadowA.y;
        shadowPos[o + 2] = _shadowA.z;
        shadowPos[o + 3] = _shadowB.x;
        shadowPos[o + 4] = _shadowB.y;
        shadowPos[o + 5] = _shadowB.z;
        segs += 1;
      }
    }
    shadowGeo.attributes.position.needsUpdate = true;
    shadowGeo.setDrawRange(0, segs * 2);
  }

  function canSeeHit(camera, origin, hit) {
    _toHit.copy(hit).sub(origin);
    const along = _toHit.dot(rayDir);
    if (along < 0.2 || _toHit.lengthSq() > REACH_SQ) return false;
    _ndcHit.copy(hit).project(camera);
    if (_ndcHit.z < -1 || _ndcHit.z > 1) return false;
    if (Math.abs(_ndcHit.x) > 1 || Math.abs(_ndcHit.y) > 1) return false;
    _occlude.set(origin, _toHit.normalize());
    _occlude.far = Math.max(0.2, along - 0.12);
    const blocks = _occlude.intersectObjects(boards, false);
    return blocks.length === 0;
  }

  let rayDir = new THREE.Vector3();

  function flick(raycaster, camera) {
    const ray = raycaster.ray;
    rayDir.copy(ray.direction);
    let best = null;
    let bestDist = CLICK_RADIUS * CLICK_RADIUS;
    for (const rope of ropes) {
      const nodes = rope.nodes;
      for (let i = 0; i < nodes.length - 1; i++) {
        const distSq = ray.distanceSqToSegment(nodes[i].pos, nodes[i + 1].pos, undefined, _closest);
        if (distSq >= bestDist) continue;
        if (camera && !canSeeHit(camera, ray.origin, _closest)) continue;
        bestDist = distSq;
        best = { rope, index: i };
      }
    }
    if (!best) return false;
    pluckHarp(best.rope.note);
    const rope = best.rope;
    if (rope.mat === rope.sharedMat) {
      rope.mat = rope.mat.clone();
      materials.push(rope.mat);
      rope.line.material = rope.mat;
    }
    rope.glow = 1;
    const kick = ray.direction.clone().multiplyScalar(0.55);
    kick.y += 0.12;
    for (let i = 0; i < rope.nodes.length; i++) {
      const node = rope.nodes[i];
      if (node.pinned) continue;
      const falloff = Math.exp(-Math.abs(i - best.index) * 0.55);
      node.prev.sub(_push.copy(kick).multiplyScalar(falloff));
    }
    return true;
  }

  function resize(w, h) {
    const pr = Math.min(window.devicePixelRatio || 1, 1.25);
    for (const mat of materials) mat.resolution.set(w * pr, h * pr);
  }

  return { group, update, flick, resize };
}
