import type { CustomNodeType } from "@/lib/api";

export const NODE_TYPES = {
  flow_start: {
    label: "Старт",
    category: "Flow",
    defaults: { title: "Старт", note: "" },
  },
  flow_end: {
    label: "Конец",
    category: "Flow",
    defaults: { title: "Конец", note: "" },
  },
  webhook_trigger: {
    label: "Webhook",
    category: "Triggers",
    defaults: { title: "Webhook" },
  },
  api_call: {
    label: "LZT API",
    category: "Market",
    defaults: {
      title: "",
      endpoint_id: "",
      account_id: "",
      params: {},
      token: "",
    },
  },
  http_request: {
    label: "HTTP",
    category: "HTTP",
    defaults: {
      title: "HTTP",
      method: "GET",
      url: "",
      headers: "",
      body: "",
      timeout: 30,
    },
  },
  file_source: {
    label: "Файл",
    category: "Data",
    defaults: {
      title: "Файл",
      file_ids: [] as string[],
      iterate_lines: true,
      format: "auto",
      dedup: false,
    },
  },
  set_variables: {
    label: "Переменные",
    category: "Utility",
    defaults: { title: "Переменные", assignments: "" },
  },
  parse_message: {
    label: "Parse",
    category: "Utility",
    defaults: {
      title: "Parse",
      source: "",
      preset: "url",
      pattern: "",
      output_key: "value",
    },
  },
  pick_value: {
    label: "Pick",
    category: "Utility",
    defaults: {
      title: "Pick",
      path: "",
      output_key: "value",
    },
  },
  delay: {
    label: "Задержка",
    category: "Utility",
    defaults: { seconds: 5 },
  },
  if_condition: {
    label: "IF",
    category: "Logic",
    defaults: {
      title: "",
      match: "all",
      conditions: [{ subject: "", operator: "truthy" }],
    },
  },
  switch: {
    label: "Switch",
    category: "Logic",
    defaults: {
      title: "",
      value: "{{ node_1.response }}",
      cases: ["ok", "error"],
    },
  },
  merge: {
    label: "Merge",
    category: "Logic",
    defaults: { title: "", mode: "all" },
  },
  execute_flow: {
    label: "Выполнить flow",
    category: "Logic",
    defaults: { title: "", flow_id: "", input_context: "{}" },
  },
  filter: {
    label: "Filter",
    category: "Utility",
    defaults: {
      title: "Filter",
      source: "",
      field: "",
      operator: "truthy",
      value: "",
      output_key: "filtered",
    },
  },
  aggregate: {
    label: "Aggregate",
    category: "Utility",
    defaults: {
      title: "Aggregate",
      source: "",
      field: "",
      operation: "count",
      separator: "\n",
      output_key: "result",
    },
  },
  account_status: {
    label: "Статус аккаунта",
    category: "Market",
    defaults: { title: "Статус аккаунта", account_id: "", token: "" },
  },
} as const;

export type NodeDefinition = {
  label: string;
  category: string;
  defaults: Record<string, unknown>;
  expected_inputs?: CustomNodeType["expected_inputs"];
  integration_id?: string;
};

export const CATEGORY_COLORS: Record<string, string> = {
  Flow: "#334155",
  Triggers: "#f59e0b",
  Market: "#22c55e",
  HTTP: "#3b82f6",
  Data: "#0ea5e9",
  Utility: "#64748b",
  Logic: "#a855f7",
};

export const CATEGORY_LABELS: Record<string, string> = {
  Triggers: "Триггеры",
  Market: "Market",
  Logic: "Логика",
  Utility: "Утилиты",
  HTTP: "HTTP",
  Data: "Данные",
  Flow: "Flow",
};

export function categoryColor(category: string) {
  return CATEGORY_COLORS[category] ?? "#22c55e";
}

export function categoryLabel(category: string) {
  return CATEGORY_LABELS[category] ?? category;
}

const dynamicRegistry: Record<string, NodeDefinition> = {};

export function defaultGraph(name?: string) {
  return {
    flow_id: name ?? null,
    settings: {
      loop: false,
      interval_seconds: 120,
      cron_expression: null as string | null,
      cron_timezone: "UTC",
      proxy: null as string | null,
    },
    nodes: [
      {
        id: "node_start",
        type: "flow_start",
        position: { x: 80, y: 200 },
        data: { title: "Старт", note: "", type: "flow_start" },
      },
      {
        id: "node_end",
        type: "flow_end",
        position: { x: 520, y: 200 },
        data: { title: "Конец", note: "", type: "flow_end" },
      },
    ],
    edges: [],
  };
}

export function setDynamicNodeTypes(customNodes: CustomNodeType[]) {
  for (const key of Object.keys(dynamicRegistry)) {
    delete dynamicRegistry[key];
  }
  for (const node of customNodes) {
    dynamicRegistry[node.node_type_slug] = {
      label: node.display_name,
      category: node.integration_name,
      defaults: { ...node.defaults },
      expected_inputs: node.expected_inputs,
      integration_id: node.integration_id,
    };
  }
}

export function getAllNodeTypes(): Record<string, NodeDefinition> {
  const builtin: Record<string, NodeDefinition> = {};
  for (const [key, meta] of Object.entries(NODE_TYPES)) {
    builtin[key] = { ...meta };
  }
  return { ...builtin, ...dynamicRegistry };
}

export function nodeLabel(type: string) {
  return getAllNodeTypes()[type]?.label ?? type;
}

export function nodeDefaults(type: string) {
  return getAllNodeTypes()[type]?.defaults ?? {};
}

export function nodeExpectedInputs(type: string) {
  return getAllNodeTypes()[type]?.expected_inputs;
}

export function nodeCategory(type: string) {
  return getAllNodeTypes()[type]?.category ?? "Custom";
}

export function isCustomNodeType(type: string) {
  return type in dynamicRegistry;
}

export function isBranchingNode(type: string) {
  return type === "if_condition" || type === "switch";
}
