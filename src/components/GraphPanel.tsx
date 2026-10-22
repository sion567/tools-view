import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { toPng, toSvg } from "html-to-image";
import "@xyflow/react/dist/style.css";
import {
  buildGraph,
  layoutGraph,
  MAX_NODES,
  type Direction,
  type GraphNode,
  type GraphNodeData,
} from "../lib/graph";

function KvNode({ data }: NodeProps<GraphNode>) {
  // 方向联动 handle：横向 = 左进右出，纵向 = 上进下出
  const horizontal = data.direction === "horizontal";
  return (
    <div className={`kv-node kv-${data.kind}`} title={data.title}>
      <Handle
        type="target"
        position={horizontal ? Position.Left : Position.Top}
        className="kv-handle"
      />
      <span className="kv-label">{data.label}</span>
      <Handle
        type="source"
        position={horizontal ? Position.Right : Position.Bottom}
        className="kv-handle"
      />
    </div>
  );
}

const nodeTypes = { kv: KvNode };

function minimapColor(node: Node): string {
  const kind = (node.data as GraphNodeData).kind;
  if (kind === "object") return "#4f8cff";
  if (kind === "array") return "#b07cff";
  return "#3ecf8e";
}

function GraphInner({ value }: { value: unknown }) {
  const [direction, setDirection] = useState<Direction>("vertical");
  const [downloading, setDownloading] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { fitView } = useReactFlow();

  const { nodes: baseNodes, edges: baseEdges, truncated, total } = useMemo(
    () => buildGraph(value),
    [value],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<GraphNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // 数据或方向变化时重新用 elkjs 计算布局
  useEffect(() => {
    let cancelled = false;
    layoutGraph(baseNodes, baseEdges, direction)
      .then((laidNodes) => {
        if (cancelled) return;
        setNodes(laidNodes);
        setEdges(baseEdges);
        requestAnimationFrame(() => {
          fitView({ padding: 0.12, maxZoom: 1.2, duration: 200 });
        });
      })
      .catch((err) => console.error("elk 布局失败", err));
    return () => {
      cancelled = true;
    };
  }, [baseNodes, baseEdges, direction, fitView, setNodes, setEdges]);

  const download = useCallback(async (fmt: "png" | "svg") => {
    const el = wrapperRef.current;
    if (!el) return;
    setDownloading(true);
    try {
      const options = {
        backgroundColor: "#0d1117",
        pixelRatio: 2,
        // 导出时排除 Controls / MiniMap 等浮动面板
        filter: (domNode: HTMLElement) =>
          !(domNode.classList && domNode.classList.contains("react-flow__panel")),
      };
      const url = fmt === "png" ? await toPng(el, options) : await toSvg(el, options);
      const a = document.createElement("a");
      a.href = url;
      a.download = `graph-${Date.now()}.${fmt}`;
      a.click();
    } catch (err) {
      console.error("导出图片失败", err);
    } finally {
      setDownloading(false);
    }
  }, []);

  const hasGraph = nodes.length > 0;

  return (
    <section className="panel graph-panel">
      <header className="panel-header">
        <span className="panel-title">图线区</span>
        {hasGraph && (
          <span className="badge muted">
            {truncated ? `${nodes.length} / ${total} 节点` : `${nodes.length} 节点`}
          </span>
        )}
        {truncated && <span className="badge warn">已截断</span>}
        <div className="panel-actions">
          <div className="seg" role="group" aria-label="布局方向">
            <button
              className={direction === "vertical" ? "active" : ""}
              onClick={() => setDirection("vertical")}
              title="上 → 下"
            >
              纵向
            </button>
            <button
              className={direction === "horizontal" ? "active" : ""}
              onClick={() => setDirection("horizontal")}
              title="左 → 右"
            >
              横向
            </button>
          </div>
          <button
            className="btn"
            disabled={!hasGraph || downloading}
            onClick={() => download("png")}
          >
            下载 PNG
          </button>
          <button
            className="btn"
            disabled={!hasGraph || downloading}
            onClick={() => download("svg")}
          >
            下载 SVG
          </button>
        </div>
      </header>
      <div className="panel-body">
        <div className="flow-wrap" id="react-flow-container" ref={wrapperRef}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            colorMode="dark"
            fitView
            minZoom={0.05}
            proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={{
              type: "smoothstep",
              style: { stroke: "#41506b", strokeWidth: 1.5 },
            }}
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#2a3348" />
            <Controls showInteractive={false} position="bottom-right" />
            <MiniMap pannable zoomable nodeColor={minimapColor} position="bottom-left" />
          </ReactFlow>
          {!hasGraph && (
            <div className="flow-empty">在上方粘贴 JSON / YAML / XML，自动生成节点关系图</div>
          )}
        </div>
      </div>
    </section>
  );
}

export default function GraphPanel({ value }: { value: unknown }) {
  return (
    <ReactFlowProvider>
      <GraphInner value={value} />
    </ReactFlowProvider>
  );
}
