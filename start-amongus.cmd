@echo off
cd /d "%~dp0"
set "PATH=%CD%\..\.codex-tools\node-v22.22.2-win-x64;%PATH%"
npm.cmd run start
