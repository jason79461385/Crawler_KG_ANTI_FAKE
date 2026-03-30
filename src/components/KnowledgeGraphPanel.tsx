import { useEffect, useRef } from "react";
import { Network } from "vis-network/standalone";
import type { GraphEdge, GraphNode } from "../types";

type KnowledgeGraphPanelProps = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export function KnowledgeGraphPanel({
  nodes,
  edges,
}: KnowledgeGraphPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const network = new Network(
      containerRef.current,
      {
        nodes: nodes.map((node) => ({
          id: node.id,
          label: node.label,
          title: `${node.type} / weight ${node.weight}`,
          value: Math.max(16, node.weight * 10),
          shape: "dot",
          color: {
            background: node.id.startsWith("post:")
              ? "#39b9ff"
              : node.type === "keyword"
                ? "#93c5fd"
                : "#7dd3fc",
            border: "#dff6ff",
            highlight: {
              background: "#f8fafc",
              border: "#39b9ff",
            },
          },
          font: {
            color: "#eff6ff",
            face: "Noto Sans TC",
            size: 18,
            strokeWidth: 0,
          },
        })),
        edges: edges.map((edge, index) => ({
          id: `${edge.from}-${edge.to}-${index}`,
          from: edge.from,
          to: edge.to,
          label: edge.relation,
          color: {
            color: "rgba(125, 211, 252, 0.45)",
            highlight: "#7dd3fc",
          },
          font: {
            color: "#cbd5e1",
            size: 12,
          },
          smooth: {
            enabled: true,
            type: "dynamic",
            roundness: 0.35,
          },
        })),
      },
      {
        autoResize: true,
        height: "420px",
        width: "100%",
        physics: {
          stabilization: false,
          barnesHut: {
            gravitationalConstant: -2600,
            centralGravity: 0.1,
            springLength: 130,
            springConstant: 0.04,
          },
        },
        interaction: {
          hover: true,
        },
        nodes: {
          borderWidth: 1,
        },
      },
    );

    return () => {
      network.destroy();
    };
  }, [nodes, edges]);

  return <div ref={containerRef} className="h-[420px] w-full rounded-[22px] bg-slate-950/20" />;
}
