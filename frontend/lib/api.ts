/** Empty string = same-origin (nginx). Local default: localhost:8000 */
const API_URL =
  process.env.NEXT_PUBLIC_API_URL !== undefined
    ? process.env.NEXT_PUBLIC_API_URL
    : "http://localhost:8000";

export type Flow = {
  id: string;
  name: string;
  graph_json: FlowGraph;
  settings: FlowSettings;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  webhook_urls: Record<string, string>;
};

export type FlowGraph = {
  flow_id?: string | null;
  settings: FlowSettings;
  nodes: FlowNode[];
  edges: FlowEdge[];
};

export type FlowSettings = {
  loop: boolean;
  interval_seconds: number;
  cron_expression: string | null;
  cron_timezone: string;
  proxy?: string | null;
};

export type FlowNode = {
  id: string;
  type: string;
  data: Record<string, unknown>;
  position?: { x: number; y: number };
  execution?: NodeExecutionSettings;
};

export type NodeExecutionSettings = {
  retry_count?: number;
  retry_delay_ms?: number;
  continue_on_fail?: boolean;
};

export type FlowEdge = {
  id: string;
  source: string;
  target: string;
  source_handle?: string | null;
  target_handle?: string | null;
};

export type FlowRun = {
  id: string;
  flow_id: string;
  status: string;
  context: Record<string, unknown>;
  error: string | null;
  current_node_id: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
};

export type NodeRun = {
  id: string;
  node_id: string;
  node_type: string;
  status: string;
  input_snapshot: Record<string, unknown>;
  output_snapshot: Record<string, unknown>;
  error: string | null;
  duration_ms: number | null;
  started_at: string | null;
  finished_at: string | null;
};

export type LztAccount = {
  id: string;
  nickname: string;
  token_preview: string;
  balance: number | null;
  last_refreshed_at: string | null;
};

export type CredentialItem = {
  id: string;
  kind: "lzt" | "openapi" | string;
  name: string;
  preview?: string | null;
  integration_id?: string | null;
  auth_type?: string | null;
  meta?: Record<string, unknown>;
};

export type CredentialEvent = {
  id: string;
  credential_kind: string;
  credential_id: string | null;
  action: string;
  label: string | null;
  ip_address: string | null;
  created_at: string;
};

export type CatalogEndpoint = {
  id: string;
  tag: string;
  summary: string;
  description: string;
  method: string;
  pathTemplate: string;
  pathParams: Array<{ name: string; in: string; required: boolean; type: string; description?: string; enum?: string[] }>;
  queryParams: Array<{ name: string; in: string; required: boolean; type: string; description?: string; enum?: string[] }>;
  bodyParams: Array<{ name: string; in: string; required: boolean; type: string; description?: string; enum?: string[] }>;
  rateLimitBucket: string;
  retryOnRetryRequest: boolean;
  minDelayMs?: number;
};

export type FlowFileMeta = {
  id: string;
  flow_id: string;
  node_id: string | null;
  filename: string;
  mime_type: string;
  encoding: string;
  size: number;
};

export type ExpectedInput = {
  name: string;
  type: string;
  required?: boolean;
  location?: string;
  description?: string;
  enum?: unknown[];
  schema?: Record<string, unknown>;
};

export type CustomNodeType = {
  id: string;
  node_type_slug: string;
  operation_id: string;
  display_name: string;
  summary: string | null;
  http_method: string;
  endpoint_path: string;
  integration_id: string;
  integration_name: string;
  category: string;
  expected_inputs: ExpectedInput[];
  defaults: Record<string, unknown>;
};

export type Integration = {
  id: string;
  name: string;
  base_url: string;
  spec_source_url: string | null;
  openapi_version: string | null;
  security_scheme: Record<string, unknown>;
  node_count: number;
  created_at: string;
};

export type OpenApiPreview = {
  preview_id: string;
  integration_name: string;
  base_url: string;
  operations: Array<{
    id: string;
    method: string;
    path: string;
    summary: string;
    tags?: string[];
  }>;
  security_schemes: Array<{
    type: string;
    name?: string;
    location?: string;
  }>;
};

export class ApiError extends Error {
  status: number;
  requestId: string | null;

  constructor(status: number, message: string, requestId: string | null = null) {
    const suffix = requestId ? ` · id ${requestId.slice(0, 8)}` : "";
    super(`${message}${suffix}`);
    this.status = status;
    this.requestId = requestId;
  }
}

const REQUEST_ID_HEADER = "X-Request-ID";

function newRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (!headers.has(REQUEST_ID_HEADER)) headers.set(REQUEST_ID_HEADER, newRequestId());

  const response = await fetch(`${API_URL}${path}`, { ...init, headers, credentials: "include" });
  if (!response.ok) {
    const requestId = response.headers.get(REQUEST_ID_HEADER);
    let message = "Request failed";
    try {
      const body = await response.json();
      const detail = body.detail;
      if (typeof detail === "string") message = detail;
      else if (Array.isArray(detail)) {
        message = detail
          .map((item) => {
            if (typeof item === "string") return item;
            if (item && typeof item === "object" && "msg" in item) return String(item.msg);
            return JSON.stringify(item);
          })
          .join("; ");
      } else if (detail != null) message = JSON.stringify(detail);
    } catch {
      message = response.statusText;
    }
    throw new ApiError(response.status, message, requestId);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  listCredentials: () => request<CredentialItem[]>("/credentials"),
  getPins: (flowId: string) =>
    request<Record<string, unknown>>(`/flows/${flowId}/pins`),
  putPins: (flowId: string, pin_data: Record<string, unknown>) =>
    request<{ status: string; pin_data: Record<string, unknown> }>(`/flows/${flowId}/pins`, {
      method: "PUT",
      body: JSON.stringify(pin_data),
    }),
  listFlows: () => request<Flow[]>("/flows"),
  createFlow: (payload: { name: string; graph_json?: FlowGraph }) =>
    request<Flow>("/flows", { method: "POST", body: JSON.stringify(payload) }),
  getFlow: (id: string) => request<Flow>(`/flows/${id}`),
  updateFlow: (
    id: string,
    payload: Partial<{ name: string; graph_json: FlowGraph; is_active: boolean }>,
  ) => request<Flow>(`/flows/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteFlow: (id: string) => request<void>(`/flows/${id}`, { method: "DELETE" }),
  runFlow: (id: string) => request<FlowRun>(`/flows/${id}/run`, { method: "POST" }),
  stopFlow: (id: string) => request<Flow>(`/flows/${id}/stop`, { method: "POST" }),
  getRun: (flowId: string, runId: string) => request<FlowRun>(`/flows/${flowId}/runs/${runId}`),
  listRuns: (flowId: string) => request<FlowRun[]>(`/flows/${flowId}/runs`),
  listNodeRuns: (flowId: string, runId: string) =>
    request<NodeRun[]>(`/flows/${flowId}/runs/${runId}/nodes`),
  testNode: (
    flowId: string,
    payload: {
      node_id: string;
      mock_context?: Record<string, unknown>;
      node_data?: Record<string, unknown>;
      node_type?: string;
      pin?: boolean;
    },
  ) =>
    request<{ status: string; result?: Record<string, unknown>; error?: string }>(
      `/flows/${flowId}/test-node`,
      { method: "POST", body: JSON.stringify(payload) },
    ),
  upsertSchedule: (
    flowId: string,
    payload: { cron_expression: string; timezone?: string; is_active?: boolean },
  ) => request<{ status: string }>(`/flows/${flowId}/schedule`, { method: "PUT", body: JSON.stringify(payload) }),
  previewOpenApi: (payload: { url: string }) =>
    request<OpenApiPreview>("/integrations/openapi/preview", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  previewOpenApiUpload: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<OpenApiPreview>("/integrations/openapi/preview/upload", {
      method: "POST",
      body: form,
    });
  },
  importOpenApi: (payload: {
    preview_id: string;
    integration_name: string;
    operation_ids: string[];
    credential?: {
      auth_type: "none" | "bearer" | "api_key_header" | "api_key_query" | "basic";
      token?: string;
      api_key?: string;
      header_name?: string;
      query_name?: string;
      username?: string;
      password?: string;
    };
  }) =>
    request<CustomNodeType[]>("/integrations/openapi/import", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  listIntegrations: () => request<Integration[]>("/integrations"),
  listNodeTypes: () => request<CustomNodeType[]>("/integrations/node-types"),
  deleteIntegration: (id: string) => request<void>(`/integrations/${id}`, { method: "DELETE" }),
  updateCredentials: (
    id: string,
    payload: {
      name?: string;
      auth_type: "none" | "bearer" | "api_key_header" | "api_key_query" | "basic";
      token?: string;
      api_key?: string;
      header_name?: string;
      query_name?: string;
      username?: string;
      password?: string;
    },
  ) =>
    request<{ status: string }>(`/integrations/${id}/credentials`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  listLztAccounts: () => request<LztAccount[]>("/lzt-accounts"),
  createLztAccount: (payload: { token: string; nickname?: string }) =>
    request<LztAccount>("/lzt-accounts", { method: "POST", body: JSON.stringify(payload) }),
  refreshLztAccount: (id: string) =>
    request<LztAccount>(`/lzt-accounts/${id}/refresh`, { method: "POST", body: "{}" }),
  rotateLztAccount: (id: string, token: string) =>
    request<LztAccount>(`/lzt-accounts/${id}/rotate`, {
      method: "POST",
      body: JSON.stringify({ token }),
    }),
  deleteLztAccount: (id: string) => request<void>(`/lzt-accounts/${id}`, { method: "DELETE" }),
  listCredentialEvents: (limit = 50) =>
    request<CredentialEvent[]>(`/credentials/events?limit=${limit}`),
  listCatalog: (params?: { q?: string; tag?: string }) => {
    const qs = new URLSearchParams();
    if (params?.q) qs.set("q", params.q);
    if (params?.tag) qs.set("tag", params.tag);
    const suffix = qs.toString() ? `?${qs}` : "";
    return request<CatalogEndpoint[]>(`/catalog${suffix}`);
  },
  listCatalogTags: () => request<Array<{ tag: string; count: number }>>("/catalog/tags"),
  getCatalogEndpoint: (id: string) => request<CatalogEndpoint>(`/catalog/${encodeURIComponent(id)}`),
  listFlowFiles: (flowId: string, nodeId?: string) => {
    const qs = nodeId ? `?node_id=${encodeURIComponent(nodeId)}` : "";
    return request<FlowFileMeta[]>(`/flows/${flowId}/files${qs}`);
  },
  uploadFlowFile: async (flowId: string, file: File, nodeId?: string) => {
    const form = new FormData();
    form.append("upload", file);
    if (nodeId) form.append("node_id", nodeId);
    return request<FlowFileMeta>(`/flows/${flowId}/files`, { method: "POST", body: form });
  },
  deleteFlowFile: (flowId: string, fileId: string) =>
    request<void>(`/flows/${flowId}/files/${fileId}`, { method: "DELETE" }),
};

export function streamRun(
  flowId: string,
  runId: string,
  onEvent: (data: { status: string; current_node_id: string | null; error: string | null }) => void,
  onDone: () => void,
): () => void {
  const controller = new AbortController();
  const streamHeaders: Record<string, string> = { [REQUEST_ID_HEADER]: newRequestId() };

  fetch(`${API_URL}/flows/${flowId}/runs/${runId}/stream`, {
    headers: streamHeaders,
    credentials: "include",
    signal: controller.signal,
  }).then(async (response) => {
    if (!response.ok || !response.body) {
      onDone();
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const data = JSON.parse(line.slice(6));
          onEvent(data);
          if (data.status && !["pending", "running"].includes(data.status)) {
            onDone();
            controller.abort();
            return;
          }
        } catch {
          // ignore parse errors
        }
      }
    }
    onDone();
  });

  return () => controller.abort();
}
