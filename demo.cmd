@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title SIMCOVA — Mode Démo
cd /d "%~dp0"

echo ============================================================
echo   SIMCOVA Marketplace — Lancement de la démonstration
echo ============================================================
echo.

set "NODE_BIN="

rem --- 1) Node système >= 22 ?
for /f "tokens=*" %%v in ('node --version 2^>nul') do set NODE_VER=%%v
if defined NODE_VER (
    set NODE_MAJOR=!NODE_VER:~1,2!
    if !NODE_MAJOR! GEQ 22 set "NODE_BIN=node"
)

rem --- 2) Node 22 embarqué dans le projet (tools\node22)
if not defined NODE_BIN if exist "%~dp0tools\node22\node.exe" set "NODE_BIN=%~dp0tools\node22\node.exe"

rem --- 3) Node 22 portable du TEMP
if not defined NODE_BIN if exist "%TEMP%\node-v22.23.5-win-x64\node.exe" set "NODE_BIN=%TEMP%\node-v22.23.5-win-x64\node.exe"

if not defined NODE_BIN (
    echo [ERREUR] Node.js ^>= 22.5 requis ^(module node:sqlite^) et introuvable.
    echo Installez-le puis relancez :   nvm install 22   puis   nvm use 22
    echo https://nodejs.org
    pause
    exit /b 1
)

rem --- Dépendances (première fois seulement)
if not exist node_modules\nodemailer (
    echo Installation des dependances ^(premiere fois^)...
    call npm install --no-audit --no-fund
)

rem --- Base de démo propre à chaque présentation
if exist data\simcova-demo.db del /q data\simcova-demo.db
if exist data\simcova-demo.db-wal del /q data\simcova-demo.db-wal
if exist data\simcova-demo.db-shm del /q data\simcova-demo.db-shm

echo.
echo Node utilise : %NODE_BIN%
echo.
echo Comptes de demonstration :
echo   Admin    : admin@simcova.africa   /  AdminDemo2026!
echo   Vendeur  : vendeur@simcova.africa /  VendeurDemo2026!
echo   Acheteur : aucun compte requis
echo.
echo La plateforme demarre sur http://localhost:3000
echo ^(Ctrl+C pour arreter^)
echo.
"%NODE_BIN%" node_modules\tsx\dist\cli.mjs server.ts
pause
