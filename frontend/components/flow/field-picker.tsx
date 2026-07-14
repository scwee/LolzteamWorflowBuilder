"use client";

import { ChevronRight, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { FlowNode } from "@/lib/api";

type FieldPickerProps = {
  value: string;
  onChange: (value: string) => void;
  pinData: Record<string, unknown>;
  graphNodes: FlowNode[];
  placeholder?: string;
  label?: string;
};

export function buildPaths(obj: unknown, prefix = "", depth = 0): string[] {
  if (depth > 6 || obj == null) return prefix ? [prefix] : [];
  if (typeof obj !== "object") return prefix ? [prefix] : [];

  const paths: string[] = [];
  if (Array.isArray(obj)) {
    if (!obj.length) {
      if (prefix) paths.push(prefix);
      return paths;
    }
    const sample = Math.min(obj.length, 3);
    for (let i = 0; i < sample; i++) {
      const next = prefix ? `${prefix}[${i}]` : `[${i}]`;
      paths.push(...buildPaths(obj[i], next, depth + 1));
    }
    return paths.length ? paths : prefix ? [prefix] : [];
  }

  const entries = Object.entries(obj as Record<string, unknown>);
  if (!entries.length) {
    if (prefix) paths.push(prefix);
    return paths;
  }

  for (const [key, val] of entries) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (val != null && typeof val === "object") {
      paths.push(...buildPaths(val, next, depth + 1));
    } else {
      paths.push(next);
    }
  }
  return paths;
}

type TreeNode = {
  key: string;
  path: string;
  children: TreeNode[];
  leaf: boolean;
};

function pathsToTree(paths: string[]): TreeNode[] {
  const root: TreeNode[] = [];

  function ensure(parts: string[], list: TreeNode[], built: string): TreeNode[] {
    if (!parts.length) return list;
    const [head, ...rest] = parts;
    const isIndex = /^\d+$/.test(head) || /^\[\d+\]$/.test(head);
    const segment = isIndex ? head.replace(/[\[\]]/g, "") : head;
    const path =
      built === ""
        ? isIndex
          ? `[${segment}]`
          : segment
        : isIndex
          ? `${built}[${segment}]`
          : `${built}.${segment}`;

    let node = list.find((n) => n.key === segment && n.path === path);
    if (!node) {
      node = { key: segment, path, children: [], leaf: rest.length === 0 };
      list.push(node);
    }
    if (rest.length === 0) node.leaf = true;
    else ensure(rest, node.children, path);
    return list;
  }

  for (const p of paths) {
    const parts = p
      .replace(/\[(\d+)\]/g, ".$1")
      .split(".")
      .filter(Boolean);
    ensure(parts, root, "");
  }
  return root;
}

function TreeButtons({
  nodes,
  onPick,
  depth = 0,
}: {
  nodes: TreeNode[];
  onPick: (path: string) => void;
  depth?: number;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});

  return (
    <div className="space-y-0.5">
      {nodes.map((node) => {
        const hasChildren = node.children.length > 0;
        const isOpen = open[node.path] ?? depth < 1;
        return (
          <div key={node.path}>
            <div className="flex items-center gap-0.5" style={{ paddingLeft: depth * 10 }}>
              {hasChildren ? (
                <button
                  type="button"
                  className="flex h-5 w-5 items-center justify-center text-muted-foreground"
                  onClick={() => setOpen((s) => ({ ...s, [node.path]: !isOpen }))}
                >
                  <ChevronRight className={`h-3 w-3 transition ${isOpen ? "rotate-90" : ""}`} />
                </button>
              ) : (
                <span className="w-5" />
              )}
              <button
                type="button"
                className="min-w-0 flex-1 truncate rounded px-1.5 py-0.5 text-left font-mono text-[11px] hover:bg-accent"
                onClick={() => onPick(node.path)}
                title={node.path}
              >
                {node.key}
              </button>
            </div>
            {hasChildren && isOpen ? (
              <TreeButtons nodes={node.children} onPick={onPick} depth={depth + 1} />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function FieldPicker({
  value,
  onChange,
  pinData,
  graphNodes,
  placeholder,
  label,
}: FieldPickerProps) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const treeSections = useMemo(() => {
    const sections: Array<{ id: string; title: string; paths: string[]; tree: TreeNode[] }> = [];
    const upstreamIds = new Set(graphNodes.map((n) => n.id));

    for (const node of graphNodes) {
      if (!upstreamIds.has(node.id)) continue;
      const pinned = pinData[node.id];
      const title = String(node.data?.title || node.id);
      if (pinned != null && typeof pinned === "object") {
        const paths = buildPaths(pinned, node.id);
        sections.push({
          id: node.id,
          title: `${title} · данные`,
          paths,
          tree: pathsToTree(paths),
        });
      } else {
        const fallback = [`${node.id}.response`];
        sections.push({
          id: node.id,
          title: `${title} · подключить`,
          paths: fallback,
          tree: pathsToTree(fallback),
        });
      }
    }

    for (const [key, val] of Object.entries(pinData)) {
      if (graphNodes.some((n) => n.id === key)) continue;
      const paths = buildPaths(val, key);
      sections.push({
        id: key,
        title: key,
        paths,
        tree: pathsToTree(paths),
      });
    }

    return sections;
  }, [graphNodes, pinData]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pick(path: string) {
    const tpl = `{{ ${path} }}`;
    onChange(value ? `${value}${value.endsWith(" ") ? "" : " "}${tpl}` : tpl);
    setOpen(false);
  }

  return (
    <div className="relative space-y-1.5">
      {label ? <Label className="text-[11px] font-medium text-muted-foreground">{label}</Label> : null}
      <div className="flex gap-1.5">
        <input
          className="flex h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 font-mono text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={value}
          placeholder={placeholder ?? "{{ node_id.response }}"}
          onChange={(e) => onChange(e.target.value)}
        />
        <Button
          ref={btnRef}
          type="button"
          size="sm"
          variant="outline"
          className="h-9 shrink-0 text-[11px]"
          onClick={() => setOpen((v) => !v)}
        >
          Выбрать поле
        </Button>
      </div>

      {open ? (
        <div
          ref={panelRef}
          className="absolute right-0 z-50 mt-1 max-h-64 w-full min-w-[260px] overflow-auto rounded-md border border-border bg-panel p-2 shadow-lg"
        >
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Поля контекста
            </p>
            <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setOpen(false)}>
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {treeSections.length ? (
            <div className="space-y-2">
              {treeSections.map((section) => (
                <div key={section.id}>
                  <p className="mb-0.5 truncate px-1 text-[10px] font-medium text-muted-foreground">
                    {section.title}
                  </p>
                  <TreeButtons nodes={section.tree} onPick={pick} />
                </div>
              ))}
            </div>
          ) : (
            <p className="px-1 text-[11px] text-muted-foreground">Нет доступных полей</p>
          )}
          <div className="mt-2 border-t border-border/60 pt-1.5">
            <p className="mb-1 text-[10px] text-muted-foreground">Частые</p>
            <div className="flex flex-wrap gap-1">
              {["login", "password", "email", "line"].map((k) => (
                <Button
                  key={k}
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-6 text-[10px]"
                  onClick={() => pick(k)}
                >
                  {k}
                </Button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
