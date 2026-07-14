"use client";

import { Copy, FlaskConical, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { DynamicNodeForm } from "@/components/integrations/dynamic-node-form";
import { KeyValueEditor, StringListEditor, ValueInput } from "@/components/flow/value-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  api,
  type CatalogEndpoint,
  type FlowFileMeta,
  type FlowNode,
  type LztAccount,
  type NodeExecutionSettings,
} from "@/lib/api";
import {
  buildSubjectGroups,
  IF_OPERATORS,
  IF_PRESETS,
  type IfCondition,
  isUnaryOperator,
  normalizeIfData,
} from "@/lib/if-builder";
import {
  categoryColor,
  isCustomNodeType,
  nodeCategory,
  nodeExpectedInputs,
  nodeLabel,
} from "@/lib/nodes";

type NodeConfigDrawerProps = {
  node: FlowNode | null;
  webhookUrl?: string;
  flowId?: string;
  graphNodes?: FlowNode[];
  pinData?: Record<string, unknown>;
  onChange: (nodeId: string, data: Record<string, unknown>) => void;
  onClose: () => void;
  onExecutionChange?: (nodeId: string, execution: NodeExecutionSettings) => void;
  onTestNode?: (nodeId: string) => Promise<void>;
  onPinUpdate?: (pinData: Record<string, unknown>) => void;
  onInsertTemplate?: (nodeId: string, field: string, template: string) => void;
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] font-medium text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring";

const PARSE_PRESETS = [
  { value: "url", label: "URL из текста" },
  { value: "email", label: "Email из текста" },
  { value: "json", label: "Поле из JSON" },
  { value: "regex", label: "Свой шаблон (regex)" },
  { value: "split", label: "Разделить строку" },
];

function ApiCallFields({
  data,
  update,
  onChangeBatch,
  graphNodes,
}: {
  data: Record<string, unknown>;
  update: (key: string, value: unknown) => void;
  onChangeBatch: (patch: Record<string, unknown>) => void;
  graphNodes: FlowNode[];
}) {
  const [accounts, setAccounts] = useState<LztAccount[]>([]);
  const [tags, setTags] = useState<Array<{ tag: string; count: number }>>([]);
  const [endpoints, setEndpoints] = useState<CatalogEndpoint[]>([]);
  const [tag, setTag] = useState("");
  const [q, setQ] = useState("");
  const [endpoint, setEndpoint] = useState<CatalogEndpoint | null>(null);

  useEffect(() => {
    api.listLztAccounts().then(setAccounts).catch(() => setAccounts([]));
    api.listCatalogTags().then(setTags).catch(() => setTags([]));
  }, []);

  useEffect(() => {
    api.listCatalog({ q: q || undefined, tag: tag || undefined }).then(setEndpoints).catch(() => setEndpoints([]));
  }, [q, tag]);

  useEffect(() => {
    const id = String(data.endpoint_id || "");
    if (!id) {
      setEndpoint(null);
      return;
    }
    api.getCatalogEndpoint(id).then(setEndpoint).catch(() => setEndpoint(null));
  }, [data.endpoint_id]);

  const params = (data.params as Record<string, unknown>) || {};

  function setParam(name: string, value: string) {
    onChangeBatch({ params: { ...params, [name]: value } });
  }

  const fields = useMemo(() => {
    if (!endpoint) return [];
    return [...endpoint.pathParams, ...endpoint.queryParams, ...endpoint.bodyParams];
  }, [endpoint]);

  return (
    <>
      <Field label="LZT аккаунт">
        <select
          className={selectClass}
          value={String(data.account_id ?? "")}
          onChange={(e) => update("account_id", e.target.value)}
        >
          <option value="">— выберите —</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.nickname || "без ника"} · {a.token_preview}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Тег каталога">
        <select className={selectClass} value={tag} onChange={(e) => setTag(e.target.value)}>
          <option value="">Все</option>
          {tags.map((t) => (
            <option key={t.tag} value={t.tag}>
              {t.tag} ({t.count})
            </option>
          ))}
        </select>
      </Field>

      <Field label="Поиск endpoint">
        <Input className="h-9 text-[13px]" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Steam, FastBuy…" />
      </Field>

      <Field label="Endpoint">
        <select
          className={selectClass}
          value={String(data.endpoint_id ?? "")}
          onChange={(e) =>
            onChangeBatch({
              endpoint_id: e.target.value,
              title: endpoints.find((x) => x.id === e.target.value)?.summary || data.title,
            })
          }
        >
          <option value="">— выберите —</option>
          {endpoints.map((ep) => (
            <option key={ep.id} value={ep.id}>
              {ep.method} {ep.summary} ({ep.id})
            </option>
          ))}
        </select>
      </Field>

      {endpoint ? (
        <p className="rounded-md bg-secondary/50 px-3 py-2 font-mono text-[11px] text-muted-foreground">
          {endpoint.method} {endpoint.pathTemplate}
        </p>
      ) : null}

      {fields.map((field) => (
        <ValueInput
          key={field.name}
          label={`${field.name}${field.required ? " *" : ""} (${field.in})`}
          value={String(params[field.name] ?? "")}
          onChange={(v) => setParam(field.name, v)}
          graphNodes={graphNodes}
          placeholder={field.description || "значение"}
        />
      ))}
    </>
  );
}

function FileSourceFields({
  data,
  update,
  onChangeBatch,
  flowId,
  nodeId,
}: {
  data: Record<string, unknown>;
  update: (key: string, value: unknown) => void;
  onChangeBatch: (patch: Record<string, unknown>) => void;
  flowId?: string;
  nodeId: string;
}) {
  const [files, setFiles] = useState<FlowFileMeta[]>([]);
  const [busy, setBusy] = useState(false);
  const fileIds = Array.isArray(data.file_ids) ? (data.file_ids as string[]) : [];

  async function reload() {
    if (!flowId) return;
    const rows = await api.listFlowFiles(flowId, nodeId);
    setFiles(rows);
    onChangeBatch({ file_ids: rows.map((r) => r.id) });
  }

  useEffect(() => {
    reload().catch(() => setFiles([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowId, nodeId]);

  return (
    <>
      <Field label="Итерация по строкам">
        <div className="flex items-center gap-2">
          <Switch
            checked={Boolean(data.iterate_lines ?? true)}
            onCheckedChange={(v) => update("iterate_lines", v)}
          />
          <span className="text-[12px] text-muted-foreground">login:pass[:email]</span>
        </div>
      </Field>

      {Boolean(data.iterate_lines ?? true) ? (
        <>
          <Field label="Формат">
            <select
              className="h-9 w-full rounded-md border border-border bg-background px-2 text-[12px]"
              value={String(data.format ?? "auto")}
              onChange={(e) => update("format", e.target.value)}
            >
              <option value="auto">Авто</option>
              <option value="lines">Строки (login:pass[:email])</option>
              <option value="csv">CSV с заголовком</option>
            </select>
          </Field>
          <p className="-mt-1 text-[11px] text-muted-foreground">
            CSV: колонки login, password, email, proxy (или их алиасы). Прокси из
            строки применяется к API/HTTP-нодам этой итерации.
          </p>

          <Field label="Пропускать дубли">
            <div className="flex items-center gap-2">
              <Switch
                checked={Boolean(data.dedup)}
                onCheckedChange={(v) => update("dedup", v)}
              />
              <span className="text-[12px] text-muted-foreground">
                по строке / login:password
              </span>
            </div>
          </Field>

          <Field label="Параллельность">
            <Input
              className="h-9"
              type="number"
              min={1}
              max={32}
              placeholder="8 (по умолчанию)"
              value={data.max_parallel ? String(data.max_parallel) : ""}
              onChange={(e) =>
                update("max_parallel", e.target.value ? Number(e.target.value) : undefined)
              }
            />
          </Field>
        </>
      ) : null}

      <Field label="Загрузить файл">
        <Input
          type="file"
          className="h-9 text-[12px]"
          disabled={!flowId || busy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file || !flowId) return;
            setBusy(true);
            try {
              await api.uploadFlowFile(flowId, file, nodeId);
              await reload();
            } finally {
              setBusy(false);
              e.target.value = "";
            }
          }}
        />
      </Field>

      <div className="space-y-1">
        {files.map((f) => (
          <div key={f.id} className="flex items-center justify-between rounded-md border border-border px-2 py-1.5 text-[12px]">
            <span className="truncate">
              {f.filename} · {(f.size / 1024).toFixed(1)} KB
            </span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-[11px] text-destructive"
              onClick={async () => {
                if (!flowId) return;
                await api.deleteFlowFile(flowId, f.id);
                await reload();
              }}
            >
              удалить
            </Button>
          </div>
        ))}
        {!files.length ? (
          <p className="text-[11px] text-muted-foreground">
            Перетащите файл на canvas или загрузите здесь. ID в ноде: {fileIds.length}
          </p>
        ) : null}
      </div>
    </>
  );
}

function IfConditionFields({
  data,
  onChangeBatch,
  graphNodes,
}: {
  data: Record<string, unknown>;
  onChangeBatch: (patch: Record<string, unknown>) => void;
  graphNodes: FlowNode[];
}) {
  const groups = useMemo(() => buildSubjectGroups(graphNodes), [graphNodes]);
  const { conditions, match } = useMemo(() => normalizeIfData(data), [data]);

  const flatOptions = useMemo(
    () => groups.flatMap((g) => g.options.map((o) => ({ ...o, group: g.title }))),
    [groups],
  );

  function commit(nextConditions: IfCondition[], nextMatch: "all" | "any") {
    const cleaned = nextConditions.map((c) => ({
      subject: c.subject,
      operator: c.operator,
      ...(isUnaryOperator(c.operator) ? {} : { value: c.value ?? "" }),
    }));
    onChangeBatch({ conditions: cleaned, match: nextMatch, left: undefined, right: undefined });
  }

  function updateCondition(index: number, patch: Partial<IfCondition>) {
    const next = conditions.map((c, i) => (i === index ? { ...c, ...patch } : c));
    commit(next, match);
  }

  function addCondition() {
    commit([...conditions, { subject: "", operator: "truthy" }], match);
  }

  function removeCondition(index: number) {
    const next = conditions.filter((_, i) => i !== index);
    commit(next.length ? next : [{ subject: "", operator: "truthy" }], match);
  }

  function applyPreset(presetId: string) {
    const preset = IF_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    const built = preset.build(graphNodes);
    if (!built) {
      addCondition();
      return;
    }
    commit(built.conditions, built.match);
  }

  return (
    <div className="space-y-3">
      <div>
        <Label className="mb-1.5 block text-[11px] font-medium text-muted-foreground">
          Быстрые условия
        </Label>
        <div className="flex flex-wrap gap-1.5">
          {IF_PRESETS.map((preset) => (
            <Button
              key={preset.id}
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              onClick={() => applyPreset(preset.id)}
            >
              {preset.label}
            </Button>
          ))}
        </div>
      </div>

      {conditions.length > 1 ? (
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">Срабатывает если</span>
          <div className="flex overflow-hidden rounded-md border border-border">
            <button
              type="button"
              className={`px-2.5 py-1 text-[11px] ${match === "all" ? "bg-primary text-primary-foreground" : "bg-background"}`}
              onClick={() => commit(conditions, "all")}
            >
              все условия (И)
            </button>
            <button
              type="button"
              className={`px-2.5 py-1 text-[11px] ${match === "any" ? "bg-primary text-primary-foreground" : "bg-background"}`}
              onClick={() => commit(conditions, "any")}
            >
              любое (ИЛИ)
            </button>
          </div>
        </div>
      ) : null}

      <div className="space-y-2.5">
        {conditions.map((cond, index) => (
          <div key={index} className="space-y-2 rounded-md border border-border bg-background/50 p-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Условие {index + 1}
              </span>
              {conditions.length > 1 ? (
                <button
                  type="button"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => removeCondition(index)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>

            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Что проверяем</Label>
              <select
                className={selectClass}
                value={cond.subject}
                onChange={(e) => updateCondition(index, { subject: e.target.value })}
              >
                <option value="">— выберите —</option>
                {groups.map((g) => (
                  <optgroup key={g.nodeId} label={g.title}>
                    {g.options.map((o) => (
                      <option key={o.template} value={o.template}>
                        {o.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {cond.subject && !flatOptions.some((o) => o.template === cond.subject) ? (
                <p className="truncate text-[10px] text-muted-foreground">
                  своё поле (из старой версии)
                </p>
              ) : null}
            </div>

            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Условие</Label>
              <select
                className={selectClass}
                value={cond.operator}
                onChange={(e) => updateCondition(index, { operator: e.target.value })}
              >
                {IF_OPERATORS.map((op) => (
                  <option key={op.value} value={op.value}>
                    {op.label}
                  </option>
                ))}
              </select>
            </div>

            {!isUnaryOperator(cond.operator) ? (
              <ValueInput
                label="Значение"
                value={cond.value ?? ""}
                onChange={(v) => updateCondition(index, { value: v })}
                graphNodes={graphNodes}
                placeholder="например 200"
              />
            ) : null}
          </div>
        ))}
      </div>

      <Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-[11px]" onClick={addCondition}>
        <Plus className="h-3.5 w-3.5" />
        Добавить условие
      </Button>
    </div>
  );
}

function HttpRequestFields({
  data,
  update,
  graphNodes,
}: {
  data: Record<string, unknown>;
  update: (key: string, value: unknown) => void;
  graphNodes: FlowNode[];
}) {
  const [advanced, setAdvanced] = useState(false);
  const method = String(data.method ?? "GET");
  const needsBody = !["GET", "HEAD"].includes(method);

  return (
    <>
      <Field label="Метод">
        <select
          className={selectClass}
          value={method}
          onChange={(e) => update("method", e.target.value)}
        >
          {["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </Field>
      <ValueInput
        label="URL"
        value={String(data.url ?? "")}
        onChange={(v) => update("url", v)}
        graphNodes={graphNodes}
        placeholder="https://…"
      />
      {needsBody ? (
        <ValueInput
          label="Тело запроса"
          value={String(data.body ?? "")}
          onChange={(v) => update("body", v)}
          graphNodes={graphNodes}
          placeholder="текст или из ноды"
        />
      ) : null}
      <Field label="Timeout (сек)">
        <Input
          className="h-9"
          type="number"
          min={1}
          value={String(data.timeout ?? 30)}
          onChange={(e) => update("timeout", Number(e.target.value) || 30)}
        />
      </Field>
      <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Switch checked={advanced} onCheckedChange={setAdvanced} />
        Расширенный режим
      </label>
      {advanced ? (
        <>
          <Field label="Заголовки">
            <KeyValueEditor
              value={
                typeof data.headers === "object" && data.headers
                  ? (data.headers as Record<string, unknown>)
                  : String(data.headers ?? "")
              }
              onChange={(obj) => update("headers", obj)}
              graphNodes={graphNodes}
              keyPlaceholder="Header"
            />
          </Field>
          {needsBody ? (
            <Field label="Body (JSON)">
              <Textarea
                className="min-h-[70px] font-mono text-[12px]"
                value={String(data.body ?? "")}
                onChange={(e) => update("body", e.target.value)}
                placeholder='{"key": "value"}'
              />
            </Field>
          ) : null}
        </>
      ) : null}
    </>
  );
}

function ParseMessageFields({
  data,
  update,
  graphNodes,
}: {
  data: Record<string, unknown>;
  update: (key: string, value: unknown) => void;
  graphNodes: FlowNode[];
}) {
  const preset = String(data.preset ?? "url");
  const needsPattern = preset === "regex" || preset === "json" || preset === "split" || preset === "custom";

  return (
    <>
      <ValueInput
        label="Источник"
        value={String(data.source ?? "")}
        onChange={(v) => update("source", v)}
        graphNodes={graphNodes}
        placeholder="текст или из ноды"
      />
      <Field label="Что извлечь">
        <select
          className={selectClass}
          value={preset}
          onChange={(e) => update("preset", e.target.value)}
        >
          {PARSE_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </Field>
      {needsPattern ? (
        <details open={preset === "regex"}>
          <summary className="cursor-pointer text-[11px] text-muted-foreground">
            Расширенный режим (pattern / путь)
          </summary>
          <Input
            className="mt-1.5 h-9 font-mono text-[12px]"
            value={String(data.pattern ?? "")}
            onChange={(e) => update("pattern", e.target.value)}
            placeholder={preset === "json" ? "items.0.price" : "pattern"}
          />
        </details>
      ) : null}
      <Field label="Сохранить как">
        <Input
          className="h-9 text-[13px]"
          value={String(data.output_key ?? "value")}
          onChange={(e) => update("output_key", e.target.value)}
        />
      </Field>
    </>
  );
}

function AccountStatusFields({
  data,
  update,
}: {
  data: Record<string, unknown>;
  update: (key: string, value: unknown) => void;
}) {
  const [accounts, setAccounts] = useState<LztAccount[]>([]);

  useEffect(() => {
    api.listLztAccounts().then(setAccounts).catch(() => setAccounts([]));
  }, []);

  return (
    <>
      <Field label="LZT аккаунт">
        <select
          className="h-9 w-full rounded-md border border-border bg-background px-2 text-[12px]"
          value={String(data.account_id ?? "")}
          onChange={(e) => update("account_id", e.target.value)}
        >
          <option value="">— выберите —</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.nickname || "без ника"} · {a.token_preview}
            </option>
          ))}
        </select>
      </Field>
      <p className="-mt-1 text-[11px] text-muted-foreground">
        Проверяет токен через LZT /me. Результат: valid, nickname, balance.
      </p>
    </>
  );
}

export function NodeConfigDrawer({
  node,
  webhookUrl,
  flowId,
  graphNodes = [],
  pinData = {},
  onChange,
  onClose,
  onExecutionChange,
  onTestNode,
  onPinUpdate,
}: NodeConfigDrawerProps) {
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setTestMsg("");
    setCopied(false);
  }, [node?.id]);

  if (!node) return null;

  const nodeType = node.type;
  const data = node.data ?? {};
  const accent = categoryColor(nodeCategory(nodeType));
  const execution: NodeExecutionSettings =
    (data._execution as NodeExecutionSettings | undefined) ??
    node.execution ??
    {};
  const custom = isCustomNodeType(nodeType);
  const expectedInputs = nodeExpectedInputs(nodeType) ?? [];

  function update(key: string, value: unknown) {
    onChange(node!.id, { ...data, [key]: value });
  }

  function onChangeBatch(patch: Record<string, unknown>) {
    onChange(node!.id, { ...data, ...patch });
  }

  function updateExecution(patch: Partial<NodeExecutionSettings>) {
    const next = { ...execution, ...patch };
    onChange(node!.id, { ...data, _execution: next });
    onExecutionChange?.(node!.id, next);
  }

  async function handleTest() {
    if (!flowId || !node) return;
    setTesting(true);
    setTestMsg("");
    try {
      if (onTestNode) {
        await onTestNode(node.id);
        setTestMsg("OK");
      } else {
        const result = await api.testNode(flowId, {
          node_id: node.id,
          node_type: nodeType,
          node_data: data,
          mock_context: pinData,
          pin: true,
        });
        if (result.status === "success") {
          setTestMsg("OK · pin сохранён");
          if (result.result) {
            const nextPins = { ...pinData, [node.id]: result.result };
            await api.putPins(flowId, nextPins);
            onPinUpdate?.(nextPins);
          }
        } else {
          setTestMsg(result.error || "Ошибка");
        }
      }
    } catch (err) {
      setTestMsg(err instanceof Error ? err.message : "Ошибка теста");
    } finally {
      setTesting(false);
    }
  }

  async function copyWebhook() {
    if (!webhookUrl) return;
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <aside className="panel-slide-right flex h-full w-[340px] shrink-0 flex-col border-l border-border/80 bg-panel">
      <div className="flex items-start justify-between gap-2 border-b border-border/80 px-4 py-3">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ background: accent }} />
            <p className="truncate text-sm font-medium">{nodeLabel(nodeType)}</p>
          </div>
          <p className="font-mono text-[10px] text-muted-foreground">{node.id}</p>
        </div>
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1 px-4 py-3">
        <div className="space-y-3.5">
          <Field label="Заголовок">
            <Input
              className="h-9 text-[13px]"
              value={String(data.title ?? "")}
              onChange={(e) => update("title", e.target.value)}
            />
          </Field>

          {nodeType === "webhook_trigger" ? (
            <div className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
              <Label className="text-[11px] font-medium text-muted-foreground">Webhook URL</Label>
              {webhookUrl ? (
                <>
                  <p className="break-all font-mono text-[11px] text-foreground">{webhookUrl}</p>
                  <Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-[11px]" onClick={copyWebhook}>
                    <Copy className="h-3 w-3" />
                    {copied ? "Скопировано" : "Копировать"}
                  </Button>
                </>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  Сохраните flow — URL появится после сохранения.
                </p>
              )}
            </div>
          ) : null}

          {custom ? (
            <DynamicNodeForm
              expectedInputs={expectedInputs}
              data={data}
              onChange={(key, value) => update(key, value)}
              graphNodes={graphNodes}
            />
          ) : null}

          {nodeType === "api_call" ? (
            <ApiCallFields
              data={data}
              update={update}
              onChangeBatch={onChangeBatch}
              graphNodes={graphNodes}
            />
          ) : null}

          {nodeType === "http_request" ? (
            <HttpRequestFields
              data={data}
              update={update}
              graphNodes={graphNodes}
            />
          ) : null}

          {nodeType === "set_variables" ? (
            <Field label="Переменные">
              <KeyValueEditor
                key={`kv-${node.id}`}
                value={
                  (data.assignments as Record<string, unknown> | string | undefined) ??
                  (data.variables as Record<string, unknown> | string | undefined)
                }
                onChange={(obj) => update("assignments", obj)}
                graphNodes={graphNodes}
                keyPlaceholder="имя переменной"
              />
            </Field>
          ) : null}

          {nodeType === "parse_message" ? (
            <ParseMessageFields data={data} update={update} graphNodes={graphNodes} />
          ) : null}

          {nodeType === "pick_value" ? (
            <>
              <ValueInput
                label="Откуда взять"
                value={String(data.path ?? "")}
                onChange={(v) => update("path", v)}
                graphNodes={graphNodes}
                raw
                placeholder="выберите поле ноды"
              />
              <Field label="Сохранить как">
                <Input
                  className="h-9 text-[13px]"
                  value={String(data.output_key ?? "value")}
                  onChange={(e) => update("output_key", e.target.value)}
                  placeholder="value"
                />
              </Field>
            </>
          ) : null}

          {nodeType === "file_source" ? (
            <FileSourceFields
              data={data}
              update={update}
              onChangeBatch={onChangeBatch}
              flowId={flowId}
              nodeId={node.id}
            />
          ) : null}

          {nodeType === "delay" ? (
            <Field label="Секунды">
              <Input
                className="h-9"
                type="number"
                min={0}
                value={String(data.seconds ?? 5)}
                onChange={(e) => update("seconds", Number(e.target.value))}
              />
            </Field>
          ) : null}

          {nodeType === "if_condition" ? (
            <IfConditionFields
              data={data}
              onChangeBatch={onChangeBatch}
              graphNodes={graphNodes}
            />
          ) : null}

          {nodeType === "switch" ? (
            <>
              <ValueInput
                label="Значение"
                value={String(data.value ?? "")}
                onChange={(v) => update("value", v)}
                graphNodes={graphNodes}
                placeholder="что сравниваем"
              />
              <Field label="Варианты (cases)">
                <StringListEditor
                  key={`cases-${node.id}`}
                  value={data.cases as string[] | string | undefined}
                  onChange={(v) => update("cases", v)}
                  placeholder="значение case"
                />
              </Field>
            </>
          ) : null}

          {nodeType === "merge" ? (
            <Field label="Режим">
              <select
                className={selectClass}
                value={String(data.mode ?? "all")}
                onChange={(e) => update("mode", e.target.value)}
              >
                <option value="all">all</option>
                <option value="any">any</option>
              </select>
            </Field>
          ) : null}

          {nodeType === "execute_flow" ? (
            <>
              <Field label="Flow ID">
                <Input
                  className="h-9 text-[13px]"
                  value={String(data.flow_id ?? "")}
                  onChange={(e) => update("flow_id", e.target.value)}
                />
              </Field>
              <details>
                <summary className="cursor-pointer text-[11px] text-muted-foreground">
                  Расширенный режим (входной JSON)
                </summary>
                <Textarea
                  className="mt-1.5 min-h-[100px] font-mono text-[12px]"
                  value={String(data.input_context ?? "{}")}
                  onChange={(e) => update("input_context", e.target.value)}
                />
              </details>
            </>
          ) : null}

          {nodeType === "account_status" ? (
            <AccountStatusFields data={data} update={update} />
          ) : null}

          {nodeType === "filter" ? (
            <>
              <ValueInput
                label="Массив"
                value={String(data.source ?? "")}
                onChange={(v) => update("source", v)}
                graphNodes={graphNodes}
                placeholder="выберите поле с массивом"
              />
              <Field label="Поле элемента (опц.)">
                <Input
                  className="h-9 text-[13px]"
                  value={String(data.field ?? "")}
                  onChange={(e) => update("field", e.target.value)}
                  placeholder="status"
                />
              </Field>
              <Field label="Условие">
                <select
                  className={selectClass}
                  value={String(data.operator ?? "truthy")}
                  onChange={(e) => update("operator", e.target.value)}
                >
                  <option value="truthy">не пусто</option>
                  <option value="falsy">пусто</option>
                  <option value="eq">равно</option>
                  <option value="ne">не равно</option>
                  <option value="contains">содержит</option>
                  <option value="not_contains">не содержит</option>
                  <option value="gt">больше</option>
                  <option value="lt">меньше</option>
                  <option value="gte">≥</option>
                  <option value="lte">≤</option>
                </select>
              </Field>
              {!["truthy", "falsy"].includes(String(data.operator ?? "truthy")) ? (
                <ValueInput
                  label="Значение"
                  value={String(data.value ?? "")}
                  onChange={(v) => update("value", v)}
                  graphNodes={graphNodes}
                />
              ) : null}
              <Field label="Сохранить как">
                <Input
                  className="h-9 text-[13px]"
                  value={String(data.output_key ?? "filtered")}
                  onChange={(e) => update("output_key", e.target.value)}
                />
              </Field>
            </>
          ) : null}

          {nodeType === "aggregate" ? (
            <>
              <ValueInput
                label="Массив"
                value={String(data.source ?? "")}
                onChange={(v) => update("source", v)}
                graphNodes={graphNodes}
                placeholder="выберите поле с массивом"
              />
              <Field label="Операция">
                <select
                  className={selectClass}
                  value={String(data.operation ?? "count")}
                  onChange={(e) => update("operation", e.target.value)}
                >
                  <option value="count">посчитать</option>
                  <option value="unique">уникальные</option>
                  <option value="join">объединить</option>
                  <option value="sum">сумма</option>
                  <option value="avg">среднее</option>
                  <option value="min">минимум</option>
                  <option value="max">максимум</option>
                  <option value="first">первый</option>
                  <option value="last">последний</option>
                </select>
              </Field>
              <Field label="Поле элемента (опц.)">
                <Input
                  className="h-9 text-[13px]"
                  value={String(data.field ?? "")}
                  onChange={(e) => update("field", e.target.value)}
                  placeholder="price"
                />
              </Field>
              {String(data.operation) === "join" ? (
                <Field label="Разделитель">
                  <Input
                    className="h-9 text-[13px]"
                    value={String(data.separator ?? "\n")}
                    onChange={(e) => update("separator", e.target.value)}
                  />
                </Field>
              ) : null}
              <Field label="Сохранить как">
                <Input
                  className="h-9 text-[13px]"
                  value={String(data.output_key ?? "result")}
                  onChange={(e) => update("output_key", e.target.value)}
                />
              </Field>
            </>
          ) : null}

          {(nodeType === "flow_start" || nodeType === "flow_end") && (
            <Field label="Заметка">
              <Textarea
                className="min-h-[60px] text-[13px]"
                value={String(data.note ?? "")}
                onChange={(e) => update("note", e.target.value)}
              />
            </Field>
          )}

          <div className="space-y-2.5 border-t border-border/70 pt-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Выполнение
            </p>
            <Field label="Повторы при ошибке">
              <Input
                className="h-9"
                type="number"
                min={0}
                max={5}
                value={String(execution.retry_count ?? 0)}
                onChange={(e) => updateExecution({ retry_count: Math.min(5, Math.max(0, Number(e.target.value) || 0)) })}
              />
            </Field>
            <Field label="Продолжить при ошибке">
              <div className="flex items-center gap-2">
                <Switch
                  checked={Boolean(execution.continue_on_fail)}
                  onCheckedChange={(v) => updateExecution({ continue_on_fail: v })}
                />
                <span className="text-[12px] text-muted-foreground">continue on fail</span>
              </div>
            </Field>
          </div>

          {flowId && nodeType !== "flow_start" && nodeType !== "flow_end" ? (
            <div className="space-y-1.5 border-t border-border/70 pt-3">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 w-full gap-1.5 text-[12px]"
                disabled={testing}
                onClick={handleTest}
              >
                <FlaskConical className="h-3.5 w-3.5" />
                {testing ? "Проверка…" : "Проверить ноду"}
              </Button>
              {testMsg ? (
                <p className={`text-[11px] ${testMsg.startsWith("OK") ? "text-[hsl(var(--success))]" : "text-destructive"}`}>
                  {testMsg}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </ScrollArea>
    </aside>
  );
}
