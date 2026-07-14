"use client";

import { useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FlowNode } from "@/lib/api";
import { buildSubjectGroups } from "@/lib/if-builder";

type ValueInputProps = {
  value: string;
  onChange: (value: string) => void;
  graphNodes: FlowNode[];
  label?: string;
  placeholder?: string;
  numeric?: boolean;
  /** raw = хранить путь без {{ }} (для pick_value); по умолчанию шаблон {{ ... }}. */
  raw?: boolean;
};

const TEMPLATE_RE = /^\{\{\s*[^}]+\s*\}\}$/;

function isNodeRef(value: string, raw: boolean): boolean {
  const v = value.trim();
  if (!v) return false;
  if (raw) return !TEMPLATE_RE.test(v) && /^[a-zA-Z_][\w.[\]]*$/.test(v) && v.includes(".");
  return TEMPLATE_RE.test(v);
}

const tabClass = (active: boolean) =>
  `px-2.5 py-1 text-[11px] transition ${active ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground"}`;

export function ValueInput({
  value,
  onChange,
  graphNodes,
  label,
  placeholder,
  numeric,
  raw = false,
}: ValueInputProps) {
  const groups = useMemo(() => buildSubjectGroups(graphNodes), [graphNodes]);
  const hasSources = groups.some((g) => g.options.length > 0);
  const [mode, setMode] = useState<"manual" | "node">(isNodeRef(value, raw) ? "node" : "manual");

  const flatOptions = useMemo(
    () => groups.flatMap((g) => g.options),
    [groups],
  );

  function toTemplate(template: string): string {
    if (!raw) return template;
    const m = template.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
    return m ? m[1] : template;
  }

  const currentIsKnown = flatOptions.some((o) => toTemplate(o.template) === value.trim());

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        {label ? <Label className="text-[11px] font-medium text-muted-foreground">{label}</Label> : <span />}
        {hasSources ? (
          <div className="flex overflow-hidden rounded-md border border-border">
            <button
              type="button"
              className={tabClass(mode === "manual")}
              onClick={() => {
                setMode("manual");
                if (isNodeRef(value, raw)) onChange("");
              }}
            >
              Ввести
            </button>
            <button
              type="button"
              className={tabClass(mode === "node")}
              onClick={() => {
                setMode("node");
                if (!isNodeRef(value, raw)) onChange("");
              }}
            >
              Из ноды
            </button>
          </div>
        ) : null}
      </div>

      {mode === "node" && hasSources ? (
        <select
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={currentIsKnown ? value.trim() : ""}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">— выберите поле —</option>
          {groups.map((g) => (
            <optgroup key={g.nodeId} label={g.title}>
              {g.options.map((o) => (
                <option key={o.template} value={toTemplate(o.template)}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ))}
          {value.trim() && !currentIsKnown ? (
            <option value={value.trim()}>текущее: {value.trim()}</option>
          ) : null}
        </select>
      ) : (
        <Input
          className="h-9 text-[13px]"
          type={numeric ? "number" : "text"}
          value={value}
          placeholder={placeholder ?? "значение"}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

type KeyValueEditorProps = {
  value: Record<string, unknown> | string | undefined;
  onChange: (value: Record<string, string>) => void;
  graphNodes: FlowNode[];
  keyPlaceholder?: string;
};

function parseAssignments(value: KeyValueEditorProps["value"]): Array<[string, string]> {
  if (value && typeof value === "object") {
    return Object.entries(value).map(([k, v]) => [k, v == null ? "" : String(v)]);
  }
  if (typeof value === "string" && value.trim()) {
    const rows: Array<[string, string]> = [];
    for (const line of value.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const sep = trimmed.includes("=") ? "=" : trimmed.includes(":") ? ":" : "";
      if (!sep) continue;
      const idx = trimmed.indexOf(sep);
      rows.push([trimmed.slice(0, idx).trim(), trimmed.slice(idx + 1).trim()]);
    }
    return rows;
  }
  return [];
}

export function KeyValueEditor({ value, onChange, graphNodes, keyPlaceholder }: KeyValueEditorProps) {
  const [rows, setRows] = useState<Array<[string, string]>>(() => {
    const parsed = parseAssignments(value);
    return parsed.length ? parsed : [["", ""]];
  });

  function commit(next: Array<[string, string]>) {
    setRows(next.length ? next : [["", ""]]);
    const obj: Record<string, string> = {};
    for (const [k, v] of next) {
      if (k.trim()) obj[k.trim()] = v;
    }
    onChange(obj);
  }

  function updateRow(index: number, key: string, val: string) {
    commit(rows.map((r, i) => (i === index ? ([key, val] as [string, string]) : r)));
  }

  function addRow() {
    commit([...rows, ["", ""]]);
  }

  function removeRow(index: number) {
    commit(rows.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-2">
      {rows.map((row, index) => (
        <div key={index} className="space-y-1.5 rounded-md border border-border bg-background/50 p-2.5">
          <div className="flex items-center gap-2">
            <Input
              className="h-9 flex-1 text-[13px]"
              value={row[0]}
              placeholder={keyPlaceholder ?? "имя переменной"}
              onChange={(e) => updateRow(index, e.target.value, row[1])}
            />
            <button
              type="button"
              className="shrink-0 text-muted-foreground hover:text-destructive"
              onClick={() => removeRow(index)}
              title="Удалить"
            >
              ✕
            </button>
          </div>
          <ValueInput
            value={row[1]}
            onChange={(v) => updateRow(index, row[0], v)}
            graphNodes={graphNodes}
            placeholder="значение"
          />
        </div>
      ))}
      <button
        type="button"
        className="w-full rounded-md border border-dashed border-border py-1.5 text-[12px] text-muted-foreground hover:bg-accent"
        onClick={addRow}
      >
        + Добавить
      </button>
    </div>
  );
}

type StringListEditorProps = {
  value: string[] | string | undefined;
  onChange: (value: string[]) => void;
  placeholder?: string;
};

function parseStringList(value: StringListEditorProps["value"]): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string" && value.trim()) {
    return value
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

export function StringListEditor({ value, onChange, placeholder }: StringListEditorProps) {
  const [rows, setRows] = useState<string[]>(() => {
    const items = parseStringList(value);
    return items.length ? items : [""];
  });

  function commit(next: string[]) {
    setRows(next.length ? next : [""]);
    onChange(next.map((s) => s.trim()).filter(Boolean));
  }

  return (
    <div className="space-y-2">
      {rows.map((item, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            className="h-9 flex-1 text-[13px]"
            value={item}
            placeholder={placeholder ?? "значение"}
            onChange={(e) => commit(rows.map((r, i) => (i === index ? e.target.value : r)))}
          />
          <button
            type="button"
            className="shrink-0 text-muted-foreground hover:text-destructive"
            onClick={() => commit(rows.filter((_, i) => i !== index))}
            title="Удалить"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        className="w-full rounded-md border border-dashed border-border py-1.5 text-[12px] text-muted-foreground hover:bg-accent"
        onClick={() => commit([...rows, ""])}
      >
        + Добавить
      </button>
    </div>
  );
}
