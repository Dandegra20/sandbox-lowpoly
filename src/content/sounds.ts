// Registro de sonidos. Todo se sintetiza con WebAudio (sin archivos de audio): cada sonido es
// una lista de capas de tono (oscilador) o de ruido filtrado, con barrido de frecuencia y una
// envolvente de ataque rápido y caída exponencial. Añadir un sonido = añadir una entrada aquí.
// Las armas eligen el suyo con `sound` en content/weapons.ts.

export interface ToneLayer {
  kind: 'tone';
  wave: OscillatorType;
  /** Frecuencia inicial y final (Hz, barrido exponencial). */
  freq: [number, number];
  dur: number;
  gain: number;
  attack?: number;
  /** Retardo desde el inicio del sonido (s): sirve para arpegios. */
  delay?: number;
}

export interface NoiseLayer {
  kind: 'noise';
  filter: BiquadFilterType;
  /** Frecuencia de corte inicial y final del filtro (Hz). */
  freq: [number, number];
  q?: number;
  dur: number;
  gain: number;
  attack?: number;
  delay?: number;
}

export type SoundLayer = ToneLayer | NoiseLayer;

export interface SoundDef {
  layers: SoundLayer[];
  /** 'effects' = sonidos del mundo (posicionales si se da una posición); 'ui' = interfaz. */
  bus: 'effects' | 'ui';
  /** Distancia (m) a partir de la cual ya no se oye. */
  range?: number;
  /** Variación aleatoria del tono (±, en fracción): evita que los disparos suenen idénticos. */
  pitchJitter?: number;
  /** Tiempo mínimo entre dos reproducciones del mismo sonido (ms): limita el ruido con 6 jugadores. */
  minGapMs?: number;
}

const tone = (wave: OscillatorType, f0: number, f1: number, dur: number, gain: number, delay = 0, attack?: number): ToneLayer =>
  ({ kind: 'tone', wave, freq: [f0, f1], dur, gain, delay, attack });
const noise = (filter: BiquadFilterType, f0: number, f1: number, dur: number, gain: number, q = 1, delay = 0, attack?: number): NoiseLayer =>
  ({ kind: 'noise', filter, freq: [f0, f1], dur, gain, q, delay, attack });

export const SOUNDS = {
  // --- Armas ---
  pistol: {
    bus: 'effects', range: 90, pitchJitter: 0.06,
    layers: [noise('bandpass', 2600, 900, 0.12, 0.9, 0.8), tone('triangle', 190, 60, 0.12, 0.6)],
  },
  shotgun: {
    bus: 'effects', range: 110, pitchJitter: 0.05,
    layers: [noise('lowpass', 4200, 300, 0.38, 1.1, 0.7), tone('sine', 120, 38, 0.3, 0.9), noise('highpass', 3000, 3000, 0.05, 0.4)],
  },
  rifle: {
    bus: 'effects', range: 100, pitchJitter: 0.07, minGapMs: 40,
    layers: [noise('bandpass', 3200, 1400, 0.08, 0.75, 1.2), tone('square', 150, 70, 0.06, 0.25)],
  },
  rocket_launch: {
    bus: 'effects', range: 80, pitchJitter: 0.04,
    layers: [noise('bandpass', 500, 1800, 0.45, 0.8, 1.5), tone('sine', 90, 45, 0.25, 0.7)],
  },
  gravity_punt: {
    bus: 'effects', range: 50, pitchJitter: 0.05,
    layers: [tone('sine', 220, 900, 0.18, 0.5), noise('bandpass', 1200, 3000, 0.15, 0.4, 2)],
  },
  gravity_grab: { bus: 'effects', range: 40, layers: [tone('sine', 300, 620, 0.12, 0.35), tone('triangle', 600, 1240, 0.1, 0.12)] },
  gravity_drop: { bus: 'effects', range: 40, layers: [tone('sine', 620, 280, 0.12, 0.3)] },
  tool: { bus: 'effects', range: 40, layers: [tone('square', 880, 1320, 0.07, 0.18), tone('sine', 1760, 1760, 0.05, 0.12, 0.04)] },
  weapon_switch: { bus: 'ui', layers: [noise('highpass', 2500, 2500, 0.04, 0.35), tone('square', 420, 380, 0.03, 0.08, 0.05)] },

  // --- Mundo ---
  explosion: {
    bus: 'effects', range: 220, pitchJitter: 0.08,
    layers: [noise('lowpass', 1600, 90, 1.3, 1.4, 0.5), tone('sine', 85, 28, 0.9, 1.1), noise('highpass', 2000, 800, 0.12, 0.5)],
  },
  impact: { bus: 'effects', range: 30, pitchJitter: 0.2, minGapMs: 25, layers: [noise('bandpass', 1800, 900, 0.05, 0.3, 2)] },
  impact_player: { bus: 'effects', range: 30, minGapMs: 25, layers: [noise('lowpass', 900, 300, 0.07, 0.45), tone('sine', 160, 90, 0.06, 0.3)] },
  footstep: { bus: 'effects', range: 22, pitchJitter: 0.25, layers: [noise('lowpass', 700, 250, 0.06, 0.22, 1)] },
  land: { bus: 'effects', range: 22, layers: [noise('lowpass', 500, 120, 0.12, 0.45), tone('sine', 90, 50, 0.1, 0.3)] },
  jump: { bus: 'effects', range: 22, layers: [noise('bandpass', 600, 1400, 0.1, 0.12, 1.5)] },
  prop_spawn: { bus: 'effects', range: 40, pitchJitter: 0.1, minGapMs: 40, layers: [tone('sine', 320, 760, 0.1, 0.35), noise('highpass', 3000, 3000, 0.04, 0.15)] },
  prop_remove: { bus: 'effects', range: 40, minGapMs: 40, layers: [tone('sine', 700, 240, 0.12, 0.3)] },
  vehicle_door: { bus: 'effects', range: 30, layers: [noise('lowpass', 900, 200, 0.12, 0.6), tone('square', 110, 80, 0.06, 0.15)] },
  death: { bus: 'effects', range: 60, layers: [tone('sawtooth', 420, 70, 0.55, 0.3), noise('lowpass', 800, 150, 0.3, 0.3)] },

  // --- Interfaz y avisos ---
  ui_click: { bus: 'ui', layers: [tone('triangle', 900, 700, 0.05, 0.25)] },
  hitmarker: { bus: 'ui', minGapMs: 30, layers: [tone('triangle', 1900, 1700, 0.05, 0.35)] },
  kill_confirm: { bus: 'ui', layers: [tone('triangle', 880, 880, 0.09, 0.35), tone('triangle', 1320, 1320, 0.16, 0.35, 0.08)] },
  hurt: { bus: 'ui', minGapMs: 60, layers: [noise('lowpass', 600, 150, 0.15, 0.6), tone('sine', 140, 70, 0.12, 0.4)] },
  you_died: { bus: 'ui', layers: [tone('sawtooth', 330, 110, 0.7, 0.22), tone('sine', 165, 55, 0.8, 0.3)] },
  respawn: { bus: 'ui', layers: [tone('triangle', 523, 523, 0.08, 0.25), tone('triangle', 659, 659, 0.08, 0.25, 0.07), tone('triangle', 784, 784, 0.14, 0.25, 0.14)] },
  chat: { bus: 'ui', minGapMs: 80, layers: [tone('sine', 1040, 1040, 0.06, 0.2), tone('sine', 1380, 1380, 0.08, 0.16, 0.05)] },
  player_join: { bus: 'ui', layers: [tone('triangle', 660, 660, 0.08, 0.22), tone('triangle', 990, 990, 0.12, 0.22, 0.08)] },
  player_leave: { bus: 'ui', layers: [tone('triangle', 990, 990, 0.08, 0.2), tone('triangle', 660, 660, 0.12, 0.2, 0.08)] },
  error: { bus: 'ui', minGapMs: 150, layers: [tone('square', 220, 200, 0.08, 0.12), tone('square', 180, 170, 0.1, 0.12, 0.09)] },
  round_end: {
    bus: 'ui',
    layers: [
      tone('triangle', 523, 523, 0.14, 0.3), tone('triangle', 659, 659, 0.14, 0.3, 0.13),
      tone('triangle', 784, 784, 0.14, 0.3, 0.26), tone('triangle', 1047, 1047, 0.45, 0.3, 0.39),
    ],
  },
  round_start: { bus: 'ui', layers: [tone('sawtooth', 392, 392, 0.18, 0.18), tone('sawtooth', 523, 523, 0.35, 0.2, 0.18)] },
} satisfies Record<string, SoundDef>;

export type SoundId = keyof typeof SOUNDS;
