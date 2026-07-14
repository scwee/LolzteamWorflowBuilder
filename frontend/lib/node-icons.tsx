import type { CSSProperties } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Ban,
  Braces,
  Calculator,
  Check,
  Clock3,
  Columns2,
  FileText,
  Filter,
  GitBranch,
  GitMerge,
  Globe,
  KeyRound,
  Layers,
  Loader2,
  MessageSquareText,
  Play,
  Plug,
  Square,
  Variable,
  Webhook,
  Workflow,
  Zap,
} from "lucide-react";

/** Per-node Lucide icon + accent (n8n-style badge, not emoji). */
export const NODE_ICONS: Record<string, { icon: LucideIcon; color: string }> = {
  flow_start: { icon: Play, color: "#22c55e" },
  flow_end: { icon: Square, color: "#64748b" },
  webhook_trigger: { icon: Webhook, color: "#f59e0b" },
  api_call: { icon: Zap, color: "#22c55e" },
  http_request: { icon: Globe, color: "#3b82f6" },
  file_source: { icon: FileText, color: "#0ea5e9" },
  set_variables: { icon: Variable, color: "#788492" },
  parse_message: { icon: MessageSquareText, color: "#64748b" },
  pick_value: { icon: Braces, color: "#6b7c93" },
  delay: { icon: Clock3, color: "#38bdf8" },
  if_condition: { icon: GitBranch, color: "#a855f7" },
  switch: { icon: Columns2, color: "#8b5cf6" },
  merge: { icon: GitMerge, color: "#7c3aed" },
  execute_flow: { icon: Workflow, color: "#a855f7" },
  filter: { icon: Filter, color: "#f97316" },
  aggregate: { icon: Calculator, color: "#94a3b8" },
  account_status: { icon: KeyRound, color: "#22c55e" },
};

const FALLBACK = { icon: Layers, color: "#94a3b8" };

export function nodeIconMeta(type: string) {
  if (type.startsWith("custom_")) {
    return { icon: Plug, color: "#8b5cf6" };
  }
  return NODE_ICONS[type] ?? FALLBACK;
}

function mixHex(hex: string, amount: number): string {
  const raw = hex.replace("#", "");
  if (raw.length !== 6) return hex;
  const n = parseInt(raw, 16);
  const r = Math.min(255, Math.max(0, ((n >> 16) & 255) + amount));
  const g = Math.min(255, Math.max(0, ((n >> 8) & 255) + amount));
  const b = Math.min(255, Math.max(0, (n & 255) + amount));
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

type NodeIconBadgeProps = {
  type: string;
  size?: "sm" | "md" | "lg";
  className?: string;
};

export function NodeIconBadge({ type, size = "md", className }: NodeIconBadgeProps) {
  const { icon: Icon, color } = nodeIconMeta(type);
  const top = mixHex(color, 28);
  const bottom = mixHex(color, -22);
  const box =
    size === "sm" ? "h-5 w-5 rounded-[5px]" : size === "lg" ? "h-9 w-9 rounded-[10px]" : "h-7 w-7 rounded-[7px]";
  const glyph = size === "sm" ? "h-3 w-3" : size === "lg" ? "h-4 w-4" : "h-3.5 w-3.5";

  return (
    <span
      className={`node-icon-badge inline-flex shrink-0 items-center justify-center text-white ${box} ${className ?? ""}`}
      style={
        {
          "--node-icon": color,
          "--node-icon-top": top,
          "--node-icon-bottom": bottom,
        } as CSSProperties
      }
      aria-hidden
    >
      <Icon className={`${glyph} relative z-[1] drop-shadow-[0_1px_1px_rgba(0,0,0,0.35)]`} strokeWidth={2.35} />
    </span>
  );
}

export function NodeStatusGlyph({
  status,
}: {
  status: "idle" | "running" | "done" | "error";
}) {
  if (status === "running") {
    return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" aria-hidden />;
  }
  if (status === "done") {
    return (
      <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
        <Check className="h-2.5 w-2.5" strokeWidth={3} />
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-destructive">
        <Ban className="h-2.5 w-2.5" />
      </span>
    );
  }
  return null;
}
