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
import "@xyflow/react/dist/style.css";import {
  buildGraph,
  layoutGraph,
  MAX_NODES,
  type Direction,
  type GraphNode,
  type GraphNodeData,
} from "../lib/graph";
import {
  buildGraphContent,
  downloadBlob,
  pickScale,
  planBands,
  rasterizeBand,
  rasterizeSvg,
} from "../lib/graphExport";
import type { Theme } from "../lib/theme";

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

function GraphInner({ value, theme }: { value: unknown; theme: Theme }) {
  const [direction, setDirection] = useState<Direction>("vertical");
  const [downloading, setDownloading] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { fitView } = useReactFlow();

  const { nodes: baseNodes, edges: baseEdges, truncated, total } = useMemo(
    () => buildGraph(value),
    [value],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<GraphNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // 数据或方向变化时重新计算树布局（自研 Reingold–Tilford，同步毫秒级）
  useEffect(() => {
    setNodes(layoutGraph(baseNodes, baseEdges, direction));
    setEdges(baseEdges);
    requestAnimationFrame(() => {
      fitView({ padding: 0.12, maxZoom: 1.2, duration: 200 });
    });
  }, [baseNodes, baseEdges, direction, fitView, setNodes, setEdges]);

  const download = useCallback(
    async (fmt: "png" | "svg") => {
      if (nodes.length === 0) return;
      setDownloading(true);
      setExportNote(null);
      try {
        // 按图的真实坐标（zoom = 1）重新生成一份 SVG，
        // 而不是截取当前视口——节点多时后者会把整张图压扁。
        const { full, content, width, height } = buildGraphContent(nodes, edges);
        const name = `graph-${Date.now()}`;

        if (fmt === "svg") {
          downloadBlob(
            new Blob([full.svg], { type: "image/svg+xml;charset=utf-8" }),
            `${name}.svg`,
          );
          return;
        }

        const bands = planBands(width, height);
        if (bands.length === 1) {
          const blob = await rasterizeSvg(full.svg, width, height);
          downloadBlob(blob, `${name}.png`);
          return;
        }

        // 图比一张画布还大：分块导出，每块都是原始分辨率
        setExportNote(
          `图宽 ${width}px，超出单张 PNG 上限，正在分 ${bands.length} 块导出。`,
        );
        const scale = pickScale(bands[0].width, bands[0].height);
        for (let i = 0; i < bands.length; i++) {
          const blob = await rasterizeBand(content, bands[i], scale);
          downloadBlob(blob, `${name}-${i + 1}of${bands.length}.png`);
        }
      } catch (err) {
        console.error("导出图片失败", err);
        setExportNote("导出失败，请改用 SVG 试试。");
      } finally {
        setDownloading(false);
      }
    },
    [nodes, edges],
  );

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
        {exportNote && <span className="badge warn">{exportNote}</span>}
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
            colorMode={theme}
            fitView
            minZoom={0.05}
            proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={{
              type: "smoothstep",
              style: {
                stroke: theme === "dark" ? "#41506b" : "#a9b4c7",
                strokeWidth: 1.5,
              },
            }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={18}
              size={1}
              color={theme === "dark" ? "#2a3348" : "#cbd3e1"}
            />
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

export default function GraphPanel({ value, theme }: { value: unknown; theme: Theme }) {
  return (
    <ReactFlowProvider>
      <GraphInner value={value} theme={theme} />
    </ReactFlowProvider>
  );
}
