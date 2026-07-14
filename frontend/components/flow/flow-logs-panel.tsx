"use client";

import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  Loader2,
  Terminal,
  X,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { api, type NodeRun } from "@/lib/api";
import { nodeLabel } from "@/lib/nodes";
import { cn } from "@/lib/utils";

type FlowLogsPanelProps = {
  flowId: string;
  runId: string | null;
  liveLines?: string[];
  activeNodeId?: string | null;
  onSelectNode?: (nodeId: string) => void;
};

function statusMeta(status: string, hasError: boolean) {
  if (hasError || status === "failed" || status === "error") {
    return {
      label: "Ошибка",
      icon: XCircle,
      tone: "text-destructive bg-destructive/10 border-destructive/30",
    };
  }
  if (status === "running" || status === "pending") {
    return {
      label: "Выполняется",
      icon: Loader2,
      tone: "text-primary bg-primary/10 border-primary/30",
    };
  }
  if (status === "success" || status === "completed") {
    return {
      label: "Успех",
      icon: CheckCircle2,
      tone: "text-emerald-500 bg-emerald-500/10 border-emerald-500/30",
    };
  }
  return {
    label: status || "—",
    icon: Circle,
    tone: "text-muted-foreground bg-muted border-border",
  };
}

export function FlowLogsPanel({
  flowId,
  runId,
  liveLines = [],
  activeNodeId,
  onSelectNode,
}: FlowLogsPanelProps) {
  const [open, setOpen] = useState(true);
  const [height, setHeight] = useState(240);
  const [nodeRuns, setNodeRuns] = useState<NodeRun[]>([]);
  const [dragging, setDragging] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const dragStart = useRef<{ y: number; height: number } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!runId) {
      setNodeRuns([]);
      setExpandedId(null);
      return;
    }
    let cancelled = false;
    const load = () => {
      api
        .listNodeRuns(flowId, runId)
        .then((rows) => {
          if (!cancelled) setNodeRuns(rows);
        })
        .catch(() => {
          if (!cancelled) setNodeRuns([]);
        });
    };
    load();
    const timer = window.setInterval(load, 1200);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [flowId, runId]);

  useEffect(() => {
    if (!dragging) return;
    function onMove(event: MouseEvent) {
      if (!dragStart.current) return;
      const delta = dragStart.current.y - event.clientY;
      setHeight(Math.min(520, Math.max(120, dragStart.current.height + delta)));
    }
    function onUp() {
      setDragging(false);
      dragStart.current = null;
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging]);

  const expandedRun = useMemo(
    () => (expandedId ? nodeRuns.find((r) => r.id === expandedId) : null),
    [expandedId, nodeRuns],
  );

  useEffect(() => {
    if (!open || !scroller.current || expandedId) return;
    scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [nodeRuns, liveLines, open, expandedId]);

  if (!open) {
    return (
      <div className="absolute bottom-0 left-0 right-0 z-30 flex justify-center pb-2">
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 rounded-full bg-panel/95 px-3 text-[11px] shadow-soft backdrop-blur"
          onClick={() => setOpen(true)}
        >
          <Terminal className="h-3.5 w-3.5" />
          Логи
          {nodeRuns.length ? (
            <span className="rounded-full bg-primary/15 px-1.5 text-[10px] text-primary">
              {nodeRuns.length}
            </span>
          ) : null}
          <ChevronUp className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  return (
    <div
      className="absolute bottom-0 left-0 right-0 z-30 flex flex-col overflow-hidden rounded-t-xl border-t border-border/80 bg-panel/95 shadow-[0_-8px_30px_rgba(0,0,0,0.25)] backdrop-blur-md"
      style={{ height }}
    >
      <div
        className="flex h-2 cursor-row-resize items-center justify-center hover:bg-primary/10"
        onMouseDown={(event) => {
          setDragging(true);
          dragStart.current = { y: event.clientY, height };
        }}
      >
        <div className="h-1 w-10 rounded-full bg-border" />
      </div>

      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border/70 px-3">
        <div className="flex items-center gap-2 text-[12px] font-medium text-foreground">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-secondary">
            <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
          </span>
          Логи выполнения
          {runId ? (
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {runId.slice(0, 8)}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setHeight(140)} aria-label="Свернуть">
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOpen(false)} aria-label="Скрыть">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div ref={scroller} className="min-h-0 flex-1 space-y-1.5 overflow-auto p-3">
          {!runId && !liveLines.length ? (
            <div className="flex h-full min-h-[100px] flex-col items-center justify-center text-center">
              <p className="text-[13px] font-medium text-foreground">Пока тихо</p>
              <p className="mt-1 max-w-xs text-[12px] text-muted-foreground">
                Запустите сценарий — здесь появится timeline по каждой ноде
              </p>
            </div>
          ) : null}

          {liveLines.map((line, index) => (
            <div
              key={`live-${index}-${line}`}
              className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-[12px] text-foreground/90"
            >
              {line}
            </div>
          ))}

          {nodeRuns.map((run) => {
            const meta = statusMeta(run.status, Boolean(run.error));
            const Icon = meta.icon;
            const baseId = run.node_id.includes("#") ? run.node_id.split("#")[0] : run.node_id;
            const isActive = activeNodeId === baseId || activeNodeId === run.node_id;
            const isExpanded = expandedId === run.id;
            const stamp = run.finished_at || run.started_at;
            const time = stamp ? new Date(stamp).toLocaleTimeString() : "";
            const logs = Array.isArray(run.output_snapshot?.logs)
              ? (run.output_snapshot.logs as unknown[]).map(String)
              : [];

            return (
              <div
                key={run.id}
                className={cn(
                  "overflow-hidden rounded-lg border transition",
                  isActive && "border-primary/50 shadow-[0_0_0_1px_hsl(var(--primary)/0.2)]",
                  isExpanded ? "border-border bg-card" : "border-border/70 bg-card/60 hover:bg-card",
                )}
              >
                <button
                  type="button"
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left"
                  onClick={() => {
                    setExpandedId((cur) => (cur === run.id ? null : run.id));
                    onSelectNode?.(baseId);
                  }}
                >
                  <span className={cn("flex h-7 w-7 items-center justify-center rounded-md border", meta.tone)}>
                    <Icon className={cn("h-3.5 w-3.5", run.status === "running" && "animate-spin")} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-[12px] font-medium text-foreground">
                        {nodeLabel(run.node_type)}
                      </p>
                      <span className="truncate font-mono text-[10px] text-muted-foreground">{run.node_id}</span>
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {run.error || logs[0] || meta.label}
                      {run.duration_ms != null ? ` · ${run.duration_ms} ms` : ""}
                    </p>
                  </div>
                  {time ? <span className="shrink-0 text-[10px] text-muted-foreground">{time}</span> : null}
                </button>

                {isExpanded ? (
                  <div className="border-t border-border/60 bg-background/40 px-3 py-2.5">
                    {logs.length ? (
                      <div className="mb-2 space-y-1">
                        {logs.map((line, i) => (
                          <p key={i} className="font-mono text-[11px] text-foreground/85">
                            {line}
                          </p>
                        ))}
                      </div>
                    ) : null}
                    {run.error ? (
                      <p className="mb-2 rounded-md bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
                        {run.error}
                      </p>
                    ) : null}
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div>
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Input
                        </p>
                        <pre className="max-h-36 overflow-auto rounded-md border border-border/60 bg-card p-2 font-mono text-[10px] leading-4 text-foreground/80">
                          {JSON.stringify(run.input_snapshot ?? {}, null, 2)}
                        </pre>
                      </div>
                      <div>
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Output
                        </p>
                        <pre className="max-h-36 overflow-auto rounded-md border border-border/60 bg-card p-2 font-mono text-[10px] leading-4 text-foreground/80">
                          {JSON.stringify(run.output_snapshot ?? {}, null, 2)}
                        </pre>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        {expandedRun ? (
          <div className="hidden w-[280px] shrink-0 overflow-auto border-l border-border/70 bg-background/50 p-3 lg:block">
            <p className="mb-2 text-[11px] font-medium text-foreground">Быстрый просмотр</p>
            <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Output.response</p>
            <pre className="whitespace-pre-wrap break-all rounded-md border border-border/60 bg-card p-2 font-mono text-[10px] leading-4 text-foreground/85">
              {JSON.stringify(
                (expandedRun.output_snapshot as { response?: unknown })?.response ??
                  expandedRun.output_snapshot ??
                  {},
                null,
                2,
              )}
            </pre>
          </div>
        ) : null}
      </div>
    </div>
  );
}
