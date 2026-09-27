from fastapi.testclient import TestClient

from core.config import Settings
from interface.desktop_interface import create_app


def test_local_api_security(tmp_path):
    with TestClient(create_app(Settings(data_dir=tmp_path)), base_url="http://127.0.0.1:8765") as client:
        assert client.get("/").status_code == 200
        assert client.post("/stop").status_code == 404
        assert client.post("/api/stop").status_code == 403
        token = client.get("/api/session").json()["token"]
        headers = {"X-Agent-Token": token}
        assert client.post("/api/stop", headers=headers).status_code == 200
        assert (
            client.post("/api/stop", headers={**headers, "Origin": "https://evil.example"}).status_code == 403
        )
        assert client.get("/api/tasks", headers={"Host": "evil.example"}).status_code == 400
        assert client.get("/api/session", headers={"Sec-Fetch-Site": "cross-site"}).status_code == 403
        assert client.post("/api/tasks", headers=headers, json={"goal": "x"}).status_code == 422
        assert (
            client.put("/api/preferences/language", headers=headers, json={"value": "fr"}).status_code == 200
        )
        assert client.get("/api/preferences").json()["language"] == "fr"


def test_permission_modes_api_and_persistence(tmp_path):
    settings = Settings(data_dir=tmp_path)
    with TestClient(create_app(settings), base_url="http://127.0.0.1:8765") as client:
        headers = {"X-Agent-Token": client.get("/api/session").json()["token"]}
        assert client.get("/api/settings/permissions").json()["mode"] == "sensitive"
        assert client.put("/api/settings/permissions", json={"mode": "always_accept"}).status_code == 403
        assert (
            client.put("/api/settings/permissions", headers=headers, json={"mode": "invalid"}).status_code
            == 422
        )
        assert (
            client.put(
                "/api/settings/permissions", headers=headers, json={"mode": "always_accept"}
            ).status_code
            == 422
        )
        assert (
            client.put(
                "/api/preferences/permission_mode", headers=headers, json={"value": "always_accept"}
            ).status_code
            == 422
        )
        assert (
            client.put(
                "/api/settings/permissions",
                headers=headers,
                json={"mode": "always_accept", "accept_sensitive_risk": True},
            ).status_code
            == 200
        )
        assert client.get("/api/state").json()["permission_mode"] == "always_accept"
    with TestClient(create_app(settings), base_url="http://127.0.0.1:8765") as client:
        assert client.get("/api/settings/permissions").json()["mode"] == "always_accept"
