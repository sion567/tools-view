import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import InputPanel from "./components/InputPanel";
import FormatPanel from "./components/FormatPanel";
import GraphPanel from "./components/GraphPanel";
import { buildLinkage } from "./lib/linkage";
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
const MIN_FMT = 240;
const MIN_GRAPH = 320;

const parseView = parseEnum(["split", "format", "graph"] as const);

export default function App() {
  const { theme, toggleTheme } = useTheme();
  const [text, setText] = useState("");
  const [response, setResponse] = useState<ParseResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<FormatTarget>("auto");
  const [query, setQuery] = useState("");
  /** 格式化区定位请求（图线区节点点击） */
  const [locate, setLocate] = useState<{ line: number; ts: number } | null>(null);
  /** 输入区定位请求（点击错误位置） */
  const [editorLocate, setEditorLocate] = useState<{ line: number; ts: number } | null>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const seqRef = useRef(0);
  const lastKeyRef = useRef<string | null>(null);
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
    Math.round(window.innerWidth * 0.34),
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
      // 同时保住格式化区的折叠状态
      const key = result.ok ? `ok:${result.pretty}` : `err:${result.error?.message}`;
      if (key === lastKeyRef.current) {
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

  // ---- 键盘快捷键：Ctrl+Enter 格式化 / Ctrl+L 清空 / Ctrl+1/2/3 面板布局 ----
  const handleFormatClickRef = useRef(handleFormatClick);
  useEffect(() => {
    handleFormatClickRef.current = handleFormatClick;
  }, [handleFormatClick]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
    const max = window.innerWidth - MIN_GRAPH;
    const move = (ev: PointerEvent) => {
      setFmtWidth(Math.min(Math.max(startW + ev.clientX - startX, MIN_FMT), max));
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
      setFmtWidth((w) =>
        Math.min(Math.max(w, MIN_FMT), Math.max(window.innerWidth - MIN_GRAPH, MIN_FMT)),
      );
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
  const linkage = useMemo(
    () =>
      shownResponse?.ok && outFormat === "json" && shownResponse.pretty
        ? buildLinkage(shownResponse.value, shownResponse.pretty)
        : null,
    [shownResponse, outFormat],
  );

  const handleLocateNode = useCallback(
    (nodeId: string) => {
      const idx = Number(nodeId.slice(1));
      const line = linkage?.lines?.[idx];
      if (line != null) setLocate({ line, ts: Date.now() });
    },
    [linkage],
  );

  const handleLocateEditor = useCallback((line: number) => {
    setEditorLocate({ line, ts: Date.now() });
  }, []);

  const effectiveHeight = Math.min(
    Math.max(inputHeight, MIN_INPUT),
    Math.max(window.innerHeight - MIN_BOTTOM, MIN_INPUT),
  );
  const effectiveFmtWidth = Math.min(
    Math.max(fmtWidth, MIN_FMT),
    Math.max(window.innerWidth - MIN_GRAPH, MIN_FMT),
  );

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
          onQueryChange={setQuery}
          locate={locate}
          onLocateEditor={handleLocateEditor}
          hidden={bottomView === "graph"}
          fullscreen={bottomView === "format"}
          onToggleFullscreen={() =>
            setBottomView((v) => (v === "format" ? "split" : "format"))
          }
        />
        <div
          className={`col-divider${bottomView === "split" ? "" : " panel-hidden"}`}
          role="separator"
          aria-orientation="vertical"
          aria-label="拖拽调整双栏宽度"
          title="拖拽调整双栏宽度"
          onPointerDown={onColDividerDown}
        />
        <GraphPanel
          value={graphValue}
          theme={theme}
          query={query}
          onLocateNode={handleLocateNode}
          hidden={bottomView === "format"}
          fullscreen={bottomView === "graph"}
          onToggleFullscreen={() =>
            setBottomView((v) => (v === "graph" ? "split" : "graph"))
          }
        />
      </div>
    </main>
  );
}
