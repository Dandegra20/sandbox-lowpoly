import { RESULTS_SECONDS, type ModeDef } from '../content/modes';
import type { ModeState, ServerMessage } from '../shared/protocol';
import type { ServerPlayer } from './types';

interface ModeHost {
  readonly players: Map<number, ServerPlayer>;
  broadcast(msg: ServerMessage): void;
  /** Deja la sala como al empezar: marcadores a cero, todos reaparecen y el mapa se restaura. */
  resetRound(): void;
}

/**
 * Reglas del modo de juego de la sala.
 * - Sandbox: sin límite; se puede construir.
 * - Deathmatch: al llegar al límite de bajas termina la ronda, se muestran los resultados
 *   RESULTS_SECONDS (sin daño) y empieza otra con el mapa restaurado. No se puede construir.
 */
export class GameMode {
  private state: ModeState['state'] = 'playing';
  private restartAt = 0;
  private winner = -1;
  private ranking: [number, number, number][] = [];

  constructor(readonly def: ModeDef, readonly killLimit: number, private host: ModeHost) {}

  /** Crear objetos, tool gun... */
  get building(): boolean {
    return this.def.building;
  }

  get canDamage(): boolean {
    return this.state === 'playing';
  }

  get info(): ModeState {
    const base: ModeState = { id: this.def.id, killLimit: this.killLimit, state: this.state };
    if (this.state === 'ended') {
      Object.assign(base, { winner: this.winner, ranking: this.ranking, restartMs: Math.max(0, this.restartAt - Date.now()) });
    }
    return base;
  }

  /** Tras cada baja (ya contada en el marcador). */
  onKill(killer: ServerPlayer | null): void {
    if (!this.killLimit || this.state !== 'playing' || !killer) return;
    if (killer.info.kills >= this.killLimit) this.endRound(killer);
  }

  private endRound(winner: ServerPlayer): void {
    this.state = 'ended';
    this.winner = winner.info.id;
    this.restartAt = Date.now() + RESULTS_SECONDS * 1000;
    this.ranking = [...this.host.players.values()]
      .map((p) => [p.info.id, p.info.kills, p.info.deaths] as [number, number, number])
      .sort((a, b) => b[1] - a[1] || a[2] - b[2]);
    this.host.broadcast({ t: 'round_end', mode: this.info });
  }

  update(): void {
    if (this.state !== 'ended' || Date.now() < this.restartAt) return;
    this.state = 'playing';
    this.winner = -1;
    this.ranking = [];
    this.host.resetRound();
    this.host.broadcast({ t: 'round_start', mode: this.info });
  }
}
