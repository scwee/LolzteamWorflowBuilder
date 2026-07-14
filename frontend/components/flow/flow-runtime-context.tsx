"use client";

import { createContext, useContext } from "react";

import type { LztAccount } from "@/lib/api";

export type FlowRuntimeValue = {
  lztAccounts: LztAccount[];
  loopEnabled: boolean;
};

const FlowRuntimeContext = createContext<FlowRuntimeValue>({
  lztAccounts: [],
  loopEnabled: false,
});

export function FlowRuntimeProvider({
  value,
  children,
}: {
  value: FlowRuntimeValue;
  children: React.ReactNode;
}) {
  return <FlowRuntimeContext.Provider value={value}>{children}</FlowRuntimeContext.Provider>;
}

export function useFlowRuntime() {
  return useContext(FlowRuntimeContext);
}
