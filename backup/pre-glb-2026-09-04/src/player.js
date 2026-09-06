import * as THREE from "three";

const WALK_SPEED = 4.2;
const SPRINT_SPEED = 7.2;
const PLAYER_RADIUS = 0.28;
const WORLD_RADIUS = 52;
export const EYE_HEIGHT = 1.62;

export function createPlayer() {
  const root = new THREE.Group();
  root.name = "Player";
  root.position.set(0, 0, 8);
  return root;
}

export function createInput() {
  const keys = new Set();
  const onDown = (e) => {
    keys.add(e.code);
    if (
      e.code === "KeyW" ||
      e.code === "KeyA" ||
      e.code === "KeyS" ||
      e.code === "KeyD" ||
      e.code.startsWith("Arrow")
    ) {
      e.preventDefault();
    }
  };
  const onUp = (e) => keys.delete(e.code);
  window.addEventListener("keydown", onDown);
  window.addEventListener("keyup", onUp);
  return {
    keys,
    dispose() {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    },
  };
}

export function updatePlayer(player, input, cameraYaw, dt) {
  const forward =
    (input.keys.has("KeyW") || input.keys.has("ArrowUp") ? 1 : 0) -
    (input.keys.has("KeyS") || input.keys.has("ArrowDown") ? 1 : 0);
  const right =
    (input.keys.has("KeyD") || input.keys.has("ArrowRight") ? 1 : 0) -
    (input.keys.has("KeyA") || input.keys.has("ArrowLeft") ? 1 : 0);
  const sprint = input.keys.has("ShiftLeft") || input.keys.has("ShiftRight");

  if (forward === 0 && right === 0) return;

  const move = new THREE.Vector3(
    -Math.sin(cameraYaw) * forward + Math.cos(cameraYaw) * right,
    0,
    -Math.cos(cameraYaw) * forward - Math.sin(cameraYaw) * right,
  );
  if (move.lengthSq() < 0.0001) return;
  move.normalize();

  const speed = sprint ? SPRINT_SPEED : WALK_SPEED;
  player.position.addScaledVector(move, speed * dt);

  const radial = Math.hypot(player.position.x, player.position.z);
  const maxR = WORLD_RADIUS - PLAYER_RADIUS;
  if (radial > maxR) {
    player.position.x *= maxR / radial;
    player.position.z *= maxR / radial;
  }
}
