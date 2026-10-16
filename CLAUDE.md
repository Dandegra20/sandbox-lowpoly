# CLAUDE.md: Sandbox Low-Poly

Sandbox multijugador ligero estilo Garry's Mod, en 3D low-poly con colores planos. Se ejecuta en local y se puede jugar en LAN y online mediante un túnel. El usuario trabaja en Windows y se comunica en **español**. Los textos de la interfaz y los comentarios del código van en español.

## Reglas de trabajo

- **Trabajar por fases.** No empezar la siguiente fase hasta que el usuario lo confirme. Al terminar una, actualizar la tabla de fases del final de este archivo.
- Si hay una decisión importante poco clara, preguntar antes de implementar.
- Prioridades: **ligero** (60 fps en un portátil normal), **divertido con amigos**, **fácil de ampliar**.

## Stack (obligatorio)

- **Cliente:** Three.js (aspecto low-poly con `MeshLambertMaterial` y geometría no indexada con normales por cara; ver la nota sobre `flatShading` en "Render"), Vite, TypeScript. **Sin modelos ni texturas externas**: mapas, objetos, personajes y armas se generan por código.
- **Servidor:** Node.js + TypeScript + `ws`. Escucha en `0.0.0.0:3000` y al arrancar imprime la URL local y la IP de LAN.
- **Física:** `@dimforge/rapier3d-compat`, **solo en el servidor** (autoritativo). Los clientes renderizan, envían inputs y reciben snapshots. El jugador local usa predicción en el cliente con corrección del servidor.
  - Excepción deliberada: el **movimiento del jugador** no lo hace Rapier, sino el controlador determinista de `src/shared/playerController.ts` (cápsula contra formas simples de `shared/collision.ts`). El servidor lo ejecuta de forma autoritativa y el cliente lo usa para predecir, así la predicción coincide exactamente. En Rapier el jugador es un cuerpo **cinemático** para que los objetos choquen con él.
- El código común (tipos, constantes, protocolo) vive en `src/shared`.
- Hasta 6 jugadores por sala (`MAX_PLAYERS_PER_ROOM`). Salas con código de 4 caracteres.
- Sin despliegue en la nube ni GitHub Pages. El juego online va por Cloudflare Tunnel o ngrok (ver README).

## Comandos

| Comando | Uso |
|---|---|
| `npm run dev` | Servidor (`tsx watch`, puerto 3000) + Vite (5173, HMR, reenvía `/ws` al 3000). Abrir **localhost:5173** |
| `npm run build` | `tsc --noEmit` + `vite build` (→ `dist/client`) + esbuild del servidor (→ `dist/server/index.js`) |
| `npm start` | `node dist/server/index.js`: sirve el cliente y el WS en el puerto 3000 |
| `npm run typecheck` | Solo comprobación de tipos (incluye `tests/`) |
| `npm test` | `tests/sync.test.ts`: arranca el servidor real en un puerto aleatorio y conecta 4–6 bots por WebSocket (~12 s) |
| `start.bat` | Comprueba Node ≥ 20, instala dependencias si faltan o si `package-lock.json` es más nuevo, **compila siempre** (unos segundos) y arranca con `--open` |
| `start-online.bat` | Lo mismo con `--tunnel`: el servidor lanza `cloudflared` (quick tunnel) y muestra la URL pública |

- Puertos: 3000 (juego y WebSocket); en dev, 5173 para el cliente de Vite (que reenvía `/ws` y `/api`).
- Flags del servidor: `--dev` (URLs del 5173), `--open` (abre el navegador cuando ya escucha; si el puerto está ocupado, abre el que ya corre y sale), `--tunnel` (`server/tunnel.ts`). Puerto con la variable `PORT`.
- Las capturas y pruebas en navegador se hicieron con Chrome headless + puppeteer-core fuera del repo, simulando el pointer lock.

TypeScript 7 (`tsc` nativo). Rapier 0.21: los raycasts devuelven `timeOfImpact`; hay que llamar a `RAPIER.init()` antes de crear el mundo.

## Estructura

```
index.html                 Menú, ajustes, controles, HUD (DOM estático)
tests/                     sync.test.ts (node:test + tsx; bots contra el servidor real)
src/shared/                constants.ts, protocol.ts (mensajes JSON), input.ts y snapshot.ts (binarios),
                           collision.ts (cápsula vs suelo/caja/esfera/cápsula, rayo vs cápsula, piezas de objetos),
                           playerController.ts (movimiento), weapons.ts (cadencia, cambio de arma, dispersión)
src/server/                index.ts (HTTP+WS+enrutado+bucle fijo, /api/info, --open/--tunnel), tunnel.ts, RoomManager.ts,
                           Room.ts (mundo Rapier, jugadores, reconexión, anfitrión, chat, expulsión),
                           Combat.ts (disparos, compensación de lag, cohetes, explosiones, pistola de
                           gravedad, bidones explosivos, daño, muertes, reapariciones),
                           PropSystem.ts (crear objetos por piezas, grupos con juntas, dueño, límites, deshacer,
                           pintura/escala/congelado), Vehicles.ts (vehículos conducibles, subir/bajar, atropellos),
                           Constraints.ts (soldaduras, cuerdas, propulsores), tools.ts (handlers de la tool gun +
                           ToolSystem), GameMode.ts (reglas del modo, rondas, resultados), types.ts, static.ts
src/client/core/           App.ts (sesión: menú, entrar, reconexión, expulsión, salir), Game.ts (partida: bucle
                           fijo 60 Hz + render + sonidos de estado), Input.ts (pointer lock, acciones), CameraController.ts
                           (1ª/3ª persona), Settings.ts (ajustes + niveles de calidad), Performance.ts (fps y calidad automática)
src/client/audio/          Sound.ts (motor WebAudio: sintetiza content/sounds.ts, espacialización, motores de vehículos)
src/client/net/            Connection.ts, SampleBuffer.ts (interpolación/extrapolación), ServerClock.ts (retardo adaptativo),
                           ServerInfo.ts (direcciones LAN/túnel para invitar)
src/client/world/          World.ts (cielo, luces, suelo, piezas del mapa fusionadas en una malla, agua, montañas)
src/client/entities/       LocalPlayer.ts (predicción con rebobinado), PlayerModel.ts (muñeco low-poly con aspecto + nombre),
                           Cosmetics.ts (accesorios, materiales y texturas de patrón con caché),
                           RemotePlayer.ts, PropRenderer.ts (InstancedMesh por tipo + tinte por instancia),
                           PropGeometry.ts (piezas → geometría fusionada), VehicleView.ts (ruedas)
src/client/weapons/        WeaponController.ts (selección + predicción visual de disparos), ViewModel.ts (arma en
                           1ª persona, 2ª pasada de render), WeaponModels.ts (modelo a partir de piezas),
                           Effects.ts (partículas instanciadas, trazadoras, explosiones, cohetes, rayos)
src/client/tools/          ToolVisuals.ts (cuerdas y propulsores con su llama)
src/client/ui/             Menu.ts, SettingsPanel.ts, Hud.ts (pausa, avisos, vida, armas, killfeed, muerte, pistas), Chat.ts,
                           PlayerList.ts (marcador), SpawnMenu.ts (menú Q + pestaña Herramientas), Thumbnails.ts,
                           CharacterEditor.ts (editor de personaje + guardado en localStorage)
src/content/               props.ts (objetos por piezas, explosivos, vehículos), spawnables.ts (menú y ragdolls),
                           tools.ts (herramientas), cosmetics.ts (aspecto: accesorios y patrones), maps.ts (5 mapas),
                           modes.ts (Sandbox, Deathmatch), weapons.ts, sounds.ts (sonidos sintetizados)
```

## Reglas de arquitectura

- **Contenido data-driven.** Cada objeto, arma, skin, herramienta y mapa es una entrada en su registro de `src/content/`. Añadir uno nuevo es crear una entrada, sin tocar el núcleo. El servidor lee los campos de física (forma, masa) y el cliente los visuales (forma, color) de la **misma** definición.
- **TypeScript tipado y modular** (`strict`), con comentarios breves donde la lógica no sea obvia.
- **Red:**
  - Los mensajes de control (salas, chat, expulsiones, ping, estado de jugadores, alta/baja de objetos) van en JSON (`ClientMessage`/`ServerMessage` en `protocol.ts`). Los errores llevan un `code` (`ErrorCode`).
  - Los inputs (60 Hz, 20 B: botones, mirada, arma, `viewTick`, rueda) y los snapshots (20 Hz) son **binarios**, con el primer byte = `BinaryType`.
  - El snapshot envía por jugador el **estado de movimiento completo** en f32 (posición, velocidad, flags, coyote, buffer de salto) más vida, arma, objeto sujeto con su distancia y vehículo (43 B). Por objeto (15 B): posición en **int16 a 1/128 m** (error ≤ 4 mm, alcance ±256 m) y rotación **"smallest three"** (3 × int16 + índice en los flags). Los objetos dormidos se omiten salvo en los snapshots completos (cada `FULL_SNAPSHOT_EVERY`) y en el snapshot justo después de dormirse.
  - El WebSocket usa **permessage-deflate** (nivel 1, mensajes > 256 B): ~35 % menos tráfico real. Si un socket acumula más de `MAX_BUFFERED_BYTES` (48 KB) se le salta el snapshot (antes eran 256 KB = segundos de retraso con una subida lenta).
  - Presupuesto medido con `npm test` (6 jugadores, ~190 cuerpos despiertos tras explosiones): snapshot máx. 3,2 KB, ~63 KB/s por jugador sin comprimir (≈ 250 KB/s de subida total con compresión). Antes del cambio de formato eran 4,8 KB y 560 KB/s.
  - El servidor aplica **un tick de controlador por input** (hasta `MAX_INPUTS_PER_TICK` si llegan en ráfaga, cola máx. `MAX_INPUT_QUEUE`). Si un jugador deja de enviar durante `INPUT_STARVE_TICKS`, se le simula quieto.
  - Predicción local "rebobinar y repetir": al llegar un snapshot, `LocalPlayer` toma el estado autoritativo de `lastInputSeq` y vuelve a aplicar los inputs pendientes con el mismo `stepPlayer`. Para no frenarse contra poses viejas, el mundo de colisión del cliente extrapola objetos y jugadores en movimiento `leadTicks` hacia delante. La diferencia que quede se disipa con un desfase visual.
  - **Cualquier cambio en el movimiento se hace en `shared/playerController.ts`** (afecta a ambos lados a la vez). Si necesita más estado, añádelo a `MoveState` **y** al snapshot.
  - Entidades remotas: `SampleBuffer` interpola en `tiempoServidor - delay`, con un delay que `ServerClock` adapta al jitter (`INTERP_DELAY_MIN_MS`–`INTERP_DELAY_MAX_MS`). Extrapola como mucho 100 ms si faltan snapshots y no interpola los teletransportes (> 6 m).
- **Objetos (fase 3):**
  - Cada objeto de `content/props.ts` se compone de **piezas** (`box`, `ball`, `cylinder` con eje, `cone`) con color propio. Las piezas `visualOnly` solo decoran.
    - Servidor: un colisionador de Rapier por pieza sólida, con la masa repartida según el volumen.
    - Cliente: todas las piezas se fusionan en una geometría (normales por cara, colores por vértice) con **un `InstancedMesh` por tipo** y tinte por instancia (`PropInfo.tint`).
    - Controlador del jugador: cilindros y conos se aproximan con cajas orientadas (`addPropShapes`).
  - El menú (Q) lista `SPAWNABLES`: todo objeto con `category` más los **grupos** de `spawnables.ts` (ragdolls: 6 cuerpos con juntas esféricas, contacto solo en el cuello). Las miniaturas se renderizan en el cliente la primera vez que se abre el menú.
  - Spawn (`{t:'spawn', id}`): el servidor lo coloca donde apunta el jugador (rayo, apoyado sobre la superficie o separado de la pared) y orientado según su mirada. Lo valida: está vivo, `SPAWN_COOLDOWN_MS`, `MAX_PROPS_PER_PLAYER` (cuerpos; un ragdoll cuesta 6) y `MAX_DYNAMIC_PROPS` por sala. `undo` (Z) borra el último spawn (el grupo entero) y `clear_props` todos los del jugador. Al salir del todo de la sala se borran sus objetos.
  - Rendimiento: los cuerpos se duermen (amortiguación angular suave para que lo redondo deje de rodar) y el snapshot solo envía los despiertos.
  - Bidones explosivos (`explosive`): reciben daño de disparos y explosiones; al llegar a 0 revientan 0,1 s después (reacciones en cadena) con `Combat.explodeAt`. Las bajas cuentan como `WEAPON_EXPLOSION`.
- **Vehículos (`vehicle` en el PropDef):** controlador de vehículo por rayos de Rapier, **solo en el servidor** (`Vehicles.ts`).
  - Con E (`Button.Use`, botones a 16 bits) se sube al vehículo libre más cercano. El conductor no usa su controlador: sus botones mueven el coche (W/S motor y freno/marcha atrás, A/D dirección, Espacio freno de mano y enderezar si vuelca) y su cápsula se coloca en el asiento.
  - El snapshot lleva `vehicle` por jugador. El cliente no predice al conductor: lo dibuja sentado en la pose interpolada del chasis, con la cámara orbitando. Las ruedas (`VehicleView`) se dibujan en el cliente con giro y dirección estimados.
  - Grupos de colisión (`types.ts`): jugadores y vehículos no chocan en Rapier (un coche se pararía en seco contra un cuerpo cinemático). El controlador del jugador sí trata el coche como sólido, y por encima de 6 m/s hay daño por atropello (`WEAPON_VEHICLE`).
- **Herramientas (fase 4, tool gun = arma 6):**
  - Cada herramienta es una entrada de `content/tools.ts` (nombre, ayuda, color, `params`) más un handler con el mismo id en `server/tools.ts` (`TOOL_HANDLERS`: `primary` = clic izq., `secondary` = clic der., `reload` = R). Añadir una herramienta = añadir esas dos entradas.
  - El cliente solo envía la herramienta elegida (`{t:'tool', id, color}`) y sus botones. El servidor hace el rayo con la mira del input, comprueba permisos (objetos propios y del mapa; el anfitrión, todos) y límites (`MAX_CONSTRAINTS_PER_PLAYER`, `MAX_THRUSTERS_PER_PLAYER`), y responde con `tool_msg` (aviso bajo la mira) y `tool_fx` (rayo para los demás).
  - Herramientas:
    - **Borrar:** el objeto, o todo lo unido a él.
    - **Mover:** sujetar sin girar ni caer (mismo "sujetar" que la pistola de gravedad, en `holdMode: 'move'`); rueda = distancia, R = girar 45º, clic derecho = congelar o descongelar (cuerpo `Fixed`; la pistola de gravedad no agarra lo congelado).
    - **Soldar:** junta fija en la pose relativa actual, a otro objeto o al suelo (`ground`).
    - **Cuerda:** junta de cuerda con la longitud entre los dos puntos + `slack`.
    - **Propulsor:** impulso en un punto cada tick hacia dentro de la cara; clic derecho lo enciende o apaga, R lo quita.
    - **Pintar:** tinte por instancia.
    - **Escalar:** recrea los colisionadores a la nueva escala, con masa × escala³; no vale para vehículos, ragdolls ni objetos con uniones.
  - Sincronización: `prop_update` (pintura, escala, congelado), `constraint_added/removed`, `thruster_added/removed/active`, y las listas completas en el `welcome`. Al borrar un objeto se quitan antes sus uniones y propulsores (`Constraints.onPropRemoved`).
  - Cliente: `ToolVisuals` dibuja las cuerdas (una `LineSegments`) y los propulsores (un `InstancedMesh` con llama). El material de los objetos usa el tinte como **pintura** (color de la pintura × luminosidad original), no como multiplicación.
- **Personalización (fase 5):**
  - `Appearance` (`content/cosmetics.ts`): colores de cuerpo, brazos, piernas, cabeza y detalle, más sombrero, gafas, mochila y patrón del torso. Los accesorios son piezas low-poly (`CosmeticPart`, color fijo o `'accent'`/`'body'`) con un punto de anclaje por hueco: parte superior de la cabeza, cara y espalda. Los patrones son funciones que dibujan en un canvas de 64 px que se aplica al torso. **Añadir un accesorio o un patrón = una entrada en `COSMETICS` o `PATTERNS`.**
  - El editor (`CharacterEditor`) se abre desde el menú principal y desde la pausa. Tiene vista previa 3D propia, que se libera al cerrar. Guarda en `localStorage` (`sandbox.look`); la primera vez se genera un aspecto aleatorio.
  - El aspecto viaja en `create_room`/`join_room` y, en partida, con `{t:'look'}` (máx. 2 por segundo). El servidor lo valida con `sanitizeLook` (compartida: colores enteros en rango y accesorios del registro), lo guarda en `PlayerInfo.look` y lo reparte con `player_look`. El color de hueco (`PlayerInfo.color`) se sigue usando para la interfaz: nombres en el chat, killfeed y marcador.
  - `PlayerModel` comparte geometrías, materiales por color y texturas de patrón entre todos los personajes (cachés de `Cosmetics.ts`). `setLook()` lo cambia en caliente.
- **Mapas (fase 6):**
  - `MapDef` (`content/maps.ts`) contiene: suelo cuadrado, colores del cielo y la niebla, puntos de aparición (≥ 6), objetos iniciales, agua opcional y `killY`.
  - La geometría es una lista de **piezas** (`MapPart`: caja, cilindro, cono o esfera, con color, `rot` en Euler 'YXZ' y `solid`).
    - Servidor: un colisionador fijo por pieza sólida, con su rotación.
    - Controlador del jugador: `staticShapes()` (cajas orientadas y esferas).
    - Cliente: todas las piezas fusionadas en **una sola malla** (un draw call).
  - Las funciones de ayuda (`ramp`, `block`, `building`, `tree`, `palm`, `rock`, `lamp`, `parkedCar`) construyen las piezas. **Añadir un mapa = una entrada en `defs`.**
  - Los 5 mapas son Flatgrass, Arena, Ciudad pequeña, Isla (mar alrededor: caer al agua mata, `killY = -1.5`) y Parkour (saltos, torre en espiral, tobogán y rampas para vehículos).
  - Las rampas usan `rot: [pendiente, orientación, 0]`. El controlador las sube andando si la pendiente es menor de ~49º (`WALKABLE_NORMAL_Y`).
- **Modos:**
  - `content/modes.ts` (datos) + `server/GameMode.ts` (reglas). Se eligen al crear la sala junto con el mapa (`create_room` con `map`, `mode` y `killLimit`; la última elección se recuerda en localStorage).
  - **Sandbox:** sin límite; se puede construir.
  - **Deathmatch:**
    - Se elige un límite de 10, 20 o 30 bajas. El menú de objetos queda bloqueado (`not_allowed`), la tool gun no se puede seleccionar (el servidor ignora ese cambio de arma) y se aparece en el punto más alejado de los demás.
    - Al llegar al límite llega `round_end` con el ganador y la clasificación, y se muestran los resultados durante `RESULTS_SECONDS` (`canDamage()` = false).
    - Después, `round_start`: marcadores a cero, todos reaparecen y los objetos del mapa se recrean.
  - El `welcome` incluye `mode` (con los resultados si la ronda ya terminó). El HUD muestra modo, mapa, límite y líder.
- **Armas (todo validado por el servidor):**
  - Cada arma es una entrada de `src/content/weapons.ts` con **uno** de `hitscan` (rayo: daño, perdigones, dispersión, alcance, impulso, multiplicador a la cabeza), `projectile` (cohete: velocidad, radio y daño de explosión, impulso, knockback, autodaño) o `gravity`. El modelo se describe con piezas (`box`/`cyl`); el índice en `WEAPONS` (ordenado por `slot`) es el que viaja en el input.
  - El cliente solo envía botones (`Fire`, `AltFire`), arma seleccionada y `viewTick` (el tick que estaba viendo). El servidor aplica `stepFire` (cadencia y cambio de arma, **contados en inputs**) y decide impactos, daño y empujes.
  - **Compensación de lag:** cada jugador guarda en el servidor un anillo de posiciones por tick (`HISTORY_LENGTH`). Un disparo hitscan comprueba las cápsulas de los demás en `viewTick` (máx. `MAX_LAG_COMPENSATION_MS` atrás). Los rayos contra el mundo usan Rapier excluyendo cuerpos cinemáticos (los jugadores).
  - La dispersión es pseudoaleatoria pero determinista por (jugador, seq): el cliente dibuja al instante las mismas trazadoras que calcula el servidor. Los efectos ajenos llegan como eventos (`shot`, `punt`, `projectile`, `explode`); el que dispara no recibe su propio `shot`.
  - Los cohetes los simula el servidor (barrido por tick). Los clientes los dibujan a partir del evento `projectile`: los propios en "tiempo actual" y los ajenos en tiempo interpolado.
  - Explosión: daño y knockback con caída lineal. El knockback suma velocidad al `MoveState` del jugador (los rocket jumps funcionan con la predicción, que se corrige con el snapshot). A los objetos se les da un impulso con un Δv máximo de 25 m/s.
  - Pistola de gravedad (estilo physgun de GMod), decidida por `gravityAction()` (compartida):
    - **Mantener clic izquierdo** agarra el objeto apuntado (hasta `grabRange`) a la distancia a la que está, y se arrastra por el aire con la mira. La **rueda** cambia esa distancia (`input.wheel`, campo `holdDistance` del snapshot).
    - **Al soltar** cae conservando su velocidad, así que girar y soltar sirve para lanzarlo. El **clic derecho** lanza con fuerza si sujetas algo, y si no, empuja objetos y jugadores.
    - En el servidor, el objeto se lleva hacia el punto apuntado fijando su velocidad (con `gravityScale 0`). El controlador del jugador lo ignora para no chocar con él.
    - El cliente lo dibuja en la posición predicha (distancia del servidor + clics de rueda aún no procesados) para que no se quede atrás al girar.
  - Vida y muerte: `damage` va solo al afectado y al atacante, y `kill` va a todos con el marcador actualizado (`PlayerInfo.kills/deaths`). Un muerto no se mueve; el servidor le confirma los inputs sin aplicarlos. Reaparece a los `RESPAWN_MS` en un punto aleatorio con `SPAWN_PROTECTION_MS` de invulnerabilidad. Caer del mapa cuenta como muerte (`WEAPON_FALL`).
- **Puntos de aparición** (`Room.randomSpawn(self)`): se descartan los tapados por objetos (prueba de la cápsula en el punto y ya apoyada) y los que tienen a otro jugador a menos de 2,5 m. Deathmatch: el más alejado de los demás. Sandbox: uno libre al azar. Se usa también al entrar (antes era un cursor secuencial).
- **Sujetar objetos:** un objeto solo lo puede sujetar un jugador (pistola de gravedad o Mover), y no se puede subir a un vehículo que otro está arrastrando.
- **Sonido (fase de pulido):**
  - Todo sintetizado con WebAudio, sin archivos. Cada sonido es una entrada de `content/sounds.ts`: capas de tono (oscilador) o ruido filtrado, con barrido de frecuencia y envolvente, más `bus` (`effects`/`ui`), `range`, `pitchJitter` y `minGapMs` (evita saturar con 6 jugadores disparando). **Añadir un sonido = una entrada.** Las armas eligen el suyo con `sound` en `WeaponDef`.
  - `audio/Sound.ts` (`sound.play(id, { pos, volume, pitch })`): con `pos`, atenuación por distancia, panorama estéreo según el yaw de la cámara y paso bajo si está lejos. Máximo 40 voces. Compresor en la salida. El `AudioContext` se crea con el primer gesto del usuario.
  - Los sonidos de mensajes (disparos ajenos, explosiones, daño, muertes, chat, entrar/salir, rondas, objetos) se lanzan en `Game.handleMessage`; los de estado (pasos, salto, aterrizaje, agarrar/soltar, subir/bajar del coche) en `Game.updateAudio` comparando con el frame anterior. Los disparos propios suenan en `WeaponController` (predicción). Los motores de vehículos son bucles continuos (`sound.engine` + `endFrame`) con el tono según la velocidad dibujada.
- **Ajustes y calidad (fase de pulido):**
  - `core/Settings.ts` guarda en localStorage (`sandbox.settings`) sensibilidad, invertir Y, FOV, tres volúmenes, calidad y mostrar estadísticas, saneados al cargar. Quien los usa se suscribe con `settings.onChange` (se llama al momento y en cada cambio). `Input` lee la sensibilidad en cada movimiento.
  - Niveles en `QUALITY` (alta/media/baja): pixelRatio, antialias, sombras y tamaño del shadow map, sombras de los objetos, densidad de partículas y montañas de fondo. `Game` los aplica en `perf.onApply` (cambiar sombras obliga a `material.needsUpdate`). El **antialias** solo se puede fijar al crear el renderer (se aplica al entrar en otra sala).
  - `Performance.ts`: en "auto" mide los fps en ventanas de 2 s mientras se juega (no en menús ni con la pestaña oculta, y tras 3 s de calentamiento). Baja un nivel tras dos ventanas < 45 fps; sube uno tras 40 s ≥ 57 fps (si la subida no aguanta 10 s, no vuelve a intentarlo en esa partida). El nivel automático se recuerda (`sandbox.autoQuality`).
  - Las estadísticas de render se resetean a mano por frame (`renderer.info.autoReset = false`): antes el contador de draw calls solo contaba la pasada del arma.
  - La predicción local solo mete en el mundo de colisión los objetos a menos de 14 m (`NEAR_PROPS_RADIUS`): se reconstruye por cada input pendiente al corregir.
- **Invitar:** `GET /api/info` devuelve las URLs de la LAN y la del túnel, **solo** a peticiones desde loopback sin cabeceras de proxy (`x-forwarded-for`, `cf-connecting-ip`), así los que entran por el túnel no ven la IP local. El menú lo muestra y "Copiar enlace" usa túnel > LAN cuando el anfitrión juega en `localhost` (antes copiaba un enlace de `localhost` inservible para los amigos).
- **Interpolación:** `SampleBuffer.sample()` devuelve el valor auxiliar (0 en objetos) o `null`: compararlo siempre con `null`, nunca con `!`.
- **Render:** el arma en 1ª persona va en una escena aparte que se dibuja tras `clearDepth()` (`renderer.autoClear = false`). Todas las partículas comparten un `InstancedMesh`. **No usar `flatShading` en superficies grandes** (suelo, bloques): calcula la normal con derivadas de pantalla y en algunas GPUs sale negra de cerca. Las cajas ya traen normales por cara.
- **Sesiones:**
  - El creador de la sala es el **anfitrión** (★). Si se va del todo, el anfitrión pasa al jugador conectado de id más bajo. Solo el anfitrión puede expulsar (desde el menú de pausa). Un expulsado queda vetado en esa sala por su `clientId` (localStorage).
  - Reconexión: el `welcome` trae un `token`. Si el socket se cierra sin `leave`, el servidor reserva el hueco `RECONNECT_GRACE_MS` (el jugador desaparece de los snapshots y su colisionador se desactiva). El cliente reintenta `rejoin` con backoff. La sesión se guarda en **sessionStorage** (por pestaña), así que también sobrevive a un F5.
  - El chat tiene límite de longitud y anti-spam en el servidor. El cliente lo pinta siempre con `textContent`, nunca como HTML.
- **Optimización desde el inicio:** un `InstancedMesh` por tipo de objeto, `MAX_DYNAMIC_PROPS` por sala, cuerpos que se duermen (`setCanSleep(true)`, `sleep()` al crearlos), un único shadow map que sigue al jugador, `pixelRatio ≤ 1.5` y un bucle fijo en el servidor con acumulador (los timers de Windows tienen poca resolución).
- El servidor nunca confía en el cliente: validar y sanear todos los mensajes (nombres, códigos, números finitos).

## Estado de las fases

Nota: la tabla numera los modos como fase 7 porque se adelantaron; lo que el usuario pidió como "Fase 7: menú, ajustes, sonidos, rendimiento…" es la fila 8.

Leyenda: **✅ Hecha** = implementada y verificada con pruebas automáticas (servidor real + clientes simulados) y en navegador (Chrome headless). **🟡 A medias** = falta parte de lo pedido. **⚪ Sin empezar**. "Sin validar" = el usuario aún no la ha probado ni confirmado.

| # | Fase | Estado | Cómo se verificó |
|---|---|---|---|
| 0 | Base: proyecto, CLAUDE.md, escena mínima (suelo, cielo, WASD + ratón, salto, caja empujable con física en el servidor), salas por código, otros jugadores, start.bat, README | ✅ Hecha | Clientes simulados (crear/unirse, movimiento, empuje); `start.bat` en este equipo |
| 1 | Controlador de cápsula compartido (aceleración, sprint, salto con coyote time y buffer, empujar objetos), cámara 1ª/3ª persona (V), chat (T), lista de jugadores (Tab), nombres, muñeco animado, interpolación adaptativa, reconexión, anfitrión y expulsión | ✅ Hecha | 17 pruebas del controlador; 24 de red (predicción exacta, chat, ping, expulsión, reconexión, caducidad del hueco) |
| 2 | Armas data-driven (pistola, escopeta, rifle, lanzacohetes, pistola de gravedad estilo physgun), vida, daño con disparos a la cabeza, muerte y reaparición, marcador, killfeed, efectos, empuje de objetos, compensación de lag, cambio de arma | ✅ Hecha | 31 pruebas de combate; navegador con un bot rival |
| 3 | Menú de spawn (Q): 8 categorías y 27 objetos generados por código (incluye bidón explosivo, 2 ragdolls, buggy y camioneta conducibles), límite por jugador, deshacer (Z), sleeping, miniaturas | ✅ Hecha | Pruebas de spawn, límites, ragdoll, deshacer, reposo, bidón y conducción; navegador (menú, crear, conducir) |
| 4 | Tool gun (arma 6) con 7 herramientas en un registro: borrar, mover/congelar, soldar, cuerda, propulsor, pintar, escalar; validadas por el servidor; pestaña Herramientas con paleta | ✅ Hecha | 21 pruebas de herramientas y permisos; navegador (panel, pintura, cuerda, propulsor) |
| 5 | Editor de personaje (menú propio, vista previa 3D): colores por parte, sombreros, gafas, mochilas y patrones en un registro; localStorage; sincronizado (también en partida) | ✅ Hecha | 8 pruebas de validación y reparto; navegador con dos jugadores |
| 6 | 5 mapas low-poly en un registro (Flatgrass, Arena, Ciudad pequeña, Isla, Parkour y rampas) con puntos de aparición; selector de mapa al crear la sala | ✅ Hecha · **sin validar** | Validación de los 40 puntos de aparición y las 18 rampas; cada mapa cargado en el servidor; capturas de los 5 |
| 7 | Modos Sandbox y Deathmatch (límite de bajas, resultados, rondas); adelantado junto con la fase 6 | ✅ Hecha · **sin validar** | Deathmatch completo con clientes simulados (10 bajas, resultados, ronda nueva); navegador con bot |
| 8 | Pulido (el usuario la llamó "fase 7"): menú principal con fondo low-poly, ajustes (sensibilidad, FOV, volúmenes, calidad), 31 sonidos sintetizados con WebAudio, calidad gráfica automática según fps, snapshot más compacto + compresión, `start.bat` revisado, `start-online.bat` con túnel integrado, revisión de sincronización con 4–6 jugadores | ✅ Hecha · **sin validar** | `npm test` (7 pruebas con 4–6 bots: entrada, aparición, ritmo del servidor, ancho de banda, reconexión, cambio de anfitrión, Deathmatch); navegador (menú, ajustes, pausa, audio activo, cambio de calidad, sin errores de consola); `start.bat` y `start-online.bat` arrancados en este equipo (sin cloudflared instalado) |

Petición pendiente de aclarar: "añade armas a cada una de las armas" (después de la fase 2). Se preguntó si significaba munición/recarga, variantes, mejores modelos o sonidos, y el usuario canceló la pregunta. No se ha hecho nada.

## Sin probar

- **Rendimiento real (objetivo: 60 fps en un portátil normal).** Solo se ha medido en Chrome headless con render por software, donde la calidad baja da 38 fps y la alta 16 (sirve para comparar niveles, no como cifra real). Hay que mirar los fps del HUD con una GPU real, sobre todo en la Ciudad y con muchos objetos, y comprobar que la calidad automática no oscila.
- **Partida en LAN entre dos equipos** y **online por Cloudflare Tunnel o ngrok.** Todo se probó en `localhost`. `start-online.bat` solo se ha probado sin `cloudflared` instalado (muestra las instrucciones y sigue en LAN): falta ver la URL real, que la compresión pase por el túnel y la latencia.
- **Cómo suenan los sonidos.** Se comprobó que el `AudioContext` arranca y que los sonidos se programan, pero nadie los ha escuchado con altavoces: puede hacer falta ajustar volúmenes relativos (sobre todo explosiones, pasos y el motor).
- **El panel de ajustes en pantallas pequeñas** (< 520 px de ancho).
- **Navegadores distintos de Chrome** (Firefox, Edge, Safari) y el pointer lock real: en las pruebas se simuló.
- **6 jugadores reales a la vez** (los bots de `npm test` no ejecutan el cliente: la carga de render y de predicción con 5 jugadores remotos y muchos objetos no está medida).
- **Recorrido completo del Parkour de principio a fin.** Solo se comprobaron tramos (rampas, aparición, tobogán) y la geometría de los saltos.
- **Varios jugadores conduciendo a la vez** y choques entre vehículos.
- **Reconexión por una caída de red real:** se probó cerrando sockets desde las pruebas.
- **`start.bat` en un equipo limpio** (sin `node_modules` ni Node en el PATH).

## Bugs conocidos

- **Si todos los puntos de aparición están tapados por objetos, se usa uno igualmente** (el que tenga a los jugadores más lejos) y se aparece dentro del objeto.
- **El sonido del motor y los pasos de los demás se estiman** a partir de lo que se mueve su modelo en pantalla: al teletransportarse o con tirones de red pueden sonar raros.
- **Ragdolls: la franja de los "ojos" se ve del color de la piel oscurecido** en vez de negra (efecto del shader de pintura, que trata el tinte como pintura).
- **Escalar un objeto apoyado lo hace "saltar":** los colisionadores crecen en su sitio y Rapier lo separa del suelo u otros objetos de golpe.
- **Las ruedas dibujadas de los vehículos estiman el giro y la dirección** a partir del movimiento del chasis: al chocar o volcar pueden girar raro.
- **El primer contacto al empujar una caja produce una corrección visible de 7–10 cm** (luego se suaviza a ~2 cm).
- **Con la pestaña oculta se congela la cadencia de disparo**, porque se cuenta en inputs y el cliente deja de enviarlos.

## Deuda técnica

- **Solo las pruebas de sincronización están en el repositorio** (`tests/sync.test.ts`, `npm test`). Las de las fases 1–6 (controlador, combate, herramientas, mapas…) se escribieron como scripts sueltos en una carpeta temporal y se perdieron; habría que rehacerlas en `tests/` con el mismo patrón (servidor real + bots). Las pruebas en navegador (puppeteer-core) siguen fuera del repo.
- **`Game.ts` ha crecido mucho** (red, combate, vehículos, herramientas, modos): se podría dividir en módulos.

## Revisión de sincronización con 4–6 jugadores (fase de pulido)

Hecha con `npm test` (bots reales a 60 Hz contra el servidor) y leyendo el código. Resultado:

- **Bien:** con 6 jugadores enviando inputs a la vez el servidor mantiene 60 ticks/s, no hay huecos de más de ~65 ms entre snapshots y la cola de inputs no crece. El 7º jugador se rechaza, también con un hueco reservado para reconexión. La reconexión con token recupera el id y los inputs nuevos se aceptan. Si el anfitrión se va, pasa al de id más bajo, sus objetos se borran y su id se reutiliza sin restos en los demás clientes.
- **Corregido:**
  - Ancho de banda: el peor caso (sala llena de objetos despiertos) pedía ~560 KB/s de subida al anfitrión, demasiado para un túnel; ahora ~250 KB/s reales (formato compacto + compresión). Y el servidor tardaba demasiado en dejar de encolar snapshots a un cliente lento.
  - Dos jugadores podían reaparecer en el mismo punto (Sandbox elegía al azar sin mirar) o dentro de un objeto construido.
  - La herramienta Mover podía agarrar un objeto que otro ya sujetaba (tirones y el objeto caía al soltarlo uno). Se podía subir a un vehículo que otro arrastraba.
  - Los cohetes en vuelo explotaban al empezar la ronda siguiente.
  - "Copiar enlace" desde `localhost` daba un enlace que no servía a los amigos.
- **Queda (ver "Bugs conocidos" y "Limitaciones"):** la cadencia de disparo con la pestaña oculta, la conducción sin predicción por túnel, y que los clientes no tienen física de los objetos (correcciones al empujar).

## Mejoras futuras

Ideas ordenadas por lo que más aportarían a "divertido con amigos" sin perder ligereza. Ninguna está empezada.

1. **Predicción de la conducción** (con el mismo controlador de vehículo en el cliente, o al menos extrapolar el chasis propio): conducir por túnel se nota lento.
2. **Interés por distancia en los snapshots:** enviar los objetos lejanos a menos frecuencia por jugador (snapshot por cliente). Recorta mucho el peor caso de ancho de banda.
3. **Guardar y cargar construcciones** (JSON de objetos, soldaduras y cuerdas) y compartirlas con un código.
4. **Más modos:** por equipos (TDM), carreras en el Parkour con tiempos, "el suelo es lava", escondite. La base (`GameMode`, `modes.ts`) ya lo permite.
5. **Cambiar de mapa o de modo sin crear otra sala** (votación o elección del anfitrión al terminar la ronda).
6. **Munición y recarga** como campos de `WeaponDef` (la pregunta "añade armas a cada una de las armas" quedó sin aclarar: podría ser esto).
7. **Teclas asignables a los propulsores** (como en GMod) y fuerza configurable; ruedas motorizadas para construir vehículos propios.
8. **Reasignar teclas** en los ajustes y soporte de mando.
9. **Recuperar las pruebas de las fases 1–6** en `tests/` y añadir una prueba en navegador al `npm test` (opcional, si hay Chrome).
10. **Compresión gzip de los estáticos** en `server/static.ts`: la primera carga por túnel bajaría de ~700 KB a ~190 KB.
11. **Sonidos con más variedad:** superficie de los pasos según el material, eco en la Ciudad, música de menú generada.
12. **Efectos con nivel de detalle:** no generar partículas lejanas o fuera de cámara; impostores para los árboles en calidad baja.
13. **Dividir `Game.ts`** (red, combate, vehículos, audio) en módulos más pequeños.
14. **Línea de visión en las explosiones** (no dañar a través de paredes) y límites de ángulo en los ragdolls cuando Rapier los ofrezca.
15. **Moderación básica:** contraseña opcional de sala y silenciar a un jugador en el chat.

## Limitaciones de diseño

- El controlador no tiene "autostep": los bordillos bajos (≤ 0,15 m) se suben andando, pero los bloques de 0,5 m o más requieren saltar. Las rampas se suben andando hasta ~49º.
- Al empujar objetos quedan correcciones pequeñas porque el cliente no simula la física de la caja; se suavizan visualmente.
- Las ráfagas de inputs se absorben con la cola del servidor; con mucha pérdida de paquetes el jugador puede notar pequeños tirones.
- Conducir no tiene predicción: el coche responde con la latencia de la red más el retardo de interpolación (bien en LAN; algo más lento por túnel). Subirse a la caja de una camioneta en marcha no te arrastra con ella.
- Las juntas de los ragdolls no tienen límites de ángulo (Rapier 0.21 no los ofrece en las esféricas): los muñecos son muy flexibles.
- El input "recuerda" las pulsaciones hasta el siguiente tick (`Input.latched`), así que un toque más corto que 16 ms no se pierde.
- El suelo de todos los mapas es plano (y = 0): el relieve se hace con piezas (terrazas, rampas). Un terreno con alturas necesitaría otra forma de colisión.
- En el controlador del jugador, cilindros y conos (barriles, conos, troncos) son cajas: al rodearlos se nota la esquina.
- Deathmatch es todos contra todos (sin equipos). Cambiar de mapa o de modo requiere crear otra sala.
- Las soldaduras y las cuerdas no se pueden deshacer con Z (Z deshace objetos); se quitan con el clic derecho de su herramienta o al borrar el objeto.
- Los propulsores solo se encienden apuntándoles con la herramienta (no hay teclas asignables como en GMod) y tienen una fuerza fija (1500 N).
- Sin munición ni recarga (se puede añadir como campos del `WeaponDef`). En Sandbox también hay daño (todos contra todos).
- Las explosiones no comprueban línea de visión (dañan a través de paredes finas).
- El veto por expulsión usa un id de localStorage: basta para evitar que alguien vuelva sin querer, no es seguridad real.
- Dos pestañas del mismo navegador comparten el personaje guardado (localStorage); la sesión de reconexión sí es por pestaña (sessionStorage).
- El bundle del cliente (~685 KB sin comprimir, 182 KB con gzip, casi todo Three.js) se puede dividir si hace falta. El servidor de estáticos no comprime: por túnel, la primera carga son ~700 KB.
- Las posiciones de los objetos viajan con 4 mm de precisión: al estar de pie sobre un objeto puede haber correcciones de ese orden (se suavizan). Más allá de ±256 m del centro se recortan.
- La calidad automática solo sube si los fps llegan a 57: en pantallas de 48–50 Hz nunca subirá de nivel (sí baja si caen de 45).
