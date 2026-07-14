from app.engine.validate import validate_graph


def test_validate_empty_graph():
    assert "пуст" in validate_graph({"nodes": [], "edges": []})[0].lower()


def test_validate_missing_flow_start():
    errors = validate_graph(
        {
            "nodes": [{"id": "a", "type": "delay", "data": {}}],
            "edges": [],
        }
    )
    assert any("триггера" in msg or "flow_start" in msg or "Webhook" in msg for msg in errors)


def test_validate_webhook_as_trigger_ok():
    errors = validate_graph(
        {
            "nodes": [
                {"id": "wh", "type": "webhook_trigger", "data": {}},
                {"id": "end", "type": "flow_end", "data": {}},
            ],
            "edges": [{"id": "e1", "source": "wh", "target": "end"}],
        }
    )
    assert not any("триггера" in msg for msg in errors)



def test_validate_execute_flow_requires_flow_id():
    errors = validate_graph(
        {
            "nodes": [
                {"id": "start", "type": "flow_start", "data": {}},
                {"id": "sub", "type": "execute_flow", "data": {}},
            ],
            "edges": [],
        }
    )
    assert any("flow_id" in msg for msg in errors)


def test_validate_unknown_type():
    errors = validate_graph(
        {
            "nodes": [
                {"id": "start", "type": "flow_start", "data": {}},
                {"id": "bad", "type": "Totally Invalid!!", "data": {}},
            ],
            "edges": [],
        }
    )
    assert any("Неизвестный тип" in msg for msg in errors)


def test_validate_allows_custom_slug():
    errors = validate_graph(
        {
            "nodes": [
                {"id": "start", "type": "flow_start", "data": {}},
                {"id": "c", "type": "custom_get_users", "data": {}},
            ],
            "edges": [],
        }
    )
    assert not any("Неизвестный тип" in msg for msg in errors)


def test_validate_orphan_if_warning():
    errors = validate_graph(
        {
            "nodes": [
                {"id": "start", "type": "flow_start", "data": {}},
                {"id": "iff", "type": "if_condition", "data": {}},
            ],
            "edges": [{"id": "e1", "source": "start", "target": "iff"}],
        }
    )
    assert any(msg.startswith("Предупреждение:") and "IF" in msg for msg in errors)


def test_validate_ok_minimal():
    errors = validate_graph(
        {
            "nodes": [
                {"id": "start", "type": "flow_start", "data": {}},
                {"id": "end", "type": "flow_end", "data": {}},
            ],
            "edges": [{"id": "e1", "source": "start", "target": "end"}],
        }
    )
    assert errors == []
