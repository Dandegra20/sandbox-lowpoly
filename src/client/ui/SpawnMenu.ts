import { CATEGORIES, SPAWNABLES, type SpawnableDef } from '../../content/spawnables';
import type { PropCategory } from '../../content/props';
import { PAINT_COLORS, TOOLS } from '../../content/tools';
import { MAX_PROPS_PER_PLAYER } from '../../shared/constants';
import { renderThumbnails } from './Thumbnails';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/**
 * Menú de spawn (Q): categorías a la izquierda, rejilla de objetos con miniatura.
 * Clic = crear donde apunta el jugador y cerrar; Mayús+clic = crear sin cerrar.
 * Mientras está abierto el ratón queda libre (sin pointer lock).
 */
export class SpawnMenu {
  onSpawn: (id: string) => void = () => {};
  onUndo: () => void = () => {};
  onClear: () => void = () => {};
  onSelectTool: (id: string) => void = () => {};
  onSelectColor: (color: number) => void = () => {};
  /** relock = volver a capturar el ratón (solo si se cierra con una acción del usuario). */
  onClose: (relock: boolean) => void = () => {};

  private root = $('spawn-menu');
  private tabs = $('spawn-tabs');
  private grid = $('spawn-grid');
  private count = $('spawn-count');
  private category: PropCategory | 'Herramientas' = CATEGORIES[0];
  private tool = '';
  private color = 0;
  private help = $('spawn-help');
  private defaultHelp = this.help.textContent ?? '';
  private thumbs: Map<string, string> | null = null;

  constructor() {
    $<HTMLButtonElement>('spawn-undo').onclick = () => this.onUndo();
    $<HTMLButtonElement>('spawn-clear').onclick = () => {
      if (confirm('¿Borrar todos tus objetos?')) this.onClear();
    };
    $<HTMLButtonElement>('spawn-close').onclick = () => this.close(true);
    // Clic fuera del panel = cerrar.
    this.root.onclick = (e) => e.target === this.root && this.close(true);
    document.addEventListener('keydown', this.onKey);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(): void {
    if (this.isOpen) return;
    if (!this.thumbs) this.thumbs = renderThumbnails(SPAWNABLES);
    this.root.hidden = false;
    this.render();
  }

  close(relock: boolean): void {
    if (!this.isOpen) return;
    this.root.hidden = true;
    this.onClose(relock);
  }

  /** Herramienta y color actuales (para resaltarlos). */
  setToolState(tool: string, color: number): void {
    this.tool = tool;
    this.color = color;
    if (this.isOpen && this.category === 'Herramientas') this.render();
  }

  setCount(n: number): void {
    this.count.textContent = `Tus objetos: ${n}/${MAX_PROPS_PER_PLAYER}`;
    this.count.classList.toggle('full', n >= MAX_PROPS_PER_PLAYER);
  }

  private onKey = (e: KeyboardEvent): void => {
    if (!this.isOpen) return;
    if (e.code === 'KeyQ') {
      e.preventDefault();
      this.close(true); // la pulsación de tecla permite volver a capturar el ratón
    } else if (e.code === 'Escape') {
      this.close(false);
    } else if (e.code === 'KeyZ') {
      this.onUndo();
    }
  };

  private render(): void {
    const tabs: (PropCategory | 'Herramientas')[] = [...CATEGORIES, 'Herramientas'];
    this.tabs.replaceChildren(...tabs.map((c) => {
      const b = document.createElement('button');
      b.textContent = c;
      b.className = c === this.category ? 'on' : '';
      b.onclick = () => {
        this.category = c;
        this.render();
      };
      return b;
    }));
    if (this.category === 'Herramientas') return this.renderTools();
    this.grid.className = '';
    this.help.textContent = this.defaultHelp;
    this.grid.replaceChildren(...SPAWNABLES.filter((s) => s.category === this.category).map((s) => this.item(s)));
  }

  /** Pestaña de herramientas: paleta de Pintar + una tarjeta por herramienta del registro. */
  private renderTools(): void {
    this.grid.className = 'tool-grid';
    this.help.textContent = 'Clic en una herramienta para usarla con la tool gun (6). Clic izq./der./R según la herramienta.';
    const palette = document.createElement('div');
    palette.className = 'palette';
    palette.append('Color para Pintar:');
    for (const c of PAINT_COLORS) {
      const b = document.createElement('button');
      b.style.background = `#${c.toString(16).padStart(6, '0')}`;
      b.className = c === this.color ? 'on' : '';
      b.title = 'Elegir color';
      b.onclick = () => {
        this.onSelectColor(c);
        this.setToolState(this.tool, c);
      };
      palette.append(b);
    }
    const cards = TOOLS.map((t) => {
      const el = document.createElement('button');
      el.className = 'tool-card' + (t.id === this.tool ? ' on' : '');
      const name = document.createElement('b');
      name.textContent = t.name;
      const desc = document.createElement('span');
      desc.textContent = t.description;
      el.append(name, desc);
      el.onclick = () => {
        this.onSelectTool(t.id);
        this.close(true);
      };
      return el;
    });
    this.grid.replaceChildren(palette, ...cards);
  }

  private item(s: SpawnableDef): HTMLElement {
    const el = document.createElement('button');
    el.className = 'spawn-item';
    el.title = `${s.name} — clic para crearlo (Mayús+clic: sin cerrar el menú)`;
    const url = this.thumbs?.get(s.id);
    if (url) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      img.draggable = false;
      el.append(img);
    }
    const label = document.createElement('span');
    label.textContent = s.name;
    el.append(label);
    el.onclick = (e) => {
      this.onSpawn(s.id);
      if (!e.shiftKey) this.close(true);
    };
    return el;
  }

  dispose(): void {
    document.removeEventListener('keydown', this.onKey);
    this.root.hidden = true;
  }
}
