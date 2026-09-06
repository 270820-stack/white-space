import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { pluckHarp } from "./harp.js?v=6";

const WIRE_COLORS = [0xc0392b, 0x27ae60, 0x8b6914, 0xd4a017, 0xa93226, 0x1e8449, 0xb7950b, 0x6e2c00];
const SKY_PER_SIGN = [1, 2, 2, 3, 3, 3, 4, 4, 5, 6];
const SKY_NODES = 12;
const SKY_RENDER = 32;
const CROSS_NODES = 20;
const CROSS_RENDER = 36;
const AIR_NODES = 16;
const AIR_RENDER = 28;
const DRAPE_LINKS = 22;
const AIR_LINKS = 34;
const GRAVITY = new THREE.Vector3(0, -9.5, 0);
const DAMPING = 0.982;
const ITERATIONS = 12;
const PLAYER_RADIUS = 0.48;
const CLICK_RADIUS = 0.55;
const FLOOR_Y = 0.02;
const LINE_WIDTH = 0.03;
const GLOW_TIME = 1;
const TIP_IGNORE = 0.3;

const _diff = new THREE.Vector3();
const _push = new THREE.Vector3();
const _closest = new THREE.Vector3();
const _sample = new THREE.Vector3();
const _local = new THREE.Vector3();
const _world = new THREE.Vector3();
const _hsl = { h: 0, s: 0, l: 0 };
const _neon = new THREE.Color();

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

function collideSigns(nodes, colliders, radius) {
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
    for (let s = 0; s < colliders.length; s++) {
      const c = colliders[s];
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

function sampleRope(curve, count, buffer) {
  for (let i = 0; i < count; i++) {
    curve.getPoint(i / (count - 1), _sample);
    buffer[i * 3] = _sample.x;
    buffer[i * 3 + 1] = _sample.y;
    buffer[i * 3 + 2] = _sample.z;
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
  const pr = Math.min(window.devicePixelRatio || 1, 2);
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
    const hx = Math.max(0.12, h * aspect * 0.3);
    const hz = 0.07;
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
  const ropes = [];
  const whiteMap = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  whiteMap.needsUpdate = true;
  const cableMapUniform = { value: whiteMap };
  new THREE.TextureLoader().load("./assets/textures/cable-plastic.png?v=1", (tex) => {
    cableMapUniform.value = prepCableMap(tex);
  });

  const signList = signs.group.children;
  const colliders = makeColliders(signList);
  const grommetGeo = new THREE.TorusGeometry(0.015, 0.005, 5, 10);
  const grommetMat = new THREE.MeshStandardMaterial({
    color: 0x454545,
    roughness: 0.42,
    metalness: 0.55,
  });

  function addRope(start, end, nodeCount, renderCount, extra, hex, opts = {}) {
    const drape = !!opts.drape;
    const lineWidth = opts.width || LINE_WIDTH;
    const { nodes, rest } = drape ? makeDrapeNodes(start, end, nodeCount) : makeNodes(start, end, nodeCount, extra);
    const floorR = lineWidth * 0.5;
    for (let i = 0; i < 50; i++) {
      constrain(nodes, rest);
      collideFloor(nodes, floorR);
      collideSigns(nodes, colliders, lineWidth * 0.55);
    }

    const curve = new THREE.CatmullRomCurve3(nodes.map((n) => n.pos));
    const positions = new Float32Array(renderCount * 3);
    sampleRope(curve, renderCount, positions);
    const geometry = new LineGeometry();
    geometry.setPositions(positions);
    const mat = colorMaterial(hex, width, height, cableMapUniform, lineWidth);
    materials.push(mat);
    const line = new Line2(geometry, mat);
    line.computeLineDistances();
    line.frustumCulled = false;
    group.add(line);
    ropes.push({
      nodes,
      rest,
      geometry,
      positions,
      line,
      curve,
      renderCount,
      drape,
      note: ropes.length,
      mat,
      baseColor: new THREE.Color(hex),
      glow: 0,
      width: lineWidth,
      glowWidth: lineWidth * 2.55,
    });
  }

  for (let i = 0; i < signList.length; i++) {
    const sign = signList[i];
    const locals = attachLocals(sign);
    for (let a = locals.length - 1; a > 0; a--) {
      const b = (Math.random() * (a + 1)) | 0;
      [locals[a], locals[b]] = [locals[b], locals[a]];
    }
    const count = skyCount();
    for (let k = 0; k < count; k++) {
      const local = locals[k % locals.length];
      const start = toWorld(sign, local);
      if (local.y < sign.userData.height * 0.88) {
        const grommet = new THREE.Mesh(grommetGeo, grommetMat);
        grommet.position.copy(local);
        grommet.rotation.x = Math.PI / 2;
        sign.add(grommet);
      }
      const yaw = Math.random() * Math.PI * 2;
      const pitch = THREE.MathUtils.degToRad(22 + Math.random() * 62);
      const reach = 28 + Math.random() * 58;
      const sky = new THREE.Vector3(
        start.x + Math.cos(yaw) * Math.cos(pitch) * reach,
        start.y + Math.sin(pitch) * reach,
        start.z + Math.sin(yaw) * Math.cos(pitch) * reach,
      );
      const nodes = 10 + ((Math.random() * 5) | 0);
      addRope(start, sky, nodes, Math.max(SKY_RENDER, nodes * 2 + 8), 0.01 + Math.random() * 0.018, pickColor(), {
        width: pickWidth(),
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

  function randomAttachWorld(sign) {
    const locals = attachLocals(sign);
    return toWorld(sign, locals[(Math.random() * locals.length) | 0]);
  }

  let drapes = 0;
  let guard = 0;
  while (drapes < DRAPE_LINKS && guard < 900) {
    guard += 1;
    const a = (Math.random() * signList.length) | 0;
    const b = (Math.random() * signList.length) | 0;
    if (!canPair(a, b)) continue;
    const pa = randomAttachWorld(signList[a]);
    const pb = randomAttachWorld(signList[b]);
    const dist = pa.distanceTo(pb);
    if (dist < 3.2 || dist > 18) continue;
    markPair(a, b);
    addRope(pa, pb, CROSS_NODES, CROSS_RENDER, 0, pickColor(), {
      drape: true,
      width: pickWidth(),
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
    const pa = randomAttachWorld(signList[a]);
    const pb = randomAttachWorld(signList[b]);
    const dist = pa.distanceTo(pb);
    if (dist < 2.8 || dist > 20) continue;
    markPair(a, b);
    addRope(pa, pb, AIR_NODES, AIR_RENDER, 0.03 + Math.random() * 0.1, pickColor(), {
      width: pickWidth(),
    });
    airs += 1;
  }

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

    const gStep = GRAVITY.clone().multiplyScalar(step * step);
    for (const rope of ropes) {
      for (const node of rope.nodes) {
        if (node.pinned) continue;
        _diff.copy(node.pos).sub(node.prev).multiplyScalar(DAMPING);
        node.prev.copy(node.pos);
        node.pos.add(_diff).add(gStep);
      }
      collidePlayer(rope.nodes, spheres);
      collideSigns(rope.nodes, colliders, rope.width * 0.55);
      collideFloor(rope.nodes, rope.width * 0.5);
      for (let i = 0; i < ITERATIONS; i++) {
        constrain(rope.nodes, rope.rest);
        collideFloor(rope.nodes, rope.width * 0.5);
      }
      collideSigns(rope.nodes, colliders, rope.width * 0.55);
      sampleRope(rope.curve, rope.renderCount, rope.positions);
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
  }

  function flick(raycaster) {
    const ray = raycaster.ray;
    let best = null;
    let bestDist = CLICK_RADIUS * CLICK_RADIUS;
    for (const rope of ropes) {
      const nodes = rope.nodes;
      for (let i = 0; i < nodes.length - 1; i++) {
        const distSq = ray.distanceSqToSegment(nodes[i].pos, nodes[i + 1].pos, undefined, _closest);
        if (distSq < bestDist) {
          bestDist = distSq;
          best = { rope, index: i };
        }
      }
    }
    if (!best) return false;
    pluckHarp(best.rope.note);
    best.rope.glow = 1;
    const kick = ray.direction.clone().multiplyScalar(0.55);
    kick.y += 0.12;
    for (let i = 0; i < best.rope.nodes.length; i++) {
      const node = best.rope.nodes[i];
      if (node.pinned) continue;
      const falloff = Math.exp(-Math.abs(i - best.index) * 0.55);
      node.prev.sub(_push.copy(kick).multiplyScalar(falloff));
    }
    return true;
  }

  function resize(w, h) {
    const pr = Math.min(window.devicePixelRatio || 1, 2);
    for (const mat of materials) mat.resolution.set(w * pr, h * pr);
  }

  return { group, update, flick, resize };
}
