"use client";

import { KeyRound, Plus, Trash2, Workflow } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AppShell, PageCanvas } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { api, type Flow, type FlowGraph } from "@/lib/api";
import { FLOW_TEMPLATES } from "@/lib/flow-templates";
import { defaultGraph } from "@/lib/nodes";

function DashboardContent() {
  const router = useRouter();
  const [flows, setFlows] = useState<Flow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api
      .listFlows()
      .then(setFlows)
      .finally(() => setLoading(false));
  }, []);

  async function createFlow(graph: FlowGraph = defaultGraph() as FlowGraph, name?: string) {
    setCreating(true);
    try {
      const flow = await api.createFlow({
        name: name ?? `Workflow ${flows.length + 1}`,
        graph_json: graph,
      });
      router.push(`/flow/${flow.id}`);
    } finally {
      setCreating(false);
    }
  }

  async function createFromTemplate(templateId: string) {
    const template = FLOW_TEMPLATES.find((item) => item.id === templateId);
    if (!template) return;
    await createFlow(template.graph(), template.name);
  }

  async function deleteFlow(id: string) {
    try {
      await api.deleteFlow(id);
      setFlows((current) => current.filter((flow) => flow.id !== id));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Не удалось удалить workflow");
    }
  }

  return (
    <AppShell
      title="Сценарии"
      subtitle="Автоматизация LZT Market"
      actions={
        <Button onClick={() => createFlow()} disabled={creating} className="gap-1.5">
          <Plus className="h-4 w-4" />
          {creating ? "Создание..." : "Новый workflow"}
        </Button>
      }
    >
      <PageCanvas>
        <section className="mb-8 fade-up">
          <h2 className="mb-1 text-sm font-medium text-foreground">Шаблоны</h2>
          <p className="mb-3 text-[12px] text-muted-foreground">
            Быстрый старт: выберите готовый сценарий или создайте пустой
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {FLOW_TEMPLATES.map((template) => (
              <button
                key={template.id}
                type="button"
                disabled={creating}
                onClick={() => createFromTemplate(template.id)}
                className="rounded-md border border-border bg-card p-3.5 text-left transition hover:border-primary/40"
              >
                <p className="text-[13px] font-medium text-foreground">{template.name}</p>
                <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                  {template.description}
                </p>
                <p className="mt-2.5 text-[11px] font-medium text-primary">Создать →</p>
              </button>
            ))}
          </div>
        </section>

        <section className="fade-up">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-foreground">Мои workflows</h2>
            <span className="text-[11px] text-muted-foreground">{flows.length}</span>
          </div>

          {loading ? (
            <p className="text-sm text-muted-foreground">Загрузка...</p>
          ) : flows.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-border bg-card/40 px-6 py-14 text-center">
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-md bg-secondary">
                <Workflow className="h-5 w-5 text-muted-foreground" />
              </div>
              <h3 className="text-[15px] font-medium text-foreground">Пока нет сценариев</h3>
              <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-muted-foreground">
                1. Добавьте токен в{" "}
                <Link href="/credentials" className="text-primary hover:underline">
                  Учётные данные
                </Link>
                <br />
                2. Создайте сценарий или выберите шаблон выше
                <br />
                3. Запускайте и смотрите историю в{" "}
                <Link href="/executions" className="text-primary hover:underline">
                  Запуски
                </Link>
              </p>
              <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                <Button className="gap-1.5" onClick={() => createFlow()} disabled={creating}>
                  <Plus className="h-4 w-4" />
                  Создать пустой
                </Button>
                <Button variant="outline" asChild>
                  <Link href="/credentials" className="gap-1.5">
                    <KeyRound className="h-3.5 w-3.5" />
                    Учётные данные
                  </Link>
                </Button>
              </div>
            </div>
          ) : (
            <div className="overflow-hidden rounded-md border border-border bg-card">
              {flows.map((flow, index) => (
                <div
                  key={flow.id}
                  className="group flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0 hover:bg-secondary/40"
                  style={{ animationDelay: `${index * 30}ms` }}
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-secondary">
                    <Workflow className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/flow/${flow.id}`}
                      className="block truncate text-[13px] font-medium text-foreground hover:text-primary"
                    >
                      {flow.name}
                    </Link>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {new Date(flow.updated_at).toLocaleString("ru-RU")}
                      {flow.is_active ? (
                        <span className="ml-2 inline-flex items-center gap-1 text-primary">
                          <span className="h-1.5 w-1.5 rounded-full bg-current" />
                          active
                        </span>
                      ) : null}
                    </p>
                  </div>
                  <Button asChild variant="outline" size="sm" className="h-7 opacity-0 group-hover:opacity-100">
                    <Link href={`/flow/${flow.id}`}>Открыть</Link>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 opacity-0 group-hover:opacity-100"
                    onClick={() => deleteFlow(flow.id)}
                    aria-label="Удалить"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>
      </PageCanvas>
    </AppShell>
  );
}

export default function HomePage() {
  return <DashboardContent />;
}
