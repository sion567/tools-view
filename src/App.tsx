import {
  useCallback,
  useEffect,
  lazy,
  Suspense,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import InputPanel from "./components/InputPanel";
import FormatPanel from "./components/FormatPanel";
import HelpModal from "./components/HelpModal";
import { IconButton, IconMaximize } from "./components/icons";
import { buildLinkage, type Linkage } from "./lib/linkage";
import { parseText, readTextFile } from "./lib/parse";
import { SAMPLES } from "./lib/samples";
import { useTheme } from "./lib/theme";
import type { FormatTarget, ParseResponse } from "./lib/types";
import {
  parseEnum,
  parsePositiveInt,
  usePersistentState,
} from "./lib/usePersistentState";

/** 底部双栏视图：并排 / 仅格式化 / 仅图线 */
type BottomView = "split" | "format" | "graph";

const MIN_INPUT = 140;
const MIN_BOTTOM = 280;
/** 格式化区最小宽度：保证工具栏在转换态（JSON→XML 组合徽标）也单行放下 */
const MIN_FMT = 640;
const MIN_GRAPH = 320;
/** 竖向拖拽夹取时扣除 app 内边距与分割条（10×2 + 8 + 余量） */
const COL_CHROME = 40;
const clampFmt = (w: number, innerW: number) =>
  Math.min(Math.max(w, MIN_FMT), Math.max(innerW - MIN_GRAPH - COL_CHROME, MIN_FMT));

const parseView = parseEnum(["split", "format", "graph"] as const);

// 图库 chunk 较大（约占首屏 JS 四分之一）：拆成懒加载，首份数据到达前不加载
const GraphPanel = lazy(() => import("./components/GraphPanel"));

/** 防抖值：搜索词传给全量扫描的消费者（行匹配 / 节点匹配），避免每键全量扫描 */
function useDebouncedValue<T>(value: T, delay: number): T {
  const [deferred, setDeferred] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDeferred(value), delay);
    return () => window.clearTimeout(t);
  }, [value, delay]);
  return deferred;
}

/** 图线区占位：面板骨架与全屏入口保留，图库 chunk 未加载时不渲染 React Flow */
function GraphPlaceholder({ hidden, onOpen }: { hidden: boolean; onOpen: () => void }) {
  return (
    <section className={`panel graph-panel${hidden ? " panel-hidden" : ""}`}>
      <header className="panel-header">
        <span className="panel-title">图线区</span>
        <div className="panel-actions">
          <IconButton icon={<IconMaximize />} label="全屏显示此面板（Ctrl+3）" onClick={onOpen} />
        </div>
      </header>
      <div className="panel-body">
        <div className="flow-wrap">
          <div className="flow-empty">在上方粘贴 JSON / YAML / XML / TOML，或直接拖入文件</div>
        </div>
      </div>
    </section>
  );
}

export default function App() {
  const { theme, toggleTheme } = useTheme();
  const [text, setText] = useState("");
  const [response, setResponse] = useState<ParseResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<FormatTarget>("auto");
  const [query, setQuery] = useState("");
  // 全量扫描类消费者（格式化区行匹配 / 图节点匹配）用防抖值；
  // 搜索框本身与可见行高亮仍用即时 query
  const searchQuery = useDebouncedValue(query, 200);
  /** 格式化区定位请求（图线区节点点击） */
  const [locate, setLocate] = useState<{ line: number; ts: number } | null>(null);
  /** 输入区定位请求（点击错误位置） */
  const [editorLocate, setEditorLocate] = useState<{ line: number; ts: number } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);
  const seqRef = useRef(0);
  const lastKeyRef = useRef<{ ok: boolean; text: string } | null>(null);
  const sampleIndexRef = useRef(0);
  const prevTargetRef = useRef<FormatTarget>("auto");

  const [inputHeight, setInputHeight] = usePersistentState(
    "tools-view.inputHeight",
    Math.round(window.innerHeight * 0.28),
    parsePositiveInt,
    String,
  );
  const [fmtWidth, setFmtWidth] = usePersistentState(
    "tools-view.fmtWidth",
    clampFmt(Math.round(window.innerWidth * 0.45), window.innerWidth),
    parsePositiveInt,
    String,
  );
  const [bottomView, setBottomView] = usePersistentState(
    "tools-view.bottomView",
    "split" as BottomView,
    parseView,
    String,
  );

  const runParse = useCallback(
    async (raw: string) => {
      const seq = ++seqRef.current;
      if (!raw.trim()) {
        setResponse(null);
        setBusy(false);
        return;
      }
      setBusy(true);
      const result = await parseText(raw, target);
      if (seq !== seqRef.current) return; // 丢弃过期结果
      // 结果（含错误）与上次一致时跳过，避免无谓的重建图/重渲染，
      // 同时保住格式化区的折叠状态。直接持有 pretty/message 的引用比较，
      // 不再拼接出与输出等大的 key 字符串
      const key = result.ok
        ? { ok: true, text: result.pretty ?? "" }
        : { ok: false, text: result.error?.message ?? "" };
      const last = lastKeyRef.current;
      if (last !== null && last.ok === key.ok && last.text === key.text) {
        setBusy(false);
        return;
      }
      lastKeyRef.current = key;
      setResponse(result);
      setBusy(false);
    },
    [target],
  );

  // 自动识别格式：输入停顿 350ms 后自动走检测；切换输出格式立即重跑
  useEffect(() => {
    window.clearTimeout(timerRef.current);
    if (!text.trim()) {
      lastKeyRef.current = null;
      return;
    }
    const immediate = prevTargetRef.current !== target;
    prevTargetRef.current = target;
    timerRef.current = window.setTimeout(() => runParse(text), immediate ? 0 : 350);
    return () => window.clearTimeout(timerRef.current);
  }, [text, target, runParse]);

  const handleFormatClick = useCallback(() => {
    window.clearTimeout(timerRef.current);
    runParse(text);
  }, [text, runParse]);

  const handleClear = useCallback(() => setText(""), []);

  const handleSample = useCallback(() => {
    const sample = SAMPLES[sampleIndexRef.current % SAMPLES.length];
    sampleIndexRef.current += 1;
    setText(sample.content);
  }, []);

  // 全屏切换回调保持稳定引用，配合 GraphPanel 的 memo 跳过无关重渲染
  const toggleFormatFullscreen = useCallback(
    () => setBottomView((v) => (v === "format" ? "split" : "format")),
    [setBottomView],
  );
  const toggleGraphFullscreen = useCallback(
    () => setBottomView((v) => (v === "graph" ? "split" : "graph")),
    [setBottomView],
  );

  // ---- 键盘快捷键：Ctrl+Enter 格式化 / Ctrl+L 清空 / Ctrl+1/2/3 面板布局 ----
  const handleFormatClickRef = useRef(handleFormatClick);
  useEffect(() => {
    handleFormatClickRef.current = handleFormatClick;
  }, [handleFormatClick]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F1") {
        e.preventDefault();
        setHelpOpen((v) => !v);
        return;
      }
      if (e.key === "Escape") {
        setHelpOpen(false);
        return;
      }
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "enter") {
        e.preventDefault();
        handleFormatClickRef.current();
      } else if (k === "l") {
        e.preventDefault();
        setText("");
      } else if (k === "1") {
        setBottomView("split");
      } else if (k === "2") {
        setBottomView("format");
      } else if (k === "3") {
        setBottomView("graph");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setBottomView]);

  // ---- 拖拽文件打开（仅 Tauri 环境有此事件） ----
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    (async () => {
      try {
        const { getCurrentWebview } = await import("@tauri-apps/api/webview");
        unlisten = await getCurrentWebview().onDragDropEvent((event) => {
          const payload = event.payload as { type: string; paths?: string[] };
          if (payload.type === "drop") {
            const path = payload.paths?.[0];
            if (!path) return;
            readTextFile(path)
              .then((content) => setText(content))
              .catch((err) => console.error("读取拖入文件失败", err));
          }
        });
        if (disposed) unlisten?.();
      } catch {
        // 非 Tauri 环境（纯浏览器）没有拖拽事件
      }
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // ---- 输入区高度拖拽：move/up 挂 window，指针移出细条不丢事件 ----
  const onDividerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = inputHeight;
    const max = window.innerHeight - MIN_BOTTOM;
    const move = (ev: PointerEvent) => {
      setInputHeight(Math.min(Math.max(startH + ev.clientY - startY, MIN_INPUT), max));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("dragging-input");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    document.body.classList.add("dragging-input");
  };

  // ---- 底部双栏宽度拖拽（竖向分割条） ----
  const onColDividerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = fmtWidth;
    const move = (ev: PointerEvent) => {
      setFmtWidth(clampFmt(startW + ev.clientX - startX, window.innerWidth));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("dragging-col");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    document.body.classList.add("dragging-col");
  };

  // 窗口变小时把已存的尺寸压回合法范围
  useEffect(() => {
    const onResize = () => {
      setInputHeight((h) =>
        Math.min(Math.max(h, MIN_INPUT), Math.max(window.innerHeight - MIN_BOTTOM, MIN_INPUT)),
      );
      setFmtWidth((w) => clampFmt(w, window.innerWidth));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [setInputHeight, setFmtWidth]);

  // ---- 派生视图状态：清空输入后立即回到空态，不等异步解析 ----
  const shownResponse = text.trim() ? response : null;
  const shownBusy = busy && Boolean(text.trim());
  const graphValue = shownResponse?.ok ? shownResponse.value : null;
  const errorLine =
    shownResponse && !shownResponse.ok ? shownResponse.error?.line ?? null : null;

  // ---- 图节点 ↔ 格式化区行联动（仅 JSON 输出可精确定位） ----
  const outFormat =
    shownResponse?.ok ? (target === "auto" ? shownResponse.format : target) : null;
  // 联动只在点击图节点定位时用到：惰性构建并按 response 引用缓存，
  // 避免每次解析成功都全量扫一遍 pretty 输出
  const linkageRef = useRef<{ response: ParseResponse; linkage: Linkage } | null>(null);
  const getLinkage = useCallback((): Linkage | null => {
    const resp = shownResponse;
    if (!resp?.ok || outFormat !== "json" || !resp.pretty) return null;
    const cached = linkageRef.current;
    if (cached && cached.response === resp) return cached.linkage;
    const linkage = buildLinkage(resp.value, resp.pretty);
    linkageRef.current = { response: resp, linkage };
    return linkage;
  }, [shownResponse, outFormat]);

  const handleLocateNode = useCallback(
    (nodeId: string) => {
      const idx = Number(nodeId.slice(1));
      const line = getLinkage()?.lines?.[idx];
      if (line != null) setLocate({ line, ts: Date.now() });
    },
    [getLinkage],
  );

  const handleLocateEditor = useCallback((line: number) => {
    setEditorLocate({ line, ts: Date.now() });
  }, []);

  const effectiveHeight = Math.min(
    Math.max(inputHeight, MIN_INPUT),
    Math.max(window.innerHeight - MIN_BOTTOM, MIN_INPUT),
  );
  const effectiveFmtWidth = clampFmt(fmtWidth, window.innerWidth);
  // 图线区懒加载：首份数据或主动进入图线视图时才挂载（chunk 按需加载）
  const mountGraph = graphValue != null || bottomView === "graph";

  return (
    <main
      className="app"
      style={{ gridTemplateRows: `${effectiveHeight}px 8px minmax(0, 1fr)` }}
    >
      <InputPanel
        value={text}
        format={shownResponse?.ok ? shownResponse.format : null}
        busy={shownBusy}
        errorLine={errorLine}
        locate={editorLocate}
        onTextChange={setText}
        onFormatClick={handleFormatClick}
        onClear={handleClear}
        onSample={handleSample}
        onOpenHelp={() => setHelpOpen(true)}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
      <div
        className="row-divider"
        role="separator"
        aria-orientation="horizontal"
        aria-label="拖拽调整输入区高度"
        title="拖拽调整输入区高度"
        onPointerDown={onDividerDown}
      />
      <div
        className={`app-bottom${bottomView === "split" ? "" : " single"}`}
        style={
          bottomView === "split"
            ? { gridTemplateColumns: `${effectiveFmtWidth}px 8px minmax(0, 1fr)` }
            : undefined
        }
      >
        <FormatPanel
          response={shownResponse}
          busy={shownBusy}
          target={target}
          onTargetChange={setTarget}
          query={query}
          searchQuery={searchQuery}
          onQueryChange={setQuery}
          locate={locate}
          onLocateEditor={handleLocateEditor}
          hidden={bottomView === "graph"}
          fullscreen={bottomView === "format"}
          onToggleFullscreen={toggleFormatFullscreen}
        />
        <div
          className={`col-divider${bottomView === "split" ? "" : " panel-hidden"}`}
          role="separator"
          aria-orientation="vertical"
          aria-label="拖拽调整双栏宽度"
          title="拖拽调整双栏宽度"
          onPointerDown={onColDividerDown}
        />
        {mountGraph ? (
          <Suspense
            fallback={
              <section className="panel graph-panel">
                <div className="panel-body">
                  <div className="placeholder">图线区加载中…</div>
                </div>
              </section>
            }
          >
            <GraphPanel
              value={graphValue}
              theme={theme}
              query={searchQuery}
              onLocateNode={handleLocateNode}
              hidden={bottomView === "format"}
              fullscreen={bottomView === "graph"}
              onToggleFullscreen={toggleGraphFullscreen}
            />
          </Suspense>
        ) : (
          <GraphPlaceholder
            hidden={bottomView === "format"}
            onOpen={() => setBottomView("graph")}
          />
        )}
      </div>
      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
    </main>
  );
}
