from datetime import datetime, timedelta, timezone

from app.engine.file_utils import (
    looks_like_csv,
    parse_csv_records,
    parse_line_credentials,
)
from app.engine.interpolator import interpolate_value
from app.engine.lzt_nodes import _build_records, _dedup_records, run_file_source
from app.engine.registry import ExecutionState
from app.engine.topology import _evaluate_condition, GraphExecutionError, topological_sort
from app.flows.schemas import FlowGraph, GraphEdge, GraphNode


def _inline_file(content: str, name: str = "accounts.txt") -> dict:
    return {"name": name, "encoding": "text", "content": content}


def test_topological_sort_linear_graph():
    nodes = [
        GraphNode(id="node_1", type="flow_start", data={}),
        GraphNode(id="node_2", type="api_call", data={}),
        GraphNode(id="node_3", type="flow_end", data={}),
    ]
    edges = [
        GraphEdge(id="e1", source="node_1", target="node_2"),
        GraphEdge(id="e2", source="node_2", target="node_3"),
    ]

    ordered = topological_sort(nodes, edges)
    assert [node.id for node in ordered] == ["node_1", "node_2", "node_3"]


def test_topological_sort_detects_cycle():
    nodes = [
        GraphNode(id="a", type="flow_start", data={}),
        GraphNode(id="b", type="delay", data={}),
    ]
    edges = [
        GraphEdge(id="e1", source="a", target="b"),
        GraphEdge(id="e2", source="b", target="a"),
    ]

    try:
        topological_sort(nodes, edges)
        raise AssertionError("Expected cycle detection")
    except GraphExecutionError:
        pass


def test_interpolate_nested_response_with_array_index():
    context = {
        "node_2": {
            "response": [{"id": "order-42", "status": "paid"}],
        }
    }
    value = interpolate_value("Order {{ node_2.response[0].id }}", context)
    assert value == "Order order-42"


def test_interpolate_object_fields():
    context = {
        "node_1": {"response": {"token": "abc123"}},
    }
    payload = interpolate_value(
        {
            "url": "https://example.com/{{ node_1.response.token }}",
            "headers": {"Authorization": "Bearer {{ node_1.response.token }}"},
        },
        context,
    )
    assert payload["url"] == "https://example.com/abc123"
    assert payload["headers"]["Authorization"] == "Bearer abc123"


def test_interpolate_entire_template_returns_native():
    context = {"node_1": {"response": {"items": [1, 2, 3], "ok": True}}}
    assert interpolate_value("{{ node_1.response.items }}", context) == [1, 2, 3]
    assert interpolate_value("{{ node_1.response.ok }}", context) is True


def test_flow_graph_schema_accepts_lzt_shape():
    graph = FlowGraph.model_validate(
        {
            "flow_id": "usr_9921_flow_01",
            "settings": {"loop": True, "interval_seconds": 120, "proxy": "http://1.1.1.1:8080"},
            "nodes": [
                {"id": "node_1", "type": "flow_start", "data": {}},
                {
                    "id": "node_2",
                    "type": "api_call",
                    "data": {"endpoint_id": "Publishing.Add", "account_id": "00000000-0000-0000-0000-000000000001"},
                },
                {"id": "node_3", "type": "file_source", "data": {"iterate_lines": True}},
            ],
            "edges": [
                {"id": "e1-2", "source": "node_1", "target": "node_2"},
                {"id": "e2-3", "source": "node_2", "target": "node_3"},
            ],
        }
    )
    assert graph.settings.loop is True
    assert len(graph.nodes) == 3


def test_invite_expiry_helper():
    expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    assert expires_at < datetime.now(timezone.utc)


def test_parse_line_credentials_variants():
    assert parse_line_credentials("user:pass") == {
        "login": "user",
        "password": "pass",
        "email": None,
    }
    assert parse_line_credentials("user:pass:mail@x.io")["email"] == "mail@x.io"
    assert parse_line_credentials("onlylogin") == {"login": "onlylogin"}


def test_looks_like_csv_detection():
    assert looks_like_csv("login,password,proxy\na,b,c") is True
    assert looks_like_csv("# comment\nuser:pass") is False
    assert looks_like_csv("user:pass:mail") is False


def test_parse_csv_records_with_aliases():
    text = "username,pwd,mail,proxy\njohn,secret,john@x.io,http://1.2.3.4:8080\n"
    records = parse_csv_records(text)
    assert records == [
        {
            "login": "john",
            "password": "secret",
            "email": "john@x.io",
            "proxy": "http://1.2.3.4:8080",
        }
    ]


def test_dedup_records_by_line():
    records = [
        {"line": "a:b", "login": "a", "password": "b"},
        {"line": "a:b", "login": "a", "password": "b"},
        {"line": "c:d", "login": "c", "password": "d"},
    ]
    assert len(_dedup_records(records)) == 2


def test_build_records_auto_switches_to_csv():
    files = [_inline_file("login,password\na,b\nc,d")]
    body = {"lines": ["login,password", "a,b", "c,d"]}
    records = _build_records(files, body, {"format": "auto"})
    assert records == [
        {"login": "a", "password": "b"},
        {"login": "c", "password": "d"},
    ]


def test_run_file_source_fan_out_with_proxy():
    data = {
        "iterate_lines": True,
        "format": "csv",
        "files": [_inline_file("login,password,proxy\na,b,http://1.1.1.1:9000\n", "a.csv")],
    }
    result = run_file_source(data, ExecutionState())
    assert result["_fan_out"] is True
    assert result["response"]["itemCount"] == 1
    item = result["_items"][0]
    assert item["login"] == "a"
    assert item["proxy"] == "http://1.1.1.1:9000"


def test_run_file_source_dedup_and_parallel():
    data = {
        "iterate_lines": True,
        "dedup": True,
        "max_parallel": 4,
        "files": [_inline_file("a:b\na:b\nc:d\n")],
    }
    result = run_file_source(data, ExecutionState())
    assert result["response"]["itemCount"] == 2
    assert result["_max_parallel"] == 4


def test_run_file_source_empty_skips_downstream():
    data = {"iterate_lines": True, "files": [_inline_file("# only comment\n")]}
    result = run_file_source(data, ExecutionState())
    assert result["_skip_downstream"] is True
    assert result["_items"] == []


def test_run_filter_by_field_condition():
    from app.engine.utility_nodes import run_filter

    context = {
        "node_1": {"response": {"items": [{"status": "ok"}, {"status": "bad"}, {"status": "ok"}]}}
    }
    result = run_filter(
        {"source": "node_1.response.items", "field": "status", "operator": "eq", "value": "ok"},
        context,
        {},
    )
    assert result["response"]["count"] == 2
    assert result["response"]["dropped"] == 1


def test_run_aggregate_sum_and_join():
    from app.engine.utility_nodes import run_aggregate

    context = {"node_1": {"response": {"items": [{"price": "10"}, {"price": "5"}]}}}
    summed = run_aggregate(
        {"source": "node_1.response.items", "field": "price", "operation": "sum"}, context, {}
    )
    assert summed["response"]["value"] == 15

    joined = run_aggregate(
        {"source": "node_1.response.items", "field": "price", "operation": "join", "separator": ","},
        context,
        {},
    )
    assert joined["response"]["value"] == "10,5"


def test_if_condition_legacy_shape():
    assert _evaluate_condition({"left": "5", "operator": "gt", "right": "3"}) is True
    assert _evaluate_condition({"left": "ok", "operator": "eq", "right": "no"}) is False


def test_if_condition_conditions_all_and_any():
    data_all = {
        "match": "all",
        "conditions": [
            {"subject": "200", "operator": "gte", "value": "200"},
            {"subject": "200", "operator": "lt", "value": "300"},
        ],
    }
    assert _evaluate_condition(data_all) is True

    data_all_fail = {
        "match": "all",
        "conditions": [
            {"subject": "True", "operator": "truthy"},
            {"subject": "", "operator": "not_empty"},
        ],
    }
    assert _evaluate_condition(data_all_fail) is False

    data_any = {
        "match": "any",
        "conditions": [
            {"subject": "", "operator": "not_empty"},
            {"subject": "True", "operator": "truthy"},
        ],
    }
    assert _evaluate_condition(data_any) is True


def test_if_condition_unary_ignores_value():
    assert _evaluate_condition({"conditions": [{"subject": "False", "operator": "falsy"}]}) is True
    assert _evaluate_condition({"conditions": [{"subject": "hi", "operator": "not_empty"}]}) is True


def test_run_aggregate_unique_and_count():
    from app.engine.utility_nodes import run_aggregate

    context = {"node_1": {"response": {"items": ["a", "b", "a", "c"]}}}
    unique = run_aggregate({"source": "node_1.response.items", "operation": "unique"}, context, {})
    assert unique["response"]["value"] == ["a", "b", "c"]
    count = run_aggregate({"source": "node_1.response.items", "operation": "count"}, context, {})
    assert count["response"]["value"] == 4


def test_pick_value_accepts_template_and_raw_path():
    from app.engine.utility_nodes import run_pick_value

    context = {"node_1": {"response": {"price": 42}}}
    raw = run_pick_value({"path": "node_1.response.price", "output_key": "p"}, context, {})
    assert raw["value"] == 42
    assert raw["variables"]["p"] == 42

    templated = run_pick_value({"path": "{{ node_1.response.price }}", "output_key": "p"}, context, {})
    assert templated["value"] == 42


def test_set_variables_accepts_dict_assignments():
    from app.engine.utility_nodes import run_set_variables

    context = {"node_1": {"response": {"ok": True}}}
    result = run_set_variables(
        {"assignments": {"flag": "{{ node_1.response.ok }}", "name": "test"}},
        context,
        {},
    )
    assert result["variables"]["flag"] is True
    assert result["variables"]["name"] == "test"
