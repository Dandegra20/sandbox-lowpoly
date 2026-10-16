// Pruebas de sincronización con 4–6 jugadores contra el servidor real (sin navegador).
// Arranca `src/server/index.ts` en un puerto libre y conecta bots por WebSocket que envían
// inputs binarios a 60 Hz, como el cliente. Ejecutar con `npm test`.

import { spawn, type ChildProcess } from 'node:child_process';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { randomLook } from '../src/content/cosmetics';
import { WEAPON_INDEX } from '../src/content/weapons';
import { MAX_PLAYERS_PER_ROOM, PLAYER_RADIUS, TICK_RATE } from '../src/shared/constants';
import { encodeInput } from '../src/shared/input';
import { Button, BinaryType, type ClientMessage, type ServerMessage } from '../src/shared/protocol';
import { decodeSnapshot, type Snapshot } from '../src/shared/snapshot';

const PORT = 3200 + Math.floor(Math.random() * 500);
let server: ChildProcess;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitUntil(fn: () => boolean, timeout = 3000): Promise<void> {
  const end = Date.now() + timeout;
  while (!fn()) {
    if (Date.now() > end) throw new Error('tiempo de espera agotado');
    await sleep(10);
  }
}

/** Jugador simulado: guarda los mensajes y snapshots que recibe y envía inputs a 60 Hz. */
class Bot {
  ws!: WebSocket;
  id = -1;
  token = '';
  code = '';
  msgs: ServerMessage[] = [];
  snaps: { at: number; snap: Snapshot; bytes: number }[] = [];
  seq = 0;
  buttons = 0;
  yaw = 0;
  pitch = 0;
  weapon = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  async connect(): Promise<this> {
    this.ws = new WebSocket(`ws://localhost:${PORT}/ws`);
    this.ws.binaryType = 'arraybuffer';
    this.ws.on('message', (data: ArrayBuffer | string, isBinary: boolean) => {
      if (isBinary) {
        const view = new DataView(data as ArrayBuffer);
        if (view.getUint8(0) === BinaryType.Snapshot) {
          this.snaps.push({ at: performance.now(), snap: decodeSnapshot(view), bytes: view.byteLength });
        }
      } else {
        const m = JSON.parse(data.toString()) as ServerMessage;
        this.msgs.push(m);
        if (m.t === 'welcome') {
          this.id = m.playerId;
          this.token = m.token;
          this.code = m.roomCode;
          this.seq = 0; // el servidor reinicia la numeración al (re)entrar
        }
      }
    });
    await new Promise((res, rej) => {
      this.ws.once('open', res);
      this.ws.once('error', rej);
    });
    return this;
  }

  send(m: ClientMessage): void {
    this.ws.send(JSON.stringify(m));
  }

  async waitFor<T extends ServerMessage['t']>(t: T, timeout = 3000, from = 0): Promise<Extract<ServerMessage, { t: T }>> {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const m = this.msgs.slice(from).find((x) => x.t === t);
      if (m) return m as Extract<ServerMessage, { t: T }>;
      await sleep(10);
    }
    throw new Error(`bot ${this.id}: no llegó "${t}"`);
  }

  startInputs(): void {
    this.timer = setInterval(() => {
      if (this.ws.readyState !== WebSocket.OPEN) return;
      this.ws.send(encodeInput({
        seq: ++this.seq, buttons: this.buttons, yaw: this.yaw, pitch: this.pitch, weapon: this.weapon,
        viewTick: this.snaps.at(-1)?.snap.tick ?? 0, wheel: 0,
      }));
    }, 1000 / TICK_RATE);
  }

  stopInputs(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get last(): Snapshot | undefined {
    return this.snaps.at(-1)?.snap;
  }

  close(): void {
    this.stopInputs();
    this.ws.terminate();
  }
}

async function createRoom(map = 'flatgrass', mode = 'sandbox'): Promise<Bot> {
  const host = await new Bot().connect();
  host.send({ t: 'create_room', name: 'Anfitrion', clientId: 'host-' + Math.random(), look: randomLook(), map, mode: mode as 'sandbox', killLimit: 10 });
  await host.waitFor('welcome');
  return host;
}

async function join(code: string, name: string): Promise<Bot> {
  const b = await new Bot().connect();
  b.send({ t: 'join_room', code, name, clientId: name + Math.random(), look: randomLook() });
  await b.waitFor('welcome');
  return b;
}

before(async () => {
  server = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  server.stderr!.on('data', (d) => (out += d));
  await new Promise<void>((res, rej) => {
    const t = setTimeout(() => rej(new Error('El servidor no arrancó:\n' + out)), 20_000);
    server.stdout!.on('data', (d: Buffer) => {
      out += d;
      if (out.includes('servidor en marcha')) {
        clearTimeout(t);
        res();
      }
    });
  });
});

after(() => {
  server.kill();
});

describe('sala con 6 jugadores', () => {
  const bots: Bot[] = [];

  after(() => bots.forEach((b) => b.close()));

  it('entran 6, todos se ven y el 7º se rechaza', async () => {
    bots.push(await createRoom());
    for (let i = 1; i < MAX_PLAYERS_PER_ROOM; i++) bots.push(await join(bots[0].code, `Bot${i}`));
    assert.deepEqual(bots.map((b) => b.id), [0, 1, 2, 3, 4, 5]);

    const extra = await new Bot().connect();
    extra.send({ t: 'join_room', code: bots[0].code, name: 'Sobra', clientId: 'x', look: randomLook() });
    const err = await extra.waitFor('error');
    assert.equal(err.code, 'room_full');
    extra.close();

    for (const b of bots) b.startInputs();
    await sleep(600);
    for (const b of bots) {
      assert.equal(b.last?.players.length, 6, `el bot ${b.id} ve a todos`);
      const joined = b.msgs.filter((m) => m.t === 'player_joined').length;
      assert.equal(joined, 5 - b.id, `el bot ${b.id} recibe un aviso por cada jugador que entra después`);
    }
  });

  it('nadie aparece encima de otro jugador', async () => {
    await sleep(800); // que caigan al suelo
    const ps = bots[0].last!.players;
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const d = Math.hypot(ps[i].x - ps[j].x, ps[i].z - ps[j].z);
        assert.ok(d > PLAYER_RADIUS * 2 + 0.2, `jugadores ${ps[i].id} y ${ps[j].id} a ${d.toFixed(2)} m`);
      }
    }
  });

  it('el servidor procesa a tiempo los inputs de los 6 (60 Hz cada uno)', async () => {
    // Todos andan y saltan a la vez durante 3 s.
    bots.forEach((b, i) => {
      b.yaw = (i / bots.length) * Math.PI * 2;
      b.buttons = Button.Forward | (i % 2 ? Button.Jump : 0);
    });
    const from = bots[0].snaps.length;
    const t0 = performance.now();
    await sleep(3000);
    const elapsed = performance.now() - t0;
    const window = bots[0].snaps.slice(from);
    const ticks = window.at(-1)!.snap.tick - window[0].snap.tick;
    const tickRate = (ticks * 1000) / (window.at(-1)!.at - window[0].at);
    assert.ok(Math.abs(tickRate - TICK_RATE) < 6, `ritmo del servidor: ${tickRate.toFixed(1)} ticks/s`);

    let maxGap = 0;
    for (let i = 1; i < window.length; i++) maxGap = Math.max(maxGap, window[i].at - window[i - 1].at);
    assert.ok(maxGap < 200, `hueco máximo entre snapshots: ${maxGap.toFixed(0)} ms`);

    for (const b of bots) {
      const me = b.last!.players.find((p) => p.id === b.id)!;
      // Inputs enviados que el servidor aún no ha aplicado (latencia de cola).
      const lag = b.seq - me.lastInputSeq;
      assert.ok(lag < 12, `bot ${b.id}: ${lag} inputs sin procesar`);
    }
    console.log(`    ritmo ${tickRate.toFixed(1)} ticks/s, hueco máx. ${maxGap.toFixed(0)} ms, ${(elapsed / 1000).toFixed(1)} s`);
  });

  it('ancho de banda con la sala llena de objetos despiertos', async () => {
    bots.forEach((b) => {
      b.buttons = 0;
      b.pitch = -0.6;
    });
    await sleep(200);
    // Cada uno crea 6 ragdolls (36 cuerpos): 216 > MAX_DYNAMIC_PROPS, así que alguno se rechaza.
    for (let k = 0; k < 6; k++) {
      for (const b of bots) b.send({ t: 'spawn', id: 'ragdoll' });
      await sleep(300);
    }
    await sleep(300);
    const props = bots[0].msgs.filter((m) => m.t === 'prop_added').length;
    const limited = bots.flatMap((b) => b.msgs).filter((m) => m.t === 'error' && m.code === 'limit_reached').length;
    console.log(`    ${props} cuerpos creados, ${limited} spawns rechazados por el límite`);
    assert.ok(props <= 200 + 5, 'se respeta MAX_DYNAMIC_PROPS (más los del mapa)');

    // Todos disparan cohetes al montón para despertarlo todo.
    bots.forEach((b) => {
      b.weapon = WEAPON_INDEX.rocket;
      b.pitch = -1.2;
    });
    await sleep(400);
    const from = bots.map((b) => b.snaps.length);
    bots.forEach((b) => (b.buttons = Button.Fire));
    await sleep(2000);
    bots.forEach((b) => (b.buttons = 0));

    let maxBytes = 0;
    let total = 0;
    let span = 0;
    bots.forEach((b, i) => {
      const w = b.snaps.slice(from[i]);
      for (const s of w) maxBytes = Math.max(maxBytes, s.bytes);
      total += w.reduce((a, s) => a + s.bytes, 0);
      span = Math.max(span, w.at(-1)!.at - w[0].at);
    });
    const perClient = total / bots.length / (span / 1000) / 1024;
    console.log(`    snapshot máx. ${maxBytes} B; ${perClient.toFixed(1)} KB/s por jugador; `
      + `${(perClient * bots.length).toFixed(0)} KB/s de subida para el anfitrión`);
    // Un túnel o una ADSL modesta suben ~500 KB/s: con 6 jugadores hay que quedar por debajo.
    assert.ok(perClient * bots.length < 500, 'subida total del servidor por debajo de 500 KB/s');
  });

  it('desconexión sin "leave": el hueco se guarda y se recupera con el token', async () => {
    const b = bots[3];
    const marks = bots.map((x) => x.msgs.length);
    b.close();
    const status = await bots[0].waitFor('player_status', 3000, marks[0]);
    assert.deepEqual([status.id, status.connected], [3, false]);

    // Mientras el hueco está reservado, la sala sigue llena.
    const extra = await new Bot().connect();
    extra.send({ t: 'join_room', code: bots[0].code, name: 'Sobra', clientId: 'y', look: randomLook() });
    assert.equal((await extra.waitFor('error')).code, 'room_full');
    extra.close();

    const again = await new Bot().connect();
    again.send({ t: 'rejoin', code: b.code, token: b.token });
    const w = await again.waitFor('welcome');
    assert.equal(w.playerId, 3);
    bots[3] = again;
    again.startInputs();
    await waitUntil(() => bots[0].msgs.slice(marks[0]).some((m) => m.t === 'player_status' && m.id === 3 && m.connected));
    await sleep(300);
    assert.ok(bots[0].last!.players.some((p) => p.id === 3), 'vuelve a salir en los snapshots');
    // Los inputs nuevos (seq desde 1) se aceptan.
    const me = again.last!.players.find((p) => p.id === 3)!;
    assert.ok(me.lastInputSeq > 0 && me.lastInputSeq <= again.seq);
  });

  it('si el anfitrión se va, pasa al siguiente y su hueco se reutiliza', async () => {
    const mark = bots[1].msgs.length;
    bots[0].send({ t: 'leave' });
    const hc = await bots[1].waitFor('host_changed', 2000, mark);
    assert.equal(hc.id, 1);
    bots[0].close();
    const left = await bots[1].waitFor('player_left', 2000, mark);
    assert.equal(left.id, 0);
    // Sus objetos se borran con él.
    const removed = bots[1].msgs.slice(mark).filter((m) => m.t === 'prop_removed').length;
    assert.ok(removed > 0, 'se borran los objetos del que se va');

    const mark2 = bots[1].msgs.length;
    const nuevo = await join(bots[1].code, 'Nuevo');
    assert.equal(nuevo.id, 0);
    const pj = await bots[1].waitFor('player_joined', 2000, mark2);
    assert.equal(pj.player.id, 0);
    const w = nuevo.msgs.find((m) => m.t === 'welcome')!;
    assert.equal(w.t === 'welcome' && w.hostId, 1);
    bots[0] = nuevo;
  });
});

describe('deathmatch con 4 jugadores', () => {
  const bots: Bot[] = [];
  after(() => bots.forEach((b) => b.close()));

  it('reaparecen separados y lejos unos de otros', async () => {
    bots.push(await createRoom('arena', 'deathmatch'));
    for (let i = 1; i < 4; i++) bots.push(await join(bots[0].code, `DM${i}`));
    for (const b of bots) b.startInputs();
    await sleep(1000);
    const ps = bots[0].last!.players;
    let minD = Infinity;
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) minD = Math.min(minD, Math.hypot(ps[i].x - ps[j].x, ps[i].z - ps[j].z));
    }
    assert.ok(minD > 10, `distancia mínima entre jugadores: ${minD.toFixed(1)} m`);
  });
});
