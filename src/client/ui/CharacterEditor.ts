import * as THREE from 'three';
import {
  COSMETICS_BY_SLOT, DEFAULT_LOOK, LOOK_COLORS, PATTERNS, randomLook, sanitizeLook,
  type Appearance, type CosmeticSlot,
} from '../../content/cosmetics';
import { PlayerModel } from '../entities/PlayerModel';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const LOOK_KEY = 'sandbox.look';

/** Aspecto guardado en localStorage (o uno aleatorio la primera vez, que se guarda). */
export function loadLook(): Appearance {
  try {
    const raw = localStorage.getItem(LOOK_KEY);
    if (raw) return sanitizeLook(JSON.parse(raw));
  } catch { /* sin almacenamiento o JSON roto: aspecto nuevo */ }
  const look = randomLook();
  saveLook(look);
  return look;
}

export function saveLook(look: Appearance): void {
  try {
    localStorage.setItem(LOOK_KEY, JSON.stringify(look));
  } catch { /* ignorar */ }
}

const COLOR_ROWS: [keyof Appearance, string][] = [
  ['body', 'Cuerpo'], ['arms', 'Brazos'], ['legs', 'Piernas'], ['head', 'Cabeza'], ['accent', 'Detalles'],
];
const ITEM_ROWS: [CosmeticSlot, string][] = [['hat', 'Sombrero'], ['glasses', 'Gafas'], ['backpack', 'Mochila']];
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/**
 * Editor de personaje (menú propio): vista previa 3D que se puede girar arrastrando,
 * colores por parte, accesorios y patrón. Se abre desde el menú principal y desde la pausa.
 * Guardar escribe en localStorage y avisa con onSave (en partida, App lo envía al servidor).
 */
export class CharacterEditor {
  onSave: (look: Appearance) => void = () => {};
  onClose: () => void = () => {};

  private root = $('editor');
  private options = $('editor-options');
  private canvas = $<HTMLCanvasElement>('editor-canvas');
  private look: Appearance = { ...DEFAULT_LOOK };
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  private model: PlayerModel | null = null;
  private turntable = new THREE.Group();
  private raf = 0;
  private yaw = 0.4; // de frente y algo de lado
  private dragging = false;
  private lastX = 0;
  private lastTime = 0;

  constructor() {
    $<HTMLButtonElement>('editor-random').onclick = () => this.setLook(randomLook());
    $<HTMLButtonElement>('editor-reset').onclick = () => this.setLook(loadLook());
    $<HTMLButtonElement>('editor-cancel').onclick = () => this.close();
    $<HTMLButtonElement>('editor-save').onclick = () => {
      saveLook(this.look);
      this.onSave({ ...this.look });
      this.close();
    };
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.8));
    const sun = new THREE.DirectionalLight(0xfff2dd, 1.8);
    sun.position.set(2, 3, -3);
    this.scene.add(sun, this.turntable);
    this.camera.position.set(0, 0.35, -4.6);
    this.camera.lookAt(0, 0.15, 0);

    // Arrastrar para girar el muñeco.
    this.canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.yaw += (e.clientX - this.lastX) * 0.012;
      this.lastX = e.clientX;
    });
    this.canvas.addEventListener('pointerup', () => (this.dragging = false));
    document.addEventListener('keydown', (e) => {
      if (this.isOpen && e.code === 'Escape') this.close();
    });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(): void {
    if (this.isOpen) return;
    this.root.hidden = false;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    } catch {
      this.renderer = null; // sin WebGL extra: el editor funciona igual, sin vista previa
    }
    this.setLook(loadLook());
    this.lastTime = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  close(): void {
    if (!this.isOpen) return;
    this.root.hidden = true;
    cancelAnimationFrame(this.raf);
    if (this.model) {
      this.turntable.remove(this.model.root);
      this.model.dispose();
      this.model = null;
    }
    this.renderer?.dispose();
    this.renderer = null;
    this.onClose();
  }

  private setLook(look: Appearance): void {
    this.look = { ...look };
    if (!this.model) {
      this.model = new PlayerModel(this.look, '');
      this.model.setLabelVisible(false);
      this.turntable.add(this.model.root);
    } else {
      this.model.setLook(this.look);
    }
    this.renderOptions();
  }

  private frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;
    if (!this.dragging) this.yaw += dt * 0.5; // giro lento mientras no se arrastra
    this.turntable.rotation.y = this.yaw;
    this.model?.animate(dt, 0, 0, true);
    if (!this.renderer) return;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (this.canvas.width !== Math.floor(w * this.renderer.getPixelRatio())) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    this.renderer.render(this.scene, this.camera);
  };

  /** Rejilla de opciones: colores por parte y botones de accesorios/patrón (todo del registro). */
  private renderOptions(): void {
    const sections: HTMLElement[] = [];

    const colors = document.createElement('div');
    colors.className = 'ed-section';
    colors.append(heading('Colores'));
    for (const [key, label] of COLOR_ROWS) {
      const row = document.createElement('div');
      row.className = 'ed-row';
      const name = document.createElement('span');
      name.className = 'ed-label';
      name.textContent = label;
      row.append(name);
      for (const c of LOOK_COLORS) {
        const b = document.createElement('button');
        b.className = 'ed-swatch' + (this.look[key] === c ? ' on' : '');
        b.style.background = hex(c);
        b.title = hex(c);
        b.onclick = () => this.setLook({ ...this.look, [key]: c });
        row.append(b);
      }
      const custom = document.createElement('input');
      custom.type = 'color';
      custom.value = hex(this.look[key] as number);
      custom.title = 'Otro color';
      custom.onchange = () => this.setLook({ ...this.look, [key]: parseInt(custom.value.slice(1), 16) });
      row.append(custom);
      colors.append(row);
    }
    sections.push(colors);

    const chips = (title: string, list: { id: string; name: string }[], current: string, set: (id: string) => void) => {
      const sec = document.createElement('div');
      sec.className = 'ed-section';
      sec.append(heading(title));
      const wrap = document.createElement('div');
      wrap.className = 'ed-chips';
      for (const item of list) {
        const b = document.createElement('button');
        b.className = 'ed-chip' + (item.id === current ? ' on' : '');
        b.textContent = item.name;
        b.onclick = () => set(item.id);
        wrap.append(b);
      }
      sec.append(wrap);
      return sec;
    };
    for (const [slot, title] of ITEM_ROWS) {
      sections.push(chips(title, COSMETICS_BY_SLOT[slot], this.look[slot], (id) => this.setLook({ ...this.look, [slot]: id })));
    }
    sections.push(chips('Patrón del torso', PATTERNS, this.look.pattern, (id) => this.setLook({ ...this.look, pattern: id })));

    const scroll = this.options.scrollTop;
    this.options.replaceChildren(...sections);
    this.options.scrollTop = scroll;
  }
}

function heading(text: string): HTMLElement {
  const h = document.createElement('div');
  h.className = 'ed-heading';
  h.textContent = text;
  return h;
}
