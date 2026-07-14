"use client";

import { CheckCircle2, Circle, Loader2, XCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { AppShell, PageCanvas } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { api, type Flow, type FlowRun } from "@/lib/api";
import { cn } from "@/lib/utils";

type ExecutionRow = FlowRun & { flow_name: string };

function StatusIcon({ status }: { status: string }) {
  if (status === "success" || status === "completed") {
    return <CheckCircle2 className="h-4 w-4 text-primary" />;
  }
  if (status === "error" || status === "failed") {
    return <XCircle className="h-4 w-4 text-destructive" />;
  }
  if (status === "running" || status === "pending") {
    return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  }
  return <Circle className="h-4 w-4 text-muted-foreground" />;
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    success: "Успех",
    completed: "Успех",
    error: "Ошибка",
    failed: "Ошибка",
    running: "Выполняется",
    pending: "Ожидание",
    stopped: "Остановлен",
  };
  return map[status] ?? status;
}

function ExecutionsContent() {
  const [rows, setRows] = useState<ExecutionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const flows = await api.listFlows();
        const batches = await Promise.all(
          flows.map(async (flow: Flow) => {
            try {
              const runs = await api.listRuns(flow.id);
              return runs.map((run) => ({ ...run, flow_name: flow.name }));
            } catch {
              return [] as ExecutionRow[];
            }
          }),
        );
        if (cancelled) return;
        const merged = batches
          .flat()
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        setRows(merged);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Ошибка загрузки");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AppShell title="Запуски" subtitle="История запусков сценариев">
      <PageCanvas>
        {error ? <p className="mb-4 text-sm text-destructive">{error}</p> : null}

        {loading ? (
          <p className="text-sm text-muted-foreground">Загрузка...</p>
        ) : rows.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-card/40 px-6 py-14 text-center">
            <p className="text-[15px] font-medium text-foreground">Пока нет запусков</p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Запустите workflow — результат появится здесь
            </p>
            <Button className="mt-5" asChild>
              <Link href="/">К workflows</Link>
            </Button>
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border border-border bg-card">
            <div className="grid grid-cols-[28px_1fr_120px_160px] gap-3 border-b border-border px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <span />
              <span>Workflow</span>
              <span>Статус</span>
              <span>Время</span>
            </div>
            {rows.map((row) => (
              <Link
                key={row.id}
                href={`/flow/${row.flow_id}?run=${row.id}`}
                className="grid grid-cols-[28px_1fr_120px_160px] items-center gap-3 border-b border-border px-4 py-3 last:border-b-0 transition hover:bg-secondary/40"
              >
                <StatusIcon status={row.status} />
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-foreground">{row.flow_name}</p>
                  <p className="truncate font-mono text-[10px] text-muted-foreground">{row.id.slice(0, 8)}</p>
                </div>
                <span
                  className={cn(
                    "text-[12px]",
                    row.status === "success" || row.status === "completed"
                      ? "text-primary"
                      : row.status === "error" || row.status === "failed"
                        ? "text-destructive"
                        : "text-muted-foreground",
                  )}
                >
                  {statusLabel(row.status)}
                </span>
                <span className="text-[12px] text-muted-foreground">
                  {new Date(row.created_at).toLocaleString("ru-RU")}
                </span>
              </Link>
            ))}
          </div>
        )}
      </PageCanvas>
    </AppShell>
  );
}

export default function ExecutionsPage() {
  return <ExecutionsContent />;
}
