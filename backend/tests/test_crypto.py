from cryptography.fernet import Fernet

from app.security.crypto import decrypt_graph_secrets, encrypt_graph_secrets, encrypt_secret, is_encrypted


def test_encrypt_decrypt_roundtrip(monkeypatch):
    key = Fernet.generate_key().decode()
    monkeypatch.setenv("SECRETS_ENCRYPTION_KEY", key)
    from app.config import Settings

    settings = Settings()
    monkeypatch.setattr("app.security.crypto.settings", settings)

    encrypted = encrypt_secret("super-secret-key")
    assert is_encrypted(encrypted)
    assert decrypt_graph_secrets(
        encrypt_graph_secrets(
            {
                "nodes": [
                    {
                        "id": "node_1",
                        "type": "api_call",
                        "data": {"token": "super-secret-key", "endpoint_id": "Publishing.Add"},
                    }
                ],
                "edges": [],
                "settings": {"proxy": "socks5://u:p@1.2.3.4:1080"},
            }
        )
    )["nodes"][0]["data"]["token"] == "super-secret-key"
