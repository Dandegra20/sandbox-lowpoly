// Registro de armas. Añadir un arma = añadir una entrada aquí (con su `slot`).
// El servidor usa las estadísticas para validar y aplicar el disparo; el cliente usa
// `model`, `muzzle` y los colores para dibujarla y para los efectos.
// Un arma tiene exactamente uno de: `hitscan`, `projectile`, `gravity` o `tool`.

import type { Vec3 } from '../shared/protocol';
import type { SoundId } from './sounds';

/** Pieza del modelo low-poly. Espacio del arma: empuñadura en el origen, cañón hacia -Z. */
export type ModelPart =
  | { kind: 'box'; size: Vec3; pos: Vec3; color: number }
  /** Cilindro orientado a lo largo de Z. */
  | { kind: 'cyl'; radius: number; length: number; pos: Vec3; color: number };

/** Disparo instantáneo (rayo). */
export interface HitscanSpec {
  damage: number;
  /** Proyectiles por disparo (escopeta > 1). */
  pellets: number;
  /** Dispersión máxima (radianes). */
  spread: number;
  range: number;
  /** Impulso que recibe un objeto alcanzado (por perdigón). */
  impulse: number;
  headshotMultiplier: number;
}

/** Proyectil que vuela en línea recta y explota. */
export interface ProjectileSpec {
  speed: number;
  /** Vida máxima antes de explotar solo (s). */
  lifetime: number;
  explosionRadius: number;
  /** Daño en el centro; decrece linealmente hasta el borde. */
  damage: number;
  /** Impulso a objetos en el centro de la explosión. */
  impulse: number;
  /** Velocidad que reciben los jugadores en el centro (permite rocket jumps). */
  knockback: number;
  /** Multiplicador del daño a uno mismo. */
  selfDamage: number;
  color: number;
}

/**
 * Pistola de gravedad (estilo physgun): mantener clic izquierdo agarra el objeto apuntado y lo
 * arrastra por el aire a la misma distancia; la rueda lo acerca/aleja; al soltar cae conservando
 * su impulso. Clic derecho empuja lo que haya delante (o lanza con fuerza lo que sujetas).
 */
export interface GravitySpec {
  /** Alcance para agarrar. */
  grabRange: number;
  /** Distancia mínima y máxima a la que se puede sujetar un objeto. */
  minHoldDistance: number;
  maxHoldDistance: number;
  /** Metros por "clic" de la rueda. */
  wheelStep: number;
  puntRange: number;
  /** Cambio de velocidad al empujar un objeto (m/s, se reduce con la masa). */
  puntSpeed: number;
  /** Velocidad de lanzamiento de un objeto sujeto (m/s, se reduce con la masa). */
  launchSpeed: number;
  maxMass: number;
  /** Velocidad que recibe un jugador al empujarlo. */
  playerKnockback: number;
  beamColor: number;
}

export interface WeaponDef {
  id: string;
  name: string;
  /** Tecla numérica (1..9). */
  slot: number;
  /** Tiempo mínimo entre disparos (ms). */
  fireMs: number;
  /** true = mantener el botón dispara en ráfaga. */
  automatic: boolean;
  hitscan?: HitscanSpec;
  projectile?: ProjectileSpec;
  gravity?: GravitySpec;
  /** Tool gun: usa la herramienta seleccionada (content/tools.ts). */
  tool?: boolean;
  model: ModelPart[];
  /** Punta del cañón (espacio del arma). */
  muzzle: Vec3;
  tracerColor: number;
  /** Retroceso visual (0..1). */
  recoil: number;
  /** Sonido del disparo (content/sounds.ts). Con la pistola de gravedad, el del empujón. */
  sound: SoundId;
}

const METAL = 0x3b4252;
const DARK = 0x23272e;
const WOOD = 0x8d5a2b;

const defs: WeaponDef[] = [
  {
    id: 'pistol', name: 'Pistola', slot: 1, fireMs: 250, automatic: false,
    hitscan: { damage: 22, pellets: 1, spread: 0.008, range: 200, impulse: 40, headshotMultiplier: 2 },
    model: [
      { kind: 'box', size: [0.07, 0.16, 0.1], pos: [0, -0.05, 0.02], color: DARK },
      { kind: 'box', size: [0.08, 0.08, 0.3], pos: [0, 0.05, -0.08], color: METAL },
    ],
    muzzle: [0, 0.05, -0.24], tracerColor: 0xffe08a, recoil: 0.5, sound: 'pistol',
  },
  {
    id: 'shotgun', name: 'Escopeta', slot: 2, fireMs: 900, automatic: false,
    hitscan: { damage: 11, pellets: 8, spread: 0.075, range: 60, impulse: 30, headshotMultiplier: 1.5 },
    model: [
      { kind: 'box', size: [0.08, 0.14, 0.32], pos: [0, -0.02, 0.18], color: WOOD },
      { kind: 'box', size: [0.1, 0.1, 0.22], pos: [0, 0.03, -0.06], color: METAL },
      { kind: 'cyl', radius: 0.03, length: 0.5, pos: [0, 0.06, -0.38], color: DARK },
      { kind: 'box', size: [0.08, 0.06, 0.25], pos: [0, -0.02, -0.3], color: WOOD },
    ],
    muzzle: [0, 0.06, -0.63], tracerColor: 0xffc070, recoil: 1, sound: 'shotgun',
  },
  {
    id: 'rifle', name: 'Rifle', slot: 3, fireMs: 100, automatic: true,
    hitscan: { damage: 12, pellets: 1, spread: 0.018, range: 200, impulse: 25, headshotMultiplier: 1.5 },
    model: [
      { kind: 'box', size: [0.07, 0.12, 0.25], pos: [0, -0.01, 0.2], color: DARK },
      { kind: 'box', size: [0.09, 0.12, 0.35], pos: [0, 0.03, -0.08], color: 0x4c6a4f },
      { kind: 'box', size: [0.05, 0.16, 0.07], pos: [0, -0.1, -0.05], color: DARK },
      { kind: 'cyl', radius: 0.022, length: 0.35, pos: [0, 0.05, -0.42], color: DARK },
      { kind: 'box', size: [0.04, 0.05, 0.12], pos: [0, 0.12, -0.05], color: DARK },
    ],
    muzzle: [0, 0.05, -0.6], tracerColor: 0xfff2b0, recoil: 0.35, sound: 'rifle',
  },
  {
    id: 'rocket', name: 'Lanzacohetes', slot: 4, fireMs: 1000, automatic: false,
    projectile: {
      speed: 32, lifetime: 5, explosionRadius: 5, damage: 110, impulse: 900, knockback: 14, selfDamage: 0.5,
      color: 0xd35400,
    },
    model: [
      { kind: 'cyl', radius: 0.09, length: 0.9, pos: [0, 0.08, -0.15], color: 0x556b2f },
      { kind: 'cyl', radius: 0.11, length: 0.08, pos: [0, 0.08, -0.6], color: DARK },
      { kind: 'box', size: [0.06, 0.16, 0.08], pos: [0, -0.06, 0], color: DARK },
      { kind: 'box', size: [0.05, 0.08, 0.14], pos: [0, 0.2, -0.05], color: DARK },
    ],
    muzzle: [0, 0.08, -0.64], tracerColor: 0xffa040, recoil: 1, sound: 'rocket_launch',
  },
  {
    // fireMs: tiempo mínimo entre empujones (clic derecho).
    id: 'gravity', name: 'Pistola de gravedad', slot: 5, fireMs: 500, automatic: false,
    gravity: {
      grabRange: 40, minHoldDistance: 1.8, maxHoldDistance: 40, wheelStep: 1.5,
      puntRange: 9, puntSpeed: 14, launchSpeed: 28, maxMass: 300,
      playerKnockback: 11, beamColor: 0x6fe7ff,
    },
    model: [
      { kind: 'box', size: [0.16, 0.16, 0.36], pos: [0, 0.03, 0], color: 0xd9822b },
      { kind: 'box', size: [0.06, 0.16, 0.08], pos: [0, -0.1, 0.06], color: DARK },
      { kind: 'box', size: [0.04, 0.04, 0.22], pos: [0.07, 0.07, -0.26], color: METAL },
      { kind: 'box', size: [0.04, 0.04, 0.22], pos: [-0.07, 0.07, -0.26], color: METAL },
      { kind: 'box', size: [0.04, 0.04, 0.22], pos: [0, -0.04, -0.26], color: METAL },
      { kind: 'cyl', radius: 0.05, length: 0.06, pos: [0, 0.03, -0.2], color: 0x6fe7ff },
    ],
    muzzle: [0, 0.03, -0.38], tracerColor: 0x6fe7ff, recoil: 0.6, sound: 'gravity_punt',
  },
  {
    // fireMs: tiempo mínimo entre usos del clic derecho y de R.
    id: 'toolgun', name: 'Herramientas', slot: 6, fireMs: 200, automatic: false, tool: true,
    model: [
      { kind: 'box', size: [0.1, 0.13, 0.3], pos: [0, 0.03, -0.02], color: 0xdfe6e9 },
      { kind: 'box', size: [0.06, 0.15, 0.08], pos: [0, -0.1, 0.06], color: DARK },
      { kind: 'box', size: [0.11, 0.05, 0.12], pos: [0, 0.11, 0.0], color: 0x0984e3 },
      { kind: 'cyl', radius: 0.025, length: 0.18, pos: [0, 0.04, -0.25], color: METAL },
      { kind: 'box', size: [0.02, 0.06, 0.1], pos: [0.06, 0.03, 0.02], color: 0x00cec9 },
    ],
    muzzle: [0, 0.04, -0.35], tracerColor: 0x74b9ff, recoil: 0.2, sound: 'tool',
  },
];

/** Armas ordenadas por slot; el índice en este array es el que viaja en el input. */
export const WEAPONS: readonly WeaponDef[] = [...defs].sort((a, b) => a.slot - b.slot);
export const WEAPON_INDEX: Record<string, number> = Object.fromEntries(WEAPONS.map((w, i) => [w.id, i]));

export function getWeapon(index: number): WeaponDef | undefined {
  return WEAPONS[index];
}
