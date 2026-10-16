import { SOUNDS, type SoundDef, type SoundId, type SoundLayer } from '../../content/sounds';
import { settings, type SettingsData } from '../core/Settings';

interface Vec {
  x: number;
  y: number;
  z: number;
}

export interface PlayOptions {
  /** Posición en el mundo: el sonido se atenúa con la distancia y se panoramiza. */
  pos?: Vec;
  volume?: number;
  /** Multiplicador del tono (1 = normal). */
  pitch?: number;
}

/** Máximo de sonidos sonando a la vez: con 6 jugadores disparando se descartan los que sobren. */
const MAX_VOICES = 40;
/** Distancia (m) a la que un sonido suena a la mitad de volumen. */
const HALF_DISTANCE = 8;

interface Loop {
  osc: OscillatorNode;
  sub: OscillatorNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  pan: StereoPannerNode;
  touched: boolean;
}

/**
 * Motor de sonido con WebAudio: sintetiza las entradas de `content/sounds.ts` (sin archivos).
 * Espacialización barata: atenuación por distancia, panorama estéreo según la mirada y un
 * filtro paso bajo para los sonidos lejanos. El contexto se crea con el primer gesto del
 * usuario (los navegadores no dejan sonar nada antes).
 */
class SoundEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private buses!: Record<SoundDef['bus'], GainNode>;
  private noise!: AudioBuffer;
  private voices = 0;
  private lastPlayed = new Map<string, number>();
  private listener = { x: 0, y: 0, z: 0, yaw: 0 };
  private loops = new Map<string, Loop>();

  constructor() {
    const unlock = () => this.unlock();
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    settings.onChange((s) => this.applyVolumes(s));
  }

  private unlock(): void {
    if (!this.ctx) {
      try {
        this.create();
      } catch {
        return; // sin WebAudio: el juego funciona en silencio
      }
    }
    if (this.ctx!.state === 'suspended') this.ctx!.resume().catch(() => {});
  }

  private create(): void {
    const ctx = new AudioContext();
    this.ctx = ctx;
    // El compresor evita que varias explosiones a la vez saturen.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(comp);
    this.buses = { effects: ctx.createGain(), ui: ctx.createGain() };
    for (const b of Object.values(this.buses)) b.connect(this.master);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.applyVolumes(settings.get());
  }

  private applyVolumes(s: Readonly<SettingsData>): void {
    if (!this.ctx) return;
    // Curva cuadrática: el deslizador se percibe más lineal.
    this.master.gain.value = s.masterVolume ** 2;
    this.buses.effects.gain.value = s.effectsVolume ** 2;
    this.buses.ui.gain.value = s.uiVolume ** 2;
  }

  /** Posición de la cámara y hacia dónde mira (llamar cada frame). */
  setListener(pos: Vec, yaw: number): void {
    const l = this.listener;
    l.x = pos.x;
    l.y = pos.y;
    l.z = pos.z;
    l.yaw = yaw;
  }

  /** Ganancia, panorama y apagado (0..1) según la distancia; null = demasiado lejos. */
  private spatial(pos: Vec, range: number): { gain: number; pan: number; far: number } | null {
    const l = this.listener;
    const dx = pos.x - l.x, dy = pos.y - l.y, dz = pos.z - l.z;
    const d = Math.hypot(dx, dy, dz);
    if (d >= range) return null;
    const gain = (1 / (1 + d / HALF_DISTANCE)) * (1 - d / range);
    // Derecha de la cámara (mira hacia -Z girada `yaw`).
    const h = Math.hypot(dx, dz);
    const pan = h > 0.5 ? ((dx * Math.cos(l.yaw) - dz * Math.sin(l.yaw)) / h) * 0.75 : 0;
    return { gain, pan, far: d / range };
  }

  play(id: SoundId, opts: PlayOptions = {}): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.voices >= MAX_VOICES) return;
    const def: SoundDef = SOUNDS[id];
    const nowMs = performance.now();
    if (def.minGapMs) {
      if (nowMs - (this.lastPlayed.get(id) ?? -1e9) < def.minGapMs) return;
      this.lastPlayed.set(id, nowMs);
    }

    let gain = opts.volume ?? 1;
    let pan = 0;
    let far = 0;
    if (opts.pos && def.bus === 'effects') {
      const s = this.spatial(opts.pos, def.range ?? 50);
      if (!s) return;
      gain *= s.gain;
      pan = s.pan;
      far = s.far;
    }
    if (gain < 0.01) return;
    const rate = (opts.pitch ?? 1) * (1 + (Math.random() * 2 - 1) * (def.pitchJitter ?? 0));

    const t = ctx.currentTime + 0.005;
    const out = ctx.createGain();
    out.gain.value = gain;
    let tail: AudioNode = out;
    // Lo lejano suena apagado (paso bajo); lo cercano se queda sin filtro (más barato).
    if (far > 0.15) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 600 + 14000 * (1 - far) ** 3;
      tail.connect(lp);
      tail = lp;
    }
    if (pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      tail.connect(p);
      tail = p;
    }
    tail.connect(this.buses[def.bus]);

    let end = 0;
    let last: AudioScheduledSourceNode | null = null;
    for (const layer of def.layers) {
      const stop = t + (layer.delay ?? 0) + layer.dur;
      const src = this.layer(ctx, layer, t, rate, out);
      if (stop >= end) {
        end = stop;
        last = src;
      }
    }
    if (!last) return;
    this.voices++;
    last.onended = () => {
      this.voices--;
      out.disconnect();
      if (tail !== out) tail.disconnect();
    };
  }

  private layer(ctx: AudioContext, l: SoundLayer, t0: number, rate: number, out: AudioNode): AudioScheduledSourceNode {
    const t = t0 + (l.delay ?? 0);
    const attack = l.attack ?? 0.004;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(l.gain, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + l.dur);
    env.connect(out);

    let src: AudioScheduledSourceNode;
    if (l.kind === 'tone') {
      const osc = ctx.createOscillator();
      osc.type = l.wave;
      osc.frequency.setValueAtTime(l.freq[0] * rate, t);
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, l.freq[1] * rate), t + l.dur);
      osc.connect(env);
      src = osc;
      osc.start(t);
    } else {
      const n = ctx.createBufferSource();
      n.buffer = this.noise;
      n.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = l.filter;
      f.Q.value = l.q ?? 1;
      f.frequency.setValueAtTime(l.freq[0] * rate, t);
      f.frequency.exponentialRampToValueAtTime(Math.max(20, l.freq[1] * rate), t + l.dur);
      n.connect(f).connect(env);
      src = n;
      n.start(t, Math.random() * 0.9);
    }
    src.stop(t + l.dur + 0.02);
    src.addEventListener('ended', () => env.disconnect());
    return src;
  }

  /**
   * Motor de un vehículo: sonido continuo cuyo tono sube con la velocidad. Hay que llamarlo
   * cada frame mientras suene; `endFrame()` apaga los que no se hayan actualizado.
   */
  engine(key: string, pos: Vec, speed: number, volume = 1): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const s = this.spatial(pos, 60);
    let loop = this.loops.get(key);
    if (!s) {
      if (loop) loop.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
      if (loop) loop.touched = true;
      return;
    }
    if (!loop) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      const sub = ctx.createOscillator();
      sub.type = 'square';
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 2;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const pan = ctx.createStereoPanner();
      osc.connect(filter);
      sub.connect(filter);
      filter.connect(gain).connect(pan).connect(this.buses.effects);
      osc.start();
      sub.start();
      loop = { osc, sub, filter, gain, pan, touched: true };
      this.loops.set(key, loop);
    }
    const k = Math.min(1, Math.abs(speed) / 20);
    const now = ctx.currentTime;
    loop.osc.frequency.setTargetAtTime(48 + k * 110, now, 0.08);
    loop.sub.frequency.setTargetAtTime(24 + k * 55, now, 0.08);
    loop.filter.frequency.setTargetAtTime(300 + k * 1400, now, 0.08);
    loop.gain.gain.setTargetAtTime(0.13 * volume * s.gain * (0.6 + k * 0.4), now, 0.08);
    loop.pan.pan.setTargetAtTime(s.pan, now, 0.05);
    loop.touched = true;
  }

  /** Apaga los sonidos continuos que no se han actualizado en este frame. */
  endFrame(): void {
    if (!this.ctx) return;
    for (const [key, loop] of this.loops) {
      if (loop.touched) {
        loop.touched = false;
        continue;
      }
      this.stopLoop(key, loop);
    }
  }

  /** Silencia todos los sonidos continuos (al salir de la partida). */
  stopAll(): void {
    for (const [key, loop] of this.loops) this.stopLoop(key, loop);
  }

  private stopLoop(key: string, loop: Loop): void {
    const t = this.ctx!.currentTime;
    loop.gain.gain.setTargetAtTime(0, t, 0.05);
    loop.osc.stop(t + 0.3);
    loop.sub.stop(t + 0.3);
    loop.osc.onended = () => loop.pan.disconnect();
    this.loops.delete(key);
  }
}

export const sound = new SoundEngine();
