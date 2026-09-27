import socket
import subprocess
from unittest.mock import patch

import pytest

from launcher.install import install
from launcher.install_support import backend_running, check_quiet, installation_lock


def project(tmp_path):
    (tmp_path / "pyproject.toml").write_text("""[project]
name = "ai-browser-agent"
version = "1.3.1"
dependencies = ["fastapi>=0.115,<1", "playwright>=1.51,<2"]
""")
    python = tmp_path / ".venv" / "Scripts" / "python.exe"
    python.parent.mkdir(parents=True)
    python.touch()
    return tmp_path


def test_source_install_does_not_uninstall_locked_app_metadata(tmp_path, capsys):
    root = project(tmp_path)
    old = root / ".venv" / "Lib" / "site-packages" / "ai_browser_agent-1.1.0.dist-info" / "INSTALLER"
    old.parent.mkdir(parents=True)
    old.write_text("pip")
    with patch("launcher.install.check_quiet"), patch("launcher.install.run_command") as run:
        install(root)
    commands = [call.args[0] for call in run.call_args_list]
    assert any(cmd[1:4] == ["-m", "pip", "install"] for cmd in commands)
    assert not any("-e" in cmd or "uninstall" in cmd for cmd in commands)
    assert not any(
        "ai-browser-agent" in item or "ai_browser_agent" in item for cmd in commands for item in cmd
    )
    assert old.read_text() == "pip"
    assert "Version source : 1.3.1" in capsys.readouterr().out


def test_running_backend_prevents_dependency_changes(tmp_path):
    with patch("launcher.install_support.backend_running", return_value=True):
        with pytest.raises(RuntimeError, match="Ctrl\\+C"):
            check_quiet(tmp_path)


def test_only_reported_environment_processes_block(tmp_path):
    with (
        patch("launcher.install_support.backend_running", return_value=False),
        patch(
            "launcher.install_support.environment_processes",
            return_value=[{"ProcessId": 123, "Name": "python.exe"}],
        ),
    ):
        with pytest.raises(RuntimeError, match="PID 123"):
            check_quiet(tmp_path)


def test_busy_install_lock_is_released_on_exit(tmp_path):
    with installation_lock(tmp_path):
        with pytest.raises(RuntimeError, match="installation"):
            with installation_lock(tmp_path):
                pass
    with installation_lock(tmp_path):
        pass  # The lock file may remain; it is not treated as a stale active lock.


def test_pip_failure_stops_before_chromium_and_preserves_data(tmp_path):
    root = project(tmp_path)
    (root / "data").mkdir()
    (root / "data" / "keep.txt").write_text("history")
    calls = []

    def run(command, cwd):
        calls.append(command)
        if "pip" in command:
            raise subprocess.CalledProcessError(1, command)

    with patch("launcher.install.check_quiet"), patch("launcher.install.run_command", side_effect=run):
        with pytest.raises(subprocess.CalledProcessError):
            install(root)
    assert not any("playwright" in cmd for cmd in calls)
    assert (root / "data" / "keep.txt").read_text() == "history"
    with installation_lock(root):
        pass


def test_backend_probe_uses_real_listening_socket():
    with socket.socket() as server:
        server.bind(("127.0.0.1", 0))
        server.listen()
        assert backend_running(server.getsockname()[1])
