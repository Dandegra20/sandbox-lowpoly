import { DEFAULT_MAP, MAP_LIST } from '../../content/maps';
import { MODE_LIST, getMode, type ModeId } from '../../content/modes';
import { onServerInfo } from '../net/ServerInfo';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface CreateOptions {
  map: string;
  mode: ModeId;
  killLimit: number;
}

const OPTS_KEY = 'sandbox.create';

const NAME_KEY = 'sandbox.name';

/** Menú de entrada: nombre, crear sala o unirse con código. */
export class Menu {
  onCreate: (name: string, opts: CreateOptions) => void = () => {};
  onJoin: (name: string, code: string) => void = () => {};
  onEditor: () => void = () => {};
  onSettings: () => void = () => {};

  private root = $('menu');
  private nameInput = $<HTMLInputElement>('name');
  private codeInput = $<HTMLInputElement>('code');
  private createBtn = $<HTMLButtonElement>('create');
  private joinBtn = $<HTMLButtonElement>('join');
  private errorEl = $('menu-error');
  private mapSelect = $<HTMLSelectElement>('map-select');
  private modeSelect = $<HTMLSelectElement>('mode-select');
  private killSelect = $<HTMLSelectElement>('kill-limit');
  private killRow = $('kill-limit-row');
  private desc = $('create-desc');

  constructor() {
    try {
      this.nameInput.value = localStorage.getItem(NAME_KEY) ?? '';
    } catch { /* almacenamiento no disponible */ }
    this.codeInput.value = new URLSearchParams(location.search).get('sala')?.toUpperCase() ?? '';

    // Selectores de mapa y modo (desde los registros), recordando la última elección.
    for (const m of MAP_LIST) this.mapSelect.add(new Option(m.name, m.id));
    for (const m of MODE_LIST) this.modeSelect.add(new Option(m.name, m.id));
    let saved: Partial<CreateOptions> = {};
    try {
      saved = JSON.parse(localStorage.getItem(OPTS_KEY) ?? '{}');
    } catch { /* ignorar */ }
    this.mapSelect.value = MAP_LIST.some((m) => m.id === saved.map) ? saved.map! : DEFAULT_MAP;
    this.modeSelect.value = getMode(saved.mode).id;
    this.mapSelect.onchange = this.modeSelect.onchange = () => this.updateOptions();
    this.updateOptions(saved.killLimit);

    this.createBtn.onclick = () => {
      const opts: CreateOptions = {
        map: this.mapSelect.value, mode: getMode(this.modeSelect.value).id, killLimit: Number(this.killSelect.value) || 0,
      };
      try {
        localStorage.setItem(OPTS_KEY, JSON.stringify(opts));
      } catch { /* ignorar */ }
      this.onCreate(this.playerName(), opts);
    };
    this.joinBtn.onclick = () => {
      const code = this.codeInput.value.trim().toUpperCase();
      if (!code) return this.setError('Escribe el código de la sala.');
      this.onJoin(this.playerName(), code);
    };
    this.codeInput.addEventListener('keydown', (e) => e.key === 'Enter' && this.joinBtn.click());
    $<HTMLButtonElement>('open-editor').onclick = () => this.onEditor();
    $<HTMLButtonElement>('open-settings').onclick = () => this.onSettings();
    const help = $('help');
    $<HTMLButtonElement>('open-help').onclick = () => (help.hidden = false);
    $<HTMLButtonElement>('help-close').onclick = () => (help.hidden = true);
    help.onclick = (e) => e.target === help && (help.hidden = true);

    // Si el juego se abrió en este PC, se muestra cómo pueden entrar los demás.
    const share = $('share-info');
    onServerInfo((info) => {
      const lines: [string, string][] = [];
      if (info.tunnel) lines.push(['Por internet', info.tunnel]);
      else if (info.tunnelPending) lines.push(['Por internet', 'abriendo el túnel…']);
      for (const url of info.lan.slice(0, 2)) lines.push(['En tu red (LAN)', url]);
      share.hidden = !lines.length;
      share.replaceChildren(...lines.map(([label, url]) => {
        const row = document.createElement('div');
        const b = document.createElement('b');
        b.textContent = `${label}: `;
        const code = document.createElement('code');
        code.textContent = url;
        row.append(b, code);
        return row;
      }));
    });
  }

  /** Límite de bajas (solo para los modos que lo usan) y descripción del mapa y el modo. */
  private updateOptions(killLimit?: number): void {
    const mode = getMode(this.modeSelect.value);
    const current = killLimit ?? Number(this.killSelect.value);
    this.killSelect.replaceChildren(...mode.killLimits.map((k) => new Option(`${k} bajas`, String(k))));
    if (mode.killLimits.includes(current)) this.killSelect.value = String(current);
    else if (mode.killLimits.length) this.killSelect.value = String(mode.killLimits[1] ?? mode.killLimits[0]);
    this.killRow.hidden = !mode.killLimits.length;
    const map = MAP_LIST.find((m) => m.id === this.mapSelect.value);
    this.desc.textContent = `${map?.description ?? ''} ${mode.description}`;
  }

  private playerName(): string {
    const name = this.nameInput.value.trim();
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch { /* ignorar */ }
    return name;
  }

  show(error = ''): void {
    this.root.hidden = false;
    this.setBusy(false);
    this.setError(error);
  }

  hide(): void {
    this.root.hidden = true;
  }

  setBusy(busy: boolean): void {
    this.createBtn.disabled = this.joinBtn.disabled = busy;
  }

  setError(text: string): void {
    this.errorEl.textContent = text;
  }
}
