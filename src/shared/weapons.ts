// Lógica de disparo compartida y determinista. El servidor la usa para validar (cadencia,
// cambio de arma, dirección de cada perdigón) y el cliente la repite para mostrar los
// efectos al instante, sin esperar al servidor. Mismos inputs => mismos disparos.

import { WEAPONS, type WeaponDef } from '../content/weapons';
import { TICK_RATE, WEAPON_SWITCH_MS } from './constants';
import { Button, type Vec3 } from './protocol';

const msToTicks = (ms: number) => Math.max(1, Math.round((ms / 1000) * TICK_RATE));
const SWITCH_TICKS = msToTicks(WEAPON_SWITCH_MS);

export interface FireState {
  weapon: number;
  /** Ticks hasta poder volver a disparar. */
  cooldown: number;
  /** Ticks hasta tener el arma lista tras cambiar. */
  switching: number;
  prevButtons: number;
}

export interface FireResult {
  /** Disparo principal (clic izquierdo). */
  primary: boolean;
  /** Acción secundaria (clic derecho, solo gravity gun). */
  secondary: boolean;
  /** El arma cambió en este tick. */
  switched: boolean;
}

export function createFireState(weapon = 0): FireState {
  return { weapon, cooldown: 0, switching: 0, prevButtons: 0 };
}

/** Avanza un tick (un input) del estado de disparo. */
export function stepFire(s: FireState, buttons: number, weapon: number): FireResult {
  const res: FireResult = { primary: false, secondary: false, switched: false };
  if (weapon !== s.weapon && weapon >= 0 && weapon < WEAPONS.length) {
    s.weapon = weapon;
    s.switching = SWITCH_TICKS;
    s.cooldown = 0;
    res.switched = true;
  }
  if (s.cooldown > 0) s.cooldown--;
  if (s.switching > 0) s.switching--;

  const def = WEAPONS[s.weapon];
  const fire = (buttons & Button.Fire) !== 0;
  const fireEdge = fire && !(s.prevButtons & Button.Fire);
  const altEdge = (buttons & Button.AltFire) !== 0 && !(s.prevButtons & Button.AltFire);
  s.prevButtons = buttons;
  if (s.switching > 0) return res;

  if (def.gravity || def.tool) {
    // primary = pulsar (sin enfriamiento; agarrar/usar); secondary = clic derecho (con enfriamiento).
    res.primary = fireEdge;
    if (altEdge && s.cooldown === 0) {
      res.secondary = true;
      s.cooldown = msToTicks(def.fireMs);
    }
    return res;
  }

  if (s.cooldown === 0 && (def.automatic ? fire : fireEdge)) {
    res.primary = true;
    s.cooldown = msToTicks(def.fireMs);
  }
  if (altEdge) res.secondary = true;
  return res;
}

export type GravityAction = 'grab' | 'drop' | 'throw' | 'punt' | null;

/**
 * Qué hace la pistola de gravedad en este tick (llamar con el resultado de stepFire).
 * Sujetando: soltar el clic izquierdo suelta; el derecho lanza. Sin sujetar: el izquierdo
 * intenta agarrar; el derecho empuja.
 */
export function gravityAction(buttons: number, res: FireResult, holding: boolean): GravityAction {
  if (holding) {
    if (!(buttons & Button.Fire)) return 'drop';
    return res.secondary ? 'throw' : null;
  }
  if (res.primary) return 'grab';
  return res.secondary ? 'punt' : null;
}

/** Dirección de la mirada. yaw = 0 mira hacia -Z. */
export function aimDirection(yaw: number, pitch: number): Vec3 {
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
}

/** PRNG pequeño y determinista (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Direcciones de los perdigones de un disparo hitscan. La dispersión es pseudoaleatoria
 * pero depende solo de (jugador, nº de input), así cliente y servidor obtienen las mismas.
 */
export function pelletDirections(def: WeaponDef, yaw: number, pitch: number, playerId: number, seq: number): Vec3[] {
  const spec = def.hitscan!;
  const [fx, fy, fz] = aimDirection(yaw, pitch);
  // Base ortonormal de la mirada.
  const rx = Math.cos(yaw), rz = -Math.sin(yaw); // derecha
  // arriba = derecha × adelante
  const ux = Math.sin(yaw) * fy, uy = Math.cos(pitch), uz = Math.cos(yaw) * fy;
  const rand = rng(seq * 7919 + playerId * 104729);
  const dirs: Vec3[] = [];
  for (let i = 0; i < spec.pellets; i++) {
    // Punto uniforme en un disco de radio = spread.
    const r = spec.spread * Math.sqrt(rand());
    const a = rand() * Math.PI * 2;
    const dx = r * Math.cos(a), dy = r * Math.sin(a);
    const x = fx + rx * dx + ux * dy;
    const y = fy + uy * dy;
    const z = fz + rz * dx + uz * dy;
    const len = Math.hypot(x, y, z);
    dirs.push([x / len, y / len, z / len]);
  }
  return dirs;
}
