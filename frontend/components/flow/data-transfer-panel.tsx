"use client";

import { ArrowRightLeft, X } from "lucide-react";
import { useMemo } from "react";

import { buildPaths } from "@/components/flow/field-picker";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { nodeLabel } from "@/lib/nodes";

type DataTransferPanelProps = {
  nodeId: string;
  nodeType: string;
  title?: string;
  pinPayload?: unknown;
  onClose: () => void;
};

function friendlyPath(path: string, nodeId: string): string {
  const prefix = `${nodeId}.`;
  const rest = path.startsWith(prefix) ? path.slice(prefix.length) : path;
  const map: Record<string, string> = {
    response: "Ответ (тело)",
    "response.items": "Список items",
    "response.valid": "Аккаунт валиден",
    "response.balance": "Баланс",
    "response.nickname": "Никнейм",
    "response.value": "Значение",
    "response.count": "Количество",
    status: "HTTP статус",
    login: "Логин",
    password: "Пароль",
    email: "Email",
    line: "Строка",
    logs: "Логи",
    value: "Значение",
  };
  return map[rest] || rest;
}

export function DataTransferPanel({
  nodeId,
  nodeType,
  title,
  pinPayload,
  onClose,
}: DataTransferPanelProps) {
  const paths = useMemo(() => {
    if (pinPayload != null && typeof pinPayload === "object") {
      return buildPaths(pinPayload, nodeId).slice(0, 80);
    }
    return [`${nodeId}.response`, `${nodeId}.status`, `${nodeId}.logs`];
  }, [nodeId, pinPayload]);

  const displayTitle = title?.trim() || nodeLabel(nodeType);

  return (
    <div className="absolute right-[360px] top-14 z-30 flex w-[300px] flex-col overflow-hidden rounded-lg border border-border bg-panel shadow-xl panel-slide-right max-[1100px]:right-4 max-[1100px]:top-auto max-[1100px]:bottom-48">
      <div className="flex items-center gap-2 border-b border-border/80 px-3 py-2.5">
        <ArrowRightLeft className="h-3.5 w-3.5 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-medium text-foreground">Доступные поля</p>
          <p className="truncate text-[10px] text-muted-foreground">{displayTitle}</p>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} aria-label="Закрыть">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      <p className="border-b border-border/60 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
        В другой ноде откройте параметр → «Из ноды» и выберите нужное поле из списка.
      </p>
      <ScrollArea className="max-h-[360px] flex-1">
        <div className="space-y-1 p-2">
          {paths.map((path) => (
            <div
              key={path}
              className="rounded-md border border-transparent px-2 py-1.5 text-[12px] text-foreground/90"
            >
              {friendlyPath(path, nodeId)}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
