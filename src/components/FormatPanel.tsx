import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  allFoldLines,
  buildFoldTree,
  countFolds,
  expandToLine,
  type FoldNode,
} from "../lib/fold";
import { saveTextFile } from "../lib/parse";
import type { Format, FormatTarget, ParseResponse } from "../lib/types";
import {
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconCollapseAll,
  IconColumns,
  IconCopy,
  IconExpandAll,
  IconMaximize,
  IconSave,
  IconButton,
} from "./icons";

/** 虚拟滚动的固定行高（与 .pretty-lines 的 line-height 一致） */
const ROW_H = 20;
/** 超过此行数停用折叠视图（解析成本保护） */
const FOLD_MAX_LINES = 100_000;

interface FormatPanelProps {
  response: ParseResponse | null;
  busy: boolean;
  target: FormatTarget;
  onTargetChange: (t: FormatTarget) => void;
  query: string;
  /** 防抖后的搜索词：全量行匹配用；query 即时值用于输入框与可见行高亮 */
  searchQuery: string;
  onQueryChange: (q: string) => void;
  /** 图线区节点点击请求定位：行号（0 基）+ 时间戳 */
  locate: { line: number; ts: number } | null;
  /** 点击错误位置，请求输入区定位 */
  onLocateEditor: (line: number) => void;
  hidden?: boolean;
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

interface Row {
  line: number;
  fold?: FoldNode;
  collapsed?: boolean;
  hiddenCount?: number;
}

/** 命中关键字高亮（浏览器式：全文保留，只做标记） */
function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const lower = text.toLowerCase();
  const lq = q.toLowerCase();
  const parts: ReactNode[] = [];
  let i = 0;
  let key = 0;
  for (;;) {
    const at = lower.indexOf(lq, i);
    if (at < 0) {
      parts.push(<span key={key}>{text.slice(i)}</span>);
      break;
    }
    if (at > i) parts.push(<span key={key++}>{text.slice(i, at)}</span>);
    parts.push(
      <mark className="pl-hit" key={key++}>
        {text.slice(at, at + q.length)}
      </mark>,
    );
    i = at + q.length;
  }
  return <>{parts}</>;
}

const TARGET_OPTIONS: { value: FormatTarget; label: string }[] = [
  { value: "auto", label: "原格式" },
  { value: "json", label: "JSON" },
  { value: "yaml", label: "YAML" },
  { value: "xml", label: "XML" },
  { value: "toml", label: "TOML" },
];

export default function FormatPanel({
  response,
  busy,
  target,
  onTargetChange,
  query,
  searchQuery,
  onQueryChange,
  locate,
  onLocateEditor,
  hidden,
  fullscreen,
  onToggleFullscreen,
}: FormatPanelProps) {
  const [copied, setCopied] = useState(false);
  const [savedNote, setSavedNote] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set());
  const [currentMatch, setCurrentMatch] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(400);
  const [flash, setFlash] = useState<{ line: number; ts: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const pretty = response?.ok ? (response.pretty ?? "") : "";
  const error = response && !response.ok ? response.error : null;
  const format = response?.ok ? response.format : null;
  const outFormat: Format | null = target === "auto" ? format : target;
  const q = query.trim().toLowerCase();
  const sq = searchQuery.trim().toLowerCase();

  const lines = useMemo(() => (pretty ? pretty.split("\n") : []), [pretty]);
  // 行的小写形式随内容一次性算好：搜索每个按键只做 indexOf，不再为每行新建字符串
  const lowerLines = useMemo(() => lines.map((l) => l.toLowerCase()), [lines]);
  const folds = useMemo(
    () => (pretty && outFormat ? buildFoldTree(pretty, outFormat) : []),
    [pretty, outFormat],
  );
  const foldCount = useMemo(() => countFolds(folds), [folds]);
  const interactive = lines.length > 0 && lines.length <= FOLD_MAX_LINES;

  // 浏览器式搜索：全文里所有命中行（不改变展示内容）；由防抖后的 sq 驱动
  const matches = useMemo(() => {
    if (!sq) return [] as number[];
    const out: number[] = [];
    for (let i = 0; i < lowerLines.length; i++) {
      if (lowerLines[i].includes(sq)) out.push(i);
    }
    return out;
  }, [lowerLines, sq]);
  const currentIdx = matches.length === 0 ? -1 : Math.min(Math.max(currentMatch, 0), matches.length - 1);
  const currentLine = currentIdx >= 0 ? matches[currentIdx] : -1;

  // 新内容到达后重置折叠、搜索位置与滚动窗口（行号含义已变）。
  // 若滚动容器曾被卸载（清空/报错/超长行降级），浏览器夹取 el.scrollTop
  // 不会补发 scroll 事件，state 残留会把虚拟窗口停在新内容之外（面板空白）
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 新内容必须清掉旧折叠状态
    setCollapsed(new Set());
    setCurrentMatch(0);
    setScrollTop(0);
    containerRef.current?.scrollTo?.(0, 0);
  }, [pretty]);

  // 虚拟滚动：监听滚动与容器尺寸（滚动经 rAF 节流，每帧至多重算一次窗口）
  const scrollRafRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      if (scrollRafRef.current !== undefined) return;
      scrollRafRef.current = window.requestAnimationFrame(() => {
        scrollRafRef.current = undefined;
        setScrollTop(el.scrollTop);
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight));
    ro.observe(el);
    setViewportH(el.clientHeight);
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (scrollRafRef.current !== undefined) {
        window.cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = undefined;
      }
      ro.disconnect();
    };
  }, [interactive]);

  const toggle = (line: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(line)) next.delete(line);
      else next.add(line);
      return next;
    });
  };
  const collapseAll = () => setCollapsed(new Set(allFoldLines(folds)));
  const expandAll = () => setCollapsed(new Set());

  // 完整的折叠结构视图（搜索时也不过滤，仅高亮）
  const rows = useMemo<Row[]>(() => {
    if (!interactive) return [];
    const out: Row[] = [];
    // 渲染 lines[from, to) 区间，nodes 是区间内按行序排列的折叠块
    const walk = (from: number, to: number, nodes: FoldNode[]) => {
      let cursor = from;
      for (const node of nodes) {
        for (let i = cursor; i < node.line; i++) out.push({ line: i });
        const isCollapsed = collapsed.has(node.line);
        out.push({
          line: node.line,
          fold: node,
          collapsed: isCollapsed,
          hiddenCount: isCollapsed
            ? node.end - node.line - (node.hasCloser ? 1 : 0)
            : undefined,
        });
        if (isCollapsed) {
          cursor = node.end + 1;
          continue;
        }
        walk(node.line + 1, node.hasCloser ? node.end : node.end + 1, node.children);
        if (node.hasCloser) out.push({ line: node.end });
        cursor = node.end + 1;
      }
      for (let i = cursor; i < to; i++) out.push({ line: i });
    };
    walk(0, lines.length, folds);
    return out;
  }, [lines, folds, collapsed, interactive]);

  // 图线区节点定位：滚动到目标行并闪烁
  useEffect(() => {
    if (!locate) return;
    const el = containerRef.current;
    if (el) {
      el.scrollTo({ top: Math.max(0, locate.line * ROW_H - el.clientHeight / 2) });
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 定位请求到达时同步触发闪烁
    setFlash({ line: locate.line, ts: locate.ts });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locate?.ts]);

  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 1800);
    return () => window.clearTimeout(t);
  }, [flash]);

  // 搜索导航：当前命中行如果藏在折叠块里，自动展开并滚动到可视区
  useEffect(() => {
    if (currentLine < 0 || !interactive) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 导航到折叠体内的命中行需要先展开
    setCollapsed((prev) => expandToLine(folds, currentLine, prev));
    const rowIndex = rows.findIndex((r) => r.line === currentLine);
    if (rowIndex >= 0) {
      const el = containerRef.current;
      if (el) el.scrollTo({ top: Math.max(0, rowIndex * ROW_H - el.clientHeight / 2) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLine, rows]);

  const gotoMatch = (delta: number) => {
    if (matches.length === 0) return;
    setCurrentMatch((i) => (Math.min(Math.max(i, 0), matches.length - 1) + delta + matches.length) % matches.length);
  };

  const onSearchKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      gotoMatch(e.shiftKey ? -1 : 1);
    } else if (e.key === "Escape") {
      onQueryChange("");
    }
  };

  const gutterStyle = {
    "--gutter-w": `${String(lines.length).length + 1}ch`,
  } as CSSProperties;

  // 虚拟窗口；start 兜底夹取到末行，防 state 残留时 slice 出空数组
  const start = Math.max(0, Math.min(Math.floor(scrollTop / ROW_H) - 8, rows.length - 1));
  const end = Math.min(rows.length, Math.ceil((scrollTop + viewportH) / ROW_H) + 8);
  const visible = rows.slice(start, end);

  const copy = async () => {
    if (!pretty) return;
    try {
      await navigator.clipboard.writeText(pretty);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // 剪贴板不可用时忽略
    }
  };

  const save = async () => {
    if (!pretty || !outFormat) return;
    const r = await saveTextFile(pretty, `tools-view.${outFormat}`);
    if (r === "saved") {
      setSavedNote(true);
      setTimeout(() => setSavedNote(false), 1500);
    }
  };

  return (
    <section className={`panel format-panel${hidden ? " panel-hidden" : ""}`}>
      <header className="panel-header">
        <span className="panel-title">格式化区</span>
        {format && (
          <span className={`badge fmt-${target !== "auto" && outFormat ? outFormat : format}`}>
            {target !== "auto" && outFormat && outFormat !== format
              ? `${format.toUpperCase()}→${outFormat.toUpperCase()}`
              : format.toUpperCase()}
          </span>
        )}
        {lines.length > FOLD_MAX_LINES && (
          <span className="badge muted">超 {FOLD_MAX_LINES} 行，折叠视图已停用</span>
        )}
        <div className="panel-actions">
          {pretty && (
            <>
              <div className="search-wrap">
                <input
                  className="search"
                  type="search"
                  placeholder="搜索…"
                  value={query}
                  onChange={(e) => {
                    onQueryChange(e.target.value);
                    setCurrentMatch(0);
                  }}
                  onKeyDown={onSearchKey}
                  aria-label={
                    sq && matches.length > 0
                      ? `搜索格式化结果，当前第 ${currentIdx + 1} / ${matches.length} 处`
                      : "搜索格式化结果"
                  }
                />
                {q && (
                  <>
                    <span className="search-count" aria-hidden="true">
                      {matches.length > 0 ? `${currentIdx + 1}/${matches.length}` : "0"}
                    </span>
                    <button
                      type="button"
                      className="search-clear"
                      aria-label="清空搜索"
                      title="清空搜索"
                      onClick={() => {
                        onQueryChange("");
                        setCurrentMatch(0);
                      }}
                    >
                      ✕
                    </button>
                  </>
                )}
              </div>
              <IconButton
                icon={<IconChevronUp />}
                label="上一个匹配（Shift+Enter）"
                onClick={() => gotoMatch(-1)}
                disabled={matches.length === 0}
              />
              <IconButton
                icon={<IconChevronDown />}
                label="下一个匹配（Enter）"
                onClick={() => gotoMatch(1)}
                disabled={matches.length === 0}
              />
            </>
          )}
          {/* 转换失败（error）时也要能切回目标格式，故跟 response 走而不是 pretty */}
          {response && (
            <select
              className={`formatsel${target !== "auto" ? " converting" : ""}`}
              value={target}
              onChange={(e) => onTargetChange(e.target.value as FormatTarget)}
              title="输出格式（转换）"
              aria-label="输出格式"
            >
              {TARGET_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
          {interactive && foldCount > 0 && (
            <>
              <IconButton
                icon={<IconCollapseAll />}
                label="全部折叠"
                onClick={collapseAll}
              />
              <IconButton
                icon={<IconExpandAll />}
                label="全部展开"
                onClick={expandAll}
                disabled={collapsed.size === 0}
              />
            </>
          )}
          <IconButton
            icon={copied ? <IconCheck /> : <IconCopy />}
            label={copied ? "已复制" : "复制格式化结果"}
            onClick={copy}
            disabled={!pretty}
          />
          <IconButton
            icon={savedNote ? <IconCheck /> : <IconSave />}
            label={savedNote ? "已保存" : "保存到文件"}
            onClick={save}
            disabled={!pretty || !outFormat}
          />
          <IconButton
            icon={fullscreen ? <IconColumns /> : <IconMaximize />}
            label={fullscreen ? "恢复并排显示（Ctrl+1）" : "全屏显示此面板（Ctrl+2）"}
            onClick={onToggleFullscreen}
          />
        </div>
      </header>
      <div className="panel-body">
        {error ? (
          <div className="error-box">
            <div className="error-title">✕ 解析失败</div>
            <div className="error-message">{error.message}</div>
            {(error.line !== null || error.column !== null) && (
              <button
                className="error-jump error-pos"
                onClick={() => error.line != null && onLocateEditor(error.line)}
                disabled={error.line == null}
                title="点击定位到输入区对应行"
              >
                行 {error.line ?? "?"}，列 {error.column ?? "?"} ↩
              </button>
            )}
          </div>
        ) : pretty ? (
          interactive ? (
            <div
              className="pretty-lines"
              style={gutterStyle}
              ref={containerRef}
              role="region"
              aria-label="格式化结果"
            >
              <div style={{ height: rows.length * ROW_H }}>
                <div style={{ transform: `translateY(${start * ROW_H}px)` }}>
                  {visible.map((r) => (
                    <div
                      className={`pl-row${r.line === flash?.line ? " pl-flash" : ""}${
                        r.line === currentLine ? " pl-current" : ""
                      }`}
                      key={r.line}
                    >
                      <span className="pl-gutter">{r.line + 1}</span>
                      {r.fold ? (
                        <button
                          className="pl-toggle"
                          onClick={() => toggle(r.fold!.line)}
                          aria-label={r.collapsed ? "展开此块" : "折叠此块"}
                          aria-expanded={!r.collapsed}
                        >
                          {r.collapsed ? "▸" : "▾"}
                        </button>
                      ) : (
                        <span className="pl-toggle-sp" />
                      )}
                      <span className="pl-code">
                        <Highlight text={lines[r.line]} q={q} />
                        {r.fold && r.collapsed && (
                          <span className="pl-summary">
                            {" … "}
                            {r.fold.hasCloser ? lines[r.fold.end].trim() : ""}
                            {r.hiddenCount ? `（隐藏 ${r.hiddenCount} 行）` : ""}
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <pre className="pretty">{pretty}</pre>
          )
        ) : (
          <div className="placeholder">{busy ? "解析中…" : "解析结果将显示在这里"}</div>
        )}
      </div>
    </section>
  );
}
