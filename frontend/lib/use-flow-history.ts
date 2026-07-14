"use client";

import { useCallback, useState } from "react";
import type { Edge, Node } from "@xyflow/react";

import type { FlowSettings } from "@/lib/api";

export type FlowSnapshot = {
  nodes: Node[];
  edges: Edge[];
  settings: FlowSettings;
};

const MAX_HISTORY = 50;

function cloneSnapshot(snapshot: FlowSnapshot): FlowSnapshot {
  return {
    nodes: structuredClone(snapshot.nodes),
    edges: structuredClone(snapshot.edges),
    settings: structuredClone(snapshot.settings),
  };
}

export function useFlowHistory(initial: FlowSnapshot) {
  const [past, setPast] = useState<FlowSnapshot[]>([]);
  const [future, setFuture] = useState<FlowSnapshot[]>([]);

  const pushHistory = useCallback((snapshot: FlowSnapshot) => {
    setPast((current) => [...current.slice(-MAX_HISTORY + 1), cloneSnapshot(snapshot)]);
    setFuture([]);
  }, []);

  const undo = useCallback(
    (current: FlowSnapshot): FlowSnapshot | null => {
      if (past.length === 0) return null;
      const previous = past[past.length - 1];
      setPast((items) => items.slice(0, -1));
      setFuture((items) => [cloneSnapshot(current), ...items]);
      return cloneSnapshot(previous);
    },
    [past],
  );

  const redo = useCallback(
    (current: FlowSnapshot): FlowSnapshot | null => {
      if (future.length === 0) return null;
      const next = future[0];
      setFuture((items) => items.slice(1));
      setPast((items) => [...items, cloneSnapshot(current)]);
      return cloneSnapshot(next);
    },
    [future],
  );

  const resetHistory = useCallback((snapshot: FlowSnapshot) => {
    setPast([]);
    setFuture([]);
    return cloneSnapshot(snapshot);
  }, []);

  return {
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    pushHistory,
    undo,
    redo,
    resetHistory,
  };
}
