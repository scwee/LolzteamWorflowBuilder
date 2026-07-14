import type { FlowGraph } from "@/lib/api";
import { defaultGraph } from "@/lib/nodes";

function baseSettings() {
  return {
    loop: false,
    interval_seconds: 120,
    cron_expression: null as string | null,
    cron_timezone: "UTC",
    proxy: null as string | null,
  };
}

export const FLOW_TEMPLATES: Array<{
  id: string;
  name: string;
  description: string;
  graph: () => FlowGraph;
}> = [
  {
    id: "steam-search",
    name: "Поиск Steam",
    description: "Старт → поиск аккаунтов Steam → Конец",
    graph: () => ({
      ...defaultGraph(),
      settings: baseSettings(),
      nodes: [
        {
          id: "node_start",
          type: "flow_start",
          position: { x: 60, y: 180 },
          data: { title: "Старт", type: "flow_start" },
        },
        {
          id: "node_search",
          type: "api_call",
          position: { x: 260, y: 160 },
          data: {
            type: "api_call",
            title: "Поиск Steam",
            endpoint_id: "Category.Steam",
            account_id: "",
            params: { pmax: 50, order_by: "price_to_up" },
          },
        },
        {
          id: "node_end",
          type: "flow_end",
          position: { x: 520, y: 180 },
          data: { title: "Конец", type: "flow_end" },
        },
      ],
      edges: [
        { id: "e1", source: "node_start", target: "node_search" },
        { id: "e2", source: "node_search", target: "node_end" },
      ],
    }),
  },
  {
    id: "file-iterate",
    name: "Файл → API",
    description: "Строки login:pass по очереди в LZT API",
    graph: () => ({
      ...defaultGraph(),
      settings: baseSettings(),
      nodes: [
        {
          id: "node_start",
          type: "flow_start",
          position: { x: 40, y: 180 },
          data: { title: "Старт", type: "flow_start" },
        },
        {
          id: "node_file",
          type: "file_source",
          position: { x: 220, y: 160 },
          data: { type: "file_source", title: "Файл", file_ids: [], iterate_lines: true },
        },
        {
          id: "node_api",
          type: "api_call",
          position: { x: 430, y: 160 },
          data: {
            type: "api_call",
            title: "API",
            endpoint_id: "",
            account_id: "",
            params: { login: "{{ login }}", password: "{{ password }}" },
          },
        },
        {
          id: "node_end",
          type: "flow_end",
          position: { x: 660, y: 180 },
          data: { title: "Конец", type: "flow_end" },
        },
      ],
      edges: [
        { id: "e1", source: "node_start", target: "node_file" },
        { id: "e2", source: "node_file", target: "node_api" },
        { id: "e3", source: "node_api", target: "node_end" },
      ],
    }),
  },
  {
    id: "search-if-buy",
    name: "Поиск → IF → Buy",
    description: "Если есть товары — быстрая покупка первого",
    graph: () => ({
      ...defaultGraph(),
      settings: baseSettings(),
      nodes: [
        {
          id: "node_start",
          type: "flow_start",
          position: { x: 40, y: 200 },
          data: { title: "Старт", type: "flow_start" },
        },
        {
          id: "node_search",
          type: "api_call",
          position: { x: 220, y: 180 },
          data: {
            type: "api_call",
            endpoint_id: "Category.Steam",
            account_id: "",
            params: { pmax: 30 },
          },
        },
        {
          id: "node_if",
          type: "if_condition",
          position: { x: 440, y: 180 },
          data: {
            type: "if_condition",
            left: "{{ node_search.response.items.length }}",
            operator: "gt",
            right: "0",
          },
        },
        {
          id: "node_buy",
          type: "api_call",
          position: { x: 660, y: 100 },
          data: {
            type: "api_call",
            endpoint_id: "Purchasing.FastBuy",
            account_id: "",
            params: {
              item_id: "{{ node_search.response.items[0].item_id }}",
              price: "{{ node_search.response.items[0].price }}",
            },
          },
        },
        {
          id: "node_end",
          type: "flow_end",
          position: { x: 660, y: 280 },
          data: { title: "Конец", type: "flow_end" },
        },
      ],
      edges: [
        { id: "e1", source: "node_start", target: "node_search" },
        { id: "e2", source: "node_search", target: "node_if" },
        { id: "e3", source: "node_if", target: "node_buy", source_handle: "true" },
        { id: "e4", source: "node_if", target: "node_end", source_handle: "false" },
        { id: "e5", source: "node_buy", target: "node_end" },
      ],
    }),
  },
  {
    id: "webhook-http",
    name: "Webhook → HTTP",
    description: "Входящий webhook передаёт данные во внешний HTTP-запрос",
    graph: () => ({
      ...defaultGraph(),
      settings: baseSettings(),
      nodes: [
        {
          id: "node_webhook",
          type: "webhook_trigger",
          position: { x: 60, y: 180 },
          data: { title: "Webhook", type: "webhook_trigger" },
        },
        {
          id: "node_http",
          type: "http_request",
          position: { x: 300, y: 160 },
          data: {
            type: "http_request",
            title: "HTTP",
            method: "POST",
            url: "https://httpbin.org/post",
            headers: "",
            body: "{{ node_webhook.response }}",
            timeout: 30,
          },
        },
        {
          id: "node_end",
          type: "flow_end",
          position: { x: 560, y: 180 },
          data: { title: "Конец", type: "flow_end" },
        },
      ],
      edges: [
        { id: "e1", source: "node_webhook", target: "node_http" },
        { id: "e2", source: "node_http", target: "node_end" },
      ],
    }),
  },
  {
    id: "schedule-search",
    name: "Расписание → поиск",
    description: "Включите Loop в тулбаре — поиск Steam каждые N секунд",
    graph: () => ({
      ...defaultGraph(),
      settings: {
        ...baseSettings(),
        loop: true,
        interval_seconds: 300,
      },
      nodes: [
        {
          id: "node_start",
          type: "flow_start",
          position: { x: 60, y: 180 },
          data: { title: "Старт", note: "Loop включён в настройках flow", type: "flow_start" },
        },
        {
          id: "node_search",
          type: "api_call",
          position: { x: 280, y: 160 },
          data: {
            type: "api_call",
            title: "Поиск",
            endpoint_id: "Category.Steam",
            account_id: "",
            params: { pmax: 20, order_by: "price_to_up" },
          },
        },
        {
          id: "node_end",
          type: "flow_end",
          position: { x: 520, y: 180 },
          data: { title: "Конец", type: "flow_end" },
        },
      ],
      edges: [
        { id: "e1", source: "node_start", target: "node_search" },
        { id: "e2", source: "node_search", target: "node_end" },
      ],
    }),
  },
];
