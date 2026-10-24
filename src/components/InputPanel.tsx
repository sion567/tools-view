import { useEffect, useRef } from "react";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder as cmPlaceholder,
  Decoration,
  type DecorationSet,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { json } from "@codemirror/lang-json";
import { yaml } from "@codemirror/lang-yaml";
import { xml } from "@codemirror/lang-xml";
import { editorTheme } from "../lib/editorTheme";
import type { Format } from "../lib/types";
import type { Theme } from "../lib/theme";

function langExtension(format: Format | null): Extension {
  if (format === "json") return json();
  if (format === "yaml") return yaml();
  if (format === "xml") return xml();
  return [];
}

// 静态行装饰（每次 reconfigure 重建实例），避免引入 StateField：
// 用于解析错误行标红和定位闪烁
function staticLineClass(line: number | null, className: string): Extension {
  if (line == null || line < 1) return [];
  const target = line;
  const deco = Decoration.line({ class: className });
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        const idx = Math.min(target, view.state.doc.lines) - 1;
        this.decorations = Decoration.set([deco.range(view.state.doc.line(idx + 1).from)]);
      }
    },
    { decorations: (v) => v.decorations },
  );
}

interface InputPanelProps {
  value: string;
  format: Format | null;
  busy: boolean;
  /** 解析错误的行号（1 基），用于在编辑器里标红该行 */
  errorLine: number | null;
  /** 外部请求定位（点击错误跳转）：行号 + 时间戳 */
  locate: { line: number; ts: number } | null;
  onTextChange: (text: string) => void;
  onFormatClick: () => void;
  onClear: () => void;
  onSample: () => void;
  theme: Theme;
  onToggleTheme: () => void;
}

export default function InputPanel({
  value,
  format,
  busy,
  errorLine,
  locate,
  onTextChange,
  onFormatClick,
  onClear,
  onSample,
  theme,
  onToggleTheme,
}: InputPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const langCompartmentRef = useRef(new Compartment());
  const themeCompartmentRef = useRef(new Compartment());
  const errorCompartmentRef = useRef(new Compartment());
  const lastInternalRef = useRef<string>(value);
  const onTextChangeRef = useRef(onTextChange);
  const onFormatClickRef = useRef(onFormatClick);
  useEffect(() => {
    onTextChangeRef.current = onTextChange;
  }, [onTextChange]);
  useEffect(() => {
    onFormatClickRef.current = onFormatClick;
  }, [onFormatClick]);

  useEffect(() => {
    const langCompartment = langCompartmentRef.current;
    const themeCompartment = themeCompartmentRef.current;
    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          // 精简自 basicSetup：去掉搜索/补全/折叠等用不上的全家桶
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          history(),
          drawSelection(),
          dropCursor(),
          EditorState.allowMultipleSelections.of(true),
          bracketMatching(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          themeCompartment.of(editorTheme(theme)),
          langCompartment.of(langExtension(format)),
          errorCompartmentRef.current.of([]),
          cmPlaceholder("粘贴 JSON / YAML / XML / TOML 文本，粘贴后自动识别…"),
          EditorView.lineWrapping,
          keymap.of([
            { key: "Mod-Enter", run: () => (onFormatClickRef.current(), true) },
            indentWithTab,
            ...historyKeymap,
          ]),
          EditorView.updateListener.of((update: ViewUpdate) => {
            if (update.docChanged) {
              const text = update.state.doc.toString();
              lastInternalRef.current = text;
              onTextChangeRef.current(text);
            }
          }),
        ],
      }),
      parent: containerRef.current!,
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // 仅在挂载时创建一次编辑器实例
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 外部改动（清空 / 示例 / 拖拽文件）时同步进编辑器
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (value !== current && value !== lastInternalRef.current) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
    lastInternalRef.current = value;
  }, [value]);

  // 识别出格式后联动对应语法高亮
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: langCompartmentRef.current.reconfigure(langExtension(format)),
    });
  }, [format]);

  // 切换明暗主题时重配编辑器配色
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: themeCompartmentRef.current.reconfigure(editorTheme(theme)),
    });
  }, [theme]);

  // 解析失败：错误行标红
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: errorCompartmentRef.current.reconfigure(
        staticLineClass(errorLine, "cm-errorLine"),
      ),
    });
  }, [errorLine]);

  // 点击错误位置：滚动到目标行并闪烁高亮
  useEffect(() => {
    if (!locate) return;
    const view = viewRef.current;
    if (!view) return;
    const lineNo = Math.min(locate.line, view.state.doc.lines);
    if (lineNo >= 1) {
      const info = view.state.doc.line(lineNo);
      view.dispatch({
        selection: { anchor: info.from },
        effects: EditorView.scrollIntoView(info.from, { y: "center" }),
      });
      view.dispatch({
        effects: errorCompartmentRef.current.reconfigure(
          staticLineClass(lineNo, "cm-flashLine"),
        ),
      });
      const t = window.setTimeout(() => {
        viewRef.current?.dispatch({
          effects: errorCompartmentRef.current.reconfigure(
            staticLineClass(errorLine, "cm-errorLine"),
          ),
        });
      }, 1500);
      return () => window.clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locate?.ts]);

  const badge = busy
    ? "识别中…"
    : format
      ? `自动识别：${format.toUpperCase()}`
      : value.trim()
        ? "未识别"
        : "等待输入";

  return (
    <section className="panel input-panel">
      <header className="panel-header">
        <span className="panel-title">输入区</span>
        <span
          className={`badge ${format ? "ok" : value.trim() && !busy ? "warn" : "muted"}`}
        >
          {badge}
        </span>
        <div className="panel-actions">
          <button className="btn primary" onClick={onFormatClick} title="Ctrl+Enter">
            格式化
          </button>
          <button className="btn" onClick={onSample}>
            示例
          </button>
          <button className="btn" onClick={onClear} title="Ctrl+L">
            清空
          </button>
          <button
            className="btn icon"
            onClick={onToggleTheme}
            title={theme === "dark" ? "切换到明亮模式" : "切换到暗黑模式"}
            aria-label={theme === "dark" ? "切换到明亮模式" : "切换到暗黑模式"}
          >
            {theme === "dark" ? "☀" : "☾"}
          </button>
        </div>
      </header>
      <div className="panel-body editor-host" ref={containerRef} />
    </section>
  );
}
