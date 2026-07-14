"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { KeyRound } from "lucide-react";

import { useFlowRuntime } from "@/components/flow/flow-runtime-context";
import { NodeIconBadge, NodeStatusGlyph } from "@/lib/node-icons";
import { categoryColor, isBranchingNode, nodeCategory, nodeLabel } from "@/lib/nodes";
import { cn } from "@/lib/utils";

export type FlowNodeData = {
  label?: string;
  type: string;
  data: Record<string, unknown>;
  running?: boolean;
  execStatus?: "idle" | "running" | "done" | "error";
};

function parseCases(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String).filter((item) => item.trim());
  if (typeof raw === "string") {
    return raw
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return ["case_0"];
}

const OPERATOR_RU: Record<string, string> = {
  eq: "равно",
  neq: "не равно",
  gt: "больше",
  gte: "≥",
  lt: "меньше",
  lte: "≤",
  contains: "содержит",
  not_contains: "не содержит",
  empty: "пусто",
  not_empty: "заполнено",
  truthy: "да",
  falsy: "нет",
  starts_with: "начинается с",
  ends_with: "заканчивается на",
  regex: "regex",
};

const UNARY_OPS = new Set(["empty", "not_empty", "truthy", "falsy"]);

// Короткое имя subject-шаблона для превью: "{{ node_3.response.valid }}" → "valid".
function shortSubject(raw: unknown): string {
  const text = String(raw ?? "").trim();
  const m = text.match(/\{\{\s*([^}]+?)\s*\}\}/);
  const path = (m ? m[1] : text).trim();
  if (!path) return "…";
  const parts = path.split(".");
  return parts[parts.length - 1] || path;
}

type IfConditionShape = { subject?: unknown; operator?: unknown; value?: unknown };

function nodeSubtitle(type: string, data: Record<string, unknown> | undefined): string {
  if (!data) return nodeCategory(type);
  if (type === "api_call") {
    const endpoint = String(data.endpoint_id || "").trim();
    if (endpoint) return endpoint;
  }
  if (type === "http_request") {
    const method = String(data.method || "GET").toUpperCase();
    const url = String(data.url || "").trim();
    if (url) return `${method} ${url}`;
    return method;
  }
  if (type === "delay") {
    const seconds = Number(data.seconds ?? 0);
    if (Number.isFinite(seconds) && seconds > 0) {
      return seconds >= 1 ? `${seconds} с` : `${Math.round(seconds * 1000)} мс`;
    }
  }
  if (type === "filter") {
    const field = String(data.field || data.source || "").trim();
    const op = String(data.operator || "").trim();
    const value = String(data.value ?? "").trim();
    if (field) {
      const opLabel = OPERATOR_RU[op] ?? op;
      if (UNARY_OPS.has(op)) return `${shortSubject(field)} ${opLabel}`;
      return `${shortSubject(field)} ${opLabel}${value ? ` ${value}` : ""}`;
    }
  }
  return nodeCategory(type);
}

function filterPreviewText(data: Record<string, unknown> | undefined): string | null {
  if (!data) return null;
  const field = String(data.field || data.source || "").trim();
  if (!field) return null;
  const op = String(data.operator || "truthy");
  const opLabel = OPERATOR_RU[op] ?? op;
  if (UNARY_OPS.has(op)) return `оставить где ${shortSubject(field)} ${opLabel}`;
  const value = String(data.value ?? "…");
  return `оставить где ${shortSubject(field)} ${opLabel} ${value}`;
}

function ifPreviewText(data: Record<string, unknown> | undefined): string | null {
  if (!data) return null;
  const conditions = data.conditions;
  if (Array.isArray(conditions) && conditions.length) {
    const parts = conditions.map((c) => {
      const cond = c as IfConditionShape;
      const op = String(cond.operator ?? "truthy");
      const subj = shortSubject(cond.subject);
      if (UNARY_OPS.has(op)) return `${subj} ${OPERATOR_RU[op] ?? op}`;
      return `${subj} ${OPERATOR_RU[op] ?? op} ${String(cond.value ?? "…")}`;
    });
    const join = data.match === "any" ? " ИЛИ " : " И ";
    return parts.join(join);
  }
  // legacy
  const op = String(data.operator ?? "eq");
  const left = shortSubject(data.left);
  if (UNARY_OPS.has(op)) return `${left} ${OPERATOR_RU[op] ?? op}`;
  return `${left} ${OPERATOR_RU[op] ?? op} ${String(data.right ?? "…")}`;
}

const handleClass =
  "!h-2.5 !w-2.5 !border-2 !border-card !bg-muted-foreground transition hover:!scale-125 hover:!bg-primary";

export function BaseFlowNode({ data, selected }: NodeProps & { data: FlowNodeData }) {
  const { lztAccounts, loopEnabled } = useFlowRuntime();
  const isTrigger = data.type.includes("trigger");
  const isStart = data.type === "flow_start";
  const isEnd = data.type === "flow_end";
  const isFilter = data.type === "filter";
  const isDelay = data.type === "delay";
  const isMarker = isStart || isEnd;
  const isBranching = isBranchingNode(data.type);
  const category = nodeCategory(data.type);
  const accent = isFilter ? "#f97316" : categoryColor(category);
  const cases = parseCases(data.data?.cases);
  const customTitle = String(data.data?.title || data.label || "").trim();
  const title = customTitle || nodeLabel(data.type);
  const note = String(data.data?.note || "").trim();

  const ifPreview = data.type === "if_condition" ? ifPreviewText(data.data) : null;
  const filterPreview = isFilter ? filterPreviewText(data.data) : null;

  const primaryAccount = lztAccounts[0] ?? null;
  const tokenConnected = lztAccounts.length > 0;
  const tokenUsername = primaryAccount?.nickname?.trim() || null;

  const execStatus = data.execStatus ?? (data.running ? "running" : "idle");
  const isExecRunning = execStatus === "running";
  const isExecDone = execStatus === "done";
  const isExecError = execStatus === "error";

  return (
    <div
      className={cn(
        "relative min-w-[168px] max-w-[240px] overflow-visible border bg-card transition-all duration-200",
        isMarker ? "min-w-[140px] rounded-full" : "rounded-md",
        isFilter && "min-w-[188px]",
        selected && !isExecRunning
          ? "node-selected border-primary shadow-[0_0_0_2px_hsl(var(--primary)/0.35),0_8px_24px_hsl(var(--primary)/0.12)]"
          : "border-border/80",
        isStart && !isExecRunning && !isExecDone && !selected
          ? tokenConnected
            ? "border-emerald-500/55 bg-emerald-500/[0.07]"
            : "border-amber-500/45 bg-amber-500/[0.06]"
          : "",
        isEnd && !isExecRunning && !isExecDone && !selected
          ? loopEnabled
            ? "border-border/50 bg-muted/30 opacity-60"
            : "border-slate-500/50 bg-slate-500/5"
          : "",
        isFilter && !isExecRunning && !selected && "border-orange-500/45 bg-orange-500/[0.06]",
        isDelay && !isExecRunning && !selected && "border-sky-500/40 bg-sky-500/[0.05]",
        isExecRunning && "node-exec-running z-10",
        isExecDone && !selected && "node-exec-done",
        isExecError && "node-exec-error",
      )}
    >
      {selected && !isExecRunning ? <span className="node-selected-ring" aria-hidden /> : null}
      {isExecRunning ? <span className="node-exec-ring" aria-hidden /> : null}
      {!isMarker ? <div className="flex h-0.5 w-full rounded-t-md" style={{ backgroundColor: accent }} /> : null}
      {!isTrigger && !isStart ? (
        <Handle type="target" position={Position.Left} className={handleClass} />
      ) : null}

      <div className={cn("px-3 py-2", isMarker && "px-4 py-2.5 text-center")}>
        <div className={cn("flex items-center gap-2", isMarker && "justify-center")}>
          <NodeIconBadge type={data.type} size={isMarker ? "sm" : "md"} />
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                "truncate text-[12px] font-medium leading-tight text-foreground",
                isMarker && "text-[13px] font-semibold tracking-wide",
                isStart && "text-emerald-700 dark:text-emerald-400",
                isEnd && "text-slate-700 dark:text-slate-300",
                isFilter && "text-orange-700 dark:text-orange-300",
              )}
            >
              {title}
            </p>
            {!isMarker ? (
              <p className="truncate text-[10px] text-muted-foreground">
                {isExecRunning
                  ? "выполняется…"
                  : isExecDone
                    ? "готово"
                    : isExecError
                      ? "ошибка"
                      : nodeSubtitle(data.type, data.data)}
              </p>
            ) : null}
          </div>
          {data.type === "webhook_trigger" ? (
            <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-medium text-amber-600 dark:text-amber-400">
              Webhook
            </span>
          ) : null}
          <NodeStatusGlyph status={execStatus} />
        </div>
        {isStart ? (
          <div
            className={cn(
              "mt-1.5 inline-flex max-w-full items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium",
              tokenConnected
                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                : "bg-amber-500/15 text-amber-700 dark:text-amber-300",
            )}
            title={
              tokenConnected
                ? `LZT-аккаунт: ${tokenUsername || "подключён"}`
                : "Добавьте LZT-токен в Credentials"
            }
          >
            <KeyRound className="h-2.5 w-2.5 shrink-0" />
            <span className="truncate">
              {tokenConnected
                ? `Token · ${tokenUsername || "connected"}`
                : "Нет токена"}
            </span>
          </div>
        ) : null}
        {note && isMarker && !isStart ? (
          <p className="mt-1 truncate text-[10px] text-muted-foreground">{note}</p>
        ) : null}
        {isEnd && loopEnabled ? (
          <p className="mt-1 text-[9px] text-muted-foreground">не нужен в Loop</p>
        ) : null}
        {ifPreview ? (
          <p className="mt-1.5 truncate font-mono text-[10px] text-muted-foreground">{ifPreview}</p>
        ) : null}
        {filterPreview ? (
          <p className="mt-1.5 truncate text-[10px] font-medium text-orange-700/90 dark:text-orange-300/90">
            {filterPreview}
          </p>
        ) : null}
        {data.type === "merge" ? (
          <p className="mt-1.5 text-[10px] text-muted-foreground">
            mode: {String(data.data?.mode || "all")}
          </p>
        ) : null}
      </div>

      {data.type === "if_condition" ? (
        <div className="relative border-t border-border/70 px-3 py-2.5 text-[10px] text-muted-foreground">
          <div className="mb-3 flex justify-between pr-1">
            <span className="text-emerald-600 dark:text-emerald-400">Да</span>
            <span className="text-rose-600 dark:text-rose-400">Нет</span>
          </div>
          <Handle type="source" id="true" position={Position.Right} className="!bg-emerald-500" style={{ top: "52%" }} />
          <Handle type="source" id="false" position={Position.Right} className="!bg-rose-500" style={{ top: "78%" }} />
          <Handle type="source" id="error" position={Position.Bottom} className="!bg-rose-500" style={{ left: "78%" }} />
        </div>
      ) : null}

      {data.type === "switch" ? (
        <div className="relative border-t border-border/70 px-3 py-2 text-[10px] text-muted-foreground">
          <div className="space-y-1 pb-4 pr-2">
            {cases.map((caseValue, index) => (
              <div key={`${caseValue}-${index}`} className="flex justify-between gap-2">
                <span className="truncate">{caseValue}</span>
                <span className="shrink-0 text-[9px] opacity-50">case_{index}</span>
              </div>
            ))}
            <div className="flex justify-between">
              <span>default</span>
            </div>
          </div>
          {cases.map((_, index) => (
            <Handle
              key={`case_${index}`}
              type="source"
              id={`case_${index}`}
              position={Position.Right}
              className="!bg-primary"
              style={{ top: `${28 + index * 18}%` }}
            />
          ))}
          <Handle
            type="source"
            id="default"
            position={Position.Right}
            className="!bg-muted-foreground"
            style={{ top: `${28 + cases.length * 18}%` }}
          />
          <Handle type="source" id="error" position={Position.Bottom} className="!bg-rose-500" style={{ left: "78%" }} />
        </div>
      ) : null}

      {!isBranching && !isEnd ? (
        <>
          <Handle type="source" position={Position.Right} id="default" className={handleClass} />
          {!isStart ? (
            <Handle type="source" id="error" position={Position.Bottom} className="!bg-rose-500" style={{ left: "78%" }} />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export const flowNodeTypes = {
  flowNode: BaseFlowNode,
};
