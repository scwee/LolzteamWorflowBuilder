"use client";

import { ArrowRightLeft, Copy, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";

type SelectionToolbarProps = {
  count: number;
  onDuplicate: () => void;
  onDelete: () => void;
  onClear: () => void;
  onTransfer?: () => void;
};

export function SelectionToolbar({
  count,
  onDuplicate,
  onDelete,
  onClear,
  onTransfer,
}: SelectionToolbarProps) {
  if (count <= 0) return null;

  return (
    <div className="absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-primary/30 bg-panel/95 px-1.5 py-1 shadow-[0_8px_30px_rgba(0,0,0,0.25)] backdrop-blur">
      <span className="rounded-md bg-primary/15 px-2 py-1 text-[11px] font-medium text-primary">
        {count} выбр.
      </span>
      {count === 1 && onTransfer ? (
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[11px]" onClick={onTransfer}>
          <ArrowRightLeft className="h-3 w-3" />
          Данные
        </Button>
      ) : null}
      <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[11px]" onClick={onDuplicate}>
        <Copy className="h-3 w-3" />
        Дублировать
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1 px-2 text-[11px] text-destructive hover:text-destructive"
        onClick={onDelete}
      >
        <Trash2 className="h-3 w-3" />
        Удалить
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClear} aria-label="Снять выделение">
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
