"use client";

import { KeyRound, Plug, ScrollText, Workflow } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Сценарии", icon: Workflow },
  { href: "/credentials", label: "Учётные данные", icon: KeyRound },
  { href: "/executions", label: "Запуски", icon: ScrollText },
  { href: "/integrations", label: "Интеграции", icon: Plug },
] as const;

export function AppLogo({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn("group flex items-center gap-2.5", className)}>
      <span className="flex h-7 w-7 items-center justify-center rounded bg-primary text-[11px] font-bold tracking-tight text-primary-foreground">
        LZT
      </span>
      <span className="font-display text-[15px] font-semibold tracking-tight text-foreground">
        LZT Builder
      </span>
    </Link>
  );
}

export function AppSidebar() {
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <aside className="fixed inset-y-0 left-0 z-40 flex w-[220px] flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 items-center border-b border-sidebar-border px-4">
        <AppLogo />
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-3">
        <p className="mb-1 px-2.5 text-[10px] font-medium uppercase tracking-wider text-sidebar-muted">
          Меню
        </p>
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors",
                active
                  ? "bg-sidebar-active text-sidebar-foreground"
                  : "text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-foreground",
              )}
            >
              <Icon className={cn("h-4 w-4 shrink-0", active ? "text-primary" : "")} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border p-3">
        <div className="flex items-center justify-between rounded-md px-2 py-1.5">
          <p className="text-[11px] text-sidebar-muted">Локальный builder</p>
          <ThemeToggle />
        </div>
      </div>
    </aside>
  );
}

export function AppShell({
  children,
  title,
  subtitle,
  actions,
}: {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <AppSidebar />
      <div className="pl-[220px]">
        {(title || actions) && (
          <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b border-border bg-background/95 px-6 backdrop-blur-sm">
            <div className="min-w-0">
              {title ? (
                <h1 className="truncate font-display text-[15px] font-semibold tracking-tight text-foreground">
                  {title}
                </h1>
              ) : null}
              {subtitle ? (
                <p className="truncate text-[12px] text-muted-foreground">{subtitle}</p>
              ) : null}
            </div>
            {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
          </header>
        )}
        <main className="min-h-[calc(100vh-3.5rem)]">{children}</main>
      </div>
    </div>
  );
}

export function PageCanvas({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="canvas-dots px-6 py-6">
      <div className={cn("mx-auto max-w-5xl", className)}>{children}</div>
    </div>
  );
}
