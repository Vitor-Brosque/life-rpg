@echo off
rem Abre o LIFE RPG neste computador: reconstroi o app, sobe o servidor e abre o navegador.
title LIFE RPG
cd /d "%~dp0"
call npm run local -- --open
echo.
echo O servidor parou. Pressione uma tecla para fechar.
pause >nul
