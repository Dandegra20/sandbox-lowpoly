/**
 * Ajustes del jugador (sensibilidad, volumen, calidad gráfica...). Se guardan en
 * localStorage y se aplican en caliente: quien los use se suscribe con `onChange`.
 */

/** auto = empieza en alta y baja sola si los fps no llegan. */
export type QualityLevel = 'auto' | 'low' | 'medium' | 'high';
/** Calidad efectiva (la que se está aplicando). */
export type QualityPreset = Exclude<QualityLevel, 'auto'>;

export interface SettingsData {
  /** Multiplicador de la sensibilidad base del ratón (0,2–3). */
  sensitivity: number;
  invertY: boolean;
  /** Campo de visión vertical en grados. */
  fov: number;
  /** Volúmenes 0–1. */
  masterVolume: number;
  effectsVolume: number;
  uiVolume: number;
  quality: QualityLevel;
  /** Línea de fps, ping y red en el HUD. */
  showStats: boolean;
}

/** Lo que cambia cada nivel de calidad. */
export interface QualitySpec {
  label: string;
  /** Tope del devicePixelRatio (y escala de render en "baja"). */
  pixelRatio: number;
  antialias: boolean;
  shadows: boolean;
  shadowMapSize: number;
  /** Si los objetos creados proyectan sombra (el mapa y los personajes, siempre que haya sombras). */
  propShadows: boolean;
  /** Fracción de partículas que se generan (0–1). */
  particles: number;
  /** Montañas decorativas del horizonte. */
  scenery: boolean;
}

export const QUALITY: Record<QualityPreset, QualitySpec> = {
  low: {
    label: 'Baja', pixelRatio: 0.75, antialias: false, shadows: false, shadowMapSize: 512,
    propShadows: false, particles: 0.4, scenery: false,
  },
  medium: {
    label: 'Media', pixelRatio: 1, antialias: true, shadows: true, shadowMapSize: 1024,
    propShadows: false, particles: 0.7, scenery: true,
  },
  high: {
    label: 'Alta', pixelRatio: 1.5, antialias: true, shadows: true, shadowMapSize: 2048,
    propShadows: true, particles: 1, scenery: true,
  },
};

const KEY = 'sandbox.settings';

export const DEFAULT_SETTINGS: SettingsData = {
  sensitivity: 1,
  invertY: false,
  fov: 75,
  masterVolume: 0.7,
  effectsVolume: 1,
  uiVolume: 0.8,
  quality: 'auto',
  showStats: true,
};

type Listener = (s: Readonly<SettingsData>) => void;

class SettingsStore {
  private data: SettingsData;
  private listeners = new Set<Listener>();

  constructor() {
    let saved: Partial<SettingsData> = {};
    try {
      saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    } catch { /* almacenamiento no disponible o corrupto */ }
    this.data = sanitize({ ...DEFAULT_SETTINGS, ...saved });
  }

  get(): Readonly<SettingsData> {
    return this.data;
  }

  set(patch: Partial<SettingsData>): void {
    this.data = sanitize({ ...this.data, ...patch });
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch { /* ignorar */ }
    for (const l of this.listeners) l(this.data);
  }

  reset(): void {
    this.set(DEFAULT_SETTINGS);
  }

  /** Se llama al momento con los ajustes actuales y después en cada cambio. Devuelve la baja. */
  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.data);
    return () => this.listeners.delete(fn);
  }
}

const clamp = (v: unknown, min: number, max: number, def: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;

function sanitize(s: SettingsData): SettingsData {
  const d = DEFAULT_SETTINGS;
  return {
    sensitivity: clamp(s.sensitivity, 0.2, 3, d.sensitivity),
    invertY: s.invertY === true,
    fov: Math.round(clamp(s.fov, 60, 100, d.fov)),
    masterVolume: clamp(s.masterVolume, 0, 1, d.masterVolume),
    effectsVolume: clamp(s.effectsVolume, 0, 1, d.effectsVolume),
    uiVolume: clamp(s.uiVolume, 0, 1, d.uiVolume),
    quality: (['auto', 'low', 'medium', 'high'] as const).includes(s.quality) ? s.quality : d.quality,
    showStats: s.showStats !== false,
  };
}

export const settings = new SettingsStore();
