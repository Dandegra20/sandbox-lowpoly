# Sandbox Low-Poly

Sandbox multijugador ligero estilo Garry's Mod en 3D low-poly. Todo se genera por código: sin modelos ni texturas externas.

- **Cliente:** Three.js + Vite + TypeScript
- **Servidor:** Node.js + TypeScript + `ws`, autoritativo, con física Rapier
- Hasta 6 jugadores por sala; cada sala se identifica con un código de 4 caracteres.

> Estado actual: **fase de pulido** (menú principal, ajustes, sonido sintetizado, calidad gráfica automática y arranque online en un clic). Consulta la hoja de ruta por fases en [CLAUDE.md](CLAUDE.md).

## Requisitos

- [Node.js](https://nodejs.org) 20 o superior (se recomienda la LTS). **Solo lo necesita el anfitrión** (el PC donde se abre `start.bat`).
- Un navegador moderno (Chrome, Edge, Firefox).

### ¿Qué es Node.js y para qué sirve?

**Node.js** es un programa gratuito que permite ejecutar código JavaScript en el ordenador, fuera del navegador. Normalmente JavaScript solo funciona dentro de páginas web; con Node.js se pueden hacer programas que corren en tu PC, como servidores.

El juego lo usa para tres cosas:

1. **Hacer funcionar el servidor.** Al abrir `start.bat`, Node.js arranca el servidor del juego en tu PC, que:
   - entrega la página del juego al navegador de cada jugador,
   - gestiona las salas y conecta a todos los jugadores,
   - calcula la física (cajas, coches, explosiones) y decide los disparos, el daño, etc.
2. **Instalar lo que el juego necesita.** Trae `npm`, que descarga las librerías del proyecto (Three.js para los gráficos, Rapier para la física…). Es lo que hace `start.bat` la primera vez (hace falta internet).
3. **Compilar el juego.** Convierte el código del proyecto (TypeScript) en archivos que entiende el navegador.

Tus amigos **no** necesitan instalar nada: entran con el navegador usando la dirección que les pases.

**Cómo instalarlo:** entra en https://nodejs.org, descarga la versión **LTS** (la recomendada) e instálala con las opciones por defecto. Después reinicia el PC (o cierra la sesión de Windows) para que `start.bat` lo encuentre.

## Jugar en local (forma rápida)

Haz doble clic en **`start.bat`**. El script:

1. Comprueba que tienes Node.js 20 o superior (si no, te dice dónde descargarlo).
2. Instala las dependencias la primera vez, o si han cambiado (`npm install`).
3. Compila el juego (`npm run build`, unos segundos).
4. Arranca el servidor en el puerto 3000 y abre el navegador cuando ya está listo.

La consola, y también el menú del juego si lo abres en el mismo PC, muestran la dirección para compartir en tu red local, por ejemplo:

```
Local: http://localhost:3000
LAN:   http://192.168.1.42:3000   <- comparte esta con tus amigos
```

Si haces doble clic otra vez con el juego ya abierto, avisa de que el puerto está ocupado y abre el navegador en la partida que ya está en marcha.

Para jugar **por internet**, usa **`start-online.bat`** (ver más abajo).

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Modo desarrollo: servidor de juego (puerto 3000, se reinicia al cambiar código) + cliente Vite con recarga en caliente. **Abre http://localhost:5173** |
| `npm run build` | Comprueba tipos, compila el cliente en `dist/client` y empaqueta el servidor en `dist/server` |
| `npm start` | Ejecuta el servidor compilado: sirve el juego y el WebSocket en **http://localhost:3000** |
| `npm run typecheck` | Solo comprueba tipos |
| `npm test` | Pruebas de sincronización con 4–6 jugadores simulados contra el servidor real (sin navegador) |

## Cómo se juega

0. (Opcional) Pulsa **Personalizar personaje** para elegir colores, sombrero, gafas, mochila y patrón. Se guarda en tu navegador, y también puedes cambiarlo en partida desde la pausa (Esc).
1. Escribe tu nombre, elige **mapa** (Flatgrass, Arena, Ciudad pequeña, Isla o Parkour y rampas) y **modo**, y pulsa **Crear sala**:
   - **Sandbox:** libre; construye y crea objetos.
   - **Deathmatch:** todos contra todos hasta 10, 20 o 30 bajas, con pantalla de resultados y nueva ronda a los 10 segundos. No hay menú de objetos ni tool gun. Arriba a la izquierda aparece el código (por ejemplo `K7QF`).
2. Tus amigos escriben ese código y pulsan **Unirse**, o abren el enlace del botón **Copiar enlace** (`...?sala=K7QF`).
3. Haz clic en la ventana del juego para capturar el ratón.

| Tecla | Acción |
|---|---|
| **WASD** / flechas | Moverse |
| **Ratón** | Mirar |
| **Shift** | Esprintar (hacia delante) |
| **Espacio** | Saltar |
| **V** | Cambiar entre cámara en 1ª y 3ª persona |
| **T** o **Enter** | Abrir el chat (Enter envía, Esc cancela) |
| **Clic izquierdo** | Disparar. Con la pistola de gravedad: **mantener** para agarrar un objeto y arrastrarlo por el aire |
| **Clic derecho** | Pistola de gravedad: empujar lo que tengas delante, o lanzar con fuerza lo que sujetas |
| **1–5** o **rueda** | Cambiar de arma (con la pistola de gravedad sujetando algo, la rueda lo acerca o lo aleja) |
| **Q** | Menú de objetos y herramientas: clic para crear donde apuntas (Mayús+clic: varios sin cerrar) |
| **6** | Tool gun (la herramienta se elige en la pestaña *Herramientas* del menú Q) |
| **R** | Acción extra de la herramienta (p. ej. girar con Mover, quitar propulsores) |
| **Z** | Deshacer el último objeto que creaste |
| **E** | Subir a un vehículo cercano o bajar de él |
| **Tab** (mantener) | Marcador: bajas, muertes y ping |
| **Esc** | Pausa: soltar el ratón, ver jugadores, salir de la sala |

- Camina contra las cajas o la pelota para empujarlas. Hay una zona de escalones y un muro para practicar saltos.
- **Objetos (Q):** 27 objetos en 8 categorías: cajas, barriles (¡el rojo explota si le disparas!), ruedas, muebles, pelotas, señales, muñecos articulados y dos vehículos. Cada jugador puede tener hasta 40 piezas a la vez.
- **Herramientas (tecla 6, se eligen en Q → Herramientas):** Borrar, Mover (arrastrar sin que gire y congelar en el aire), Soldar, Cuerda, Propulsor, Pintar (con paleta de colores) y Escalar. El panel de abajo a la derecha muestra los controles de la herramienta elegida. Puedes modificar tus objetos y los del mapa (el anfitrión, todos).
- **Vehículos:** acércate y pulsa **E**. W/S acelera y frena (o va marcha atrás), A/D gira y Espacio es el freno de mano; si vuelcas, pulsa Espacio parado para enderezarlo. Cuidado con atropellar a tus amigos.
- **Armas:** 1 Pistola · 2 Escopeta · 3 Rifle (automático) · 4 Lanzacohetes · 5 Pistola de gravedad. Los disparos a la cabeza hacen más daño, los disparos y explosiones empujan los objetos, y con el lanzacohetes puedes hacer *rocket jumps*. Al morir reapareces a los 3 segundos.
- El creador de la sala es el **anfitrión** (★). Desde el menú de pausa (Esc) puede **expulsar** a otros jugadores.
- Si se corta la conexión (o recargas la página), el juego **reconecta solo** y recuperas tu sitio durante 30 segundos.

## Ajustes

Botón **⚙ Ajustes** en el menú principal o en la pausa (Esc). Se guardan en el navegador y se aplican al momento:

- **Controles:** sensibilidad del ratón, campo de visión e invertir el eje vertical.
- **Sonido:** volumen general, de efectos (disparos, explosiones, pasos, motores…) y de la interfaz (avisos, chat, impactos). Todos los sonidos se generan en el momento con WebAudio; no hay archivos de audio.
- **Gráficos:** calidad **Automática** (por defecto), Alta, Media o Baja. En automática el juego mide los fps: si bajan de 45 durante unos segundos, baja la calidad (avisa bajo la mira) y, si van sobrados mucho rato, prueba a subirla. Recuerda el nivel que funcionó en tu equipo.

| Calidad | Qué cambia |
|---|---|
| Alta | Sombras de todo (mapa de sombras de 2048), resolución hasta 1,5× en pantallas de alta densidad, todas las partículas |
| Media | Solo el mapa y los personajes dan sombra (1024), resolución normal, 70 % de partículas |
| Baja | Sin sombras ni montañas de fondo, 75 % de resolución, 40 % de partículas y sin antialiasing (este último, al entrar en otra sala) |

Si un equipo va lento, activa **Mostrar fps** en los ajustes: la línea de arriba a la izquierda indica los fps, el ping, el tráfico de red y la calidad que se está usando.

## Jugar en LAN

1. Arranca el juego en un PC (`start.bat` o `npm start`).
2. Los demás abren en su navegador la dirección **LAN** que muestra la consola (`http://192.168.x.x:3000`).
3. Si no pueden conectarse, lo más probable es que el **firewall de Windows** esté bloqueando Node:
   - La primera vez, Windows pide permiso: permite el acceso en **redes privadas**.
   - Si se te pasó ese aviso, ejecuta esto en PowerShell **como administrador**:
     ```powershell
     New-NetFirewallRule -DisplayName "Sandbox Low-Poly" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Private
     ```
   - Comprueba que tu red está configurada como "Privada" en la configuración de Windows.

> En modo desarrollo (`npm run dev`), la dirección LAN usa el puerto **5173** en lugar del 3000.

## Jugar online (por internet) con un túnel

No hace falta abrir puertos en el router. Un túnel te da una URL pública HTTPS que redirige a tu `localhost:3000`. El juego detecta HTTPS y usa `wss://` para el WebSocket.

### Opción A (recomendada): Cloudflare Tunnel con `start-online.bat`

Gratis y sin cuenta.

1. Instala `cloudflared` **una sola vez** (en PowerShell):
   ```powershell
   winget install --id Cloudflare.cloudflared
   ```
   Cierra y vuelve a abrir la ventana después de instalarlo, para que Windows lo encuentre.
2. Haz doble clic en **`start-online.bat`**. Arranca el juego y el túnel a la vez. Cuando el túnel está listo, la consola muestra un recuadro con la dirección, por ejemplo `https://palabras-al-azar.trycloudflare.com`. **El menú del juego también la muestra** ("Por internet: …") y el botón **Copiar enlace** de la partida copia ya esa dirección con el código de sala.
3. Pásales esa dirección a tus amigos. Cambia cada vez que arrancas.

Si `cloudflared` no está instalado, `start-online.bat` lo avisa y el juego sigue funcionando en LAN.

Si prefieres hacerlo a mano: arranca el juego con `start.bat` y, en otra terminal, `cloudflared tunnel --url http://localhost:3000`.

### Opción B: ngrok

1. Crea una cuenta gratuita en https://ngrok.com e instálalo: `winget install ngrok.ngrok`.
2. Configura tu token (solo una vez): `ngrok config add-authtoken <TU_TOKEN>`.
3. Arranca el juego con `start.bat` y, en otra terminal:
   ```powershell
   ngrok http 3000
   ```
4. Comparte la URL `https://....ngrok-free.app`. En el plan gratuito, la primera visita muestra una página de aviso de ngrok: pulsa "Visit Site". (Con ngrok, el menú no muestra la URL: cópiala de la ventana de ngrok.)

### Consejos para jugar online

- **Quien hace de anfitrión necesita buena subida.** El servidor envía el estado del mundo a cada jugador: con 6 jugadores son unos 40–60 KB/s de subida en total en una partida normal y, en el peor caso (la sala llena de objetos saltando por los aires), unos 250 KB/s en total con la compresión. Que haga de anfitrión el PC con mejor conexión, mejor por cable.
- Los túneles añaden latencia (el tráfico pasa por sus servidores): 50–150 ms es normal. El movimiento propio no se nota porque se predice; conducir y los objetos sí van un poco por detrás.
- Mantén el túnel abierto solo mientras jugáis: cualquiera con la URL puede entrar (aunque también necesita el código de sala).

### Si algo falla

| Problema | Solución |
|---|---|
| "No se encuentra Node.js" | Instala la versión LTS de https://nodejs.org y reinicia la sesión de Windows |
| "El puerto 3000 ya está en uso" | El juego ya está abierto en otra ventana: ciérrala o usa esa. Para otro puerto: `set PORT=3001` y luego `npm start` |
| Los amigos de la LAN no conectan | Firewall de Windows: ver "Jugar en LAN" |
| `start-online.bat` no encuentra cloudflared recién instalado | Cierra todas las consolas y vuelve a abrirlo (o reinicia la sesión) |
| La URL del túnel da error 502/1033 los primeros segundos | Espera 10–20 s: el túnel tarda en propagarse |
| Va a tirones en un portátil | Ajustes → Calidad: Baja, y mira los fps en la esquina superior izquierda |

## Estructura del proyecto

```
src/
  shared/    Tipos, constantes y protocolo de red (cliente + servidor)
  server/    Servidor Node: HTTP, WebSocket, salas y física Rapier
  client/    core · net · world · entities · weapons · tools · ui
  content/   Registros de datos: objetos, mapas, armas, herramientas, aspecto, modos y sonidos
tests/       Pruebas de sincronización (npm test)
```

Para añadir contenido nuevo (un objeto, un mapa...), añade una entrada a su registro en `src/content/`. Consulta [CLAUDE.md](CLAUDE.md).
