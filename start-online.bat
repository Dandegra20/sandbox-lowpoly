@echo off
rem Arranca el juego y abre un tunel de Cloudflare para jugar por internet.
rem Necesita cloudflared:  winget install --id Cloudflare.cloudflared
call "%~dp0start.bat" online
