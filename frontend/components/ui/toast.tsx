"use client";

import { CheckCircle2, Info, X, XCircle, AlertTriangle } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";

export type ToastKind = "success" | "error" | "info" | "warning";

export type ToastItem = {
  id: string;
  title: string;
  description?: string;
  kind: ToastKind;
};

type ToastContextValue = {
  toast: (input: { title: string; description?: string; kind?: ToastKind }) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

let toastSeq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    (input: { title: string; description?: string; kind?: ToastKind }) => {
      const id = `toast-${++toastSeq}`;
      setItems((current) => [
        ...current.slice(-4),
        {
          id,
          title: input.title,
          description: input.description,
          kind: input.kind ?? "info",
        },
      ]);
      window.setTimeout(() => dismiss(id), 4200);
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      toast,
      success: (title, description) => toast({ title, description, kind: "success" }),
      error: (title, description) => toast({ title, description, kind: "error" }),
      info: (title, description) => toast({ title, description, kind: "info" }),
    }),
    [toast],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2">
        {items.map((item) => (
          <ToastCard key={item.id} item={item} onDismiss={() => dismiss(item.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const Icon =
    item.kind === "success"
      ? CheckCircle2
      : item.kind === "error"
        ? XCircle
        : item.kind === "warning"
          ? AlertTriangle
          : Info;

  return (
    <div
      className={cn(
        "pointer-events-auto toast-enter flex gap-3 rounded-lg border bg-panel/95 px-3.5 py-3 shadow-lg backdrop-blur-md",
        item.kind === "success" && "border-emerald-500/40",
        item.kind === "error" && "border-destructive/50",
        item.kind === "warning" && "border-amber-500/40",
        item.kind === "info" && "border-border",
      )}
      role="status"
    >
      <Icon
        className={cn(
          "mt-0.5 h-4 w-4 shrink-0",
          item.kind === "success" && "text-emerald-500",
          item.kind === "error" && "text-destructive",
          item.kind === "warning" && "text-amber-500",
          item.kind === "info" && "text-primary",
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-foreground">{item.title}</p>
        {item.description ? (
          <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{item.description}</p>
        ) : null}
      </div>
      <button
        type="button"
        className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        onClick={onDismiss}
        aria-label="Закрыть"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
