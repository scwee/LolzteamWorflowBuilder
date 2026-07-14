"use client";

import { AppLogo } from "@/components/app-shell";
import { flowNodeTypes } from "@/components/flow/custom-node";
import { DataTransferPanel } from "@/components/flow/data-transfer-panel";
import { FlowContextMenu, type FlowContextMenuState } from "@/components/flow/flow-context-menu";
import { FlowLogsPanel } from "@/components/flow/flow-logs-panel";
import { FlowRuntimeProvider } from "@/components/flow/flow-runtime-context";
import { NodeConfigDrawer } from "@/components/flow/node-config-drawer";
import { NodePalette, createNode } from "@/components/flow/node-palette";
import { SelectionToolbar } from "@/components/flow/selection-toolbar";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { useTheme } from "@/components/theme-provider";
import {
  api,
  streamRun,
  type Flow,
  type FlowGraph,
  type FlowRun,
  type FlowSettings,
  type LztAccount,
  type NodeExecutionSettings,
} from "@/lib/api";
import { defaultGraph, nodeLabel, setDynamicNodeTypes } from "@/lib/nodes";
import { useFlowHistory } from "@/lib/use-flow-history";
import { generateId } from "@/lib/utils";
import { KeyRound, Play, Redo2, Save, Square, Undo2 } from "lucide-react";
import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type OnSelectionChangeParams,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

function baseNodeId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const hash = raw.indexOf("#");
  return hash === -1 ? raw : raw.slice(0, hash);
}

type ExecStatus = "idle" | "running" | "done" | "error";

const edgeDefaults = {
  type: "smoothstep" as const,
  animated: false,
  style: { strokeWidth: 2 },
  markerEnd: {
    type: MarkerType.ArrowClosed,
    width: 14,
    height: 14,
  },
};

type FlowEditorProps = {
  flowId: string;
};

function toReactFlowNodes(graph: FlowGraph): Node[] {
  return graph.nodes.map((node) => {
    const data = { ...(node.data ?? {}) };
    if (node.execution && !data._execution) {
      data._execution = node.execution;
    }
    return {
      id: node.id,
      type: "flowNode",
      position: node.position ?? { x: 0, y: 0 },
      data: {
        type: node.type,
        label: nodeLabel(node.type),
        data,
      },
    };
  });
}

function toReactFlowEdges(graph: FlowGraph): Edge[] {
  return graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.source_handle ?? undefined,
    targetHandle: edge.target_handle ?? undefined,
    ...edgeDefaults,
  }));
}

function fromReactFlow(nodes: Node[], edges: Edge[], settings: FlowGraph["settings"], flowId: string): FlowGraph {
  return {
    flow_id: flowId,
    settings,
    nodes: nodes.map((node) => {
      const rawData = { ...((node.data.data as Record<string, unknown>) ?? {}) };
      const execution = (rawData._execution as NodeExecutionSettings | undefined) ?? undefined;
      if ("_execution" in rawData) delete rawData._execution;
      return {
        id: node.id,
        type: String(node.data.type),
        data: rawData,
        position: node.position,
        ...(execution && (execution.retry_count || execution.continue_on_fail || execution.retry_delay_ms)
          ? { execution }
          : {}),
      };
    }),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      source_handle: edge.sourceHandle ?? null,
      target_handle: edge.targetHandle ?? null,
    })),
  };
}

function FlowEditorInner({ flowId }: FlowEditorProps) {
  const { theme } = useTheme();
  const toast = useToast();
  const searchParams = useSearchParams();
  const runQueryId = searchParams.get("run");
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [flow, setFlow] = useState<Flow | null>(null);
  const [name, setName] = useState("");
  const [settings, setSettings] = useState<FlowSettings>(defaultGraph().settings);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const [contextMenu, setContextMenu] = useState<FlowContextMenuState | null>(null);
  const [transferNodeId, setTransferNodeId] = useState<string | null>(null);
  const [currentRun, setCurrentRun] = useState<FlowRun | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [pinData, setPinData] = useState<Record<string, unknown>>({});
  const [cronEveryMinutes, setCronEveryMinutes] = useState("");
  const [lztAccounts, setLztAccounts] = useState<LztAccount[]>([]);
  const [rfInstance, setRfInstance] = useState<{
    screenToFlowPosition: (pos: { x: number; y: number }) => { x: number; y: number };
  } | null>(null);
  const loadedRef = useRef(false);
  const autosaveSkipRef = useRef(true);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const execVisitedRef = useRef<Set<string>>(new Set());
  const execPrevNodeRef = useRef<string | null>(null);
  const execClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { canUndo, canRedo, pushHistory, undo, redo, resetHistory } = useFlowHistory({
    nodes: [],
    edges: [],
    settings: defaultGraph().settings,
  });

  const clearExecHighlight = useCallback(() => {
    execVisitedRef.current = new Set();
    execPrevNodeRef.current = null;
    setNodes((current) =>
      current.map((node) => ({
        ...node,
        className: undefined,
        data: {
          ...node.data,
          running: false,
          execStatus: "idle" as ExecStatus,
        },
      })),
    );
    setEdges((current) =>
      current.map((edge) => ({
        ...edge,
        animated: false,
        className: undefined,
      })),
    );
  }, [setEdges, setNodes]);

  const applyExecHighlight = useCallback(
    (currentRaw: string | null, runStatus: string) => {
      const currentId = baseNodeId(currentRaw);
      const prev = execPrevNodeRef.current;
      if (prev && currentId && prev !== currentId) {
        execVisitedRef.current.add(prev);
      }
      if (currentId) {
        execPrevNodeRef.current = currentId;
      }

      const failed = runStatus === "failed" || runStatus === "stopped";
      const finished = !["pending", "running"].includes(runStatus);

      if (finished && currentId) {
        if (failed) {
          // keep current as error, visited as done
        } else {
          execVisitedRef.current.add(currentId);
        }
      }

      const visited = execVisitedRef.current;
      const activeId = finished ? null : currentId;
      const errorId = failed ? currentId : null;
      const isLive = !finished;

      setNodes((current) =>
        current.map((node) => {
          let execStatus: ExecStatus = "idle";
          if (errorId && node.id === errorId) execStatus = "error";
          else if (activeId && node.id === activeId) execStatus = "running";
          else if (visited.has(node.id) || (finished && !failed && node.id === currentId)) execStatus = "done";

          const focus = execStatus === "running" || execStatus === "done" || execStatus === "error";
          return {
            ...node,
            className: isLive ? (focus ? "exec-focus" : "exec-dim") : execStatus !== "idle" ? "exec-focus" : undefined,
            data: {
              ...node.data,
              running: execStatus === "running",
              execStatus,
            },
          };
        }),
      );

      setEdges((current) =>
        current.map((edge) => {
          const sourceDone = visited.has(edge.source) || edge.source === activeId || edge.source === errorId;
          const targetActive = edge.target === activeId;
          const targetDone = visited.has(edge.target) || (finished && !failed && edge.target === currentId);
          const targetError = edge.target === errorId;

          let className: string | undefined;
          let animated = false;
          if (targetError || (failed && edge.target === errorId)) {
            className = "edge-exec-error";
          } else if (targetActive) {
            className = "edge-exec-active particle-edge";
            animated = true;
          } else if (sourceDone && targetDone) {
            className = "edge-exec-done";
          }

          return { ...edge, animated, className };
        }),
      );
    },
    [setEdges, setNodes],
  );
  const getSnapshot = useCallback(
    () => ({
      nodes,
      edges,
      settings,
    }),
    [nodes, edges, settings],
  );

  const applySnapshot = useCallback(
    (snapshot: ReturnType<typeof getSnapshot>) => {
      setNodes(snapshot.nodes);
      setEdges(snapshot.edges);
      setSettings(snapshot.settings);
    },
    [setNodes, setEdges],
  );

  const recordHistory = useCallback(() => {
    if (!loadedRef.current) return;
    pushHistory(getSnapshot());
  }, [getSnapshot, pushHistory]);

  const selectedNode = useMemo(() => {
    const node = nodes.find((item) => item.id === selectedNodeId);
    if (!node) return null;
    return {
      id: node.id,
      type: String(node.data.type),
      data: (node.data.data as Record<string, unknown>) ?? {},
      position: node.position,
    };
  }, [nodes, selectedNodeId]);

  const transferNode = useMemo(() => {
    if (!transferNodeId) return null;
    return nodes.find((n) => n.id === transferNodeId) ?? null;
  }, [nodes, transferNodeId]);

  const webhookUrl = selectedNode ? flow?.webhook_urls?.[selectedNode.id] : undefined;
  const activeExecNodeId = useMemo(() => {
    if (!currentRun || !["pending", "running"].includes(currentRun.status)) return null;
    return baseNodeId(currentRun.current_node_id);
  }, [currentRun]);

  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  useEffect(() => {
    setLoadError("");
    autosaveSkipRef.current = true;
    loadedRef.current = false;
    api
      .getFlow(flowId)
      .then((loaded) => {
        setFlow(loaded);
        setName(loaded.name);
        const graph = loaded.graph_json ?? defaultGraph();
        const nextSettings = graph.settings ?? defaultGraph().settings;
        const nextNodes = toReactFlowNodes(graph);
        const nextEdges = toReactFlowEdges(graph);
        setSettings(nextSettings);
        setNodes(nextNodes);
        setEdges(nextEdges);
        resetHistory({ nodes: nextNodes, edges: nextEdges, settings: nextSettings });
        loadedRef.current = true;
        // skip autosave for initial hydrate
        setTimeout(() => {
          autosaveSkipRef.current = false;
        }, 500);
      })
      .catch((err) => {
        setLoadError(err instanceof Error ? err.message : "Не удалось загрузить flow");
      });
    api
      .getPins(flowId)
      .then((res) => setPinData(res ?? {}))
      .catch(() => setPinData({}));
    api.listNodeTypes().then(setDynamicNodeTypes).catch(() => setDynamicNodeTypes([]));
    api.listLztAccounts().then(setLztAccounts).catch(() => setLztAccounts([]));
  }, [flowId, resetHistory, setEdges, setNodes]);

  const runtimeValue = useMemo(
    () => ({ lztAccounts, loopEnabled: settings.loop }),
    [lztAccounts, settings.loop],
  );
  const primaryAccount = lztAccounts[0] ?? null;
  const tokenConnected = lztAccounts.length > 0;

  // Highlight from ?run= query
  useEffect(() => {
    if (!runQueryId || !loadedRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const [run, nodeRuns] = await Promise.all([
          api.getRun(flowId, runQueryId),
          api.listNodeRuns(flowId, runQueryId),
        ]);
        if (cancelled) return;
        setCurrentRun(run);
        const visited = new Set<string>();
        let errorId: string | null = null;
        for (const nr of nodeRuns) {
          if (nr.status === "success" || nr.status === "done") visited.add(nr.node_id);
          if (nr.status === "failed" || nr.status === "error") errorId = nr.node_id;
        }
        execVisitedRef.current = visited;
        execPrevNodeRef.current = errorId ?? run.current_node_id;
        applyExecHighlight(run.current_node_id, run.status);
        setStatusMessage(`Run ${run.status} · ${runQueryId.slice(0, 8)}`);
      } catch {
        // ignore missing run
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyExecHighlight, flowId, runQueryId, flow]);

  const onSelectionChange = useCallback((params: OnSelectionChangeParams) => {
    const nodeIds = params.nodes.map((node) => node.id);
    const edgeIds = params.edges.map((edge) => edge.id);
    setSelectedNodeIds(nodeIds);
    setSelectedEdgeIds(edgeIds);
    if (nodeIds.length === 1) {
      setSelectedNodeId(nodeIds[0]);
    } else if (nodeIds.length === 0) {
      setSelectedNodeId(null);
    }
  }, []);

  const clearSelection = useCallback(() => {
    setNodes((current) => current.map((node) => ({ ...node, selected: false })));
    setEdges((current) => current.map((edge) => ({ ...edge, selected: false })));
    setSelectedNodeIds([]);
    setSelectedEdgeIds([]);
    setSelectedNodeId(null);
  }, [setEdges, setNodes]);

  const deleteSelected = useCallback(
    (explicitNodeIds?: string[]) => {
      const nodeIds = new Set(explicitNodeIds ?? selectedNodeIds);
      const edgeIds = new Set(selectedEdgeIds);
      if (!nodeIds.size && !edgeIds.size) return;
      recordHistory();
      setNodes((current) => current.filter((node) => !nodeIds.has(node.id)));
      setEdges((current) =>
        current.filter(
          (edge) => !edgeIds.has(edge.id) && !nodeIds.has(edge.source) && !nodeIds.has(edge.target),
        ),
      );
      setSelectedNodeIds([]);
      setSelectedEdgeIds([]);
      if (selectedNodeId && nodeIds.has(selectedNodeId)) {
        setSelectedNodeId(null);
      }
      setContextMenu(null);
    },
    [recordHistory, selectedEdgeIds, selectedNodeId, selectedNodeIds, setEdges, setNodes],
  );

  const duplicateSelected = useCallback(
    (explicitNodeIds?: string[]) => {
      const ids = explicitNodeIds ?? selectedNodeIds;
      if (!ids.length) return;
      const idSet = new Set(ids);
      const selected = nodes.filter((node) => idSet.has(node.id));
      if (!selected.length) return;

      recordHistory();
      const idMap = new Map<string, string>();
      const clones: Node[] = selected.map((node) => {
        const nextId = generateId("node");
        idMap.set(node.id, nextId);
        return {
          ...node,
          id: nextId,
          position: { x: node.position.x + 48, y: node.position.y + 48 },
          selected: true,
          data: {
            ...node.data,
            data: { ...((node.data.data as Record<string, unknown>) ?? {}) },
          },
        };
      });

      const clonedEdges: Edge[] = edges
        .filter((edge) => idSet.has(edge.source) && idSet.has(edge.target))
        .map((edge) => ({
          ...edge,
          id: generateId("e"),
          source: idMap.get(edge.source)!,
          target: idMap.get(edge.target)!,
          selected: true,
        }));

      setNodes((current) => [
        ...current.map((node) => ({ ...node, selected: false })),
        ...clones,
      ]);
      setEdges((current) => [
        ...current.map((edge) => ({ ...edge, selected: false })),
        ...clonedEdges,
      ]);
      setSelectedNodeIds(clones.map((node) => node.id));
      setSelectedEdgeIds(clonedEdges.map((edge) => edge.id));
      if (clones.length === 1) setSelectedNodeId(clones[0].id);
      setContextMenu(null);
    },
    [edges, nodes, recordHistory, selectedNodeIds, setEdges, setNodes],
  );

  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      nodeId: node.id,
    });
    setNodes((current) =>
      current.map((item) => ({
        ...item,
        selected: item.id === node.id,
      })),
    );
    setSelectedNodeIds([node.id]);
    setSelectedNodeId(node.id);
  }, [setNodes]);

  const onPaneContextMenu = useCallback((event: React.MouseEvent | MouseEvent) => {
    event.preventDefault();
    setContextMenu(null);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (typing) return;

      const isMeta = event.metaKey || event.ctrlKey;
      if (isMeta && event.key.toLowerCase() === "z" && !event.shiftKey) {
        event.preventDefault();
        const snapshot = undo(getSnapshot());
        if (snapshot) applySnapshot(snapshot);
      }
      if (isMeta && event.key.toLowerCase() === "z" && event.shiftKey) {
        event.preventDefault();
        const snapshot = redo(getSnapshot());
        if (snapshot) applySnapshot(snapshot);
      }
      if (isMeta && event.key.toLowerCase() === "a") {
        event.preventDefault();
        setNodes((current) => current.map((node) => ({ ...node, selected: true })));
        setEdges((current) => current.map((edge) => ({ ...edge, selected: true })));
      }
      if (isMeta && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicateSelected();
        toast.success("Дублировано");
      }
      if (event.key === "Enter" && selectedNodeIds.length === 1) {
        event.preventDefault();
        setSelectedNodeId(selectedNodeIds[0]);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [applySnapshot, duplicateSelected, getSnapshot, redo, selectedNodeIds, setEdges, setNodes, toast, undo]);

  useEffect(() => {
    if (!currentRun || !["pending", "running"].includes(currentRun.status)) return;

    const stopStream = streamRun(
      flowId,
      currentRun.id,
      (run) => {
        setCurrentRun((prev) => (prev ? { ...prev, ...run } : prev));
        const label = baseNodeId(run.current_node_id) ?? run.current_node_id;
        const prev = execPrevNodeRef.current;
        if (label && label !== prev && ["pending", "running"].includes(run.status)) {
          const rf = nodesRef.current.find((n) => n.id === label);
          const title = rf
            ? String((rf.data as { data?: { title?: string }; label?: string }).data?.title || (rf.data as { label?: string }).label || label)
            : label;
          toast.info("Выполняется", title);
        }
        setStatusMessage(`Run ${run.status}${label ? ` · ${label}` : ""}`);
        applyExecHighlight(run.current_node_id, run.status);

        if (!["pending", "running"].includes(run.status)) {
          setRunning(false);
          if (run.status === "success") toast.success("Сценарий завершён");
          else if (run.status === "failed") toast.error("Сценарий упал", run.error || undefined);
          else if (run.status === "stopped") toast.info("Сценарий остановлен");
          if (execClearTimerRef.current) clearTimeout(execClearTimerRef.current);
          execClearTimerRef.current = setTimeout(() => {
            clearExecHighlight();
          }, 2800);
        }
      },
      () => setRunning(false),
    );

    return () => {
      stopStream();
      if (execClearTimerRef.current) clearTimeout(execClearTimerRef.current);
    };
  }, [applyExecHighlight, clearExecHighlight, currentRun?.id, flowId, toast]);

  const onConnect = useCallback(
    (connection: Connection) => {
      recordHistory();
      const keepAnimated = settings.loop;
      setEdges((current) =>
        addEdge(
          {
            ...connection,
            id: generateId("e"),
            ...edgeDefaults,
            animated: true,
            style: keepAnimated
              ? { ...edgeDefaults.style, stroke: "hsl(var(--primary) / 0.85)" }
              : edgeDefaults.style,
          },
          current,
        ),
      );
      toast.success("Связь создана", "Данные потекут по этой стрелке");
      window.setTimeout(() => {
        setEdges((current) =>
          current.map((edge) =>
            edge.source === connection.source && edge.target === connection.target
              ? { ...edge, animated: keepAnimated }
              : edge,
          ),
        );
      }, 1200);
    },
    [recordHistory, setEdges, settings.loop, toast],
  );

  useEffect(() => {
    if (running) return;
    setEdges((current) =>
      current.map((edge) => ({
        ...edge,
        animated: settings.loop,
        style: settings.loop
          ? { ...edgeDefaults.style, stroke: "hsl(var(--primary) / 0.85)" }
          : edgeDefaults.style,
      })),
    );
  }, [running, settings.loop, setEdges]);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = event.dataTransfer.files?.length ? "copy" : "move";
  }, []);

  const onDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData("application/reactflow");
      const endpointId = event.dataTransfer.getData("application/lzt-endpoint");
      const position = rfInstance
        ? rfInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY })
        : { x: event.clientX - 120, y: event.clientY - 40 };

      const files = event.dataTransfer.files;
      if (files?.length) {
        recordHistory();
        const node = createNode("file_source", position);
        setNodes((current) => [...current, node]);
        try {
          const uploadedIds: string[] = [];
          for (const file of Array.from(files)) {
            const meta = await api.uploadFlowFile(flowId, file, node.id);
            uploadedIds.push(meta.id);
          }
          setNodes((current) =>
            current.map((n) =>
              n.id === node.id
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      data: { ...(n.data.data as object), file_ids: uploadedIds, iterate_lines: true },
                    },
                  }
                : n,
            ),
          );
          setStatusMessage(`Загружено файлов: ${uploadedIds.length}`);
        } catch (err) {
          setStatusMessage(err instanceof Error ? err.message : "Ошибка загрузки файла");
        }
        return;
      }

      if (endpointId) {
        if (settings.loop && type === "flow_end") return;
        recordHistory();
        const node = createNode("api_call", position);
        node.data.data = {
          ...(node.data.data as object),
          endpoint_id: endpointId,
          title: event.dataTransfer.getData("application/lzt-endpoint-title") || endpointId,
        };
        setNodes((current) => [...current, node]);
        return;
      }

      if (!type) return;
      if (settings.loop && type === "flow_end") return;

      recordHistory();
      setNodes((current) => [...current, createNode(type, position)]);
    },
    [flowId, recordHistory, rfInstance, setNodes, settings.loop],
  );

  const onNodesChangeWithHistory = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      const removes = changes.some((change) => change.type === "remove");
      if (removes) recordHistory();
      onNodesChange(changes);
    },
    [onNodesChange, recordHistory],
  );

  const onEdgesChangeWithHistory = useCallback(
    (changes: Parameters<typeof onEdgesChange>[0]) => {
      const removes = changes.some((change) => change.type === "remove");
      if (removes) recordHistory();
      onEdgesChange(changes);
    },
    [onEdgesChange, recordHistory],
  );

  function addNode(type: string) {
    if (settings.loop && type === "flow_end") return;
    recordHistory();
    setNodes((current) => [...current, createNode(type, { x: 120 + current.length * 40, y: 120 + current.length * 20 })]);
  }

  async function saveFlow(silent = false) {
    if (!silent) {
      setSaving(true);
      setStatusMessage("");
    }
    try {
      const graph = fromReactFlow(nodes, edges, settings, flowId);
      const updated = await api.updateFlow(flowId, { name, graph_json: graph });
      setFlow(updated);
      if (!silent) {
        setStatusMessage("Сохранено");
        toast.success("Сохранено");
      } else {
        setStatusMessage("Автосохранение");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Ошибка сохранения";
      setStatusMessage(msg);
      toast.error("Не удалось сохранить", msg);
    } finally {
      if (!silent) setSaving(false);
    }
  }

  // Autosave debounce 2s
  useEffect(() => {
    if (!loadedRef.current || autosaveSkipRef.current) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      saveFlow(true).catch(() => undefined);
    }, 2000);
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, settings, name]);

  async function toggleFlowActive(checked: boolean) {
    try {
      const updated = await api.updateFlow(flowId, { is_active: checked });
      setFlow(updated);
      toast.success(checked ? "Сценарий активен" : "Сценарий выключен");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Ошибка";
      toast.error("Не удалось изменить активность", msg);
    }
  }

  async function runFlowAction() {
    setRunning(true);
    setStatusMessage("Запуск...");
    toast.info("Запуск сценария");
    if (execClearTimerRef.current) clearTimeout(execClearTimerRef.current);
    clearExecHighlight();
    try {
      await saveFlow(true);
      const run = await api.runFlow(flowId);
      setCurrentRun(run);
    } catch (err) {
      setRunning(false);
      const msg = err instanceof Error ? err.message : "Ошибка запуска";
      setStatusMessage(msg);
      toast.error("Не удалось запустить", msg);
    }
  }

  async function stopFlowAction() {
    try {
      const updated = await api.stopFlow(flowId);
      setFlow(updated);
      setRunning(false);
      setStatusMessage("Остановлено");
      toast.info("Остановлено");
      applyExecHighlight(currentRun?.current_node_id ?? null, "stopped");
      if (execClearTimerRef.current) clearTimeout(execClearTimerRef.current);
      execClearTimerRef.current = setTimeout(() => clearExecHighlight(), 1800);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Ошибка остановки";
      setStatusMessage(msg);
      toast.error("Не удалось остановить", msg);
    }
  }

  function updateNodeData(nodeId: string, data: Record<string, unknown>) {
    setNodes((current) =>
      current.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              data: {
                ...node.data,
                data,
              },
            }
          : node,
      ),
    );
    setFlow((current) => {
      if (!current) return current;
      const graph = current.graph_json ?? defaultGraph();
      return {
        ...current,
        graph_json: {
          ...graph,
          nodes: graph.nodes.map((node) => (node.id === nodeId ? { ...node, data } : node)),
        },
      };
    });
  }

  async function handleTestNode(nodeId: string) {
    const rfNode = nodes.find((n) => n.id === nodeId);
    if (!rfNode) return;
    const nodeType = String(rfNode.data.type);
    const nodeData = (rfNode.data.data as Record<string, unknown>) ?? {};
    const result = await api.testNode(flowId, {
      node_id: nodeId,
      node_type: nodeType,
      node_data: nodeData,
      mock_context: pinData,
      pin: true,
    });
    if (result.status === "success" && result.result) {
      const nextPins = { ...pinData, [nodeId]: result.result };
      await api.putPins(flowId, nextPins);
      setPinData(nextPins);
      setStatusMessage(`Тест OK · ${nodeId}`);
      toast.success("Нода проверена", "Данные сохранены для передачи");
    } else {
      throw new Error(result.error || "Тест не прошёл");
    }
  }

  function applyCronEveryMinutes(minutesRaw: string) {
    setCronEveryMinutes(minutesRaw);
    const n = Number(minutesRaw);
    if (!n || n < 1) return;
    setSettings((current) => ({
      ...current,
      cron_expression: `*/${Math.floor(n)} * * * *`,
    }));
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border/80 bg-panel/95 px-2.5 backdrop-blur-sm">
        <div className="flex min-w-0 items-center gap-2">
          <AppLogo className="scale-90" />
          <div className="hidden h-4 w-px bg-border sm:block" />
          <Input
            className="h-7 w-40 border-transparent bg-transparent px-1.5 text-[13px] font-medium shadow-none focus-visible:border-border focus-visible:bg-card focus-visible:ring-1 sm:w-52"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {statusMessage || loadError ? (
            <span
              className={`hidden truncate text-[11px] md:inline ${loadError ? "text-destructive" : "text-muted-foreground"}`}
            >
              {loadError || statusMessage}
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-1">
          <Link
            href="/credentials"
            className={`mr-1 hidden max-w-[160px] items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium transition hover:opacity-90 sm:inline-flex ${
              tokenConnected
                ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300"
            }`}
            title={
              tokenConnected
                ? `LZT: ${primaryAccount?.nickname || "аккаунт подключён"}`
                : "Добавить LZT-токен в Credentials"
            }
          >
            <KeyRound className="h-3 w-3 shrink-0" />
            <span className="truncate">
              {tokenConnected
                ? `Token · ${primaryAccount?.nickname || "connected"}`
                : "Нет токена"}
            </span>
          </Link>
          <div className="mr-1 hidden items-center gap-1.5 rounded-md border border-border/70 px-1.5 py-0.5 md:flex">
            <Switch
              checked={settings.loop}
              onCheckedChange={(checked) => setSettings((current) => ({ ...current, loop: checked }))}
            />
            <Label
              className="text-[10px] text-muted-foreground"
              title={settings.loop ? "Цикл по интервалу — нода End не нужна" : "Включить повторный запуск"}
            >
              Loop
            </Label>
            <Input
              className="h-6 w-12 border-0 bg-transparent px-0.5 text-[11px] shadow-none focus-visible:ring-0"
              type="number"
              min={1}
              title="Интервал (сек)"
              value={settings.interval_seconds}
              onChange={(e) =>
                setSettings((current) => ({ ...current, interval_seconds: Number(e.target.value) || 120 }))
              }
            />
            <span className="text-[9px] text-muted-foreground">сек</span>
            <div className="hidden h-4 w-px bg-border lg:block" />
            <Input
              className="hidden h-6 w-14 border-0 bg-transparent px-0.5 text-[11px] shadow-none focus-visible:ring-0 lg:block"
              type="number"
              min={1}
              placeholder="N мин"
              title="Каждые N минут (cron)"
              value={cronEveryMinutes}
              onChange={(e) => applyCronEveryMinutes(e.target.value)}
            />
            <Input
              className="hidden h-6 w-28 border-0 bg-transparent px-0.5 font-mono text-[10px] shadow-none focus-visible:ring-0 xl:block"
              placeholder="cron"
              value={settings.cron_expression ?? ""}
              onChange={(e) =>
                setSettings((current) => ({ ...current, cron_expression: e.target.value || null }))
              }
            />
            <Input
              className="hidden h-6 w-16 border-0 bg-transparent px-0.5 font-mono text-[10px] shadow-none focus-visible:ring-0 xl:block"
              placeholder="TZ"
              title="Timezone"
              value={settings.cron_timezone ?? "UTC"}
              onChange={(e) =>
                setSettings((current) => ({ ...current, cron_timezone: e.target.value || "UTC" }))
              }
            />
            <Input
              className="hidden h-6 w-24 border-0 bg-transparent px-0.5 font-mono text-[10px] shadow-none focus-visible:ring-0 2xl:block"
              placeholder="proxy"
              value={settings.proxy ?? ""}
              onChange={(e) =>
                setSettings((current) => ({ ...current, proxy: e.target.value || null }))
              }
              title="Прокси на уровне flow (socks5://… / http://…)"
            />
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={!canUndo}
            onClick={() => {
              const snapshot = undo(getSnapshot());
              if (snapshot) applySnapshot(snapshot);
            }}
          >
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={!canRedo}
            onClick={() => {
              const snapshot = redo(getSnapshot());
              if (snapshot) applySnapshot(snapshot);
            }}
          >
            <Redo2 className="h-3.5 w-3.5" />
          </Button>
          <div
            className="mr-1 flex items-center gap-1.5 rounded-md border border-border/70 px-1.5 py-0.5"
            title="Активный сценарий принимает webhook и запускается по расписанию"
          >
            <Switch checked={flow?.is_active ?? false} onCheckedChange={toggleFlowActive} />
            <Label className="text-[10px] text-muted-foreground">Активен</Label>
          </div>
          <Button variant="outline" size="sm" className="h-7 gap-1 px-2.5 text-[12px]" onClick={() => saveFlow()} disabled={saving}>
            <Save className="h-3.5 w-3.5" />
            {saving ? "..." : "Save"}
          </Button>
          <Button size="sm" className="h-7 gap-1 px-2.5 text-[12px]" onClick={runFlowAction} disabled={running}>
            <Play className="h-3.5 w-3.5" />
            {running ? "..." : "Run"}
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={stopFlowAction} aria-label="Stop">
            <Square className="h-3 w-3" />
          </Button>
          <ThemeToggle />
        </div>
      </header>

      <FlowRuntimeProvider value={runtimeValue}>
      <div className="flex min-h-0 flex-1">
        <NodePalette onAdd={addNode} loopEnabled={settings.loop} />
        <div ref={reactFlowWrapper} className="relative min-w-0 flex-1 bg-canvas">
          {settings.loop ? (
            <div className="pointer-events-none absolute left-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-panel/90 px-2.5 py-1 text-[10px] font-medium text-primary shadow-sm backdrop-blur-sm">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
              Loop · каждые {settings.interval_seconds || 120} с
            </div>
          ) : null}
          <ReactFlow
            className="h-full w-full"
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChangeWithHistory}
            onEdgesChange={onEdgesChangeWithHistory}
            onConnect={onConnect}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onInit={setRfInstance}
            nodeTypes={flowNodeTypes}
            defaultEdgeOptions={{
              ...edgeDefaults,
              animated: settings.loop,
              style: settings.loop
                ? { ...edgeDefaults.style, stroke: "hsl(var(--primary) / 0.85)" }
                : edgeDefaults.style,
            }}
            connectionLineType={ConnectionLineType.SmoothStep}
            connectionLineStyle={{ stroke: "hsl(var(--primary))", strokeWidth: 2 }}
            fitView
            fitViewOptions={{ padding: 0.18 }}
            minZoom={0.2}
            maxZoom={2}
            deleteKeyCode={["Backspace", "Delete"]}
            multiSelectionKeyCode={["Meta", "Control", "Shift"]}
            selectionOnDrag
            selectionMode={SelectionMode.Partial}
            panOnDrag={[1, 2]}
            panOnScroll
            zoomOnDoubleClick={false}
            onSelectionChange={onSelectionChange}
            onNodeClick={(_, node) => {
              setContextMenu(null);
              setSelectedNodeId(node.id);
            }}
            onPaneClick={() => {
              setContextMenu(null);
              setSelectedNodeId(null);
            }}
            onNodeContextMenu={onNodeContextMenu}
            onPaneContextMenu={onPaneContextMenu}
            onNodeDragStart={() => recordHistory()}
            onSelectionDragStart={() => recordHistory()}
            proOptions={{ hideAttribution: true }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={22}
              size={1}
              color={theme === "dark" ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.08)"}
            />
            <Controls showInteractive={false} position="top-left" />
            <MiniMap
              position="bottom-left"
              pannable
              zoomable
              className="!bg-panel/90 !border-border/80"
              maskColor={theme === "dark" ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.6)"}
              nodeColor={() => (theme === "dark" ? "#475569" : "#94a3b8")}
            />
          </ReactFlow>

          <SelectionToolbar
            count={selectedNodeIds.length}
            onDuplicate={() => {
              duplicateSelected();
              toast.success("Дублировано");
            }}
            onDelete={() => {
              deleteSelected();
              toast.info("Удалено");
            }}
            onClear={clearSelection}
            onTransfer={
              selectedNodeIds.length === 1
                ? () => setTransferNodeId(selectedNodeIds[0])
                : undefined
            }
          />

          {selectedNode && selectedNodeIds.length <= 1 ? (
            <NodeConfigDrawer
              node={selectedNode}
              webhookUrl={webhookUrl}
              flowId={flowId}
              pinData={pinData}
              graphNodes={nodes.map((n) => ({
                id: n.id,
                type: String((n.data as { type?: string }).type || n.type),
                data: ((n.data as { data?: Record<string, unknown> }).data || {}) as Record<string, unknown>,
                position: n.position,
              }))}
              onChange={updateNodeData}
              onClose={() => setSelectedNodeId(null)}
              onPinUpdate={setPinData}
              onTestNode={handleTestNode}
            />
          ) : null}

          {transferNode ? (
            <DataTransferPanel
              nodeId={transferNode.id}
              nodeType={String(transferNode.data.type)}
              title={String(
                (transferNode.data.data as { title?: string } | undefined)?.title ||
                  transferNode.data.label ||
                  "",
              )}
              pinPayload={pinData[transferNode.id]}
              onClose={() => setTransferNodeId(null)}
            />
          ) : null}

          {contextMenu ? (
            <FlowContextMenu
              menu={contextMenu}
              nodeTitle={(() => {
                const n = nodes.find((item) => item.id === contextMenu.nodeId);
                if (!n) return contextMenu.nodeId;
                return String(
                  (n.data.data as { title?: string } | undefined)?.title ||
                    n.data.label ||
                    nodeLabel(String(n.data.type)),
                );
              })()}
              onClose={() => setContextMenu(null)}
              onOpenSettings={(nodeId) => setSelectedNodeId(nodeId)}
              onDuplicate={(nodeId) => {
                duplicateSelected([nodeId]);
                toast.success("Нода дублирована");
              }}
              onDelete={(nodeId) => {
                deleteSelected([nodeId]);
                toast.info("Нода удалена");
              }}
              onCopyId={async (nodeId) => {
                try {
                  await navigator.clipboard.writeText(nodeId);
                  toast.success("ID скопирован", nodeId);
                } catch {
                  toast.info(nodeId);
                }
              }}
              onTransferData={(nodeId) => {
                setTransferNodeId(nodeId);
                setSelectedNodeId(nodeId);
              }}
              onTestNode={async (nodeId) => {
                try {
                  await handleTestNode(nodeId);
                } catch (err) {
                  toast.error("Тест не прошёл", err instanceof Error ? err.message : undefined);
                }
              }}
              onRunFromHere={() => {
                runFlowAction().catch(() => undefined);
              }}
            />
          ) : null}

          <FlowLogsPanel
            flowId={flowId}
            runId={currentRun?.id ?? null}
            liveLines={statusMessage ? [statusMessage] : []}
            activeNodeId={activeExecNodeId}
            onSelectNode={(nodeId) => {
              setSelectedNodeId(nodeId);
              setNodes((current) =>
                current.map((node) => ({
                  ...node,
                  selected: node.id === nodeId,
                })),
              );
            }}
          />
        </div>
      </div>
      </FlowRuntimeProvider>
    </div>
  );
}

export function FlowEditor({ flowId }: FlowEditorProps) {
  return (
    <ReactFlowProvider>
      <Suspense fallback={<div className="flex h-screen items-center justify-center text-sm text-muted-foreground">Загрузка…</div>}>
        <FlowEditorInner flowId={flowId} />
      </Suspense>
    </ReactFlowProvider>
  );
}
