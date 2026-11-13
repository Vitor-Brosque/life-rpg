@echo off
rem Abre o LIFE RPG neste computador: reconstroi o app, sobe o servidor e abre o navegador.
title LIFE RPG
cd /d "%~dp0"
rem Instala dependencias novas (rapido quando nada mudou) antes de reconstruir.
call npm install --no-audit --no-fund --loglevel=error
call npm run local -- --open
echo.
echo O servidor parou. Pressione uma tecla para fechar.
pause >nul
