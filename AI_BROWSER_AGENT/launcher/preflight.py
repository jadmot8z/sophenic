"""Windows startup: verify local backend, Ollama service and mandatory model."""

import json
import os
import socket
import subprocess
import time
from urllib.request import ProxyHandler, build_opener

opener = build_opener(ProxyHandler({}))
url = os.environ.get("AIBA_OLLAMA_URL", "http://127.0.0.1:11434")


def tags():
    with opener.open(url + "/api/tags", timeout=3) as response:
        return json.load(response)


def main():
    with socket.socket() as sock:
        try:
            sock.bind(("127.0.0.1", 8765))
        except OSError:
            raise SystemExit("Port 8765 deja utilise : fermez l'autre instance.")
    try:
        models = tags()
    except Exception:
        print("Demarrage du service Ollama...")
        subprocess.Popen(
            ["ollama", "serve"],
            creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        for _ in range(30):
            time.sleep(1)
            try:
                models = tags()
                break
            except Exception:
                continue
        else:
            raise SystemExit("Ollama ne repond pas. Verifiez le service et le port 11434.")
    if "qwen3:14b" not in [m["name"] for m in models.get("models", [])]:
        print("Modele obligatoire absent. Le telechargement represente plusieurs Go.")
        if input("Telecharger qwen3:14b maintenant ? [o/N] ").lower() != "o":
            raise SystemExit("Installation annulee. Commande : ollama pull qwen3:14b")
        subprocess.run(["ollama", "pull", "qwen3:14b"], check=True)
        if "qwen3:14b" not in [m["name"] for m in tags().get("models", [])]:
            raise SystemExit("Modele non disponible sur le serveur Ollama configure.")
    print("Ollama et Qwen3 14B disponibles.")


if __name__ == "__main__":
    main()
