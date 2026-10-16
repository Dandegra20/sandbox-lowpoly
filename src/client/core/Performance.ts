import { QUALITY, settings, type QualityLevel, type QualityPreset, type QualitySpec } from './Settings';

/** Ventana de medida de los fps (ms). */
const WINDOW_MS = 2000;
/** Por debajo de estos fps (dos ventanas seguidas) la calidad automática baja un nivel. */
const LOW_FPS = 45;
/** Por encima de estos fps durante GOOD_MS se prueba a subir un nivel. */
const GOOD_FPS = 57;
const GOOD_MS = 40_000;
/** Al empezar se ignoran unos segundos (compilación de shaders, carga). */
const WARMUP_MS = 3000;
const ORDER: QualityPreset[] = ['low', 'medium', 'high'];
const AUTO_KEY = 'sandbox.autoQuality';

/**
 * Mide los fps y decide la calidad gráfica. En modo automático empieza con el último nivel
 * que funcionó en este equipo (o alto), baja si los fps no llegan y, si van sobrados durante
 * un rato, prueba a subir (una sola vez por partida si la subida no aguanta).
 */
export class Performance {
  /** Aplica una calidad; `notice` es un aviso para el jugador (cambio automático). */
  onApply: (spec: QualitySpec, notice: string | null) => void = () => {};

  private level: QualityLevel = settings.get().quality;
  private preset: QualityPreset = this.level === 'auto' ? loadAuto() : this.level;
  private applied = false;
  private frames = 0;
  private elapsed = 0;
  private warmup = WARMUP_MS;
  private lowWindows = 0;
  private goodMs = 0;
  /** Tiempo que queda para dar por buena una subida automática. */
  private trialMs = 0;
  private upgradeFailed = false;
  /** Últimos fps medidos (ventana completa). */
  fps = 0;

  get spec(): QualitySpec {
    return QUALITY[this.preset];
  }

  get label(): string {
    return this.level === 'auto' ? `auto (${QUALITY[this.preset].label.toLowerCase()})` : QUALITY[this.preset].label.toLowerCase();
  }

  setLevel(level: QualityLevel): void {
    if (this.applied && level === this.level) return;
    this.level = level;
    this.preset = level === 'auto' ? loadAuto() : level;
    this.resetWindow();
    this.warmup = WARMUP_MS;
    this.applied = true;
    this.onApply(this.spec, null);
  }

  /** Llamar cada frame. `playing` = el jugador está en partida (no en un menú). */
  frame(dtMs: number, playing: boolean): void {
    if (this.warmup > 0) {
      this.warmup -= dtMs;
      return;
    }
    // Con la pestaña oculta o en un menú los fps no son representativos.
    if (!playing || document.hidden || dtMs >= 250) return this.resetWindow();
    this.frames++;
    this.elapsed += dtMs;
    if (this.trialMs > 0) this.trialMs -= dtMs;
    if (this.elapsed < WINDOW_MS) return;

    this.fps = Math.round((this.frames * 1000) / this.elapsed);
    const windowMs = this.elapsed;
    this.resetWindow();
    if (this.level !== 'auto') return;

    const i = ORDER.indexOf(this.preset);
    if (this.fps < LOW_FPS) {
      this.goodMs = 0;
      if (++this.lowWindows < 2 || i === 0) return;
      if (this.trialMs > 0) this.upgradeFailed = true;
      this.change(ORDER[i - 1], `Calidad automática: ${QUALITY[ORDER[i - 1]].label} (${this.fps} fps)`);
    } else {
      this.lowWindows = 0;
      this.goodMs = this.fps >= GOOD_FPS ? this.goodMs + windowMs : 0;
      if (this.goodMs >= GOOD_MS && i < ORDER.length - 1 && !this.upgradeFailed) {
        this.trialMs = 10_000;
        this.change(ORDER[i + 1], `Calidad automática: ${QUALITY[ORDER[i + 1]].label}`);
      }
    }
  }

  private change(preset: QualityPreset, notice: string): void {
    this.preset = preset;
    this.lowWindows = 0;
    this.goodMs = 0;
    this.warmup = 1500;
    try {
      localStorage.setItem(AUTO_KEY, preset);
    } catch { /* ignorar */ }
    this.onApply(this.spec, notice);
  }

  private resetWindow(): void {
    this.frames = 0;
    this.elapsed = 0;
  }
}

function loadAuto(): QualityPreset {
  try {
    const v = localStorage.getItem(AUTO_KEY) as QualityPreset | null;
    if (v && ORDER.includes(v)) return v;
  } catch { /* ignorar */ }
  return 'high';
}
