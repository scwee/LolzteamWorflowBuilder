"use client";

import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api, type CatalogEndpoint } from "@/lib/api";
import { NodeIconBadge } from "@/lib/node-icons";
import {
  categoryColor,
  categoryLabel,
  getAllNodeTypes,
  nodeDefaults,
  nodeLabel,
} from "@/lib/nodes";
import { generateId } from "@/lib/utils";

type NodePaletteProps = {
  onAdd: (type: string) => void;
  loopEnabled?: boolean;
};

const CATEGORY_ORDER = ["Triggers", "Market", "HTTP", "Logic", "Utility", "Data", "Flow"];

export function NodePalette({ onAdd, loopEnabled = false }: NodePaletteProps) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"blocks" | "market">("blocks");
  const [tag, setTag] = useState("");
  const [tags, setTags] = useState<Array<{ tag: string; count: number }>>([]);
  const [endpoints, setEndpoints] = useState<CatalogEndpoint[]>([]);

  useEffect(() => {
    api.listCatalogTags().then(setTags).catch(() => setTags([]));
  }, []);

  useEffect(() => {
    if (tab !== "market") return;
    api
      .listCatalog({ q: query || undefined, tag: tag || undefined })
      .then(setEndpoints)
      .catch(() => setEndpoints([]));
  }, [tab, query, tag]);

  const allNodes = useMemo(() => getAllNodeTypes(), []);
  const categories = useMemo(() => {
    const present = Array.from(new Set(Object.values(allNodes).map((node) => node.category)));
    const ordered = CATEGORY_ORDER.filter((c) => present.includes(c));
    const rest = present.filter((c) => !CATEGORY_ORDER.includes(c)).sort();
    return [...ordered, ...rest];
  }, [allNodes]);

  const blockEntries = useMemo(() => {
    if (tab !== "blocks") return [];
    const q = query.trim().toLowerCase();
    return Object.entries(allNodes).filter(([type, meta]) => {
      if (loopEnabled && type === "flow_end") return false;
      if (!q) return true;
      return (
        meta.label.toLowerCase().includes(q) ||
        type.toLowerCase().includes(q) ||
        meta.category.toLowerCase().includes(q) ||
        categoryLabel(meta.category).toLowerCase().includes(q)
      );
    });
  }, [allNodes, query, loopEnabled, tab]);

  return (
    <aside className="panel-slide-left flex h-full w-[220px] shrink-0 flex-col border-r border-border/80 bg-panel">
      <div className="space-y-2 border-b border-border/80 px-2.5 py-2.5">
        <div className="flex gap-1">
          <Button
            size="sm"
            variant={tab === "blocks" ? "default" : "outline"}
            className="h-7 flex-1 text-[11px]"
            onClick={() => setTab("blocks")}
          >
            Блоки
          </Button>
          <Button
            size="sm"
            variant={tab === "market" ? "default" : "outline"}
            className="h-7 flex-1 text-[11px]"
            onClick={() => setTab("market")}
          >
            Market
          </Button>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tab === "market" ? "Steam, buy…" : "Поиск нод..."}
            className="h-7 pl-7 text-[11px]"
          />
        </div>
        {tab === "market" ? (
          <select
            className="flex h-7 w-full rounded-md border border-input bg-background px-2 text-[11px]"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
          >
            <option value="">Все теги</option>
            {tags.map((t) => (
              <option key={t.tag} value={t.tag}>
                {t.tag} ({t.count})
              </option>
            ))}
          </select>
        ) : null}
      </div>

      <ScrollArea className="flex-1 px-1.5 py-2">
        {tab === "blocks" ? (
          <div className="space-y-3">
            {loopEnabled ? (
              <p className="px-1.5 text-[10px] leading-snug text-muted-foreground">
                Loop включён — End не нужен.
              </p>
            ) : null}
            {categories.map((category) => {
              const items = blockEntries.filter(([, meta]) => meta.category === category);
              if (!items.length) return null;
              const color = categoryColor(category);
              return (
                <div key={category}>
                  <div className="mb-1 flex items-center gap-1.5 px-1.5">
                    <span className="h-1 w-1 rounded-full" style={{ backgroundColor: color }} />
                    <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                      {categoryLabel(category)}
                    </p>
                  </div>
                  <div className="space-y-0.5">
                    {items.map(([type]) => (
                      <button
                        key={type}
                        draggable
                        onDragStart={(event) => {
                          event.dataTransfer.setData("application/reactflow", type);
                          event.dataTransfer.effectAllowed = "move";
                        }}
                        onClick={() => onAdd(type)}
                        className="group flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[11px] text-foreground transition hover:bg-accent"
                      >
                        <NodeIconBadge type={type} size="sm" />
                        <span className="truncate">{nodeLabel(type)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="space-y-0.5">
            {endpoints.map((ep) => (
              <button
                key={ep.id}
                type="button"
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData("application/reactflow", "api_call");
                  event.dataTransfer.setData("application/lzt-endpoint", ep.id);
                  event.dataTransfer.setData("application/lzt-endpoint-title", ep.summary);
                  event.dataTransfer.effectAllowed = "move";
                }}
                onClick={() => onAdd("api_call")}
                className="flex w-full flex-col rounded px-1.5 py-1.5 text-left transition hover:bg-accent"
                title={ep.pathTemplate}
              >
                <span className="font-mono text-[9px] text-primary">{ep.method}</span>
                <span className="truncate text-[11px]">{ep.summary}</span>
                <span className="truncate font-mono text-[9px] text-muted-foreground">{ep.id}</span>
              </button>
            ))}
            {!endpoints.length ? (
              <p className="px-1.5 text-[11px] text-muted-foreground">Нет endpoints</p>
            ) : null}
          </div>
        )}
      </ScrollArea>
    </aside>
  );
}

export function createNode(type: string, position: { x: number; y: number }) {
  return {
    id: generateId("node"),
    type: "flowNode",
    position,
    data: {
      type,
      label: nodeLabel(type),
      data: { ...nodeDefaults(type) },
    },
  };
}
