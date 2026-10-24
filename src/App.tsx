import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import InputPanel from "./components/InputPanel";
import FormatPanel from "./components/FormatPanel";
import GraphPanel from "./components/GraphPanel";
import { parseText } from "./lib/parse";
import { SAMPLES } from "./lib/samples";
import { useTheme } from "./lib/theme";
import type { ParseResponse } from "./lib/types";

/** 底部双栏视图：并排 / 仅格式化 / 仅图线 */
type BottomView = "split" | "format" | "graph";

const INPUT_H_KEY = "tools-view.inputHeight";
const VIEW_KEY = "tools-view.bottomView";
const MIN_INPUT = 140;
const MIN_BOTTOM = 280;

function loadInputHeight(): number {
  try {
    const v = Number(localStorage.getItem(INPUT_H_KEY));
    if (Number.isFinite(v) && v >= MIN_INPUT) return v;
  } catch {
    // localStorage 不可用时用默认值
  }
  return Math.round(window.innerHeight * 0.28);
}

function loadBottomView(): BottomView {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v === "split" || v === "format" || v === "graph") return v;
  } catch {
    // 忽略
  }
  return "split";
}

export default function App() {
  const { theme, toggleTheme } = useTheme();
  const [text, setText] = useState("");
  const [response, setResponse] = useState<ParseResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [inputHeight, setInputHeight] = useState(loadInputHeight);
  const [bottomView, setBottomView] = useState<BottomView>(loadBottomView);
  const timerRef = useRef<number | undefined>(undefined);
  const seqRef = useRef(0);
  const sampleIndexRef = useRef(0);

  const runParse = useCallback(async (raw: string) => {
    const seq = ++seqRef.current;
    if (!raw.trim()) {
      setResponse(null);
      setBusy(false);
      return;
    }
    setBusy(true);
    const result = await parseText(raw);
    if (seq !== seqRef.current) return; // 丢弃过期结果
    setResponse(result);
    setBusy(false);
  }, []);

  // 自动识别格式：输入停顿 350ms 后自动走 JSON → YAML/XML 检测
  useEffect(() => {
    window.clearTimeout(timerRef.current);
    if (!text.trim()) {
      setResponse(null);
      setBusy(false);
      return;
    }
    setBusy(true);
    timerRef.current = window.setTimeout(() => {
      runParse(text);
    }, 350);
    return () => window.clearTimeout(timerRef.current);
  }, [text, runParse]);

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

  // ---- 输入区高度拖拽：按下后把 move/up 挂到 window，指针移出细条也不会丢事件 ----
  const onDividerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = inputHeight;
    const max = window.innerHeight - MIN_BOTTOM;
    const move = (ev: PointerEvent) => {
      setInputHeight(
        Math.min(Math.max(startH + ev.clientY - startY, MIN_INPUT), max),
      );
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("dragging-input");
      // 松手时持久化最终高度
      setInputHeight((h) => {
        try {
          localStorage.setItem(INPUT_H_KEY, String(h));
        } catch {
          // 忽略
        }
        return h;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    document.body.classList.add("dragging-input");
  };

  // 窗口变小时把已存的高度压回合法范围
  useEffect(() => {
    const onResize = () =>
      setInputHeight((h) => Math.min(Math.max(h, MIN_INPUT), window.innerHeight - MIN_BOTTOM));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, bottomView);
    } catch {
      // 忽略
    }
  }, [bottomView]);

  const graphValue = response?.ok ? response.value : null;
  const effectiveHeight = Math.min(
    Math.max(inputHeight, MIN_INPUT),
    Math.max(window.innerHeight - MIN_BOTTOM, MIN_INPUT),
  );

  return (
    <main
      className="app"
      style={{ gridTemplateRows: `${effectiveHeight}px 8px minmax(0, 1fr)` }}
    >
      <InputPanel
        value={text}
        format={response?.ok ? response.format : null}
        busy={busy}
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
      <div className={`app-bottom${bottomView === "split" ? "" : " single"}`}>
        <FormatPanel
          response={response}
          busy={busy}
          hidden={bottomView === "graph"}
          fullscreen={bottomView === "format"}
          onToggleFullscreen={() =>
            setBottomView((v) => (v === "format" ? "split" : "format"))
          }
        />
        <GraphPanel
          value={graphValue}
          theme={theme}
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
