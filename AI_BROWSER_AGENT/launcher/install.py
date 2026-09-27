"""Source-mode Windows installer: never uninstall/reinstall the application's own dist-info.

The launch command runs modules from the source directory. Only external dependencies
need installation; an editable self-install was unnecessary and caused WinError 32.
"""

import subprocess
import sys
from pathlib import Path

# Also supports import by the test suite without changing production package layout.
try:
    from .install_support import ROOT, check_quiet, installation_lock, project_metadata
except ImportError:
    from install_support import ROOT, check_quiet, installation_lock, project_metadata


def run_command(command, root):
    subprocess.run(command, cwd=root, check=True)


def install(root=ROOT):
    root = Path(root).resolve()
    metadata = project_metadata(root)
    print(f"Dossier source : {root}", flush=True)
    print(f"Version source : {metadata['version']}", flush=True)
    print(
        "Le ZIP extrait est la source installee ; ce script ne telecharge pas de nouvelle version du projet.",
        flush=True,
    )
    with installation_lock(root):
        check_quiet(root)
        python = root / ".venv" / "Scripts" / "python.exe"
        if not python.exists():
            run_command([sys.executable, "-m", "venv", str(root / ".venv")], root)
        run_command(
            [
                str(python),
                "-c",
                'import sys; assert sys.version_info >= (3,12), "Python 3.12+ requis dans .venv"',
            ],
            root,
        )
        # Do NOT use `pip install -e .`: the launcher imports the source tree directly.
        # Existing ai_browser_agent-*.dist-info from old versions is harmless and left untouched.
        run_command([str(python), "-m", "pip", "install", *metadata["dependencies"]], root)
        run_command([str(python), "-m", "playwright", "install", "chromium"], root)
        for directory in ("uploads", "logs"):
            (root / "data" / directory).mkdir(parents=True, exist_ok=True)
    print(f"Installation terminee — source {metadata['version']}. Lancez launcher\\lancer.bat.", flush=True)


def main():
    if sys.version_info < (3, 12):
        print("Installez Python 3.12 ou plus recent avec le lanceur Windows py.")
        return 1
    try:
        install()
    except (RuntimeError, OSError, subprocess.SubprocessError) as exc:
        print(f"Installation interrompue : {exc}", flush=True)
        print(
            "Si WinError 32 persiste : fermez les processus de cet agent, ou redemarrez Windows. "
            "Ne desactivez pas votre antivirus. Aucun dossier data ou .venv n’a ete supprime.",
            flush=True,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
