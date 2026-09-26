@echo off
setlocal
cd /d "%~dp0.."
echo === Installation AI Browser Agent ===
where py >nul 2>nul
if errorlevel 1 goto python_missing
py -3 -c "import sys; assert sys.version_info >= (3,12)" >nul 2>nul
if errorlevel 1 goto python_missing
if not exist ".venv\Scripts\python.exe" py -3 -m venv .venv
if errorlevel 1 goto failed
".venv\Scripts\python.exe" -m pip install --upgrade pip
if errorlevel 1 goto failed
".venv\Scripts\python.exe" -m pip install -e .
if errorlevel 1 goto failed
".venv\Scripts\python.exe" -m playwright install chromium
if errorlevel 1 goto failed
if not exist data\uploads mkdir data\uploads
if not exist data\logs mkdir data\logs
where ollama >nul 2>nul
if errorlevel 1 (
  echo Installez Ollama depuis https://ollama.com/download/windows puis relancez lancer.bat.
) else (
  echo Pour telecharger le modele : ollama pull qwen3:14b
)
echo Installation terminee. Lancez launcher\lancer.bat.
pause
exit /b 0
:python_missing
echo Installez Python 3.12 ou plus recent avec le lanceur py depuis https://www.python.org/downloads/windows/
pause
exit /b 1
:failed
echo Echec de l'installation. Consultez les erreurs ci-dessus.
pause
exit /b 1
