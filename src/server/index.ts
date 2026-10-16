import RAPIER from '@dimforge/rapier3d-compat';
import { spawn } from 'node:child_process';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { MAX_NAME_LENGTH, SERVER_PORT, TICK_RATE, WS_PATH } from '../shared/constants';
import type { ErrorCode, ServerMessage } from '../shared/protocol';
import { decodeInput } from '../shared/input';
import { RoomManager } from './RoomManager';
import type { JoinResult, Room } from './Room';
import { createStaticHandler } from './static';
import { startTunnel, type TunnelState } from './tunnel';

const isDev = process.argv.includes('--dev');
/** --open: abre el navegador cuando el servidor ya escucha (start.bat). */
const openBrowser = process.argv.includes('--open');
/** --tunnel: abre también un túnel de Cloudflare para jugar por internet (start-online.bat). */
const withTunnel = process.argv.includes('--tunnel');
const PORT = Number(process.env.PORT) || SERVER_PORT;
let tunnel: TunnelState | null = null;

await RAPIER.init();

const rooms = new RoomManager();
// npm ejecuta los scripts desde la raíz del proyecto.
const serveStatic = createStaticHandler(join(process.cwd(), 'dist', 'client'));
const httpServer = createServer((req, res) => {
  if (req.url?.startsWith('/api/info')) return serveInfo(req, res);
  serveStatic(req, res);
});
// Compresión permessage-deflate (nivel 1, barata): reduce ~35 % el tráfico real con 6 jugadores
// y muchos objetos, que es lo que más pesa al jugar por un túnel. Solo para mensajes > 256 B.
const wss = new WebSocketServer({
  server: httpServer, path: WS_PATH, maxPayload: 4096,
  perMessageDeflate: { threshold: 256, zlibDeflateOptions: { level: 1 } },
});

interface Session {
  room: Room | null;
  playerId: number;
  alive: boolean;
}

const str = (v: unknown, max = 64): string => (typeof v === 'string' ? v.slice(0, max) : '');

wss.on('connection', (ws: WebSocket) => {
  const session: Session = { room: null, playerId: -1, alive: true };
  ws.on('pong', () => (session.alive = true));

  const sendError = (code: ErrorCode, message: string) => {
    const msg: ServerMessage = { t: 'error', code, message };
    ws.send(JSON.stringify(msg));
  };

  const enter = (room: Room, result: JoinResult, what: string) => {
    if (!result.ok) return sendError(result.code, result.message);
    session.room = room;
    session.playerId = result.id;
    console.log(`[sala ${room.code}] ${what} jugador ${result.id} (${room.connectedCount} conectados)`);
  };

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      if (!session.room) return;
      const buf = data as Buffer;
      const input = decodeInput(new DataView(buf.buffer, buf.byteOffset, buf.byteLength));
      if (input) session.room.handleInput(session.playerId, input);
      return;
    }

    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(data.toString());
      if (typeof msg !== 'object' || msg === null) return;
    } catch {
      return;
    }

    // --- Fuera de sala: crear, unirse o reconectar ---
    if (!session.room) {
      const clientId = str(msg.clientId) || 'anon';
      switch (msg.t) {
        case 'create_room': {
          const room = rooms.create(str(msg.map) || undefined, msg.mode, msg.killLimit);
          return enter(room, room.addPlayer(ws, sanitizeName(msg.name), clientId, msg.look), 'entra (anfitrión)');
        }
        case 'join_room': {
          const room = rooms.get(str(msg.code, 8));
          if (!room) return sendError('room_not_found', 'La sala no existe.');
          return enter(room, room.addPlayer(ws, sanitizeName(msg.name), clientId, msg.look), 'entra');
        }
        case 'rejoin': {
          const room = rooms.get(str(msg.code, 8));
          if (!room) return sendError('session_invalid', 'La sala ya no existe.');
          return enter(room, room.resumePlayer(ws, str(msg.token)), 'reconecta');
        }
      }
      return;
    }

    // --- Dentro de una sala ---
    const room = session.room;
    switch (msg.t) {
      case 'chat':
        return room.chat(session.playerId, msg.text);
      case 'kick':
        return room.kick(session.playerId, Number(msg.id));
      case 'ping':
        return room.ping(session.playerId, msg.n, msg.rtt);
      case 'spawn':
        return room.spawn(session.playerId, msg.id);
      case 'undo':
        return room.undo(session.playerId);
      case 'clear_props':
        return room.clearProps(session.playerId);
      case 'tool':
        return room.selectTool(session.playerId, msg.id, msg.color);
      case 'look':
        return room.setLook(session.playerId, msg.look);
      case 'leave':
        room.removePlayer(session.playerId, 'left');
        console.log(`[sala ${room.code}] sale el jugador ${session.playerId}`);
        session.room = null;
        return;
    }
  });

  ws.on('close', () => {
    clearInterval(heartbeat);
    const room = session.room;
    if (!room) return;
    // Cierre inesperado: se reserva el hueco para que pueda reconectar.
    if (room.disconnectPlayer(session.playerId, ws)) {
      console.log(`[sala ${room.code}] desconexión del jugador ${session.playerId} (hueco reservado)`);
    }
    session.room = null;
  });

  // Heartbeat: detecta conexiones muertas (útil con túneles y redes móviles).
  const heartbeat = setInterval(() => {
    if (!session.alive) return ws.terminate();
    session.alive = false;
    ws.ping();
  }, 10_000);
});

/** Direcciones LAN (IPv4) de este equipo. */
function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => n!.address);
}

/**
 * Direcciones para invitar (LAN y túnel). Solo para quien abre el juego en este mismo PC:
 * a los que llegan por la red o por el túnel (cabeceras de proxy) no se les enseña la IP local.
 */
function serveInfo(req: IncomingMessage, res: ServerResponse): void {
  const ip = req.socket.remoteAddress ?? '';
  const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)
    && !req.headers['x-forwarded-for'] && !req.headers['cf-connecting-ip'];
  const port = isDev ? 5173 : PORT;
  const body = local
    ? {
      lan: lanAddresses().map((a) => `http://${a}:${port}`),
      tunnel: tunnel?.url ?? null,
      tunnelPending: tunnel?.status === 'starting',
    }
    : { lan: [], tunnel: null, tunnelPending: false };
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** Abre una URL en el navegador por defecto. */
function openUrl(url: string): void {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    spawn(cmd as string, args as string[], { stdio: 'ignore', detached: true, windowsHide: true }).unref();
  } catch { /* sin navegador: no pasa nada */ }
}

function sanitizeName(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.replace(/[\u0000-\u001f<>]/g, '').trim() : '';
  return s.slice(0, MAX_NAME_LENGTH) || 'Jugador';
}

// --- Bucle de simulación a paso fijo ---
// Los timers de Windows tienen poca resolución, así que acumulamos tiempo real y
// ejecutamos tantos ticks fijos como toque (máx. 5 por vuelta para no espiralizar).
const TICK_MS = 1000 / TICK_RATE;
let last = performance.now();
let acc = 0;
function loop(): void {
  const now = performance.now();
  acc += now - last;
  last = now;
  let steps = 0;
  while (acc >= TICK_MS && steps < 5) {
    rooms.stepAll();
    acc -= TICK_MS;
    steps++;
  }
  if (steps === 5) acc = 0;
  setTimeout(loop, 1);
}
loop();

httpServer.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`
  [ERROR] El puerto ${PORT} ya está en uso.`);
    console.error('  Seguramente el juego ya está abierto en otra ventana: ciérrala, o usa esa.');
    console.error(`  (Para usar otro puerto: set PORT=3001 antes de arrancar.)
`);
    if (openBrowser) openUrl(`http://localhost:${PORT}`);
  } else {
    console.error('  [ERROR] No se pudo arrancar el servidor:', err.message);
  }
  process.exit(1);
});

httpServer.listen(PORT, '0.0.0.0', () => {
  const lan = lanAddresses();

  console.log('\n  Sandbox Low-Poly - servidor en marcha');
  if (isDev) {
    console.log(`  (modo dev) Servidor de juego en el puerto ${PORT}; abre el cliente de Vite:`);
    console.log('    Local: http://localhost:5173');
    for (const ip of lan) console.log(`    LAN:   http://${ip}:5173`);
  } else {
    console.log(`    Local: http://localhost:${PORT}`);
    for (const ip of lan) console.log(`    LAN:   http://${ip}:${PORT}   <- comparte esta con tus amigos`);
  }
  console.log('');
  if (withTunnel) tunnel = startTunnel(isDev ? 5173 : PORT);
  if (openBrowser) openUrl(`http://localhost:${isDev ? 5173 : PORT}`);
});
