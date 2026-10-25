import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { parseEnum, usePersistentState } from "../lib/usePersistentState";
import {
  IconColumns,
  IconMaximize,
  IconPng,
  IconSvg,
  IconButton,
} from "./icons";
import type { Theme } from "../lib/theme";

/** 节点数超过此值时隐藏小地图（其渲染所有节点，大图时开销大） */
const MINIMAP_MAX_NODES = 1500;

function KvNode({ data }: NodeProps<GraphNode>) {
  // 方向联动 handle：横向 = 左进右出，纵向 = 上进下出
  const horizontal = data.direction === "horizontal";
  const matched = (data as GraphNodeData & { matched?: boolean }).matched;
  const cls =
    matched === undefined ? "" : matched ? " kv-hit" : " kv-dim";
  return (
    <div
      className={`kv-node kv-${data.kind}${cls}`}
      title={`${data.path}\n${data.title}`}
    >
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

function GraphInner({
  value,
  theme,
  query,
  onLocateNode,
  hidden,
  fullscreen,
  onToggleFullscreen,
}: {
  value: unknown;
  theme: Theme;
  query: string;
  onLocateNode?: (nodeId: string) => void;
  hidden?: boolean;
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
}) {
  // 方向持久化：面板会随数据清空而卸载，普通 state 会悄悄重置回纵向
  const [direction, setDirection] = usePersistentState<Direction>(
    "tools-view.graphDirection",
    "vertical",
    parseEnum<Direction>(["vertical", "horizontal"]),
    String,
  );
  const [downloading, setDownloading] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [copiedNote, setCopiedNote] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { fitView } = useReactFlow();

  // value 为 null/undefined（尚未解析）时不建图，保持空态提示
  const { nodes: baseNodes, edges: baseEdges, truncated, total } = useMemo(
    () => (value == null ? EMPTY_BUILD : buildGraph(value)),
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

  // 面板尺寸变化（全屏/并排切换、分栏拖拽、窗口缩放）后重新适配视图：
  // React Flow 内部对容器尺寸的感知有自己的 ResizeObserver，直接在 props 变化的
  // 同一帧 fitView 会拿到旧尺寸，因此监听容器自身并在尺寸稳定后（防抖）再适配；
  // hidden 期间容器无尺寸，跳过
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el || hidden) return;
    let timer: number | undefined;
    const ro = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        fitView({ padding: 0.12, maxZoom: 1.2, duration: 200 });
      }, 80);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      window.clearTimeout(timer);
    };
  }, [hidden, fitView]);

  // 搜索命中：命中的节点高亮，未命中淡化；无搜索时保持原数组（避免无谓重渲染）
  const displayNodes = useMemo(() => {
    if (!query.trim()) return nodes;
    const q = query.trim().toLowerCase();
    return nodes.map((n) => ({
      ...n,
      data: { ...n.data, matched: n.data.label.toLowerCase().includes(q) },
    }));
  }, [nodes, query]);

  const handleNodeClick = useCallback(
    (_: unknown, node: Node) => onLocateNode?.(node.id),
    [onLocateNode],
  );

  const handleNodeDoubleClick = useCallback((_: unknown, node: Node) => {
    const path = (node.data as GraphNodeData).path;
    navigator.clipboard
      .writeText(path)
      .then(() => {
        setCopiedNote(`已复制 ${path}`);
        setTimeout(() => setCopiedNote(null), 2000);
      })
      .catch(() => {
        // 剪贴板不可用时忽略
      });
  }, []);

  const download = useCallback(
    async (fmt: "png" | "svg") => {
      if (nodes.length === 0) return;
      setDownloading(true);
      setExportNote(null);
      try {
        // 按图的真实坐标（zoom = 1）重新生成一份 SVG，
        // 而不是截取当前视口——节点多时后者会把整张图压扁。
        // 导出逻辑只有下载时用到，动态加载以减小首屏代码
        const { bandSvg, buildGraphContent, downloadBlob, pickScale, planBands, rasterize } =
          await import("../lib/graphExport");
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
          const blob = await rasterize(full.svg, width, height, pickScale(width, height));
          downloadBlob(blob, `${name}.png`);
          return;
        }

        // 图比一张画布还大：分块导出，每块都是原始分辨率
        setExportNote(
          `图宽 ${width}px，超出单张 PNG 上限，正在分 ${bands.length} 块导出。`,
        );
        const scale = pickScale(bands[0].width, bands[0].height);
        for (let i = 0; i < bands.length; i++) {
          const blob = await rasterize(bandSvg(content, bands[i]), bands[i].width, bands[i].height, scale);
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
  const showMiniMap = nodes.length <= MINIMAP_MAX_NODES;

  return (
    <section className={`panel graph-panel${hidden ? " panel-hidden" : ""}`}>
      <header className="panel-header">
        <span className="panel-title">图线区</span>
        {hasGraph && (
          <span className="badge muted">
            {truncated ? `${nodes.length} / ${total} 节点` : `${nodes.length} 节点`}
          </span>
        )}
        {truncated && (
          <span className="badge warn" title={`图节点上限 ${MAX_NODES}`}>
            已截断
          </span>
        )}
        {exportNote && <span className="badge warn">{exportNote}</span>}
        {copiedNote && <span className="badge ok">{copiedNote}</span>}
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
          <IconButton
            icon={<IconPng />}
            label="下载 PNG"
            onClick={() => download("png")}
            disabled={!hasGraph || downloading}
          />
          <IconButton
            icon={<IconSvg />}
            label="下载 SVG"
            onClick={() => download("svg")}
            disabled={!hasGraph || downloading}
          />
          <IconButton
            icon={fullscreen ? <IconColumns /> : <IconMaximize />}
            label={fullscreen ? "恢复并排显示（Ctrl+1）" : "全屏显示此面板（Ctrl+3）"}
            onClick={onToggleFullscreen}
          />
        </div>
      </header>
      <div className="panel-body">
        <div className="flow-wrap" id="react-flow-container" ref={wrapperRef}>
          <ReactFlow
            nodes={displayNodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={handleNodeClick}
            onNodeDoubleClick={handleNodeDoubleClick}
            nodeTypes={nodeTypes}
            colorMode={theme}
            fitView
            minZoom={0.05}
            onlyRenderVisibleElements
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
            {showMiniMap && (
              <MiniMap pannable zoomable nodeColor={minimapColor} position="bottom-left" />
            )}
          </ReactFlow>
          {!hasGraph && (
            <div className="flow-empty">
              在上方粘贴 JSON / YAML / XML / TOML，或直接拖入文件
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

const EMPTY_BUILD = { nodes: [], edges: [] as Edge[], truncated: false, total: 0 };

export default memo(function GraphPanel({
  value,
  theme,
  query,
  onLocateNode,
  hidden,
  fullscreen,
  onToggleFullscreen,
}: {
  value: unknown;
  theme: Theme;
  query: string;
  onLocateNode?: (nodeId: string) => void;
  hidden?: boolean;
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
}) {
  return (
    <ReactFlowProvider>
      <GraphInner
        value={value}
        theme={theme}
        query={query}
        onLocateNode={onLocateNode}
        hidden={hidden}
        fullscreen={fullscreen}
        onToggleFullscreen={onToggleFullscreen}
      />
    </ReactFlowProvider>
  );
});
