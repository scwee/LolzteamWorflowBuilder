"use client";

import { History, KeyRound, Link2, Plus, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AppShell, PageCanvas } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, type CredentialEvent, type CredentialItem, type LztAccount } from "@/lib/api";

const ACTION_LABELS: Record<string, string> = {
  created: "создан",
  rotated: "заменён токен",
  deleted: "удалён",
  refreshed: "обновлён",
  used: "использован",
};

function CredentialsContent() {
  const [items, setItems] = useState<CredentialItem[]>([]);
  const [accounts, setAccounts] = useState<LztAccount[]>([]);
  const [events, setEvents] = useState<CredentialEvent[]>([]);
  const [token, setToken] = useState("");
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rotatingId, setRotatingId] = useState<string | null>(null);
  const [rotateToken, setRotateToken] = useState("");

  const reload = useCallback(async () => {
    const [creds, lzt, log] = await Promise.all([
      api.listCredentials(),
      api.listLztAccounts(),
      api.listCredentialEvents().catch(() => [] as CredentialEvent[]),
    ]);
    setItems(creds);
    setAccounts(lzt);
    setEvents(log);
  }, []);

  async function onRotate(id: string) {
    setBusy(true);
    setError(null);
    try {
      await api.rotateLztAccount(id, rotateToken.trim());
      setRotatingId(null);
      setRotateToken("");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось заменить токен");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    reload()
      .catch((err) => setError(err instanceof Error ? err.message : "Ошибка загрузки"))
      .finally(() => setLoading(false));
  }, [reload]);

  const openapiItems = useMemo(() => items.filter((item) => item.kind === "openapi"), [items]);

  async function onCreate() {
    setBusy(true);
    setError(null);
    try {
      await api.createLztAccount({ token: token.trim(), nickname: nickname || undefined });
      setToken("");
      setNickname("");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell
      title="Учётные данные"
      subtitle="Токены LZT и OpenAPI"
      actions={
        <Button variant="outline" size="sm" asChild>
          <Link href="/integrations">Интеграции</Link>
        </Button>
      }
    >
      <PageCanvas className="space-y-6">
        <section className="rounded-md border border-border bg-card p-5">
          <div className="mb-3 flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-medium">Добавить LZT токен</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-[11px] text-muted-foreground">Bearer token (scope market)</Label>
              <Input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="вставьте токен"
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground">Ник (опционально)</Label>
              <Input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="nickname" />
            </div>
          </div>
          {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
          <Button className="mt-4 gap-1.5" size="sm" disabled={busy || token.trim().length < 8} onClick={onCreate}>
            <Plus className="h-3.5 w-3.5" />
            Сохранить
          </Button>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-medium">LZT Market</h2>
          {loading ? (
            <p className="text-sm text-muted-foreground">Загрузка...</p>
          ) : accounts.length === 0 ? (
            <p className="rounded-md border border-dashed border-border bg-card/40 px-4 py-6 text-sm text-muted-foreground">
              Нет сохранённых LZT токенов.
            </p>
          ) : (
            <div className="overflow-hidden rounded-md border border-border bg-card">
              {accounts.map((account) => (
                <div
                  key={account.id}
                  className="border-b border-border px-4 py-3 last:border-b-0"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium">{account.nickname || "без ника"}</p>
                      <p className="font-mono text-[11px] text-muted-foreground">{account.token_preview}</p>
                      <p className="text-[11px] text-muted-foreground">
                        баланс: {account.balance ?? "—"}
                        {account.last_refreshed_at
                          ? ` · ${new Date(account.last_refreshed_at).toLocaleString("ru-RU")}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        title="Заменить токен"
                        onClick={() => {
                          setRotatingId(rotatingId === account.id ? null : account.id);
                          setRotateToken("");
                        }}
                      >
                        <RotateCcw className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        title="Обновить"
                        onClick={async () => {
                          try {
                            await api.refreshLztAccount(account.id);
                            await reload();
                          } catch (err) {
                            setError(err instanceof Error ? err.message : "Refresh failed");
                          }
                        }}
                      >
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        title="Удалить"
                        onClick={async () => {
                          await api.deleteLztAccount(account.id);
                          await reload();
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                  {rotatingId === account.id ? (
                    <div className="mt-3 flex items-end gap-2 rounded-md border border-border bg-background/60 p-3">
                      <div className="flex-1 space-y-1.5">
                        <Label className="text-[11px] text-muted-foreground">Новый токен</Label>
                        <Input
                          value={rotateToken}
                          onChange={(e) => setRotateToken(e.target.value)}
                          placeholder="вставьте новый токен"
                          className="font-mono text-xs"
                        />
                      </div>
                      <Button
                        size="sm"
                        disabled={busy || rotateToken.trim().length < 8}
                        onClick={() => onRotate(account.id)}
                      >
                        Заменить
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium">OpenAPI credentials</h2>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/integrations" className="gap-1.5 text-[12px]">
                <Link2 className="h-3.5 w-3.5" />
                Управление в Интеграциях
              </Link>
            </Button>
          </div>
          {loading ? null : openapiItems.length === 0 ? (
            <p className="rounded-md border border-dashed border-border bg-card/40 px-4 py-6 text-sm text-muted-foreground">
              Нет OpenAPI credentials.{" "}
              <Link href="/integrations" className="text-primary hover:underline">
                Импортируйте интеграцию
              </Link>
            </p>
          ) : (
            <div className="overflow-hidden rounded-md border border-border bg-card">
              {openapiItems.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 last:border-b-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium">{item.name}</p>
                    <p className="truncate font-mono text-[11px] text-muted-foreground">
                      {item.preview || "—"}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      auth: {item.auth_type || "none"}
                    </p>
                  </div>
                  {item.integration_id ? (
                    <Button variant="outline" size="sm" className="h-7" asChild>
                      <Link href="/integrations">Открыть</Link>
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="mb-2 flex items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-medium">Журнал действий</h2>
          </div>
          {events.length === 0 ? (
            <p className="rounded-md border border-dashed border-border bg-card/40 px-4 py-6 text-sm text-muted-foreground">
              Пока нет событий. Создание, замена, обновление и удаление кредов появятся здесь.
            </p>
          ) : (
            <div className="overflow-hidden rounded-md border border-border bg-card">
              {events.map((event) => (
                <div
                  key={event.id}
                  className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5 text-[12px] last:border-b-0"
                >
                  <div className="min-w-0">
                    <span className="font-medium">{ACTION_LABELS[event.action] || event.action}</span>
                    <span className="text-muted-foreground"> · {event.label || event.credential_kind}</span>
                  </div>
                  <div className="shrink-0 text-right text-[11px] text-muted-foreground">
                    <span>{new Date(event.created_at).toLocaleString("ru-RU")}</span>
                    {event.ip_address ? <span className="ml-2 font-mono">{event.ip_address}</span> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </PageCanvas>
    </AppShell>
  );
}

export default function CredentialsPage() {
  return <CredentialsContent />;
}
