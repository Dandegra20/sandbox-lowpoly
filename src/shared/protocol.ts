import type { Appearance } from '../content/cosmetics';
import type { ModeId } from '../content/modes';

// Protocolo de red.
// - Mensajes de control (salas, chat, expulsiones, ping) => JSON (texto), poco frecuentes.
// - Inputs (60 Hz) y snapshots (20 Hz) => binario (ArrayBuffer), ver snapshot.ts e input.ts.

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export interface PlayerInfo {
  id: number;
  name: string;
  color: number;
  /** false mientras el jugador está desconectado pero su hueco sigue reservado. */
  connected: boolean;
  kills: number;
  deaths: number;
  /** Aspecto elegido en el editor de personaje (validado por el servidor). */
  look: Appearance;
}

export interface PropInfo {
  id: number;
  /** Clave del registro de objetos (src/content/props.ts). */
  type: string;
  pos: Vec3;
  rot: Quat;
  /** Jugador que lo creó (-1 = del mapa). */
  owner: number;
  /** Tinte por instancia (0xffffff = colores originales). */
  tint: number;
  /** Escala uniforme (herramienta Escalar). */
  scale: number;
  /** Congelado en el sitio (herramienta Mover). */
  frozen: boolean;
}

/** Soldadura o cuerda entre dos objetos (b = 0: el mundo). Anclajes en el espacio local de cada uno. */
export interface ConstraintInfo {
  id: number;
  kind: 'weld' | 'rope';
  a: number;
  b: number;
  la: Vec3;
  /** Local de b, o del mundo si b = 0. */
  lb: Vec3;
}

/** Propulsor pegado a un objeto: posición y dirección de empuje en el espacio local del objeto. */
export interface ThrusterInfo {
  id: number;
  prop: number;
  pos: Vec3;
  dir: Vec3;
  active: boolean;
}

/** Estado del modo de juego de la sala. */
export interface ModeState {
  id: ModeId;
  /** 0 = sin límite (Sandbox). */
  killLimit: number;
  state: 'playing' | 'ended';
  /** Con la ronda terminada: ganador, clasificación y cuánto falta para la siguiente. */
  winner?: number;
  ranking?: [id: number, kills: number, deaths: number][];
  restartMs?: number;
}

export type LeaveReason = 'left' | 'timeout' | 'kicked';

export type ErrorCode =
  | 'room_not_found'
  | 'room_full'
  | 'banned'
  | 'session_invalid'
  | 'session_in_use'
  | 'not_host'
  | 'rate_limited'
  | 'limit_reached'
  | 'not_allowed'
  | 'bad_request';

// ---------- Cliente -> Servidor ----------
export type ClientMessage =
  | { t: 'create_room'; name: string; clientId: string; look: Appearance; map?: string; mode?: ModeId; killLimit?: number }
  | { t: 'join_room'; code: string; name: string; clientId: string; look: Appearance }
  /** Cambio de aspecto en partida (editor de personaje). */
  | { t: 'look'; look: Appearance }
  /** Reconexión con el token recibido en el welcome. */
  | { t: 'rejoin'; code: string; token: string }
  | { t: 'leave' }
  | { t: 'chat'; text: string }
  | { t: 'kick'; id: number }
  /** Crear un objeto del menú de spawn (id de spawnables.ts) donde apunta el jugador. */
  | { t: 'spawn'; id: string }
  /** Borrar el último objeto creado por el jugador. */
  | { t: 'undo' }
  /** Borrar todos los objetos del jugador. */
  | { t: 'clear_props' }
  /** Herramienta seleccionada de la tool gun (y su color, para Pintar). */
  | { t: 'tool'; id: string; color: number }
  /** rtt: último ping medido por el cliente (ms), para mostrarlo a los demás. */
  | { t: 'ping'; n: number; rtt: number };

// ---------- Servidor -> Cliente ----------
export type ServerMessage =
  | {
      t: 'welcome';
      playerId: number;
      hostId: number;
      /** Token secreto para reconectar a este mismo hueco. */
      token: string;
      roomCode: string;
      map: string;
      players: PlayerInfo[];
      props: PropInfo[];
      mode: ModeState;
      constraints: ConstraintInfo[];
      thrusters: ThrusterInfo[];
    }
  | { t: 'player_joined'; player: PlayerInfo }
  | { t: 'player_left'; id: number; reason: LeaveReason }
  | { t: 'player_status'; id: number; connected: boolean }
  | { t: 'player_look'; id: number; look: Appearance }
  /** Fin de ronda (Deathmatch): ganador y clasificación; la siguiente empieza en restartMs. */
  | { t: 'round_end'; mode: ModeState }
  /** Nueva ronda: marcadores a cero, todos reaparecen y el mapa vuelve a su estado inicial. */
  | { t: 'round_start'; mode: ModeState }
  | { t: 'host_changed'; id: number }
  | { t: 'chat'; from: number; text: string }
  | { t: 'pong'; n: number }
  /** Pings de todos los jugadores: [id, ms][] */
  | { t: 'stats'; pings: [number, number][] }
  | { t: 'kicked' }
  // --- Combate (eventos para efectos y marcador; el estado vive en el snapshot) ---
  /** Disparo instantáneo: origen y punto final de cada perdigón (k: 0 mundo, 1 jugador, 2 objeto, 3 nada). */
  | { t: 'shot'; by: number; w: number; o: Vec3; e: [number, number, number, number][] }
  /** Gravity gun: empujón o lanzamiento (para el efecto). */
  | { t: 'punt'; by: number; o: Vec3; to: Vec3 }
  | { t: 'projectile'; id: number; by: number; w: number; pos: Vec3; dir: Vec3; tick: number }
  /** id = proyectil (0 si es un bidón); r = radio de la explosión. */
  | { t: 'explode'; id: number; pos: Vec3; w: number; r: number }
  /** Solo al afectado y al atacante. */
  | { t: 'damage'; target: number; by: number; amount: number; health: number; from: Vec3 }
  /** killer = -1: muerte sin atacante (caída). Incluye el marcador actualizado de ambos. */
  | {
      t: 'kill';
      victim: number;
      killer: number;
      w: number;
      pos: Vec3;
      respawnMs: number;
      scores: [id: number, kills: number, deaths: number][];
    }
  | { t: 'prop_added'; prop: PropInfo }
  | { t: 'prop_removed'; id: number }
  /** Cambio de pintura, escala o congelado de un objeto. */
  | { t: 'prop_update'; id: number; tint?: number; scale?: number; frozen?: boolean }
  | { t: 'constraint_added'; c: ConstraintInfo }
  | { t: 'constraint_removed'; id: number }
  | { t: 'thruster_added'; th: ThrusterInfo }
  | { t: 'thruster_removed'; id: number }
  | { t: 'thruster_active'; id: number; active: boolean }
  /** Rayo de la tool gun (para que los demás lo vean). */
  | { t: 'tool_fx'; by: number; tool: string; o: Vec3; to: Vec3 }
  /** Mensaje de la herramienta para quien la usa (p. ej. "Elige el segundo objeto"). */
  | { t: 'tool_msg'; text: string; ok: boolean }
  | { t: 'error'; code: ErrorCode; message: string };

/** Primer byte de cada mensaje binario. */
export enum BinaryType {
  Snapshot = 1,
  Input = 2,
}

/** Bits del campo "buttons" del input. */
export enum Button {
  Forward = 1 << 0,
  Back = 1 << 1,
  Left = 1 << 2,
  Right = 1 << 3,
  Jump = 1 << 4,
  Sprint = 1 << 5,
  Fire = 1 << 6,
  AltFire = 1 << 7,
  /** E: subir/bajar del vehículo. */
  Use = 1 << 8,
  /** R: acción secundaria de la herramienta. */
  Reload = 1 << 9,
}

/** Armas "falsas" para el evento kill: muerte por caída, explosión de un bidón, atropello. */
export const WEAPON_FALL = 255;
export const WEAPON_EXPLOSION = 254;
export const WEAPON_VEHICLE = 253;
