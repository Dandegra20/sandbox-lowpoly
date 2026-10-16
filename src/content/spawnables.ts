// Lo que se puede crear desde el menú de spawn (Q).
// - Todo objeto de props.ts con `category` es un spawnable de un solo cuerpo.
// - Los grupos (ragdolls) son varios cuerpos unidos por juntas; se definen aquí.
// Añadir un spawnable = añadir un objeto con categoría en props.ts, o un grupo aquí.

import type { Vec3 } from '../shared/protocol';
import { PROPS, type PropCategory } from './props';

export interface GroupPart {
  type: string;
  /** Posición relativa al punto de aparición. */
  pos: Vec3;
  /** Tinte de la pieza (0xffffff = sin tinte). */
  tint?: number;
}

export interface GroupJoint {
  a: number;
  b: number;
  /** Punto de unión relativo al punto de aparición (se convierte a local de cada cuerpo). */
  at: Vec3;
  /** Si las dos piezas chocan entre sí (evita que, p. ej., la cabeza se meta en el torso). */
  contacts?: boolean;
}

export interface SpawnableDef {
  id: string;
  name: string;
  category: PropCategory;
  /** Un solo objeto... */
  prop?: string;
  /** ...o un grupo de cuerpos con juntas. */
  group?: { parts: GroupPart[]; joints: GroupJoint[] };
}

export const CATEGORIES: PropCategory[] = ['Cajas', 'Barriles', 'Ruedas', 'Muebles', 'Pelotas', 'Señales', 'Ragdolls', 'Vehículos'];

/** Muñeco articulado de 6 piezas (cabeza, torso, brazos y piernas) unidas por rótulas. */
function ragdoll(color: number): SpawnableDef['group'] {
  const skin = 0xf3c9a6;
  return {
    parts: [
      { type: 'rag_torso', pos: [0, 0.15, 0], tint: color },
      { type: 'rag_head', pos: [0, 0.72, 0], tint: skin },
      { type: 'rag_arm', pos: [-0.42, 0.18, 0], tint: color },
      { type: 'rag_arm', pos: [0.42, 0.18, 0], tint: color },
      { type: 'rag_leg', pos: [-0.16, -0.62, 0], tint: 0x34495e },
      { type: 'rag_leg', pos: [0.16, -0.62, 0], tint: 0x34495e },
    ],
    joints: [
      // Cuello con contacto (la cabeza no se mete en el torso). Hombros y caderas sin él: si
      // chocaran, las caras planas en contacto dejarían las articulaciones rígidas.
      { a: 0, b: 1, at: [0, 0.52, 0], contacts: true },
      { a: 0, b: 2, at: [-0.33, 0.47, 0] },
      { a: 0, b: 3, at: [0.33, 0.47, 0] },
      { a: 0, b: 4, at: [-0.16, -0.2, 0] },
      { a: 0, b: 5, at: [0.16, -0.2, 0] },
    ],
  };
}

const groups: SpawnableDef[] = [
  { id: 'ragdoll', name: 'Muñeco', category: 'Ragdolls', group: ragdoll(0x3498db) },
  { id: 'ragdoll_red', name: 'Muñeco rojo', category: 'Ragdolls', group: ragdoll(0xe74c3c) },
];

export const SPAWNABLES: SpawnableDef[] = [
  ...Object.values(PROPS)
    .filter((p) => p.category)
    .map((p) => ({ id: p.id, name: p.name, category: p.category!, prop: p.id })),
  ...groups,
];

export const SPAWNABLE_BY_ID: Record<string, SpawnableDef> = Object.fromEntries(SPAWNABLES.map((s) => [s.id, s]));

/** Cuántos cuerpos físicos crea (cuenta para los límites). */
export function spawnableCost(s: SpawnableDef): number {
  return s.group ? s.group.parts.length : 1;
}
