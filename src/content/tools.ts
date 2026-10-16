// Registro de herramientas de la tool gun (arma 6). Cada herramienta es una entrada aquí
// (datos y textos de ayuda) más su comportamiento en src/server/tools.ts (mismo id).
// Añadir una herramienta = una entrada en este registro + un handler en el servidor.

export interface ToolDef {
  id: string;
  name: string;
  description: string;
  /** Ayuda de los controles (se muestra en el HUD con la tool gun en la mano). */
  primary: string;
  secondary?: string;
  reload?: string;
  /** Color del rayo de la tool gun al usarla. */
  color: number;
  /** Ajustes propios de cada herramienta (los lee su handler). */
  params?: Record<string, number>;
}

const defs: ToolDef[] = [
  {
    id: 'remover', name: 'Borrar', color: 0xe74c3c,
    description: 'Elimina objetos (los tuyos y los del mapa).',
    primary: 'Borrar el objeto', secondary: 'Borrar todo lo que esté unido a él',
  },
  {
    id: 'mover', name: 'Mover', color: 0x74b9ff,
    description: 'Coloca objetos con precisión: los arrastras sin que giren ni caigan, y los congelas en el aire.',
    primary: 'Mantener: arrastrar (rueda = distancia)', secondary: 'Congelar / descongelar', reload: 'Girar 45º (arrastrando)',
    params: { grabRange: 60, minHold: 1.5, maxHold: 60, wheelStep: 1.5 },
  },
  {
    id: 'weld', name: 'Soldar', color: 0xf39c12,
    description: 'Une dos objetos (o un objeto al suelo) de forma rígida.',
    primary: 'Clic en un objeto y luego en otro (o en el suelo)', secondary: 'Quitar las soldaduras del objeto',
  },
  {
    id: 'rope', name: 'Cuerda', color: 0xc8a165,
    description: 'Ata dos puntos con una cuerda de la longitud que haya entre ellos.',
    primary: 'Clic en el primer punto y luego en el segundo', secondary: 'Quitar las cuerdas del objeto',
    params: { slack: 0.2 },
  },
  {
    id: 'thruster', name: 'Propulsor', color: 0xff7f2a,
    description: 'Pega un propulsor en la superficie: empuja el objeto hacia dentro de esa cara.',
    primary: 'Poner un propulsor', secondary: 'Encender / apagar los propulsores del objeto', reload: 'Quitar los propulsores del objeto',
    params: { force: 1500 },
  },
  {
    id: 'paint', name: 'Pintar', color: 0xa29bfe,
    description: 'Tiñe objetos con el color elegido en el menú (Q).',
    primary: 'Pintar con el color elegido', secondary: 'Quitar la pintura',
  },
  {
    id: 'scale', name: 'Escalar', color: 0x55efc4,
    description: 'Cambia el tamaño de un objeto (no vehículos ni ragdolls).',
    primary: 'Agrandar', secondary: 'Encoger', reload: 'Tamaño original',
    params: { step: 1.25, min: 0.25, max: 4 },
  },
];

export const TOOLS: readonly ToolDef[] = defs;
export const TOOL_BY_ID: Record<string, ToolDef> = Object.fromEntries(defs.map((t) => [t.id, t]));
export const DEFAULT_TOOL = 'remover';

/** Colores disponibles para la herramienta Pintar. */
export const PAINT_COLORS = [
  0xe74c3c, 0xe67e22, 0xf1c40f, 0x2ecc71, 0x1abc9c, 0x3498db, 0x9b59b6, 0xfd79a8,
  0xffffff, 0x95a5a6, 0x34495e, 0x111111,
];

/** Límites por jugador. */
export const MAX_CONSTRAINTS_PER_PLAYER = 40;
export const MAX_THRUSTERS_PER_PLAYER = 16;
