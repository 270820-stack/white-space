import * as THREE from "three";
import { collidePlayerWithSigns, createInput, createPlayer, EYE_HEIGHT, updatePlayer } from "./player.js?v=3";
import { createSigns, applyDroppedFigure, pickSwapSigns, updateSigns } from "./signs.js?v=21";
import { processOnlinePhoto, warmupOnline } from "./online-composite.js?v=1";
import { createWires } from "./wires.js?v=30";
import { createGlitch } from "./glitch.js?v=15";
import { createSelectBoxes } from "./select-box.js?v=3";
import { setCableVolume, unlockHarp } from "./harp.js?v=6";
import { playSelectLock, playSwapGlitch, setAnimVolume } from "./swap-sfx.js?v=7";

const canvas = document.querySelector("#c");
const overlay = document.querySelector("#overlay");
const pauseOverlay = document.querySelector("#pause");
const continueBtn = document.querySelector("#continue");
const crosshair = document.querySelector("#crosshair");
const volCables = document.querySelector("#vol-cables");
const volAnim = document.querySelector("#vol-anim");
const volCablesVal = document.querySelector("#vol-cables-val");
const volAnimVal = document.querySelector("#vol-anim-val");
const modeLive = document.querySelector("#mode-live");
const modeOnline = document.querySelector("#mode-online");
const cameraScreen = document.querySelector("#camera-screen");
const camVideo = document.querySelector("#cam-video");
const takePhotoBtn = document.querySelector("#take-photo");
const camBack = document.querySelector("#cam-back");
const camStatus = document.querySelector("#cam-status");
const retakePhotoBtn = document.querySelector("#retake-photo");

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
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0xffffff, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffffff);
scene.fog = new THREE.Fog(0xffffff, 8, 40);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.08, 260);

const hemi = new THREE.HemisphereLight(0xffffff, 0xe8e8e8, 0.92);
scene.add(hemi);
const fill = new THREE.DirectionalLight(0xffffff, 0.62);
fill.position.set(6.5, 19, -4.5);
fill.target.position.set(0, 0, 0);
fill.castShadow = true;
fill.shadow.mapSize.set(2048, 2048);
fill.shadow.camera.near = 2;
fill.shadow.camera.far = 70;
fill.shadow.camera.left = -46;
fill.shadow.camera.right = 46;
fill.shadow.camera.top = 46;
fill.shadow.camera.bottom = -46;
fill.shadow.bias = -0.0007;
fill.shadow.normalBias = 0.03;
fill.shadow.intensity = 0.32;
scene.add(fill);
scene.add(fill.target);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(160, 160),
  new THREE.MeshLambertMaterial({ color: 0xffffff }),
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const grid = new THREE.GridHelper(120, 96, 0xbdbdbd, 0xdcdcdc);
grid.position.y = 0.014;
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
let selectBoxes = null;
let signGroup = null;
let playing = false;
let paused = false;
let camStream = null;
let lastReplaceId = null;
let swapping = false;
let signsReady = null;
let onlineMode = false;

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

function isCameraOpen() {
  return Boolean(cameraScreen && !cameraScreen.hidden && !cameraScreen.classList.contains("hidden"));
}

function syncRetakeButton() {
  if (!retakePhotoBtn) return;
  retakePhotoBtn.hidden = !(onlineMode && playing);
}

function showPause() {
  if (!playing || isCameraOpen()) return;
  paused = true;
  pauseOverlay.hidden = false;
  pauseOverlay.classList.remove("hidden");
  pauseOverlay.style.display = "flex";
  crosshair.classList.remove("visible");
  document.body.classList.remove("playing");
  syncRetakeButton();
}

function hidePause() {
  paused = false;
  pauseOverlay.hidden = true;
  pauseOverlay.classList.add("hidden");
  pauseOverlay.style.display = "none";
  crosshair.classList.add("visible");
  document.body.classList.add("playing");
}

function stopCamera() {
  if (camStream) {
    camStream.getTracks().forEach((track) => track.stop());
    camStream = null;
  }
  if (camVideo) camVideo.srcObject = null;
}

function hideCameraScreen() {
  if (!cameraScreen) return;
  cameraScreen.classList.add("hidden");
  cameraScreen.hidden = true;
  stopCamera();
}

function showStartMenu() {
  playing = false;
  onlineMode = false;
  hideCameraScreen();
  overlay.classList.remove("hidden");
  overlay.style.display = "flex";
  syncRetakeButton();
}

function startPlay() {
  playing = true;
  overlay.classList.add("hidden");
  overlay.style.display = "none";
  hideCameraScreen();
  unlockHarp();
  syncRetakeButton();
  lockMouse();
}

function captureFaceFrame() {
  const width = camVideo.videoWidth;
  const height = camVideo.videoHeight;
  if (!width || !height) return null;
  const frame = document.createElement("canvas");
  frame.width = width;
  frame.height = height;
  const ctx = frame.getContext("2d");
  ctx.translate(width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(camVideo, 0, 0);
  return frame;
}

async function openOnline() {
  onlineMode = true;
  overlay.classList.add("hidden");
  overlay.style.display = "none";
  if (playing) {
    try {
      document.exitPointerLock();
    } catch {
      // Camera UI needs the pointer free.
    }
    pauseOverlay.hidden = true;
    pauseOverlay.classList.add("hidden");
    pauseOverlay.style.display = "none";
  }
  cameraScreen.hidden = false;
  cameraScreen.classList.remove("hidden");
  camStatus.textContent = "";
  takePhotoBtn.disabled = false;
  try {
    camStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 960 } },
      audio: false,
    });
    camVideo.srcObject = camStream;
    await camVideo.play();
    warmupOnline();
  } catch (err) {
    console.warn("camera unavailable", err);
    camStatus.textContent = "Camera unavailable. Allow access, then choose Online again.";
  }
}

async function runSwap(event) {
  if (!signsReady || !event?.figure) return;
  while (swapping) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  swapping = true;
  lastReplaceId = event.id;
  try {
    const targets = pickSwapSigns(signsReady.group, event.count);
    if (selectBoxes && targets.length) selectBoxes.show(targets);
    unlockHarp();
    playSelectLock();
    await new Promise((resolve) => setTimeout(resolve, 1800));
    const replaced = await applyDroppedFigure(signsReady.group, event, targets);
    if (selectBoxes) selectBoxes.confirm();
    if (glitch && replaced.length) glitch.burstSigns(replaced);
    playSwapGlitch();
    console.log(`replaced ${replaced.length} signs with ${event.figure}`);
    await new Promise((resolve) => setTimeout(resolve, 1500));
  } catch (err) {
    console.warn("swap failed", err);
  } finally {
    if (selectBoxes) selectBoxes.hide();
    swapping = false;
  }
}

async function takeOnlinePhoto() {
  if (takePhotoBtn.disabled) return;
  if (!camVideo.videoWidth) {
    camStatus.textContent = "Camera is still starting.";
    return;
  }
  takePhotoBtn.disabled = true;
  camStatus.textContent = "Taking photo…";
  const clickedAt = performance.now();
  const frame = captureFaceFrame();
  if (!frame) {
    camStatus.textContent = "Could not capture a frame.";
    takePhotoBtn.disabled = false;
    return;
  }
  startPlay();
  try {
    const event = await processOnlinePhoto(frame);
    lastReplaceId = event.id;
    const wait = Math.max(0, 5000 - (performance.now() - clickedAt));
    await new Promise((resolve) => setTimeout(resolve, wait));
    await runSwap(event);
  } catch (err) {
    console.warn("online photo failed", err);
  }
}

function resumePlay() {
  if (!playing) {
    startPlay();
    return;
  }
  lockMouse();
}

function syncPointerLock() {
  if (!playing || isCameraOpen()) return;
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
  if (!playing) return;
  if (paused || !isMouseLocked()) {
    lockMouse();
    return;
  }
  if (!wires) return;
  unlockHarp();
  ndc.set(0, 0);
  raycaster.setFromCamera(ndc, camera);
  wires.flick(raycaster, camera);
}

modeLive.addEventListener("click", (event) => {
  event.stopPropagation();
  onlineMode = false;
  startPlay();
});
modeOnline.addEventListener("click", (event) => {
  event.stopPropagation();
  openOnline();
});
takePhotoBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  takeOnlinePhoto();
});
retakePhotoBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  openOnline();
});
camBack.addEventListener("click", (event) => {
  event.stopPropagation();
  hideCameraScreen();
  if (playing) showPause();
  else showStartMenu();
});
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
  if (playing && !paused) {
    if (signGroup) updateSigns(signGroup, dt);
    updatePlayer(player, input, look.yaw, dt);
    if (signGroup) collidePlayerWithSigns(player, signGroup);
  }
  if (dt > 1e-5) {
    playerVel.copy(player.position).sub(prevPlayer).divideScalar(dt);
  } else {
    playerVel.set(0, 0, 0);
  }
  prevPlayer.copy(player.position);
  if (wires && !paused) wires.update(dt, player.position, playerVel);
  if (glitch) glitch.update(dt);
  placeCamera();
  if (selectBoxes) selectBoxes.update(dt, camera);
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

createSigns(scene)
  .then((signs) => {
    signGroup = signs.group;
    try {
      glitch = createGlitch(scene);
    } catch (err) {
      console.error("Failed to create glitch particles", err);
    }
    try {
      selectBoxes = createSelectBoxes(scene);
    } catch (err) {
      console.error("Failed to create select boxes", err);
    }
    signsReady = signs;
    if (new URLSearchParams(location.search).has("play")) startPlay();

    const pollIncoming = async () => {
      if (swapping) return;
      try {
        const res = await fetch(`./assets/replace.json?t=${Date.now()}`);
        if (!res.ok) return;
        const event = await res.json();
        if (!event.id) return;
        if (event.id === lastReplaceId) return;
        if (lastReplaceId != null && event.id < lastReplaceId) return;
        if (Date.now() - event.id > 120000) {
          lastReplaceId = event.id;
          return;
        }
        await runSwap(event);
      } catch (err) {
        console.warn("incoming figure poll failed", err);
      }
    };
    setInterval(pollIncoming, 900);
    pollIncoming();

    try {
      wires = createWires(scene, signs);
      wires.resize(window.innerWidth, window.innerHeight);
    } catch (err) {
      console.error("Failed to create cables", err);
    }
  })
  .catch((err) => {
    console.error("Failed to load figure signs", err);
  });
tick();
