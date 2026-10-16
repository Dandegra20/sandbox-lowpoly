import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../shared/constants';
import { Room } from './Room';

export class RoomManager {
  private rooms = new Map<string, Room>();

  create(mapId?: string, mode?: unknown, killLimit?: unknown): Room {
    let code: string;
    do code = randomCode();
    while (this.rooms.has(code));
    const room = new Room(code, mapId, mode, killLimit);
    this.rooms.set(code, room);
    console.log(`[sala ${code}] creada (mapa: ${room.map.id}, modo: ${room.mode.def.id}${room.mode.killLimit ? ` a ${room.mode.killLimit}` : ''})`);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.trim().toUpperCase());
  }

  /** Avanza todas las salas y cierra las que se han quedado sin jugadores (ni huecos reservados). */
  stepAll(): void {
    for (const room of this.rooms.values()) {
      room.step();
      if (room.isEmpty) {
        room.dispose();
        this.rooms.delete(room.code);
        console.log(`[sala ${room.code}] cerrada (vacía)`);
      }
    }
  }
}

function randomCode(): string {
  let s = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    s += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  }
  return s;
}
