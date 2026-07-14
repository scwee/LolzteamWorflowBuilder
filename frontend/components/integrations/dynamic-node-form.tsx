"use client";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ValueInput } from "@/components/flow/value-input";
import type { ExpectedInput, FlowNode } from "@/lib/api";

type DynamicNodeFormProps = {
  expectedInputs: ExpectedInput[];
  data: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  graphNodes?: FlowNode[];
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

export function DynamicNodeForm({
  expectedInputs,
  data,
  onChange,
  graphNodes = [],
}: DynamicNodeFormProps) {
  if (!expectedInputs.length) {
    return <p className="text-sm text-muted-foreground">Нет параметров для этой операции.</p>;
  }

  return (
    <div className="space-y-4">
      {expectedInputs.map((input) => {
        const name = input.name;
        if (!name || name === "body") {
          return (
            <Field key="body" label="Body">
              <ValueInput
                label=""
                value={String(data.body ?? "")}
                onChange={(v) => onChange("body", v)}
                graphNodes={graphNodes}
                placeholder="значение или из ноды"
              />
              <details className="pt-1">
                <summary className="cursor-pointer text-[11px] text-muted-foreground">
                  Расширенный режим (JSON)
                </summary>
                <Textarea
                  className="mt-1.5 min-h-[70px] font-mono text-[12px]"
                  value={String(data.body ?? "")}
                  onChange={(e) => onChange("body", e.target.value)}
                  placeholder='{"key": "value"}'
                />
              </details>
            </Field>
          );
        }

        if (input.type === "boolean") {
          return (
            <Field key={name} label={`${name}${input.required ? " *" : ""}`}>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={String(data[name] ?? "false")}
                onChange={(e) => onChange(name, e.target.value === "true")}
              >
                <option value="true">да</option>
                <option value="false">нет</option>
              </select>
            </Field>
          );
        }

        if (input.enum && input.enum.length > 0) {
          return (
            <Field key={name} label={`${name}${input.required ? " *" : ""}`}>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={String(data[name] ?? "")}
                onChange={(e) => onChange(name, e.target.value)}
              >
                <option value="">—</option>
                {input.enum.map((value) => (
                  <option key={String(value)} value={String(value)}>
                    {String(value)}
                  </option>
                ))}
              </select>
            </Field>
          );
        }

        if (input.type === "object" || input.type === "array") {
          return (
            <Field key={name} label={`${name}${input.required ? " *" : ""}`}>
              <ValueInput
                value={String(data[name] ?? "")}
                onChange={(v) => onChange(name, v)}
                graphNodes={graphNodes}
                placeholder="значение или из ноды"
              />
              <details className="pt-1">
                <summary className="cursor-pointer text-[11px] text-muted-foreground">
                  Расширенный режим (JSON)
                </summary>
                <Textarea
                  className="mt-1.5 min-h-[70px] font-mono text-[12px]"
                  value={String(data[name] ?? "")}
                  onChange={(e) => onChange(name, e.target.value)}
                />
              </details>
            </Field>
          );
        }

        return (
          <ValueInput
            key={name}
            label={`${name}${input.required ? " *" : ""}`}
            value={String(data[name] ?? "")}
            onChange={(v) => onChange(name, v)}
            graphNodes={graphNodes}
            numeric={input.type === "number"}
            placeholder={input.description || "значение"}
          />
        );
      })}
    </div>
  );
}
