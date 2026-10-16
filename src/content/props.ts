// Registro de objetos (props) físicos. Añadir un objeto nuevo = añadir una entrada aquí.
// Cada objeto se compone de piezas (`parts`): el servidor crea un colisionador por pieza y el
// cliente fusiona su geometría en un único modelo low-poly. Las piezas `visualOnly` solo decoran.
// Los objetos con `category` aparecen en el menú de spawn (Q); los demás son internos
// (p. ej. las partes de un ragdoll, ver spawnables.ts).

import type { PartDesc } from '../shared/collision';
import type { Vec3 } from '../shared/protocol';

export type PropPart = PartDesc & {
  /** Color de la pieza (por defecto, el del objeto). */
  color?: number;
  /** Lados de cilindros y conos (low-poly: pocos). */
  segments?: number;
};

export type PropCategory = 'Cajas' | 'Barriles' | 'Ruedas' | 'Muebles' | 'Pelotas' | 'Señales' | 'Ragdolls' | 'Vehículos';

/** Barril explosivo: revienta al recibir daño suficiente. */
export interface ExplosiveSpec {
  health: number;
  radius: number;
  damage: number;
  impulse: number;
  knockback: number;
}

export interface VehicleWheel {
  /** Punto de anclaje de la suspensión (espacio del chasis). */
  pos: Vec3;
  radius: number;
  steer: boolean;
  drive: boolean;
}

/** Vehículo conducible (controlador de vehículo por rayos de Rapier, solo en el servidor). */
export interface VehicleSpec {
  wheels: VehicleWheel[];
  wheelWidth: number;
  wheelColor: number;
  suspensionRest: number;
  suspensionStiffness: number;
  /** Fuerza del motor por rueda motriz (N). */
  engineForce: number;
  brakeForce: number;
  maxSteer: number;
  maxSpeed: number;
  /** Dónde va sentado el conductor (centro de su cápsula, espacio del chasis). */
  seat: Vec3;
  /** Dónde aparece al bajarse (espacio del chasis). */
  exit: Vec3;
}

export interface PropDef {
  id: string;
  name: string;
  category?: PropCategory;
  parts: PropPart[];
  /** Masa total en kg (se reparte entre las piezas sólidas según su volumen). */
  mass: number;
  color: number;
  friction?: number;
  restitution?: number;
  explosive?: ExplosiveSpec;
  vehicle?: VehicleSpec;
}

const WOOD = 0xc8873e;
const WOOD_DARK = 0x8d5a2b;
const METAL = 0x7f8c8d;
const DARK = 0x2d3436;
const RUBBER = 0x2b2b2b;
const WHITE = 0xf5f6fa;

/** Cuatro patas en las esquinas de un rectángulo (útil para muebles). */
function legs(x: number, z: number, y: number, h: number, t: number, color?: number): PropPart[] {
  return [[-x, -z], [x, -z], [-x, z], [x, z]].map(([px, pz]) => ({
    kind: 'box', size: [t, h, t], pos: [px, y, pz], color,
  }) as PropPart);
}

/** Aristas oscuras de una caja (decoración low-poly). */
function crateEdges(s: number, color: number): PropPart[] {
  const h = s / 2 - 0.04;
  const e = s * 0.09;
  return [[-h, -h], [h, -h], [-h, h], [h, h]].map(([x, z]) => ({
    kind: 'box', size: [e, s + 0.01, e], pos: [x, 0, z], color, visualOnly: true,
  }) as PropPart);
}

const defs: PropDef[] = [
  // ---------------------------------------------------------------- Cajas
  {
    id: 'crate', name: 'Caja de madera', category: 'Cajas', mass: 20, color: WOOD,
    parts: [{ kind: 'box', size: [1, 1, 1] }, ...crateEdges(1, WOOD_DARK)],
  },
  {
    id: 'crate_big', name: 'Caja grande', category: 'Cajas', mass: 80, color: 0xa86b2d,
    parts: [{ kind: 'box', size: [2, 2, 2] }, ...crateEdges(2, 0x6e4219)],
  },
  {
    id: 'crate_metal', name: 'Caja metálica', category: 'Cajas', mass: 120, color: 0x95a5a6, friction: 0.4,
    parts: [{ kind: 'box', size: [1.2, 1.2, 1.2] }, ...crateEdges(1.2, 0x5d6d7e)],
  },
  {
    id: 'cardboard', name: 'Caja de cartón', category: 'Cajas', mass: 3, color: 0xd4a76a,
    parts: [
      { kind: 'box', size: [0.8, 0.6, 0.6] },
      { kind: 'box', size: [0.81, 0.08, 0.15], pos: [0, 0.27, 0], color: 0xc9a227, visualOnly: true },
    ],
  },
  {
    id: 'plank', name: 'Tablón', category: 'Cajas', mass: 12, color: WOOD,
    parts: [{ kind: 'box', size: [3, 0.12, 0.4] }],
  },

  // ---------------------------------------------------------------- Barriles
  {
    id: 'barrel', name: 'Barril de madera', category: 'Barriles', mass: 35, color: 0xa0632b,
    parts: [
      { kind: 'cylinder', radius: 0.4, height: 1.1, segments: 10 },
      { kind: 'cylinder', radius: 0.42, height: 0.07, pos: [0, 0.35, 0], color: DARK, segments: 10, visualOnly: true },
      { kind: 'cylinder', radius: 0.42, height: 0.07, pos: [0, -0.35, 0], color: DARK, segments: 10, visualOnly: true },
    ],
  },
  {
    id: 'drum_blue', name: 'Bidón azul', category: 'Barriles', mass: 30, color: 0x2e86de, friction: 0.5,
    parts: [
      { kind: 'cylinder', radius: 0.35, height: 1, segments: 10 },
      { kind: 'cylinder', radius: 0.37, height: 0.05, pos: [0, 0.2, 0], color: 0x1b4f72, segments: 10, visualOnly: true },
    ],
  },
  {
    id: 'drum_explosive', name: 'Bidón explosivo', category: 'Barriles', mass: 30, color: 0xd63031,
    explosive: { health: 25, radius: 5.5, damage: 95, impulse: 1000, knockback: 13 },
    parts: [
      { kind: 'cylinder', radius: 0.35, height: 1, segments: 10 },
      { kind: 'cylinder', radius: 0.37, height: 0.22, color: 0xfdcb6e, segments: 10, visualOnly: true },
    ],
  },

  // ---------------------------------------------------------------- Ruedas
  {
    id: 'wheel', name: 'Rueda', category: 'Ruedas', mass: 15, color: RUBBER, friction: 1,
    parts: [
      { kind: 'cylinder', radius: 0.45, height: 0.3, axis: 'x', segments: 12 },
      { kind: 'cylinder', radius: 0.2, height: 0.32, axis: 'x', color: 0xbdc3c7, segments: 8, visualOnly: true },
    ],
  },
  {
    id: 'wheel_big', name: 'Rueda de tractor', category: 'Ruedas', mass: 60, color: RUBBER, friction: 1,
    parts: [
      { kind: 'cylinder', radius: 0.9, height: 0.5, axis: 'x', segments: 14 },
      { kind: 'cylinder', radius: 0.45, height: 0.52, axis: 'x', color: 0xf1c40f, segments: 10, visualOnly: true },
    ],
  },
  {
    id: 'wheel_wood', name: 'Rueda de carro', category: 'Ruedas', mass: 20, color: WOOD_DARK,
    parts: [
      { kind: 'cylinder', radius: 0.6, height: 0.12, axis: 'x', segments: 12 },
      { kind: 'box', size: [0.14, 1.15, 0.08], color: WOOD, visualOnly: true },
      { kind: 'box', size: [0.14, 0.08, 1.15], color: WOOD, visualOnly: true },
      { kind: 'cylinder', radius: 0.12, height: 0.2, axis: 'x', color: DARK, segments: 8, visualOnly: true },
    ],
  },

  // ---------------------------------------------------------------- Muebles
  {
    id: 'chair', name: 'Silla', category: 'Muebles', mass: 6, color: 0xb9770e,
    parts: [
      { kind: 'box', size: [0.5, 0.07, 0.5], pos: [0, -0.05, 0] },
      ...legs(0.21, 0.21, -0.32, 0.46, 0.06, WOOD_DARK),
      { kind: 'box', size: [0.5, 0.5, 0.06], pos: [0, 0.26, 0.22] },
    ],
  },
  {
    id: 'stool', name: 'Taburete', category: 'Muebles', mass: 4, color: 0x6c5ce7,
    parts: [
      { kind: 'cylinder', radius: 0.24, height: 0.07, pos: [0, 0.3, 0], segments: 10 },
      ...legs(0.13, 0.13, -0.03, 0.62, 0.05, DARK),
    ],
  },
  {
    id: 'table', name: 'Mesa', category: 'Muebles', mass: 25, color: WOOD,
    parts: [
      { kind: 'box', size: [1.6, 0.08, 0.9], pos: [0, 0.36, 0] },
      ...legs(0.7, 0.36, -0.04, 0.72, 0.08, WOOD_DARK),
    ],
  },
  {
    id: 'bench', name: 'Banco', category: 'Muebles', mass: 15, color: 0x27ae60,
    parts: [
      { kind: 'box', size: [1.8, 0.08, 0.4], pos: [0, 0.2, 0] },
      { kind: 'box', size: [0.08, 0.44, 0.4], pos: [-0.75, -0.06, 0], color: DARK },
      { kind: 'box', size: [0.08, 0.44, 0.4], pos: [0.75, -0.06, 0], color: DARK },
    ],
  },
  {
    id: 'shelf', name: 'Estantería', category: 'Muebles', mass: 35, color: 0xdfe6e9,
    parts: [
      { kind: 'box', size: [0.05, 1.8, 0.4], pos: [-0.58, 0, 0] },
      { kind: 'box', size: [0.05, 1.8, 0.4], pos: [0.58, 0, 0] },
      ...[-0.85, -0.3, 0.25, 0.85].map((y) => ({ kind: 'box', size: [1.12, 0.05, 0.4], pos: [0, y, 0] }) as PropPart),
      { kind: 'box', size: [1.12, 1.75, 0.02], pos: [0, 0, 0.19], color: 0xb2bec3, visualOnly: true },
    ],
  },

  // ---------------------------------------------------------------- Pelotas
  {
    id: 'ball', name: 'Pelota de playa', category: 'Pelotas', mass: 5, color: 0xe84393, restitution: 0.6, friction: 0.4,
    parts: [{ kind: 'ball', radius: 0.6 }],
  },
  {
    id: 'soccer', name: 'Balón', category: 'Pelotas', mass: 1, color: WHITE, restitution: 0.7, friction: 0.5,
    parts: [{ kind: 'ball', radius: 0.35 }],
  },
  {
    id: 'bowling', name: 'Bola de bolos', category: 'Pelotas', mass: 7, color: 0x1e3799, restitution: 0.1,
    parts: [{ kind: 'ball', radius: 0.25 }],
  },
  {
    id: 'ball_giant', name: 'Pelota gigante', category: 'Pelotas', mass: 40, color: 0xfeca57, restitution: 0.5,
    parts: [{ kind: 'ball', radius: 1.4 }],
  },

  // ---------------------------------------------------------------- Señales
  {
    id: 'cone', name: 'Cono', category: 'Señales', mass: 2, color: 0xff7f2a,
    parts: [
      { kind: 'cone', radius: 0.28, height: 0.7, pos: [0, 0.05, 0], segments: 8 },
      { kind: 'box', size: [0.55, 0.05, 0.55], pos: [0, -0.32, 0] },
      { kind: 'cylinder', radius: 0.17, height: 0.1, pos: [0, 0.1, 0], color: WHITE, segments: 8, visualOnly: true },
    ],
  },
  {
    id: 'barrier', name: 'Valla', category: 'Señales', mass: 10, color: WHITE,
    parts: [
      { kind: 'box', size: [1.6, 0.25, 0.1], pos: [0, 0.3, 0] },
      { kind: 'box', size: [0.3, 0.26, 0.11], pos: [-0.45, 0.3, 0], color: 0xe74c3c, visualOnly: true },
      { kind: 'box', size: [0.3, 0.26, 0.11], pos: [0.15, 0.3, 0], color: 0xe74c3c, visualOnly: true },
      { kind: 'box', size: [0.08, 0.9, 0.5], pos: [-0.65, 0, 0], color: DARK },
      { kind: 'box', size: [0.08, 0.9, 0.5], pos: [0.65, 0, 0], color: DARK },
    ],
  },
  {
    id: 'sign', name: 'Señal de stop', category: 'Señales', mass: 8, color: METAL,
    parts: [
      { kind: 'box', size: [0.07, 2, 0.07] },
      { kind: 'cylinder', radius: 0.4, height: 0.05, axis: 'z', pos: [0, 0.8, -0.05], color: 0xc0392b, segments: 8 },
      { kind: 'box', size: [0.5, 0.08, 0.5], pos: [0, -0.98, 0], color: DARK },
    ],
  },

  // ---------------------------------------------------------------- Vehículos
  {
    id: 'buggy', name: 'Buggy', category: 'Vehículos', mass: 450, color: 0xe17055, friction: 0.6,
    parts: [
      { kind: 'box', size: [1.5, 0.3, 2.6] },
      { kind: 'box', size: [0.6, 0.12, 0.6], pos: [0, 0.2, 0.25], color: DARK, visualOnly: true },
      { kind: 'box', size: [0.6, 0.6, 0.1], pos: [0, 0.45, 0.55], color: DARK, visualOnly: true },
      { kind: 'box', size: [0.08, 0.9, 0.08], pos: [-0.65, 0.6, 0.6], color: DARK, visualOnly: true },
      { kind: 'box', size: [0.08, 0.9, 0.08], pos: [0.65, 0.6, 0.6], color: DARK, visualOnly: true },
      { kind: 'box', size: [1.38, 0.08, 0.08], pos: [0, 1.04, 0.6], color: DARK, visualOnly: true },
      { kind: 'box', size: [1.3, 0.25, 0.5], pos: [0, 0.27, -1.0] },
    ],
    vehicle: {
      wheels: [
        { pos: [-0.85, -0.05, -0.95], radius: 0.42, steer: true, drive: true },
        { pos: [0.85, -0.05, -0.95], radius: 0.42, steer: true, drive: true },
        { pos: [-0.85, -0.05, 0.95], radius: 0.42, steer: false, drive: true },
        { pos: [0.85, -0.05, 0.95], radius: 0.42, steer: false, drive: true },
      ],
      wheelWidth: 0.3, wheelColor: RUBBER, suspensionRest: 0.35, suspensionStiffness: 30,
      engineForce: 1300, brakeForce: 25, maxSteer: 0.55, maxSpeed: 22,
      seat: [0, 0.75, 0.25], exit: [-1.6, 0.6, 0.2],
    },
  },
  {
    id: 'pickup', name: 'Camioneta', category: 'Vehículos', mass: 1100, color: 0x0984e3, friction: 0.6,
    parts: [
      { kind: 'box', size: [1.9, 0.45, 4.2] },
      { kind: 'box', size: [1.8, 0.8, 1.6], pos: [0, 0.62, -0.4] },
      { kind: 'box', size: [1.72, 0.5, 0.05], pos: [0, 0.75, -1.21], color: 0x81ecec, visualOnly: true },
      { kind: 'box', size: [0.08, 0.4, 1.9], pos: [-0.91, 0.42, 1.1] },
      { kind: 'box', size: [0.08, 0.4, 1.9], pos: [0.91, 0.42, 1.1] },
      { kind: 'box', size: [1.9, 0.4, 0.08], pos: [0, 0.42, 2.06] },
      { kind: 'box', size: [1.9, 0.2, 0.1], pos: [0, 0, -2.12], color: 0xdfe6e9, visualOnly: true },
    ],
    vehicle: {
      wheels: [
        { pos: [-0.95, -0.2, -1.35], radius: 0.5, steer: true, drive: false },
        { pos: [0.95, -0.2, -1.35], radius: 0.5, steer: true, drive: false },
        { pos: [-0.95, -0.2, 1.35], radius: 0.5, steer: false, drive: true },
        { pos: [0.95, -0.2, 1.35], radius: 0.5, steer: false, drive: true },
      ],
      wheelWidth: 0.38, wheelColor: RUBBER, suspensionRest: 0.4, suspensionStiffness: 28,
      engineForce: 4200, brakeForce: 60, maxSteer: 0.45, maxSpeed: 18,
      seat: [-0.45, 0.85, -0.3], exit: [-2, 0.6, -0.3],
    },
  },

  // ---------------------------------------------------------------- Partes de ragdoll (internas)
  // Blancas: se tiñen por instancia con el color del muñeco (ver spawnables.ts).
  { id: 'rag_torso', name: 'Torso', mass: 30, color: WHITE, parts: [{ kind: 'box', size: [0.6, 0.7, 0.35] }] },
  {
    id: 'rag_head', name: 'Cabeza', mass: 5, color: WHITE,
    parts: [
      { kind: 'box', size: [0.4, 0.4, 0.4] },
      { kind: 'box', size: [0.32, 0.1, 0.03], pos: [0, 0.05, -0.21], color: DARK, visualOnly: true },
    ],
  },
  { id: 'rag_arm', name: 'Brazo', mass: 4, color: WHITE, parts: [{ kind: 'box', size: [0.18, 0.65, 0.2] }] },
  { id: 'rag_leg', name: 'Pierna', mass: 8, color: WHITE, parts: [{ kind: 'box', size: [0.24, 0.8, 0.26] }] },
];

export const PROPS: Record<string, PropDef> = Object.fromEntries(defs.map((d) => [d.id, d]));

export function getProp(id: string): PropDef {
  const def = PROPS[id];
  if (!def) throw new Error(`Prop desconocido: ${id}`);
  return def;
}

/** Volumen aproximado de una pieza (para repartir la masa). */
export function partVolume(p: PropPart): number {
  switch (p.kind) {
    case 'box': return p.size[0] * p.size[1] * p.size[2];
    case 'ball': return (4 / 3) * Math.PI * p.radius ** 3;
    case 'cylinder': return Math.PI * p.radius ** 2 * p.height;
    case 'cone': return (Math.PI * p.radius ** 2 * p.height) / 3;
  }
}

/** Radio de una esfera que envuelve el objeto (para colocarlo al crearlo). */
export function propRadius(def: PropDef): number {
  let r = 0;
  for (const p of def.parts) {
    const c = p.pos ? Math.hypot(...p.pos) : 0;
    const e = p.kind === 'box' ? Math.hypot(...p.size) / 2
      : p.kind === 'ball' ? p.radius
      : Math.hypot(p.radius, p.height / 2);
    r = Math.max(r, c + e);
  }
  return r;
}

/** Altura de la parte más baja respecto al origen (para apoyarlo en el suelo). */
export function propBottom(def: PropDef): number {
  let b = 0;
  for (const p of def.parts) {
    const y = p.pos?.[1] ?? 0;
    const h = p.kind === 'box' ? p.size[1] / 2
      : p.kind === 'ball' ? p.radius
      : p.kind === 'cylinder' && p.axis && p.axis !== 'y' ? p.radius
      : p.height / 2;
    b = Math.min(b, y - h);
  }
  // Vehículos: las ruedas cuelgan por debajo del chasis.
  for (const w of def.vehicle?.wheels ?? []) b = Math.min(b, w.pos[1] - def.vehicle!.suspensionRest - w.radius);
  return b;
}
