@echo off
setlocal
cd /d "%~dp0.."
echo === Installation AI Browser Agent ===
where py >nul 2>nul
if errorlevel 1 goto python_missing
py -3 -c "import sys; assert sys.version_info >= (3,12)" >nul 2>nul
if errorlevel 1 goto python_missing
py -3 launcher\install.py
if errorlevel 1 goto failed
where ollama >nul 2>nul
if errorlevel 1 (
  echo Installez Ollama depuis https://ollama.com/download/windows puis relancez lancer.bat.
) else (
  echo Pour telecharger le modele : ollama pull qwen3:14b
)
pause
exit /b 0
:python_missing
echo Installez Python 3.12 ou plus recent avec le lanceur py depuis https://www.python.org/downloads/windows/
pause
exit /b 1
:failed
echo Echec de l'installation. Consultez le diagnostic ci-dessus.
echo Ne relancez pas une ancienne copie du dossier AI_BROWSER_AGENT.
pause
exit /b 1
