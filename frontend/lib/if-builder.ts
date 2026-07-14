import type { FlowNode } from "@/lib/api";

export type IfOperator = {
  value: string;
  label: string;
  unary?: boolean; // не требует значения справа
};

export const IF_OPERATORS: IfOperator[] = [
  { value: "truthy", label: "истина / да", unary: true },
  { value: "falsy", label: "ложь / нет", unary: true },
  { value: "not_empty", label: "заполнено", unary: true },
  { value: "empty", label: "пусто", unary: true },
  { value: "eq", label: "равно" },
  { value: "neq", label: "не равно" },
  { value: "contains", label: "содержит" },
  { value: "not_contains", label: "не содержит" },
  { value: "gt", label: "больше" },
  { value: "gte", label: "больше или равно" },
  { value: "lt", label: "меньше" },
  { value: "lte", label: "меньше или равно" },
  { value: "starts_with", label: "начинается с" },
  { value: "ends_with", label: "заканчивается на" },
];

const UNARY = new Set(IF_OPERATORS.filter((o) => o.unary).map((o) => o.value));

export function isUnaryOperator(op: string): boolean {
  return UNARY.has(op);
}

export function operatorLabel(op: string): string {
  return IF_OPERATORS.find((o) => o.value === op)?.label ?? op;
}

export type SubjectOption = {
  label: string; // человекочитаемо, напр. "Аккаунт валиден"
  template: string; // напр. "{{ node_3.response.valid }}"
};

export type SubjectGroup = {
  nodeId: string;
  title: string;
  options: SubjectOption[];
};

// Поля, которые каждая нода отдаёт наружу — с понятными русскими ярлыками.
function optionsForNodeType(nodeId: string, type: string): SubjectOption[] {
  const t = (path: string) => `{{ ${nodeId}.${path} }}`;
  switch (type) {
    case "file_source":
      return [
        { label: "Логин", template: t("login") },
        { label: "Пароль", template: t("password") },
        { label: "Email", template: t("email") },
        { label: "Строка целиком", template: t("line") },
      ];
    case "account_status":
      return [
        { label: "Аккаунт валиден", template: t("response.valid") },
        { label: "Баланс", template: t("response.balance") },
        { label: "Никнейм", template: t("response.nickname") },
        { label: "HTTP статус", template: t("status") },
      ];
    case "api_call":
    case "http_request":
      return [
        { label: "HTTP статус", template: t("status") },
        { label: "Ответ (тело)", template: t("response") },
      ];
    case "parse_message":
      return [
        { label: "Найдено совпадение", template: t("response.matched") },
        { label: "Значение", template: t("response.value") },
      ];
    case "pick_value":
      return [{ label: "Значение", template: t("value") }];
    case "filter":
      return [
        { label: "Количество после фильтра", template: t("response.count") },
        { label: "Сколько отброшено", template: t("response.dropped") },
      ];
    case "aggregate":
      return [{ label: "Результат", template: t("response.value") }];
    case "webhook_trigger":
      return [{ label: "Данные вебхука", template: t("response") }];
    case "set_variables":
      return [{ label: "Ответ", template: t("response") }];
    default:
      // OpenAPI custom и прочее
      return [
        { label: "Ответ (тело)", template: t("response") },
        { label: "HTTP статус", template: t("status") },
      ];
  }
}

export function buildSubjectGroups(graphNodes: FlowNode[]): SubjectGroup[] {
  const groups: SubjectGroup[] = [];
  for (const node of graphNodes) {
    const type = String(node.type || node.data?.type || "");
    if (type === "flow_start" || type === "flow_end" || type === "if_condition" || type === "switch" || type === "merge") {
      continue;
    }
    const title = String(node.data?.title || node.id);
    groups.push({ nodeId: node.id, title, options: optionsForNodeType(node.id, type) });
  }
  return groups;
}

export type IfCondition = {
  subject: string;
  operator: string;
  value?: string;
};

function findNodeByType(graphNodes: FlowNode[], types: string[]): FlowNode | undefined {
  return graphNodes.find((n) => types.includes(String(n.type || n.data?.type || "")));
}

export type IfPreset = {
  id: string;
  label: string;
  build: (graphNodes: FlowNode[]) => { conditions: IfCondition[]; match: "all" | "any" } | null;
};

export const IF_PRESETS: IfPreset[] = [
  {
    id: "account_valid",
    label: "Аккаунт валиден",
    build: (nodes) => {
      const n = findNodeByType(nodes, ["account_status"]);
      if (!n) return null;
      return { conditions: [{ subject: `{{ ${n.id}.response.valid }}`, operator: "truthy" }], match: "all" };
    },
  },
  {
    id: "balance_gt",
    label: "Баланс больше…",
    build: (nodes) => {
      const n = findNodeByType(nodes, ["account_status"]);
      if (!n) return null;
      return { conditions: [{ subject: `{{ ${n.id}.response.balance }}`, operator: "gt", value: "0" }], match: "all" };
    },
  },
  {
    id: "email_filled",
    label: "Email заполнен",
    build: (nodes) => {
      const n = findNodeByType(nodes, ["file_source"]);
      if (!n) return null;
      return { conditions: [{ subject: `{{ ${n.id}.email }}`, operator: "not_empty" }], match: "all" };
    },
  },
  {
    id: "http_2xx",
    label: "HTTP успех (2xx)",
    build: (nodes) => {
      const n = findNodeByType(nodes, ["api_call", "http_request"]);
      if (!n) return null;
      return {
        conditions: [
          { subject: `{{ ${n.id}.status }}`, operator: "gte", value: "200" },
          { subject: `{{ ${n.id}.status }}`, operator: "lt", value: "300" },
        ],
        match: "all",
      };
    },
  },
  {
    id: "response_contains",
    label: "Ответ содержит текст…",
    build: (nodes) => {
      const n = findNodeByType(nodes, ["api_call", "http_request", "parse_message"]);
      if (!n) return null;
      return { conditions: [{ subject: `{{ ${n.id}.response }}`, operator: "contains", value: "" }], match: "all" };
    },
  },
];

// Человекочитаемая подпись для выбранного subject-шаблона.
export function subjectLabel(template: string, groups: SubjectGroup[]): string {
  for (const g of groups) {
    const opt = g.options.find((o) => o.template === template);
    if (opt) return `${g.title}: ${opt.label}`;
  }
  return template;
}

// Миграция старой формы { left, operator, right } в conditions[].
export function normalizeIfData(data: Record<string, unknown>): {
  conditions: IfCondition[];
  match: "all" | "any";
} {
  const rawConditions = data.conditions;
  if (Array.isArray(rawConditions) && rawConditions.length) {
    const conditions = rawConditions.map((c) => {
      const cond = c as Record<string, unknown>;
      return {
        subject: String(cond.subject ?? ""),
        operator: String(cond.operator ?? "truthy"),
        value: cond.value != null ? String(cond.value) : undefined,
      };
    });
    const match = data.match === "any" ? "any" : "all";
    return { conditions, match };
  }
  // legacy
  const left = data.left != null ? String(data.left) : "";
  if (left) {
    return {
      conditions: [
        {
          subject: left,
          operator: String(data.operator ?? "eq"),
          value: data.right != null ? String(data.right) : undefined,
        },
      ],
      match: "all",
    };
  }
  return { conditions: [{ subject: "", operator: "truthy" }], match: "all" };
}
