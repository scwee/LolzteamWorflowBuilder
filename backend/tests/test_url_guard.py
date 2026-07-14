from app.engine.errors import GraphExecutionError
from app.engine.url_guard import pin_outbound_url, validate_outbound_url, validate_proxy_url
import pytest


def test_blocks_localhost():
    with pytest.raises(GraphExecutionError):
        validate_outbound_url("http://localhost/admin")


def test_blocks_metadata_ip():
    with pytest.raises(GraphExecutionError):
        validate_outbound_url("http://169.254.169.254/latest/meta-data/")


def test_allows_public_https_ip():
    assert validate_outbound_url("https://1.1.1.1/health")


def test_blocks_non_http_scheme():
    with pytest.raises(GraphExecutionError):
        validate_outbound_url("file:///etc/passwd")


def test_blocks_docker_service_hostname():
    with pytest.raises(GraphExecutionError):
        validate_outbound_url("http://api:8000/health")
    with pytest.raises(GraphExecutionError):
        validate_outbound_url("http://postgres:5432/")


def test_blocks_single_label_hostname():
    with pytest.raises(GraphExecutionError):
        validate_proxy_url("http://proxy:8080")


def test_allows_public_proxy_ip():
    assert validate_proxy_url("http://1.1.1.1:8080")
    assert validate_proxy_url("socks5://user:pass@8.8.8.8:1080")


def test_pin_outbound_public_ip():
    pinned = pin_outbound_url("https://1.1.1.1/health")
    assert pinned.pinned_ip == "1.1.1.1"
    assert pinned.host_header is None
