"use client";

import {
  Copy,
  FlaskConical,
  Settings2,
  Trash2,
  ArrowRightLeft,
  Play,
} from "lucide-react";

import { cn } from "@/lib/utils";

export type FlowContextMenuState = {
  x: number;
  y: number;
  nodeId: string;
};

type FlowContextMenuProps = {
  menu: FlowContextMenuState;
  nodeTitle?: string;
  onClose: () => void;
  onOpenSettings: (nodeId: string) => void;
  onDuplicate: (nodeId: string) => void;
  onDelete: (nodeId: string) => void;
  onCopyId: (nodeId: string) => void;
  onTransferData: (nodeId: string) => void;
  onTestNode?: (nodeId: string) => void;
  onRunFromHere?: (nodeId: string) => void;
};

export function FlowContextMenu({
  menu,
  nodeTitle,
  onClose,
  onOpenSettings,
  onDuplicate,
  onDelete,
  onCopyId,
  onTransferData,
  onTestNode,
  onRunFromHere,
}: FlowContextMenuProps) {
  const groups: Array<
    Array<{
      label: string;
      hint?: string;
      icon: typeof Settings2;
      danger?: boolean;
      onClick: () => void;
      hidden?: boolean;
    }>
  > = [
    [
      {
        label: "Настроить",
        hint: "Enter",
        icon: Settings2,
        onClick: () => onOpenSettings(menu.nodeId),
      },
      {
        label: "Проверить ноду",
        icon: FlaskConical,
        onClick: () => onTestNode?.(menu.nodeId),
        hidden: !onTestNode,
      },
      {
        label: "Запустить сценарий",
        icon: Play,
        onClick: () => onRunFromHere?.(menu.nodeId),
        hidden: !onRunFromHere,
      },
    ],
    [
      {
        label: "Передать данные",
        icon: ArrowRightLeft,
        onClick: () => onTransferData(menu.nodeId),
      },
      {
        label: "Скопировать ID",
        icon: Copy,
        onClick: () => onCopyId(menu.nodeId),
      },
      {
        label: "Дублировать",
        hint: "⌘D",
        icon: Copy,
        onClick: () => onDuplicate(menu.nodeId),
      },
    ],
    [
      {
        label: "Удалить",
        hint: "⌫",
        icon: Trash2,
        danger: true,
        onClick: () => onDelete(menu.nodeId),
      },
    ],
  ];

  const left = Math.min(menu.x, typeof window !== "undefined" ? window.innerWidth - 240 : menu.x);
  const top = Math.min(menu.y, typeof window !== "undefined" ? window.innerHeight - 320 : menu.y);

  return (
    <>
      <button
        className="fixed inset-0 z-40 cursor-default bg-black/20"
        aria-label="Закрыть меню"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        className="fixed z-50 min-w-[220px] overflow-hidden rounded-lg border border-border bg-panel py-1 shadow-xl"
        style={{ left, top }}
        role="menu"
      >
        {nodeTitle ? (
          <div className="border-b border-border/70 px-3 py-2">
            <p className="truncate text-[11px] font-medium text-foreground">{nodeTitle}</p>
            <p className="truncate font-mono text-[10px] text-muted-foreground">{menu.nodeId}</p>
          </div>
        ) : null}
        {groups.map((group, gi) => (
          <div key={gi} className={cn(gi > 0 && "border-t border-border/60 pt-1 mt-1")}>
            {group
              .filter((item) => !item.hidden)
              .map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  className={cn(
                    "flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] transition hover:bg-accent",
                    item.danger ? "text-destructive hover:bg-destructive/10" : "text-foreground",
                  )}
                  onClick={() => {
                    item.onClick();
                    onClose();
                  }}
                >
                  <item.icon className="h-3.5 w-3.5 shrink-0 opacity-70" />
                  <span className="flex-1">{item.label}</span>
                  {item.hint ? (
                    <span className="text-[10px] text-muted-foreground">{item.hint}</span>
                  ) : null}
                </button>
              ))}
          </div>
        ))}
      </div>
    </>
  );
}
