"""Standard-library setup helpers, usable before any dependency is installed."""

import json
import os
import socket
import subprocess
import sys
import tomllib
from contextlib import contextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def project_metadata(root=ROOT):
    with (root / "pyproject.toml").open("rb") as file:
        return tomllib.load(file)["project"]


def backend_running(port=8765):
    with socket.socket() as sock:
        sock.settimeout(1)
        return sock.connect_ex(("127.0.0.1", port)) == 0


@contextmanager
def installation_lock(root=ROOT):
    """OS lock, released on exit/crash; no stale PID files and no forced process termination."""
    directory = root / "data"
    directory.mkdir(parents=True, exist_ok=True)
    file = (directory / "install.lock").open("a+b")
    try:
        file.seek(0, 2)
        if file.tell() == 0:
            file.write(b"0")
            file.flush()
        file.seek(0)
        try:
            if sys.platform == "win32":
                import msvcrt

                msvcrt.locking(file.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            raise RuntimeError(
                "Une installation est deja en cours dans ce dossier. Attendez sa fin."
            ) from exc
        yield
    finally:
        file.close()  # Closing the handle releases either Windows or POSIX lock.


def environment_processes(root=ROOT):
    """List visible processes using THIS venv only. Never kill processes, log command lines or secrets."""
    if sys.platform != "win32":
        return []
    env = {
        **os.environ,
        "AIBA_INSTALL_ENV": str((root / ".venv").resolve()) + "\\",
        "AIBA_INSTALL_PID": str(os.getpid()),
    }
    script = r"""
$ErrorActionPreference = 'Stop'
$prefix = $env:AIBA_INSTALL_ENV
$items = @(Get-CimInstance Win32_Process | Where-Object {
    $_.ProcessId -ne [int]$env:AIBA_INSTALL_PID -and $_.ProcessId -ne $PID -and (
        ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) -or
        ($_.CommandLine -and $_.CommandLine.IndexOf($prefix, [StringComparison]::OrdinalIgnoreCase) -ge 0)
    )
} | Select-Object ProcessId, Name)
ConvertTo-Json -InputObject $items -Compress
"""
    try:
        result = subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
            env=env,
            capture_output=True,
            text=True,
            timeout=20,
            check=True,
        )
        return json.loads(result.stdout.strip() or "[]")
    except (OSError, subprocess.SubprocessError, ValueError):
        print(
            "Avertissement : detection des processus indisponible. Fermez vous-meme les consoles de cet agent."
        )
        return []


def check_quiet(root=ROOT):
    if backend_running():
        raise RuntimeError(
            "Le port 8765 est encore utilise. Fermez la console du backend avec Ctrl+C, "
            "puis relancez installer.bat. Fermer seulement l’onglet du navigateur ne suffit pas."
        )
    processes = environment_processes(root)
    if processes:
        details = ", ".join(f"{p.get('Name', 'processus')} (PID {p['ProcessId']})" for p in processes)
        raise RuntimeError(
            "Des processus utilisent encore le .venv de ce dossier : " + details + ". "
            "Fermez leurs consoles ou identifiez ces PID dans le Gestionnaire des taches. "
            "Aucun processus ne sera termine automatiquement."
        )
