import csv
import io
from typing import Any

# Заголовки CSV, распознаваемые как известные поля (регистронезависимо).
_CSV_FIELD_ALIASES = {
    "login": "login",
    "username": "login",
    "user": "login",
    "password": "password",
    "pass": "password",
    "pwd": "password",
    "email": "email",
    "mail": "email",
    "proxy": "proxy",
}


def parse_text_lines(text: str) -> list[str]:
    lines = []
    for line in text.splitlines():
        trimmed = line.strip()
        if trimmed and not trimmed.startswith("#"):
            lines.append(trimmed)
    return lines


def parse_line_credentials(line: str) -> dict[str, str | None]:
    trimmed = line.strip()
    if not trimmed:
        return {}
    parts = trimmed.split(":")
    if len(parts) >= 2:
        return {
            "login": parts[0].strip() or None,
            "password": parts[1].strip() or None,
            "email": parts[2].strip() if len(parts) > 2 else None,
        }
    return {"login": trimmed}


def looks_like_csv(text: str) -> bool:
    """Эвристика: первая непустая строка содержит запятую и не выглядит как login:pass."""
    for raw in text.splitlines():
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            continue
        return "," in stripped
    return False


def parse_csv_records(text: str) -> list[dict[str, Any]]:
    """Разбирает CSV с заголовком в список записей.

    Известные колонки (login/password/email/proxy и их алиасы) нормализуются;
    остальные колонки сохраняются как есть, чтобы быть доступными в шаблонах.
    """
    reader = csv.reader(io.StringIO(text))
    rows = [row for row in reader if any(cell.strip() for cell in row)]
    if not rows:
        return []

    header = [cell.strip() for cell in rows[0]]
    normalized = [_CSV_FIELD_ALIASES.get(col.lower(), col) for col in header]

    records: list[dict[str, Any]] = []
    for row in rows[1:]:
        record: dict[str, Any] = {}
        for idx, key in enumerate(normalized):
            value = row[idx].strip() if idx < len(row) else ""
            record[key] = value or None
        records.append(record)
    return records


def build_file_source_body(files: list[dict[str, Any]]) -> dict[str, Any]:
    all_lines: list[str] = []
    for file in files:
        if file.get("encoding") == "text":
            all_lines.extend(parse_text_lines(file.get("content", "") or ""))

    first_text = next((f for f in files if f.get("encoding") == "text"), None)

    return {
        "fileCount": len(files),
        "lineCount": len(all_lines),
        "lines": all_lines,
        "files": [
            {
                "name": f.get("name"),
                "size": f.get("size"),
                "mimeType": f.get("mimeType"),
                "encoding": f.get("encoding"),
                "lineCount": len(parse_text_lines(f.get("content", "") or ""))
                if f.get("encoding") == "text"
                else 0,
            }
            for f in files
        ],
        "text": first_text.get("content") if first_text else None,
        "content": files[0].get("content") if files else None,
        "firstFileName": files[0].get("name") if files else None,
    }
