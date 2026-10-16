import { sound } from '../audio/Sound';
import { settings, type QualityLevel, type SettingsData } from '../core/Settings';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const QUALITY_DESC: Record<QualityLevel, string> = {
  auto: 'Se ajusta sola: baja si el juego va por debajo de 45 fps y sube si va sobrado. Recuerda el nivel que funcionó en este equipo.',
  high: 'Sombras de todo, más resolución y todas las partículas.',
  medium: 'Sombras solo del mapa y los personajes, resolución normal y menos partículas.',
  low: 'Sin sombras ni decorado lejano, menos resolución y pocas partículas. El antialiasing se quita al entrar en otra sala.',
};

/** Panel de ajustes: cada control escribe en `settings`, que avisa a quien los use. */
export class SettingsPanel {
  onClose: () => void = () => {};
  private root = $('settings');

  constructor() {
    const range = (id: string, key: keyof SettingsData, fmt: (v: number) => string) => {
      const input = $<HTMLInputElement>(`set-${id}`);
      const out = $(`out-${id}`);
      input.oninput = () => {
        settings.set({ [key]: Number(input.value) });
        out.textContent = fmt(Number(input.value));
      };
      return (s: Readonly<SettingsData>) => {
        input.value = String(s[key]);
        out.textContent = fmt(s[key] as number);
      };
    };
    const pct = (v: number) => `${Math.round(v * 100)} %`;
    const syncers = [
      range('sensitivity', 'sensitivity', (v) => `${v.toFixed(2)}×`),
      range('fov', 'fov', (v) => `${v}º`),
      range('master', 'masterVolume', pct),
      range('effects', 'effectsVolume', pct),
      range('ui', 'uiVolume', pct),
    ];
    const invert = $<HTMLInputElement>('set-invert');
    const stats = $<HTMLInputElement>('set-stats');
    const quality = $<HTMLSelectElement>('set-quality');
    const qualityDesc = $('quality-desc');
    invert.onchange = () => settings.set({ invertY: invert.checked });
    stats.onchange = () => settings.set({ showStats: stats.checked });
    quality.onchange = () => settings.set({ quality: quality.value as QualityLevel });

    // Al restablecer (o al abrir) se refrescan todos los controles.
    settings.onChange((s) => {
      for (const sync of syncers) sync(s);
      invert.checked = s.invertY;
      stats.checked = s.showStats;
      quality.value = s.quality;
      qualityDesc.textContent = QUALITY_DESC[s.quality];
    });

    // Al soltar un deslizador de volumen se oye cómo queda.
    for (const id of ['master', 'effects']) $(`set-${id}`).addEventListener('change', () => sound.play('pistol', { volume: 0.7 }));
    $(`set-ui`).addEventListener('change', () => sound.play('kill_confirm'));
    $<HTMLButtonElement>('set-test-sound').onclick = () => {
      sound.play('explosion', { volume: 0.8 });
    };
    $<HTMLButtonElement>('settings-reset').onclick = () => settings.reset();
    $<HTMLButtonElement>('settings-close').onclick = () => this.close();
    this.root.onclick = (e) => e.target === this.root && this.close();
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        e.stopPropagation();
        this.close();
      }
    }, true);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(): void {
    this.root.hidden = false;
  }

  close(): void {
    if (!this.isOpen) return;
    this.root.hidden = true;
    this.onClose();
  }
}
