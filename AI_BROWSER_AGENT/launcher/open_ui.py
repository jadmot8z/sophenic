"""Detached readiness waiter: open the UI only after the server has started."""

import subprocess
import sys
import time
import webbrowser
from urllib.request import ProxyHandler, build_opener

if len(sys.argv) == 1:
    subprocess.Popen(
        [sys.executable, __file__, "--wait"], creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)
    )
else:
    opener = build_opener(ProxyHandler({}))
    for _ in range(60):
        try:
            with opener.open("http://127.0.0.1:8765/api/session", timeout=1) as response:
                if response.status == 200:
                    webbrowser.open("http://127.0.0.1:8765")
                    break
        except Exception:
            time.sleep(1)
