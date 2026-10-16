import { INTERP_DELAY_MAX_MS, INTERP_DELAY_MIN_MS, SNAPSHOT_MS, TICK_RATE } from '../../shared/constants';

/**
 * Estima la diferencia entre el reloj local y el tiempo del servidor (derivado del tick),
 * suavizada para absorber el jitter de red. Las entidades remotas se dibujan en
 * renderTime() = ahora en el servidor - delay, con un delay que se adapta al jitter medido:
 * red estable => menos retardo; red irregular => más colchón para no quedarse sin muestras.
 */
export class ServerClock {
  private offset: number | null = null;
  private lastArrival = 0;
  private jitter = 0;
  private _delay = INTERP_DELAY_MIN_MS + 30;

  static tickToMs(tick: number): number {
    return (tick * 1000) / TICK_RATE;
  }

  onSnapshot(tick: number, now: number): void {
    const sample = ServerClock.tickToMs(tick) - now;
    if (this.offset === null || Math.abs(sample - this.offset) > 1000) {
      this.offset = sample;
    } else {
      this.offset += (sample - this.offset) * 0.05;
    }

    if (this.lastArrival > 0) {
      const deviation = Math.abs(now - this.lastArrival - SNAPSHOT_MS);
      this.jitter += (Math.min(deviation, 500) - this.jitter) * 0.1;
    }
    this.lastArrival = now;

    // Un intervalo de snapshot + margen por jitter; se mueve despacio para no dar saltos.
    const target = Math.min(INTERP_DELAY_MAX_MS, Math.max(INTERP_DELAY_MIN_MS, SNAPSHOT_MS * 1.2 + this.jitter * 2.5));
    this._delay += (target - this._delay) * 0.05;
  }

  get ready(): boolean {
    return this.offset !== null;
  }

  get delay(): number {
    return this._delay;
  }

  renderTime(now: number): number {
    return now + (this.offset ?? 0) - this._delay;
  }
}
