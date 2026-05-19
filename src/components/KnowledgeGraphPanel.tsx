import { useEffect, useImperativeHandle, useMemo, useRef, forwardRef } from "react";
import { DataSet } from "vis-data/standalone";
import { Network, type Node as VisNode, type Edge as VisEdge } from "vis-network/standalone";
import type { GraphEdge, GraphNode } from "../types";

// 高對比配色 — 案例(post)用最顯眼的橘色,實體類型各自分色
export const NODE_TYPE_COLORS: Record<
  string,
  { bg: string; border: string; text: string }
> = {
  post: { bg: "#f97316", border: "#fed7aa", text: "#1a0a00" }, // orange-500
  keyword: { bg: "#facc15", border: "#fef08a", text: "#1a1500" }, // yellow-400
  channel: { bg: "#34d399", border: "#a7f3d0", text: "#04231a" }, // emerald-400
  account: { bg: "#f472b6", border: "#fbcfe8", text: "#260a18" }, // pink-400
  platform: { bg: "#a78bfa", border: "#ddd6fe", text: "#180a26" }, // violet-400
  money: { bg: "#fb7185", border: "#fecdd3", text: "#260a14" }, // rose-400
  default: { bg: "#94a3b8", border: "#cbd5e1", text: "#0f172a" }, // slate-400
};

export function colorForGroup(group: string) {
  return NODE_TYPE_COLORS[group] ?? NODE_TYPE_COLORS.default;
}

export type KnowledgeGraphHandle = {
  fit: () => void;
  togglePhysics: (enabled: boolean) => void;
  focusNode: (id: string) => void;
  resetSelection: () => void;
};

type KnowledgeGraphPanelProps = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  height?: string;
  onNodeClick?: (node: GraphNode | null) => void;
  /** 為空 = 顯示全部;有值 = 只顯示這幾個 group 的節點 */
  highlightedTypes?: Set<string>;
  searchTerm?: string;
};

export const KnowledgeGraphPanel = forwardRef<
  KnowledgeGraphHandle,
  KnowledgeGraphPanelProps
>(function KnowledgeGraphPanel(
  { nodes, edges, height = "560px", onNodeClick, highlightedTypes, searchTerm },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const networkRef = useRef<Network | null>(null);
  const nodesDsRef = useRef<DataSet<VisNode> | null>(null);
  const edgesDsRef = useRef<DataSet<VisEdge> | null>(null);
  const onNodeClickRef = useRef(onNodeClick);
  onNodeClickRef.current = onNodeClick;

  // adjacency 用於 hover 時高亮鄰居
  const adjacency = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const e of edges) {
      if (!map.has(e.from)) map.set(e.from, new Set());
      if (!map.has(e.to)) map.set(e.to, new Set());
      map.get(e.from)!.add(e.to);
      map.get(e.to)!.add(e.from);
    }
    return map;
  }, [edges]);

  // 計算當下要顯示哪些節點 / 邊
  const { visibleNodeIds, visibleEdgeIds } = useMemo(() => {
    const term = searchTerm?.trim().toLowerCase() ?? "";
    const hasTypeFilter = highlightedTypes && highlightedTypes.size > 0;
    const visN = new Set<string>();
    for (const n of nodes) {
      const okType = !hasTypeFilter || highlightedTypes!.has(n.group);
      const okSearch = !term || n.label.toLowerCase().includes(term);
      if (okType && okSearch) visN.add(n.id);
    }
    const visE = new Set<string>();
    edges.forEach((e, idx) => {
      if (visN.has(e.from) && visN.has(e.to)) {
        visE.add(`${e.from}->${e.to}#${idx}`);
      }
    });
    return { visibleNodeIds: visN, visibleEdgeIds: visE };
  }, [nodes, edges, highlightedTypes, searchTerm]);

  // 初始化 / 重新初始化(只在 nodes/edges 整批換掉時才重建)
  useEffect(() => {
    if (!containerRef.current) return;

    const visNodes = nodes.map((node) => buildVisNode(node));
    const visEdges = edges.map((edge, index) => buildVisEdge(edge, index));
    const nodesDs = new DataSet<VisNode>(visNodes);
    const edgesDs = new DataSet<VisEdge>(visEdges);
    nodesDsRef.current = nodesDs;
    edgesDsRef.current = edgesDs;

    const network = new Network(
      containerRef.current,
      { nodes: nodesDs, edges: edgesDs },
      {
        autoResize: true,
        height,
        width: "100%",
        physics: {
          enabled: true,
          stabilization: { enabled: true, iterations: 90, fit: true, updateInterval: 30 },
          barnesHut: {
            gravitationalConstant: -3000,
            centralGravity: 0.18,
            springLength: 130,
            springConstant: 0.06,
            damping: 0.4,
            avoidOverlap: 0.6,
          },
          minVelocity: 1,
          maxVelocity: 30,
          timestep: 0.45,
        },
        interaction: {
          hover: true,
          tooltipDelay: 100,
          navigationButtons: true,
          keyboard: { enabled: true, bindToWindow: false },
          multiselect: false,
          zoomView: true,
          dragView: true,
          hideEdgesOnDrag: false,
        },
        nodes: {
          borderWidth: 2,
          shadow: { enabled: true, color: "rgba(8,145,178,0.4)", size: 8, x: 0, y: 3 },
          scaling: {
            min: 8,
            max: 34,
            label: { enabled: true, min: 11, max: 16, drawThreshold: 1, maxVisible: 60 },
          },
        },
        edges: {
          selectionWidth: 2,
          smooth: { enabled: true, type: "dynamic", roundness: 0.35 },
        },
      },
    );

    networkRef.current = network;

    network.once("stabilizationIterationsDone", () => {
      network.setOptions({ physics: { enabled: false } });
    });

    network.on("hoverNode", (params: { node: string }) => {
      highlightNeighborhood(params.node);
    });
    network.on("blurNode", () => {
      resetHighlight();
    });
    network.on("click", (params: { nodes: string[] }) => {
      if (params.nodes.length === 0) {
        onNodeClickRef.current?.(null);
        resetHighlight();
        return;
      }
      const id = params.nodes[0];
      const node = nodes.find((n) => n.id === id) ?? null;
      onNodeClickRef.current?.(node);
      highlightNeighborhood(id);
    });

    return () => {
      network.destroy();
      networkRef.current = null;
      nodesDsRef.current = null;
      edgesDsRef.current = null;
    };

    function highlightNeighborhood(centerId: string) {
      const ds = nodesDsRef.current;
      if (!ds) return;
      const neighbors = adjacency.get(centerId) ?? new Set<string>();
      const updates = nodes
        .filter((n) => visibleNodeIds.has(n.id))
        .map((n) => {
          const isCenter = n.id === centerId;
          const isNeighbor = neighbors.has(n.id);
          const dim = !isCenter && !isNeighbor;
          return {
            id: n.id,
            opacity: dim ? 0.25 : 1,
            borderWidth: isCenter ? 4 : isNeighbor ? 3 : 2,
          } as Partial<VisNode> & { id: string };
        });
      ds.update(updates);
    }

    function resetHighlight() {
      const ds = nodesDsRef.current;
      if (!ds) return;
      const updates = nodes
        .filter((n) => visibleNodeIds.has(n.id))
        .map(
          (n) =>
            ({
              id: n.id,
              opacity: 1,
              borderWidth: 2,
            }) as Partial<VisNode> & { id: string },
        );
      ds.update(updates);
    }
  }, [nodes, edges, height, adjacency, visibleNodeIds]);

  // 真正的「過濾熱載」:用 DataSet.update + hidden 切換,physics 短暫重啟讓圖重新排版
  useEffect(() => {
    const nodesDs = nodesDsRef.current;
    const edgesDs = edgesDsRef.current;
    const network = networkRef.current;
    if (!nodesDs || !edgesDs || !network) return;

    const nodeUpdates = nodes.map((n) => ({
      id: n.id,
      hidden: !visibleNodeIds.has(n.id),
      physics: visibleNodeIds.has(n.id),
      opacity: 1,
    }));
    nodesDs.update(nodeUpdates);

    const edgeUpdates = edges.map((e, idx) => {
      const id = `${e.from}->${e.to}#${idx}`;
      const visible = visibleEdgeIds.has(id);
      return { id, hidden: !visible, physics: visible };
    });
    edgesDs.update(edgeUpdates);

    // 切完馬上開 physics 短暫 re-layout,再自動關
    network.setOptions({ physics: { enabled: true } });
    const timer = setTimeout(() => {
      network.setOptions({ physics: { enabled: false } });
      network.fit({ animation: { duration: 350, easingFunction: "easeInOutQuad" } });
    }, 700);

    return () => clearTimeout(timer);
  }, [visibleNodeIds, visibleEdgeIds, nodes, edges]);

  useImperativeHandle(
    ref,
    () => ({
      fit: () => networkRef.current?.fit({ animation: { duration: 400, easingFunction: "easeInOutQuad" } }),
      togglePhysics: (enabled) => networkRef.current?.setOptions({ physics: { enabled } }),
      focusNode: (id) => {
        networkRef.current?.focus(id, {
          scale: 1.4,
          animation: { duration: 500, easingFunction: "easeInOutQuad" },
        });
        networkRef.current?.selectNodes([id]);
      },
      resetSelection: () => networkRef.current?.unselectAll(),
    }),
    [],
  );

  return (
    <div
      ref={containerRef}
      className="w-full overflow-hidden rounded-2xl border border-white/8 bg-[radial-gradient(circle_at_center,rgba(34,211,238,0.06)_0%,rgba(15,23,38,0.95)_70%)]"
      style={{ height }}
    />
  );
});

function buildVisNode(node: GraphNode): VisNode {
  const isPost = node.id.startsWith("post:");
  const groupKey = isPost ? "post" : node.group;
  const palette = colorForGroup(groupKey);
  // 兩種節點都用 dot(尺寸 = value),label 在點下方。
  // 比起 circle/ellipse(label 在裡面把圈撐大),這種大小可控且不會擋畫面
  const value = isPost
    ? Math.max(18, Math.min(34, node.weight * 2 + 14))
    : Math.max(8, Math.min(20, node.weight * 1.5 + 6));

  return {
    id: node.id,
    label: isPost ? truncate(node.label, 14) : truncate(node.label, 10),
    title: tooltip(node, isPost),
    value,
    shape: "dot",
    color: {
      background: palette.bg,
      border: palette.border,
      highlight: { background: palette.bg, border: "#ffffff" },
      hover: { background: palette.bg, border: "#ffffff" },
    },
    font: {
      // label 在 dot 外面 → 用淺色搭背景(深色)+ 細微 stroke 描邊以分明
      color: isPost ? "#fed7aa" : "#cbd5e1",
      face: "Noto Sans TC, system-ui",
      size: isPost ? 13 : 11,
      strokeWidth: 3,
      strokeColor: "rgba(7, 18, 36, 0.85)",
      multi: false,
      vadjust: 0,
    },
    margin: { top: 6, bottom: 6, left: 8, right: 8 },
  } as VisNode;
}

function buildVisEdge(edge: GraphEdge, index: number) {
  return {
    id: `${edge.from}->${edge.to}#${index}`,
    from: edge.from,
    to: edge.to,
    label: edge.relation,
    arrows: { to: { enabled: true, scaleFactor: 0.5 } },
    color: {
      color: "rgba(148, 163, 184, 0.4)",
      highlight: "#22d3ee",
      hover: "#22d3ee",
    },
    font: {
      color: "rgba(203, 213, 225, 0.85)",
      size: 10,
      strokeWidth: 0,
      align: "middle" as const,
    },
    width: 1,
    hoverWidth: 2,
    smooth: { enabled: true, type: "dynamic", roundness: 0.35 } as never,
  };
}

function truncate(input: string, max: number) {
  if (!input) return "";
  if (input.length <= max) return input;
  return input.slice(0, max) + "…";
}

function tooltip(node: GraphNode, isPost: boolean) {
  const lines = [
    `<b>${escapeHtml(node.label)}</b>`,
    `Type: ${escapeHtml(node.type)}`,
    `${isPost ? "Entities count" : "Mention weight"}: ${node.weight}`,
  ];
  return lines.join("<br/>");
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
