// Registro de modos de juego. El comportamiento vive en src/server/GameMode.ts.

export type ModeId = 'sandbox' | 'deathmatch';

export interface ModeDef {
  id: ModeId;
  name: string;
  description: string;
  /** Se pueden crear objetos, usar la tool gun y conducir los vehículos que se creen. */
  building: boolean;
  /** Límites de bajas que se ofrecen al crear la sala (vacío = sin límite). */
  killLimits: number[];
}

export const MODES: Record<ModeId, ModeDef> = {
  sandbox: {
    id: 'sandbox', name: 'Sandbox', building: true, killLimits: [],
    description: 'Libre: construye, crea objetos y usa todas las herramientas. Las bajas solo suman en el marcador.',
  },
  deathmatch: {
    id: 'deathmatch', name: 'Deathmatch', building: false, killLimits: [10, 20, 30],
    description: 'Todos contra todos: gana quien llegue antes al límite de bajas. Sin menú de objetos ni tool gun.',
  },
};

export const MODE_LIST: readonly ModeDef[] = Object.values(MODES);

/** Segundos que se muestra la pantalla de resultados antes de la siguiente ronda. */
export const RESULTS_SECONDS = 10;

export function getMode(id: unknown): ModeDef {
  return typeof id === 'string' && id in MODES ? MODES[id as ModeId] : MODES.sandbox;
}

/** Límite de bajas válido para el modo (el primero si el pedido no está en la lista). */
export function validKillLimit(mode: ModeDef, raw: unknown): number {
  if (!mode.killLimits.length) return 0;
  return typeof raw === 'number' && mode.killLimits.includes(raw) ? raw : mode.killLimits[1] ?? mode.killLimits[0];
}
