import { BinaryType } from './protocol';
import type { MoveState } from './playerController';

// Snapshot binario compacto. Jugadores con posición float32 (la predicción necesita el estado
// exacto); objetos con posición en int16 (1/128 m) y rotación "smallest three" (3 × int16).
// Con 6 jugadores y la sala llena de objetos despiertos, esto deja la subida del anfitrión
// en unos 350 KB/s en lugar de ~560 (cabe en un túnel o una conexión doméstica).
// Layout:
//   u8 type | u32 tick | u8 nPlayers | [player]* | u16 nProps | [prop]*
//   player: u8 id | f32 x,y,z | f32 vx,vy,vz | i16 yaw | i16 pitch | u32 lastInputSeq
//           | u8 flags | u8 coyote | u8 jumpBuffer | u8 health | u8 weapon | u16 heldProp
//           | u8 holdDistance (x4) | u16 vehicle                                             (43 B)
//           (se envía el estado de movimiento completo para que el cliente pueda rebobinar y repetir)
//   prop:   u16 id | i16 x,y,z (×128) | i16 ×3 (smallest three) | u8 flags                 (15 B)
//           flags: bit 0 = dormido, bits 1-2 = índice de la componente mayor del cuaternión
// Los props dormidos se omiten salvo en snapshots completos (ver servidor).

export interface PlayerState extends MoveState {
  id: number;
  yaw: number;
  pitch: number;
  lastInputSeq: number;
  health: number;
  dead: boolean;
  /** Índice del arma en la mano. */
  weapon: number;
  /** Id del objeto sujeto con la pistola de gravedad (0 = ninguno). */
  heldProp: number;
  /** Distancia a la que lo sujeta (m, precisión 0,25). */
  holdDistance: number;
  /** Id del vehículo que conduce (0 = a pie). */
  vehicle: number;
}

export interface PropState {
  id: number;
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  sleeping: boolean;
}

export interface Snapshot {
  tick: number;
  players: PlayerState[];
  props: PropState[];
}

const PLAYER_BYTES = 43;

const packFlags = (p: PlayerState) =>
  (p.grounded ? 1 : 0) | (p.prevJump ? 2 : 0) | (p.sprinting ? 4 : 0) | (p.dead ? 8 : 0);
const PROP_BYTES = 15;
const I16 = 32767;
/** Resolución de la posición de los objetos: 1/128 m (error ≤ 4 mm), alcance ±256 m. */
const POS_SCALE = 128;
const quantPos = (v: number) => Math.round(Math.max(-I16, Math.min(I16, v * POS_SCALE)));
/** Las tres componentes pequeñas de un cuaternión unitario están en ±1/√2. */
const Q3_SCALE = I16 * Math.SQRT2;
const quatTmp = [0, 0, 0, 0];

const quantAngle = (a: number) => Math.round((wrapAngle(a) / Math.PI) * I16);
const dequantAngle = (q: number) => (q / I16) * Math.PI;

function wrapAngle(a: number): number {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

export function encodeSnapshot(s: Snapshot): ArrayBuffer {
  const size = 1 + 4 + 1 + s.players.length * PLAYER_BYTES + 2 + s.props.length * PROP_BYTES;
  const buf = new ArrayBuffer(size);
  const v = new DataView(buf);
  let o = 0;
  v.setUint8(o, BinaryType.Snapshot); o += 1;
  v.setUint32(o, s.tick, true); o += 4;
  v.setUint8(o, s.players.length); o += 1;
  for (const p of s.players) {
    v.setUint8(o, p.id); o += 1;
    v.setFloat32(o, p.x, true); o += 4;
    v.setFloat32(o, p.y, true); o += 4;
    v.setFloat32(o, p.z, true); o += 4;
    v.setFloat32(o, p.vx, true); o += 4;
    v.setFloat32(o, p.vy, true); o += 4;
    v.setFloat32(o, p.vz, true); o += 4;
    v.setInt16(o, quantAngle(p.yaw), true); o += 2;
    v.setInt16(o, quantAngle(p.pitch), true); o += 2;
    v.setUint32(o, p.lastInputSeq, true); o += 4;
    v.setUint8(o, packFlags(p)); o += 1;
    v.setUint8(o, Math.min(255, p.coyote)); o += 1;
    v.setUint8(o, Math.min(255, p.jumpBuffer)); o += 1;
    v.setUint8(o, Math.max(0, Math.min(255, Math.ceil(p.health)))); o += 1;
    v.setUint8(o, p.weapon); o += 1;
    v.setUint16(o, p.heldProp, true); o += 2;
    v.setUint8(o, Math.max(0, Math.min(255, Math.round(p.holdDistance * 4)))); o += 1;
    v.setUint16(o, p.vehicle, true); o += 2;
  }
  v.setUint16(o, s.props.length, true); o += 2;
  for (const p of s.props) {
    v.setUint16(o, p.id, true); o += 2;
    v.setInt16(o, quantPos(p.x), true); o += 2;
    v.setInt16(o, quantPos(p.y), true); o += 2;
    v.setInt16(o, quantPos(p.z), true); o += 2;
    // Smallest three: se omite la componente mayor (se reconstruye porque |q| = 1).
    const q = quatTmp;
    q[0] = p.qx; q[1] = p.qy; q[2] = p.qz; q[3] = p.qw;
    let big = 0;
    for (let i = 1; i < 4; i++) if (Math.abs(q[i]) > Math.abs(q[big])) big = i;
    const sign = q[big] < 0 ? -1 : 1;
    for (let i = 0; i < 4; i++) {
      if (i === big) continue;
      v.setInt16(o, Math.round(Math.max(-I16, Math.min(I16, q[i] * sign * Q3_SCALE))), true); o += 2;
    }
    v.setUint8(o, (p.sleeping ? 1 : 0) | (big << 1)); o += 1;
  }
  return buf;
}

export function decodeSnapshot(v: DataView): Snapshot {
  let o = 1;
  const tick = v.getUint32(o, true); o += 4;
  const nPlayers = v.getUint8(o); o += 1;
  const players: PlayerState[] = [];
  for (let i = 0; i < nPlayers; i++) {
    const id = v.getUint8(o); o += 1;
    const x = v.getFloat32(o, true); o += 4;
    const y = v.getFloat32(o, true); o += 4;
    const z = v.getFloat32(o, true); o += 4;
    const vx = v.getFloat32(o, true); o += 4;
    const vy = v.getFloat32(o, true); o += 4;
    const vz = v.getFloat32(o, true); o += 4;
    const yaw = dequantAngle(v.getInt16(o, true)); o += 2;
    const pitch = dequantAngle(v.getInt16(o, true)); o += 2;
    const lastInputSeq = v.getUint32(o, true); o += 4;
    const flags = v.getUint8(o); o += 1;
    const coyote = v.getUint8(o); o += 1;
    const jumpBuffer = v.getUint8(o); o += 1;
    const health = v.getUint8(o); o += 1;
    const weapon = v.getUint8(o); o += 1;
    const heldProp = v.getUint16(o, true); o += 2;
    const holdDistance = v.getUint8(o) / 4; o += 1;
    const vehicle = v.getUint16(o, true); o += 2;
    players.push({
      id, x, y, z, vx, vy, vz, yaw, pitch, lastInputSeq, coyote, jumpBuffer, health, weapon, heldProp, holdDistance, vehicle,
      grounded: (flags & 1) !== 0, prevJump: (flags & 2) !== 0, sprinting: (flags & 4) !== 0,
      dead: (flags & 8) !== 0,
    });
  }
  const nProps = v.getUint16(o, true); o += 2;
  const props: PropState[] = [];
  for (let i = 0; i < nProps; i++) {
    const id = v.getUint16(o, true); o += 2;
    const x = v.getInt16(o, true) / POS_SCALE; o += 2;
    const y = v.getInt16(o, true) / POS_SCALE; o += 2;
    const z = v.getInt16(o, true) / POS_SCALE; o += 2;
    const a = v.getInt16(o, true) / Q3_SCALE;
    const b = v.getInt16(o + 2, true) / Q3_SCALE;
    const c = v.getInt16(o + 4, true) / Q3_SCALE;
    o += 6;
    const flags = v.getUint8(o); o += 1;
    const big = (flags >> 1) & 3;
    const q = [0, 0, 0, 0];
    let k = 0;
    const small = [a, b, c];
    for (let i = 0; i < 4; i++) if (i !== big) q[i] = small[k++];
    q[big] = Math.sqrt(Math.max(0, 1 - a * a - b * b - c * c));
    // Renormalizar tras la cuantización.
    const len = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
    props.push({ id, x, y, z, qx: q[0] / len, qy: q[1] / len, qz: q[2] / len, qw: q[3] / len, sleeping: (flags & 1) !== 0 });
  }
  return { tick, players, props };
}
