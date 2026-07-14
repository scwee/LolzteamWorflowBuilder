"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api, type OpenApiPreview } from "@/lib/api";

type OpenApiImportModalProps = {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
};

type Step = "source" | "select" | "credential";

export function OpenApiImportModal({ open, onClose, onImported }: OpenApiImportModalProps) {
  const [step, setStep] = useState<Step>("source");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<OpenApiPreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [integrationName, setIntegrationName] = useState("");
  const [authType, setAuthType] = useState("none");
  const [token, setToken] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [headerName, setHeaderName] = useState("X-API-Key");
  const [queryName, setQueryName] = useState("api_key");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const filteredOps = useMemo(() => {
    if (!preview) return [];
    const q = search.toLowerCase();
    return preview.operations.filter(
      (op) =>
        op.id.toLowerCase().includes(q) ||
        op.summary.toLowerCase().includes(q) ||
        op.path.toLowerCase().includes(q),
    );
  }, [preview, search]);

  function reset() {
    setStep("source");
    setUrl("");
    setFile(null);
    setPreview(null);
    setSelected(new Set());
    setSearch("");
    setIntegrationName("");
    setAuthType("none");
    setToken("");
    setApiKey("");
    setHeaderName("X-API-Key");
    setQueryName("api_key");
    setUsername("");
    setPassword("");
    setError("");
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handlePreview() {
    setLoading(true);
    setError("");
    try {
      const result = file
        ? await api.previewOpenApiUpload(file)
        : await api.previewOpenApi({ url });
      setPreview(result);
      setIntegrationName(result.integration_name);
      setSelected(new Set(result.operations.map((op) => op.id)));
      const scheme = result.security_schemes[0];
      if (scheme?.type === "bearer") setAuthType("bearer");
      else if (scheme?.type === "api_key_query" || scheme?.location === "query") setAuthType("api_key_query");
      else if (scheme?.type === "api_key_header" || scheme?.type === "api_key") setAuthType("api_key_header");
      else if (scheme?.type === "basic") setAuthType("basic");
      if (scheme?.name) {
        if (scheme.location === "query") setQueryName(scheme.name);
        else setHeaderName(scheme.name);
      }
      setStep("select");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка парсинга");
    } finally {
      setLoading(false);
    }
  }

  async function handleImport() {
    if (!preview) return;
    setLoading(true);
    setError("");
    try {
      await api.importOpenApi({
        preview_id: preview.preview_id,
        integration_name: integrationName,
        operation_ids: Array.from(selected),
        credential: {
          auth_type: authType as "none" | "bearer" | "api_key_header" | "api_key_query" | "basic",
          token,
          api_key: apiKey,
          header_name: headerName,
          query_name: queryName,
          username,
          password,
        },
      });
      onImported();
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка импорта");
    } finally {
      setLoading(false);
    }
  }

  function toggleOp(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !value && handleClose()}>
      <DialogContent className="max-h-[90vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="text-[16px]">Импорт OpenAPI</DialogTitle>
          <DialogDescription className="text-[13px]">
            Добавьте внешний API как набор визуальных блоков
          </DialogDescription>
          <div className="flex gap-1.5 pt-2">
            {(["source", "select", "credential"] as Step[]).map((item) => {
              const order = { source: 0, select: 1, credential: 2 } as const;
              const active = order[step] >= order[item];
              return (
                <div key={item} className={`h-1 flex-1 rounded-full ${active ? "bg-primary" : "bg-secondary"}`} />
              );
            })}
          </div>
        </DialogHeader>

        {error ? <p className="text-sm text-red-400">{error}</p> : null}

        {step === "source" ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>URL спецификации</Label>
              <Input
                placeholder="https://api.example.com/openapi.json"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Или загрузите файл (JSON/YAML)</Label>
              <Input type="file" accept=".json,.yaml,.yml" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </div>
            <Button onClick={handlePreview} disabled={loading || (!url && !file)}>
              {loading ? "Парсинг..." : "Далее"}
            </Button>
          </div>
        ) : null}

        {step === "select" && preview ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Название интеграции</Label>
              <Input value={integrationName} onChange={(e) => setIntegrationName(e.target.value)} />
            </div>
            <Input placeholder="Поиск эндпоинтов..." value={search} onChange={(e) => setSearch(e.target.value)} />
            <ScrollArea className="h-64 rounded-md border border-border p-3">
              <div className="space-y-2">
                {filteredOps.map((op) => (
                  <label key={op.id} className="flex cursor-pointer items-start gap-2 rounded-md p-2 hover:bg-accent">
                    <input
                      type="checkbox"
                      checked={selected.has(op.id)}
                      onChange={() => toggleOp(op.id)}
                      className="mt-1"
                    />
                    <div>
                      <p className="text-sm font-medium">
                        {op.method} {op.path}
                      </p>
                      <p className="text-xs text-muted-foreground">{op.summary || op.id}</p>
                    </div>
                  </label>
                ))}
              </div>
            </ScrollArea>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep("source")}>
                Назад
              </Button>
              <Button onClick={() => setStep("credential")} disabled={selected.size === 0}>
                Далее ({selected.size})
              </Button>
            </div>
          </div>
        ) : null}

        {step === "credential" ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Тип авторизации</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={authType}
                onChange={(e) => setAuthType(e.target.value)}
              >
                <option value="none">Без авторизации</option>
                <option value="bearer">Bearer Token</option>
                <option value="api_key_header">API Key (Header)</option>
                <option value="api_key_query">API Key (Query)</option>
                <option value="basic">Basic Auth</option>
              </select>
            </div>
            {authType === "bearer" ? (
              <div className="space-y-2">
                <Label>Token</Label>
                <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} />
              </div>
            ) : null}
            {authType === "api_key_header" ? (
              <>
                <div className="space-y-2">
                  <Label>Header name</Label>
                  <Input value={headerName} onChange={(e) => setHeaderName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>API Key</Label>
                  <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
                </div>
              </>
            ) : null}
            {authType === "api_key_query" ? (
              <>
                <div className="space-y-2">
                  <Label>Query name</Label>
                  <Input value={queryName} onChange={(e) => setQueryName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>API Key</Label>
                  <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
                </div>
              </>
            ) : null}
            {authType === "basic" ? (
              <>
                <div className="space-y-2">
                  <Label>Username</Label>
                  <Input value={username} onChange={(e) => setUsername(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Password</Label>
                  <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
              </>
            ) : null}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep("select")}>
                Назад
              </Button>
              <Button onClick={handleImport} disabled={loading}>
                {loading ? "Импорт..." : "Добавить интеграцию"}
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
