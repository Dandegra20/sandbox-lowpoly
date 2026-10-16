import { MAX_PLAYERS_PER_ROOM } from '../../shared/constants';
import type { PlayerInfo } from '../../shared/protocol';

export interface PlayerListState {
  players: PlayerInfo[];
  myId: number;
  hostId: number;
  pings: Map<number, number>;
}

/**
 * Lista de jugadores y marcador. Se dibuja en dos sitios: el panel de Tab (solo lectura) y el menú de
 * pausa, donde el anfitrión tiene botones para expulsar (ahí el ratón está libre).
 */
export function renderPlayerList(container: HTMLElement, s: PlayerListState, onKick?: (p: PlayerInfo) => void): void {
  container.replaceChildren();
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = `Jugadores (${s.players.filter((p) => p.connected).length}/${MAX_PLAYERS_PER_ROOM})`;
  container.append(title);

  const header = document.createElement('div');
  header.className = 'p header';
  header.innerHTML = '<span class="swatch"></span><span class="name">Jugador</span><span class="tag"></span>'
    + '<span class="score">Bajas</span><span class="score">Muertes</span><span class="ping">Ping</span>';
  container.append(header);

  // Marcador: más bajas primero; a igualdad, menos muertes.
  const sorted = [...s.players].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.id - b.id);
  for (const p of sorted) {
    const row = document.createElement('div');
    row.className = 'p' + (p.id === s.myId ? ' me' : '') + (p.connected ? '' : ' off');

    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = `#${p.color.toString(16).padStart(6, '0')}`;

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = p.name;

    const tag = document.createElement('span');
    tag.className = 'tag';
    const tags: string[] = [];
    if (p.id === s.hostId) tags.push('★ anfitrión');
    if (p.id === s.myId) tags.push('tú');
    if (!p.connected) tags.push('reconectando…');
    tag.textContent = tags.join(' · ');

    const ping = document.createElement('span');
    ping.className = 'ping';
    const ms = s.pings.get(p.id);
    ping.textContent = p.connected && ms !== undefined ? `${ms} ms` : '';

    const kills = document.createElement('span');
    kills.className = 'score';
    kills.textContent = String(p.kills);
    const deaths = document.createElement('span');
    deaths.className = 'score';
    deaths.textContent = String(p.deaths);

    row.append(swatch, name, tag, kills, deaths, ping);

    if (onKick && s.myId === s.hostId && p.id !== s.myId) {
      const kick = document.createElement('button');
      kick.className = 'danger';
      kick.textContent = 'Expulsar';
      kick.onclick = () => onKick(p);
      row.append(kick);
    }
    container.append(row);
  }
}
