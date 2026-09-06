import * as THREE from "three";
import { createInput, createPlayer, EYE_HEIGHT, updatePlayer } from "./player.js?v=2";
import { createSigns, applyDroppedFigure } from "./signs.js?v=9";
import { createWires } from "./wires.js?v=19";
import { createGlitch } from "./glitch.js?v=10";
import { setCableVolume, unlockHarp } from "./harp.js?v=6";
import { playSwapGlitch, setAnimVolume } from "./swap-sfx.js?v=6";

const canvas = document.querySelector("#c");
const overlay = document.querySelector("#overlay");
const pauseOverlay = document.querySelector("#pause");
const continueBtn = document.querySelector("#continue");
const crosshair = document.querySelector("#crosshair");
const volCables = document.querySelector("#vol-cables");
const volAnim = document.querySelector("#vol-anim");
const volCablesVal = document.querySelector("#vol-cables-val");
const volAnimVal = document.querySelector("#vol-anim-val");

const VOL_CABLES_KEY = "ws-vol-cables";
const VOL_ANIM_KEY = "ws-vol-anim";

function readStoredVolume(key) {
  const stored = localStorage.getItem(key);
  if (stored == null || stored === "") return 1;
  const raw = Number(stored);
  return Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 1;
}

function bindVolume(input, label, apply, key) {
  const value = readStoredVolume(key);
  input.value = String(Math.round(value * 100));
  label.textContent = input.value;
  apply(value);
  input.addEventListener("pointerdown", (event) => event.stopPropagation());
  input.addEventListener("click", (event) => event.stopPropagation());
  input.addEventListener("input", () => {
    const next = Number(input.value) / 100;
    label.textContent = input.value;
    apply(next);
    localStorage.setItem(key, String(next));
  });
}

bindVolume(volCables, volCablesVal, setCableVolume, VOL_CABLES_KEY);
bindVolume(volAnim, volAnimVal, setAnimVolume, VOL_ANIM_KEY);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0xffffff, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffffff);
scene.fog = new THREE.Fog(0xffffff, 20, 88);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.08, 260);

const hemi = new THREE.HemisphereLight(0xffffff, 0xdedede, 1.15);
scene.add(hemi);
const fill = new THREE.DirectionalLight(0xffffff, 0.7);
fill.position.set(8, 20, 6);
scene.add(fill);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(160, 160),
  new THREE.MeshBasicMaterial({ color: 0xffffff }),
);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

const grid = new THREE.GridHelper(120, 48, 0xededed, 0xf5f5f5);
grid.position.y = 0.012;
scene.add(grid);

const player = createPlayer();
scene.add(player);

const input = createInput();
const look = { yaw: 0, pitch: 0 };
const euler = new THREE.Euler(0, 0, 0, "YXZ");
const prevPlayer = player.position.clone();
const playerVel = new THREE.Vector3();
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let wires = null;
let glitch = null;
let playing = false;
let paused = false;

function isMouseLocked() {
  return document.pointerLockElement === canvas;
}

function lockMouse() {
  if (isMouseLocked()) return;
  try {
    const result = canvas.requestPointerLock();
    if (result && typeof result.catch === "function") result.catch(() => {});
  } catch {
    // The next click will retry.
  }
}

function placeCamera() {
  camera.position.set(player.position.x, player.position.y + EYE_HEIGHT, player.position.z);
  euler.set(look.pitch, look.yaw, 0);
  camera.quaternion.setFromEuler(euler);
}

function showPause() {
  if (!playing) return;
  paused = true;
  pauseOverlay.hidden = false;
  pauseOverlay.classList.remove("hidden");
  pauseOverlay.style.display = "flex";
  crosshair.classList.remove("visible");
  document.body.classList.remove("playing");
}

function hidePause() {
  paused = false;
  pauseOverlay.hidden = true;
  pauseOverlay.classList.add("hidden");
  pauseOverlay.style.display = "none";
  crosshair.classList.add("visible");
  document.body.classList.add("playing");
}

function startPlay() {
  playing = true;
  overlay.classList.add("hidden");
  overlay.style.display = "none";
  unlockHarp();
  lockMouse();
}

function resumePlay() {
  if (!playing) {
    startPlay();
    return;
  }
  lockMouse();
}

function syncPointerLock() {
  if (!playing) return;
  if (isMouseLocked()) hidePause();
  else showPause();
}

function onPointerMove(event) {
  if (!isMouseLocked()) return;
  look.yaw -= event.movementX * 0.0022;
  look.pitch -= event.movementY * 0.002;
  look.pitch = THREE.MathUtils.clamp(look.pitch, -1.2, 1.2);
}

document.addEventListener("pointerlockchange", syncPointerLock);
document.addEventListener("visibilitychange", () => {
  if (!playing || document.hidden) return;
  syncPointerLock();
});

function onCanvasClick() {
  if (!playing) {
    startPlay();
    return;
  }
  if (paused || !isMouseLocked()) {
    lockMouse();
    return;
  }
  if (!wires) return;
  unlockHarp();
  ndc.set(0, 0);
  raycaster.setFromCamera(ndc, camera);
  wires.flick(raycaster);
}

overlay.addEventListener("click", startPlay);
continueBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  resumePlay();
});
pauseOverlay.addEventListener("click", (event) => {
  if (event.target !== pauseOverlay) return;
  resumePlay();
});
canvas.addEventListener("click", onCanvasClick);
document.addEventListener("mousemove", onPointerMove);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (wires) wires.resize(window.innerWidth, window.innerHeight);
});

placeCamera();

const clock = new THREE.Clock();

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (playing && !paused) updatePlayer(player, input, look.yaw, dt);
  if (dt > 1e-5) {
    playerVel.copy(player.position).sub(prevPlayer).divideScalar(dt);
  } else {
    playerVel.set(0, 0, 0);
  }
  prevPlayer.copy(player.position);
  if (wires) wires.update(dt, player.position, playerVel);
  if (glitch) glitch.update(dt);
  placeCamera();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

createSigns(scene)
  .then((signs) => {
    try {
      wires = createWires(scene, signs);
      wires.resize(window.innerWidth, window.innerHeight);
    } catch (err) {
      console.error("Failed to create cables", err);
    }
    try {
      glitch = createGlitch(scene);
    } catch (err) {
      console.error("Failed to create glitch particles", err);
    }
    if (new URLSearchParams(location.search).has("play")) startPlay();

    let lastReplaceId = null;
    const pollIncoming = async () => {
      try {
        const res = await fetch(`./assets/replace.json?t=${Date.now()}`);
        if (!res.ok) return;
        const event = await res.json();
        if (!event.id) return;
        const firstPoll = lastReplaceId === null;
        if (event.id === lastReplaceId) return;
        lastReplaceId = event.id;
        if (firstPoll && Date.now() - event.id > 120000) return;
        const replaced = await applyDroppedFigure(signs.group, event);
        if (glitch && replaced.length) glitch.burstSigns(replaced);
        playSwapGlitch();
        console.log(`replaced ${replaced.length} signs with ${event.figure}`);
      } catch (err) {
        console.warn("incoming figure poll failed", err);
      }
    };
    setInterval(pollIncoming, 900);
    pollIncoming();
  })
  .catch((err) => {
    console.error("Failed to load figure signs", err);
  });
tick();
