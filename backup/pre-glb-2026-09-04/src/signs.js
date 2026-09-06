import * as THREE from "three";

const FIGURE_URLS = ["./assets/figures/figure-22.png"];
const FIGURE_KEYS = ["figure-22"];

const SIGN_COUNT = 50;
const MIN_RADIUS = 6;
const MAX_RADIUS = 40;
const MIN_SEPARATION = 2.1;
const HEIGHT_RANGE = [1.55, 1.85];
const BOARD_DEPTH = 0.05;
const CHEST_FRAC = 0.64;
const UP = new THREE.Vector3(0, 1, 0);
const WOOD_TILE = 0.16;

let bodyMat = new THREE.MeshLambertMaterial({ color: 0x8a8680 });
let standMat = new THREE.MeshLambertMaterial({ color: 0x6b5335 });
const grommetMat = new THREE.MeshStandardMaterial({
  color: 0x454545,
  roughness: 0.42,
  metalness: 0.55,
});
const beamTemplate = new THREE.BoxGeometry(1, 1, 1);
const footGeo = new THREE.CylinderGeometry(0.028, 0.034, 0.014, 12);
{
  const uv = footGeo.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.22, uv.getY(i) * 0.22);
  uv.needsUpdate = true;
}

function loadImageTexture(url) {
  const loader = new THREE.TextureLoader();
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, reject);
  });
}

function makeSurfaceMaterial(map, bumpScale) {
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 16;
  map.needsUpdate = true;
  const bump = map.clone();
  bump.colorSpace = THREE.NoColorSpace;
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  bump.anisotropy = 16;
  bump.needsUpdate = true;
  return new THREE.MeshLambertMaterial({
    map,
    bumpMap: bump,
    bumpScale,
  });
}

async function loadSurfaceMaterials() {
  const [board, wood] = await Promise.all([
    loadImageTexture("./assets/textures/board-cardboard.png?v=2"),
    loadImageTexture("./assets/textures/easel-wood.png?v=2"),
  ]);
  bodyMat = makeSurfaceMaterial(board, 0.012);
  standMat = makeSurfaceMaterial(wood, 0.018);
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
        height: HEIGHT_RANGE[0] + Math.random() * (HEIGHT_RANGE[1] - HEIGHT_RANGE[0]),
        figure: pts.length % FIGURE_URLS.length,
      });
    }
  }
  return pts;
}

function toShape(outer, aspect) {
  const shape = new THREE.Shape();
  const pts = outer[0][0] === outer[outer.length - 1][0] && outer[0][1] === outer[outer.length - 1][1] ? outer.slice(0, -1) : outer;
  const x0 = pts[0][0] * aspect;
  const y0 = pts[0][1];
  shape.moveTo(x0, y0);
  for (let i = 1; i < pts.length; i++) {
    shape.lineTo(pts[i][0] * aspect, pts[i][1]);
  }
  shape.closePath();
  return shape;
}

function setShapeUVs(geometry, aspect) {
  const pos = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, pos.getX(i) / aspect + 0.5, pos.getY(i) + 0.5);
  }
  uv.needsUpdate = true;
}

function ensureUV(geometry, count) {
  let uv = geometry.getAttribute("uv");
  if (!uv || uv.count !== count) {
    uv = new THREE.BufferAttribute(new Float32Array(count * 2), 2);
    geometry.setAttribute("uv", uv);
  }
  return uv;
}

function setTriplanarUVs(geometry, sx, sy, sz, tile) {
  geometry.computeVertexNormals();
  const pos = geometry.getAttribute("position");
  const nrm = geometry.getAttribute("normal");
  const uv = ensureUV(geometry, pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) * sx;
    const y = pos.getY(i) * sy;
    const z = pos.getZ(i) * sz;
    const nx = Math.abs(nrm.getX(i));
    const ny = Math.abs(nrm.getY(i));
    const nz = Math.abs(nrm.getZ(i));
    if (nz >= nx && nz >= ny) uv.setXY(i, x / tile, y / tile);
    else if (nx >= ny) uv.setXY(i, z / tile, y / tile);
    else uv.setXY(i, x / tile, z / tile);
  }
  uv.needsUpdate = true;
}

function makeBeam(from, to, width, thickness) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  const geo = beamTemplate.clone();
  setTriplanarUVs(geo, width, len, thickness, WOOD_TILE);
  const mesh = new THREE.Mesh(geo, standMat);
  mesh.scale.set(width, len, thickness);
  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(UP, dir.normalize());
  return mesh;
}

function makeEasel(height) {
  const chestY = height * CHEST_FRAC;
  const attachZ = -BOARD_DEPTH / 2 - 0.004;
  const footZ = -Math.max(0.42, height * 0.3);
  const spread = Math.min(0.13, height * 0.085);
  const easel = new THREE.Group();

  const hingeW = spread * 2 + 0.05;
  const hingeGeo = new THREE.BoxGeometry(hingeW, 0.02, 0.016);
  setTriplanarUVs(hingeGeo, 1, 1, 1, WOOD_TILE);
  const hinge = new THREE.Mesh(hingeGeo, standMat);
  hinge.position.set(0, chestY, attachZ - 0.006);
  easel.add(hinge);

  const chestL = new THREE.Vector3(-spread, chestY, attachZ);
  const chestR = new THREE.Vector3(spread, chestY, attachZ);
  const footL = new THREE.Vector3(-spread * 1.2, 0.01, footZ);
  const footR = new THREE.Vector3(spread * 1.2, 0.01, footZ);
  const chestM = new THREE.Vector3(0, chestY, attachZ);
  const footM = new THREE.Vector3(0, 0.012, footZ);

  easel.add(makeBeam(chestL, footL, 0.026, 0.016));
  easel.add(makeBeam(chestR, footR, 0.026, 0.016));
  easel.add(makeBeam(chestM, footM, spread * 1.85, 0.01));
  easel.add(makeBeam(footL, footR, 0.016, 0.016));

  const leftFoot = new THREE.Mesh(footGeo, standMat);
  leftFoot.position.copy(footL);
  const rightFoot = leftFoot.clone();
  rightFoot.position.copy(footR);
  easel.add(leftFoot, rightFoot);
  return easel;
}

function makePrototype(texture, contour) {
  const image = texture.image;
  const aspect = image.width / image.height;
  const shape = toShape(contour.outer, aspect);

  const bodyGeo = new THREE.ExtrudeGeometry(shape, {
    depth: BOARD_DEPTH,
    bevelEnabled: false,
    steps: 1,
    curveSegments: 1,
  });
  bodyGeo.translate(0, 0, -BOARD_DEPTH / 2);
  bodyGeo.computeVertexNormals();

  const photoGeo = new THREE.ShapeGeometry(shape);
  setShapeUVs(photoGeo, aspect);

  const photoMat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.2,
    depthWrite: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  return { bodyGeo, photoGeo, photoMat, aspect };
}

function makeSign(proto, height) {
  const root = new THREE.Group();
  const board = new THREE.Group();
  board.name = "Board";

  const body = new THREE.Mesh(proto.bodyGeo, bodyMat);
  body.scale.set(height, height, 1);

  const photo = new THREE.Mesh(proto.photoGeo, proto.photoMat);
  photo.scale.set(height, height, 1);
  photo.position.z = BOARD_DEPTH / 2 + 0.0008;

  board.add(body, photo);
  board.position.y = height / 2;

  const easel = makeEasel(height);
  easel.name = "Easel";
  root.add(board, easel);
  root.userData.height = height;
  root.userData.aspect = proto.aspect;
  return root;
}

export async function createSigns(scene) {
  const loader = new THREE.TextureLoader();
  const [textures, contours] = await Promise.all([
    Promise.all(
      FIGURE_URLS.map(
        (url) =>
          new Promise((resolve, reject) => {
            loader.load(
              url,
              (tex) => {
                tex.colorSpace = THREE.SRGBColorSpace;
                tex.anisotropy = 8;
                resolve(tex);
              },
              undefined,
              reject,
            );
          }),
      ),
    ),
    fetch("./assets/figures/contours.json").then((res) => {
      if (!res.ok) throw new Error("Failed to load figure contours");
      return res.json();
    }),
    loadSurfaceMaterials(),
  ]);

  const prototypes = textures.map((tex, i) => {
    const key = FIGURE_KEYS[i];
    return makePrototype(tex, contours[key]);
  });

  const root = new THREE.Group();
  root.name = "Signs";
  const placements = scatterPositions(SIGN_COUNT);

  for (const place of placements) {
    const sign = makeSign(prototypes[place.figure], place.height);
    sign.position.x = place.x;
    sign.position.z = place.z;
    sign.rotation.y = place.yaw;
    root.add(sign);
  }

  scene.add(root);
  root.updateMatrixWorld(true);

  const anchors = [];
  for (const sign of root.children) {
    const attach = new THREE.Vector3(0, sign.userData.height * 0.97, 0);
    sign.localToWorld(attach);
    const grommet = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.007, 6, 12), grommetMat);
    grommet.position.set(0, sign.userData.height * 0.97, 0);
    grommet.rotation.x = Math.PI / 2;
    grommet.name = "Grommet";
    sign.add(grommet);
    anchors.push(attach);
  }

  return { group: root, anchors };
}

function loadTexture(url) {
  const loader = new THREE.TextureLoader();
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        resolve(tex);
      },
      undefined,
      reject,
    );
  });
}

export async function applyDroppedFigure(group, event) {
  const [texture, contours] = await Promise.all([
    loadTexture(`${event.src}?v=${event.id}`),
    fetch(`./assets/figures/contours.json?v=${event.id}`).then((res) => {
      if (!res.ok) throw new Error("Failed to reload contours");
      return res.json();
    }),
  ]);
  const contour = contours[event.figure];
  if (!contour) throw new Error(`Missing contour for ${event.figure}`);
  const proto = makePrototype(texture, contour);
  const signs = [...group.children];
  for (let i = signs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [signs[i], signs[j]] = [signs[j], signs[i]];
  }
  const n = Math.max(1, Math.min(event.count, signs.length));
  const replaced = [];
  for (let i = 0; i < n; i++) {
    const sign = signs[i];
    const old = sign.getObjectByName("Board");
    if (old) sign.remove(old);
    const board = new THREE.Group();
    board.name = "Board";
    const height = sign.userData.height;
    const body = new THREE.Mesh(proto.bodyGeo, bodyMat);
    body.scale.set(height, height, 1);
    const photo = new THREE.Mesh(proto.photoGeo, proto.photoMat);
    photo.scale.set(height, height, 1);
    photo.position.z = BOARD_DEPTH / 2 + 0.0008;
    board.add(body, photo);
    board.position.y = height / 2;
    sign.add(board);
    sign.userData.aspect = proto.aspect;
    replaced.push(sign);
  }
  return replaced;
}
