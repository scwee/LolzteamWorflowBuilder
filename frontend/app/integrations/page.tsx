"use client";

import { KeyRound, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { AppShell, PageCanvas } from "@/components/app-shell";
import { OpenApiImportModal } from "@/components/integrations/openapi-import-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, type Integration } from "@/lib/api";

type AuthType = "none" | "bearer" | "api_key_header" | "api_key_query" | "basic";

function IntegrationsContent() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [importOpen, setImportOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [authType, setAuthType] = useState<AuthType>("bearer");
  const [token, setToken] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [headerName, setHeaderName] = useState("X-API-Key");
  const [queryName, setQueryName] = useState("api_key");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    try {
      setIntegrations(await api.listIntegrations());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function openCredentials(integration: Integration) {
    const schemes =
      (integration.security_scheme?.schemes as Array<{
        type?: string;
        name?: string;
        location?: string;
      }>) || [];
    const first = schemes[0];
    if (first?.type === "bearer") setAuthType("bearer");
    else if (first?.type === "api_key_query" || first?.location === "query") setAuthType("api_key_query");
    else if (first?.type === "api_key_header" || first?.type === "api_key") setAuthType("api_key_header");
    else if (first?.type === "basic") setAuthType("basic");
    else setAuthType("bearer");
    if (first?.name) {
      if (first.location === "query") setQueryName(first.name);
      else setHeaderName(first.name);
    }
    setToken("");
    setApiKey("");
    setUsername("");
    setPassword("");
    setEditingId(integration.id);
  }

  async function saveCredentials(id: string) {
    setError("");
    try {
      await api.updateCredentials(id, {
        auth_type: authType,
        token,
        api_key: apiKey || token,
        header_name: headerName,
        query_name: queryName,
        username,
        password,
      });
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка сохранения");
    }
  }

  async function remove(id: string) {
    try {
      await api.deleteIntegration(id);
      setIntegrations((current) => current.filter((item) => item.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка удаления");
    }
  }

  return (
    <AppShell
      title="Интеграции"
      subtitle="OpenAPI и свои API"
      actions={
        <>
          <Button variant="outline" size="sm" asChild>
            <Link href="/credentials">Учётные данные</Link>
          </Button>
          <Button size="sm" className="gap-1.5" onClick={() => setImportOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            Добавить
          </Button>
        </>
      }
    >
      <PageCanvas>
        {error ? <p className="mb-4 text-sm text-destructive">{error}</p> : null}
        {loading ? (
          <p className="text-sm text-muted-foreground">Загрузка...</p>
        ) : integrations.length === 0 ? (
          <div className="fade-up rounded-md border border-dashed border-border bg-card/40 px-6 py-14 text-center">
            <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-md bg-secondary">
              <KeyRound className="h-5 w-5 text-muted-foreground" />
            </div>
            <h2 className="text-[15px] font-medium">Нет интеграций</h2>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Импортируйте OpenAPI по URL или из файла
            </p>
            <Button className="mt-5 gap-1.5" onClick={() => setImportOpen(true)}>
              <Plus className="h-4 w-4" />
              Добавить интеграцию
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {integrations.map((integration, index) => (
              <div
                key={integration.id}
                className="fade-up rounded-md border border-border bg-card p-4"
                style={{ animationDelay: `${index * 40}ms` }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-[14px] font-medium">{integration.name}</h3>
                    <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                      {integration.base_url}
                    </p>
                    <p className="mt-1 text-[12px] text-muted-foreground">
                      {integration.node_count} блоков
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={() =>
                        editingId === integration.id ? setEditingId(null) : openCredentials(integration)
                      }
                    >
                      Credentials
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => remove(integration.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {editingId === integration.id ? (
                  <div className="panel-slide-left mt-4 space-y-3 border-t border-border pt-4">
                    <div className="space-y-1.5">
                      <Label className="text-[11px] text-muted-foreground">Auth type</Label>
                      <select
                        className="flex h-9 w-full rounded-md border border-input bg-card px-3 text-[13px]"
                        value={authType}
                        onChange={(e) => setAuthType(e.target.value as AuthType)}
                      >
                        <option value="none">none</option>
                        <option value="bearer">bearer</option>
                        <option value="api_key_header">api_key_header</option>
                        <option value="api_key_query">api_key_query</option>
                        <option value="basic">basic</option>
                      </select>
                    </div>
                    {authType === "bearer" ? (
                      <div className="space-y-1.5">
                        <Label className="text-[11px] text-muted-foreground">Token</Label>
                        <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} />
                      </div>
                    ) : null}
                    {authType === "api_key_header" ? (
                      <>
                        <div className="space-y-1.5">
                          <Label className="text-[11px] text-muted-foreground">Header name</Label>
                          <Input value={headerName} onChange={(e) => setHeaderName(e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-[11px] text-muted-foreground">API key</Label>
                          <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
                        </div>
                      </>
                    ) : null}
                    {authType === "api_key_query" ? (
                      <>
                        <div className="space-y-1.5">
                          <Label className="text-[11px] text-muted-foreground">Query name</Label>
                          <Input value={queryName} onChange={(e) => setQueryName(e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-[11px] text-muted-foreground">API key</Label>
                          <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
                        </div>
                      </>
                    ) : null}
                    {authType === "basic" ? (
                      <>
                        <div className="space-y-1.5">
                          <Label className="text-[11px] text-muted-foreground">Username</Label>
                          <Input value={username} onChange={(e) => setUsername(e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-[11px] text-muted-foreground">Password</Label>
                          <Input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                          />
                        </div>
                      </>
                    ) : null}
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => saveCredentials(integration.id)}>
                        Сохранить
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                        Отмена
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </PageCanvas>

      <OpenApiImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => {
          setImportOpen(false);
          load();
        }}
      />
    </AppShell>
  );
}

export default function IntegrationsPage() {
  return <IntegrationsContent />;
}
