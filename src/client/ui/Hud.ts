import { WEAPONS } from '../../content/weapons';
import { MAX_PLAYERS_PER_ROOM, PLAYER_MAX_HEALTH } from '../../shared/constants';
import type { PlayerInfo } from '../../shared/protocol';
import { shareOrigin } from '../net/ServerInfo';
import { renderPlayerList, type PlayerListState } from './PlayerList';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface HudCallbacks {
  onResume: () => void;
  onLeave: () => void;
  onKick: (p: PlayerInfo) => void;
  onEditor: () => void;
  onSettings: () => void;
}

/** HUD en partida: código de sala, stats, lista de jugadores (Tab), pausa y avisos. */
export class Hud {
  private root = $('hud');
  private pause = $('pause');
  private pauseList = $('pause-list');
  private tabList = $('tab-list');
  private stats = $('stats');
  private count = $('player-count');
  private banner = $('banner');
  private crosshair = $('crosshair');
  private code: string;
  private listState: PlayerListState | null = null;
  private tabVisible = false;
  private health = $('health');
  private healthValue = $('health-value');
  private healthBar = $('health-bar');
  private weaponBar = $('weapon-bar');
  private hitmarker = $('hitmarker');
  private damageFlash = $('damage-flash');
  private killfeed = $('killfeed');
  private deathScreen = $('death-screen');
  private deathText = $('death-text');
  private deathTimer = $('death-timer');
  private respawnAt = 0;
  private hint = $('hint');
  private modeInfo = $('mode-info');
  private results = $('results');
  private resultsTitle = $('results-title');
  private resultsList = $('results-list');
  private resultsTimer = $('results-timer');
  private resultsEnd = 0;
  private toolPanel = $('tool-panel');
  private toolName = $('tool-name');
  private toolHelp = $('tool-help');
  private toolColor = $('tool-color');
  private toolMsg = $('tool-msg');
  private toolMsgTimer: ReturnType<typeof setTimeout> | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(roomCode: string, private cb: HudCallbacks) {
    this.code = roomCode;
    $('room-code').textContent = roomCode;
    $<HTMLButtonElement>('copy-link').onclick = () => this.copyLink();
    $<HTMLButtonElement>('resume').onclick = () => cb.onResume();
    $<HTMLButtonElement>('leave').onclick = () => cb.onLeave();
    $<HTMLButtonElement>('pause-editor').onclick = () => cb.onEditor();
    $<HTMLButtonElement>('pause-settings').onclick = () => cb.onSettings();
    // Clic fuera del panel de pausa = volver al juego.
    this.pause.onclick = (e) => e.target === this.pause && cb.onResume();
    this.root.hidden = false;
    this.setBanner(null);
    this.weaponBar.replaceChildren(...WEAPONS.map((w) => {
      const el = document.createElement('div');
      el.className = 'w';
      const key = document.createElement('b');
      key.textContent = String(w.slot);
      el.append(key, w.name);
      return el;
    }));
    this.killfeed.replaceChildren();
    this.hideDeath();
  }

  // ------------------------------------------------------------------ combate

  setHealth(h: number): void {
    this.healthValue.textContent = String(h);
    const k = Math.max(0, h / PLAYER_MAX_HEALTH);
    this.healthBar.style.width = `${k * 100}%`;
    this.healthBar.style.background = k > 0.5 ? '#2ecc71' : k > 0.25 ? '#f1c40f' : '#e74c3c';
    this.health.classList.toggle('low', k <= 0.25);
  }

  /** Oculta en la barra las armas que el modo no permite. */
  setWeaponsAvailable(allowed: (index: number) => boolean): void {
    [...this.weaponBar.children].forEach((el, i) => ((el as HTMLElement).hidden = !allowed(i)));
  }

  setModeInfo(text: string): void {
    this.modeInfo.textContent = text;
  }

  /** Pantalla de resultados de la ronda (null = ocultarla). */
  showResults(r: { title: string; rows: { name: string; color: number; kills: number; deaths: number; winner: boolean; me: boolean }[]; restartMs: number } | null): void {
    this.results.hidden = !r;
    if (!r) {
      this.resultsEnd = 0;
      return;
    }
    this.resultsTitle.textContent = r.title;
    this.resultsEnd = performance.now() + r.restartMs;
    this.resultsList.replaceChildren(...r.rows.map((row, i) => {
      const el = document.createElement('div');
      el.className = 'p' + (row.me ? ' me' : '') + (row.winner ? ' winner' : '');
      const pos = document.createElement('span');
      pos.className = 'tag';
      pos.textContent = `${i + 1}º`;
      const sw = document.createElement('span');
      sw.className = 'swatch';
      sw.style.background = `#${row.color.toString(16).padStart(6, '0')}`;
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = row.name;
      const k = document.createElement('span');
      k.className = 'score';
      k.textContent = `${row.kills} bajas`;
      const d = document.createElement('span');
      d.className = 'score';
      d.textContent = `${row.deaths} muertes`;
      el.append(pos, sw, name, k, d);
      return el;
    }));
    this.updateResultsTimer();
  }

  /** Llamar cada frame: cuenta atrás hasta la siguiente ronda. */
  updateResultsTimer(): void {
    if (!this.resultsEnd) return;
    const sec = Math.max(0, Math.ceil((this.resultsEnd - performance.now()) / 1000));
    this.resultsTimer.textContent = sec > 0 ? `Nueva ronda en ${sec}…` : 'Empezando…';
  }

  setWeapon(index: number): void {
    [...this.weaponBar.children].forEach((el, i) => el.classList.toggle('on', i === index));
  }

  /** Aspa junto a la mira al acertar (roja si ha sido una baja). */
  hitMarker(kill: boolean): void {
    this.flash(this.hitmarker, 120);
    this.hitmarker.classList.toggle('kill', kill);
  }

  /** Borde rojo al recibir daño. */
  hurt(): void {
    this.flash(this.damageFlash, 80);
  }

  private flash(el: HTMLElement, ms: number): void {
    el.classList.add('show');
    this.later(() => el.classList.remove('show'), ms);
  }

  addKill(killer: { name: string; color: number } | null, victim: { name: string; color: number }, weapon: string, mine: boolean): void {
    const row = document.createElement('div');
    row.className = 'k' + (mine ? ' me' : '');
    const name = (p: { name: string; color: number }) => {
      const b = document.createElement('b');
      b.style.color = `#${p.color.toString(16).padStart(6, '0')}`;
      b.textContent = p.name;
      return b;
    };
    const wpn = document.createElement('span');
    wpn.className = 'wpn';
    wpn.textContent = `[${weapon}]`;
    if (killer) row.append(name(killer), wpn, name(victim));
    else row.append(name(victim), wpn);
    this.killfeed.append(row);
    while (this.killfeed.childElementCount > 5) this.killfeed.firstElementChild!.remove();
    this.later(() => row.classList.add('old'), 6000);
    this.later(() => row.remove(), 6700);
  }

  showDeath(text: string, respawnMs: number): void {
    this.deathText.textContent = text;
    this.respawnAt = performance.now() + respawnMs;
    this.deathScreen.hidden = false;
    this.updateDeathTimer();
  }

  hideDeath(): void {
    this.deathScreen.hidden = true;
    this.respawnAt = 0;
  }

  /** Llamar cada frame: cuenta atrás de la reaparición. */
  updateDeathTimer(): void {
    if (!this.respawnAt) return;
    const s = Math.max(0, Math.ceil((this.respawnAt - performance.now()) / 1000));
    this.deathTimer.textContent = s > 0 ? `Reapareces en ${s}…` : 'Reapareciendo…';
  }

  private later(fn: () => void, ms: number): void {
    this.timers.push(setTimeout(fn, ms));
  }

  setPaused(paused: boolean): void {
    this.pause.hidden = !paused;
    this.crosshair.hidden = paused;
    if (paused) this.renderLists();
  }

  setTabListVisible(visible: boolean): void {
    if (visible === this.tabVisible) return;
    this.tabVisible = visible;
    this.tabList.hidden = !visible;
    if (visible) this.renderLists();
  }

  setPlayers(state: PlayerListState): void {
    this.listState = state;
    const online = state.players.filter((p) => p.connected).length;
    this.count.textContent = `Jugadores: ${online}/${MAX_PLAYERS_PER_ROOM}`;
    this.renderLists();
  }

  private renderLists(): void {
    if (!this.listState) return;
    if (!this.pause.hidden) renderPlayerList(this.pauseList, this.listState, this.cb.onKick);
    if (this.tabVisible) renderPlayerList(this.tabList, this.listState);
  }

  setStatsVisible(visible: boolean): void {
    this.stats.hidden = !visible;
  }

  setStats(text: string): void {
    this.stats.textContent = text;
  }

  /** Panel de la tool gun (null = oculto): herramienta, controles y color de Pintar. */
  setTool(tool: { name: string; primary: string; secondary?: string; reload?: string; id: string } | null, color: number): void {
    this.toolPanel.hidden = !tool;
    if (!tool) return;
    if (this.toolName.textContent !== tool.name) {
      this.toolName.textContent = tool.name;
      const rows: [string, string | undefined][] = [['Clic izq.', tool.primary], ['Clic der.', tool.secondary], ['R', tool.reload]];
      this.toolHelp.replaceChildren(...rows.filter(([, t]) => t).map(([k, t]) => {
        const row = document.createElement('div');
        const kbd = document.createElement('kbd');
        kbd.textContent = k;
        row.append(kbd, t!);
        return row;
      }));
    }
    this.toolColor.hidden = tool.id !== 'paint';
    this.toolColor.style.background = `#${color.toString(16).padStart(6, '0')}`;
  }

  /** Mensaje breve de la herramienta bajo la mira. */
  toolMessage(text: string, ok: boolean): void {
    this.toolMsg.textContent = text;
    this.toolMsg.classList.toggle('bad', !ok);
    this.toolMsg.hidden = false;
    if (this.toolMsgTimer) clearTimeout(this.toolMsgTimer);
    this.toolMsgTimer = setTimeout(() => (this.toolMsg.hidden = true), 2500);
  }

  /** Pista contextual (p. ej. "Pulsa E para conducir"); null la oculta. */
  setHint(text: string | null): void {
    if (this.hint.textContent !== (text ?? '')) this.hint.textContent = text ?? '';
    this.hint.hidden = text === null;
  }

  /** Aviso destacado en pantalla (p. ej. "Reconectando…"); null lo oculta. */
  setBanner(text: string | null): void {
    this.banner.hidden = text === null;
    this.banner.textContent = text ?? '';
  }

  private copyLink(): void {
    // Si juegas en "localhost", el enlace lleva la dirección de la LAN o del túnel.
    const url = `${shareOrigin()}${location.pathname}?sala=${this.code}`;
    const btn = $<HTMLButtonElement>('copy-link');
    navigator.clipboard?.writeText(url).then(
      () => (btn.textContent = '¡Copiado!'),
      () => prompt('Copia este enlace:', url),
    );
    setTimeout(() => (btn.textContent = 'Copiar enlace'), 1500);
  }

  dispose(): void {
    this.timers.forEach(clearTimeout);
    this.hideDeath();
    this.setHint(null);
    this.toolPanel.hidden = true;
    this.toolMsg.hidden = true;
    this.showResults(null);
    this.root.hidden = true;
    this.tabList.hidden = true;
    this.tabVisible = false;
    this.pause.onclick = null;
    this.setBanner(null);
  }
}
