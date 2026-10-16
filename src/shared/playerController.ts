// Controlador del jugador: movimiento con aceleración, sprint, salto (coyote time + buffer)
// y colisiones de cápsula. Es determinista y se ejecuta igual en servidor y cliente:
// si cambias algo aquí, la predicción del cliente sigue coincidiendo sin tocar nada más.

import {
  GRAVITY, PLAYER_AIR_ACCEL, PLAYER_COYOTE_TICKS, PLAYER_GROUND_ACCEL, PLAYER_GROUND_SNAP,
  PLAYER_HALF_HEIGHT, PLAYER_JUMP_BUFFER_TICKS, PLAYER_JUMP_SPEED, PLAYER_MAX_FALL_SPEED,
  PLAYER_RADIUS, PLAYER_SPRINT_SPEED, PLAYER_WALK_SPEED, TICK_DT, WALKABLE_NORMAL_Y,
} from './constants';
import { Button } from './protocol';
import { boundingRadius, capsuleContact, type Contact, type Shape } from './collision';

export interface MoveState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  sprinting: boolean;
  /** Ticks restantes en los que aún se puede saltar tras dejar el suelo. */
  coyote: number;
  /** Ticks restantes de una pulsación de salto pendiente. */
  jumpBuffer: number;
  /** Si el salto estaba pulsado en el tick anterior (para detectar la pulsación). */
  prevJump: boolean;
}

/** Contacto con un objeto dinámico: el servidor lo convierte en un empujón. */
export interface PushContact {
  propId: number;
  /** Dirección horizontal del empujón (normalizada). */
  dx: number;
  dz: number;
  /** Velocidad con la que el jugador quiere avanzar contra el objeto. */
  speed: number;
}

export function createMoveState(x = 0, y = 0, z = 0): MoveState {
  return { x, y, z, vx: 0, vy: 0, vz: 0, grounded: false, sprinting: false, coyote: 0, jumpBuffer: 0, prevJump: false };
}

export function copyMoveState(dst: MoveState, src: MoveState): MoveState {
  dst.x = src.x; dst.y = src.y; dst.z = src.z;
  dst.vx = src.vx; dst.vy = src.vy; dst.vz = src.vz;
  dst.grounded = src.grounded;
  dst.sprinting = src.sprinting;
  dst.coyote = src.coyote;
  dst.jumpBuffer = src.jumpBuffer;
  dst.prevJump = src.prevJump;
  return dst;
}

/**
 * Velocidad horizontal deseada a partir de los botones y el yaw.
 * Convención: yaw = 0 mira hacia -Z (igual que la cámara de Three.js).
 */
export function wishVelocity(buttons: number, yaw: number): { x: number; z: number; sprint: boolean } {
  let f = 0;
  let r = 0;
  if (buttons & Button.Forward) f += 1;
  if (buttons & Button.Back) f -= 1;
  if (buttons & Button.Right) r += 1;
  if (buttons & Button.Left) r -= 1;
  if (f === 0 && r === 0) return { x: 0, z: 0, sprint: false };
  // Solo se esprinta hacia delante (también en diagonal).
  const sprint = (buttons & Button.Sprint) !== 0 && f > 0;
  const speed = sprint ? PLAYER_SPRINT_SPEED : PLAYER_WALK_SPEED;
  const len = Math.hypot(f, r);
  f /= len;
  r /= len;
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  // forward = (-sin, -cos), right = (cos, -sin)
  return { x: (-sin * f + cos * r) * speed, z: (-cos * f - sin * r) * speed, sprint };
}

const contact: Contact = { nx: 0, ny: 0, nz: 0, depth: 0 };
const CAPSULE_BOUND = PLAYER_HALF_HEIGHT + PLAYER_RADIUS;
/** Distancia máxima recorrida por subpaso (evita atravesar objetos finos a mucha velocidad). */
const MAX_SUBSTEP = 0.25;
const near: Shape[] = [];

/**
 * Avanza un tick (TICK_DT) el estado del jugador.
 * @param shapes  Mundo de colisión (suelo, bloques, objetos, otros jugadores).
 * @param selfId  Id del propio jugador, para ignorar su propia cápsula.
 * @param pushes  Si se pasa, recibe los contactos con objetos dinámicos.
 * @param ignoreProp  Objeto que el jugador sujeta con la gravity gun (no colisiona con él).
 */
export function stepPlayer(
  s: MoveState,
  buttons: number,
  yaw: number,
  shapes: readonly Shape[],
  selfId: number,
  pushes?: PushContact[],
  ignoreProp = 0,
): void {
  const dt = TICK_DT;
  const wish = wishVelocity(buttons, yaw);

  // 1. Aceleración horizontal hacia la velocidad deseada (menos control en el aire).
  const accel = (s.grounded ? PLAYER_GROUND_ACCEL : PLAYER_AIR_ACCEL) * dt;
  const ddx = wish.x - s.vx;
  const ddz = wish.z - s.vz;
  const dlen = Math.hypot(ddx, ddz);
  if (dlen <= accel) {
    s.vx = wish.x;
    s.vz = wish.z;
  } else {
    s.vx += (ddx / dlen) * accel;
    s.vz += (ddz / dlen) * accel;
  }

  // 2. Salto: se detecta la pulsación (no mantener) y se admite un pequeño margen antes/después.
  const jumpDown = (buttons & Button.Jump) !== 0;
  if (jumpDown && !s.prevJump) s.jumpBuffer = PLAYER_JUMP_BUFFER_TICKS;
  s.prevJump = jumpDown;
  let jumped = false;
  if (s.jumpBuffer > 0 && s.coyote > 0) {
    s.vy = PLAYER_JUMP_SPEED;
    s.jumpBuffer = 0;
    s.coyote = 0;
    jumped = true;
  } else if (s.jumpBuffer > 0) {
    s.jumpBuffer--;
  }

  // 3. Gravedad.
  s.vy = Math.max(s.vy - GRAVITY * dt, -PLAYER_MAX_FALL_SPEED);

  // 4. Movimiento con colisiones, en subpasos si va rápido.
  const wasGrounded = s.grounded;
  s.grounded = false;
  const travel = Math.hypot(s.vx, s.vy, s.vz) * dt;
  collectNear(s, shapes, selfId, ignoreProp, travel + PLAYER_GROUND_SNAP);
  const steps = Math.max(1, Math.ceil(travel / MAX_SUBSTEP));
  for (let i = 0; i < steps; i++) {
    s.x += (s.vx * dt) / steps;
    s.y += (s.vy * dt) / steps;
    s.z += (s.vz * dt) / steps;
    resolve(s, wish.x, wish.z, pushes);
  }

  // 5. Pegarse al suelo al bajar pequeños desniveles (si no hemos saltado).
  if (wasGrounded && !s.grounded && !jumped && s.vy <= 0) {
    const y0 = s.y;
    s.y -= PLAYER_GROUND_SNAP;
    resolve(s, wish.x, wish.z, undefined);
    if (!s.grounded) s.y = y0;
  }

  s.coyote = s.grounded ? PLAYER_COYOTE_TICKS : Math.max(0, s.coyote - 1);
  s.sprinting = wish.sprint && s.grounded;
}

/** Filtra las formas cercanas a la cápsula (fase amplia muy simple). */
function collectNear(s: MoveState, shapes: readonly Shape[], selfId: number, ignoreProp: number, extra: number): void {
  near.length = 0;
  const reach = CAPSULE_BOUND + extra + 0.1;
  for (const sh of shapes) {
    if (sh.kind === 'ground') {
      near.push(sh);
      continue;
    }
    if (sh.kind === 'capsule' && sh.playerId === selfId) continue;
    if (ignoreProp && sh.kind !== 'capsule' && sh.propId === ignoreProp) continue;
    const r = boundingRadius(sh) + reach;
    const dx = sh.x - s.x, dy = sh.y - s.y, dz = sh.z - s.z;
    if (dx * dx + dy * dy + dz * dz < r * r) near.push(sh);
  }
}

/** Saca la cápsula de las formas que penetra y recorta la velocidad contra ellas. */
function resolve(s: MoveState, wishX: number, wishZ: number, pushes: PushContact[] | undefined): void {
  for (let iter = 0; iter < 4; iter++) {
    let any = false;
    for (const sh of near) {
      if (!capsuleContact(s.x, s.y, s.z, sh, contact)) continue;
      any = true;
      const { nx, ny, nz, depth } = contact;
      s.x += nx * depth;
      s.y += ny * depth;
      s.z += nz * depth;
      const vn = s.vx * nx + s.vy * ny + s.vz * nz;
      if (vn < 0) {
        s.vx -= nx * vn;
        s.vy -= ny * vn;
        s.vz -= nz * vn;
      }
      if (ny > WALKABLE_NORMAL_Y) s.grounded = true;

      // Empujar objetos dinámicos con los que chocamos de lado.
      if (pushes && sh.kind !== 'ground' && sh.kind !== 'capsule' && sh.propId !== undefined && Math.abs(ny) < 0.7) {
        const hl = Math.hypot(nx, nz);
        if (hl > 1e-4) {
          const dx = -nx / hl, dz = -nz / hl;
          const speed = wishX * dx + wishZ * dz;
          if (speed > 0) pushes.push({ propId: sh.propId, dx, dz, speed });
        }
      }
    }
    if (!any) break;
  }
}
