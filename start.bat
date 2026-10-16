@echo off
setlocal
title Sandbox Low-Poly
cd /d "%~dp0"

rem Uso: start.bat          -> juego en local y LAN
rem      start.bat online   -> ademas abre un tunel de Cloudflare para jugar por internet
rem                            (es lo que hace start-online.bat)

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] No se encuentra Node.js. Instala la version LTS desde https://nodejs.org
  echo         y vuelve a abrir este archivo. Si acabas de instalarlo, reinicia el PC o la sesion.
  goto :fail
)

rem Hace falta Node 20 o superior.
for /f %%v in ('node -p "process.versions.node.split('.')[0]"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 20 (
  echo [ERROR] Tienes Node %NODE_MAJOR% y el juego necesita Node 20 o superior.
  echo         Instala la version LTS desde https://nodejs.org
  goto :fail
)

rem Dependencias: la primera vez, o si package-lock.json es mas nuevo que la ultima instalacion.
if not exist "node_modules\.package-lock.json" goto :install
node -e "const f=require('fs');process.exit(f.statSync('package-lock.json').mtimeMs>f.statSync('node_modules/.package-lock.json').mtimeMs?1:0)"
if errorlevel 1 goto :install
goto :build

:install
echo Instalando dependencias (solo la primera vez, puede tardar un minuto)...
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo [ERROR] Fallo la instalacion. Comprueba tu conexion a internet y vuelve a intentarlo.
  goto :fail
)

:build
echo Compilando el juego...
call npm run build
if errorlevel 1 (
  echo [ERROR] No se pudo compilar. Revisa los mensajes de arriba.
  goto :fail
)

set ARGS=--open
if /i "%~1"=="online" set ARGS=--open --tunnel

echo.
echo El navegador se abrira solo. Cierra esta ventana o pulsa Ctrl+C para detener el servidor.
node dist\server\index.js %ARGS%
if errorlevel 1 goto :fail
goto :eof

:fail
echo.
pause
exit /b 1
