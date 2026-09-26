@echo off
setlocal
cd /d "%~dp0.."
if not exist ".venv\Scripts\python.exe" (
  echo Executez d'abord launcher\installer.bat.
  pause
  exit /b 1
)
".venv\Scripts\python.exe" -c "import sys; assert sys.version_info >= (3,12)"
if errorlevel 1 goto failed
where ollama >nul 2>nul
if errorlevel 1 (
  echo Ollama absent. Installez https://ollama.com/download/windows
  pause
  exit /b 1
)
".venv\Scripts\python.exe" launcher\preflight.py
if errorlevel 1 goto failed
".venv\Scripts\python.exe" launcher\open_ui.py
".venv\Scripts\python.exe" -m interface.desktop_interface
if errorlevel 1 goto failed
exit /b 0
:failed
echo Le lancement a echoue. Consultez le message ci-dessus.
pause
exit /b 1
