import { useEffect, useRef } from "react";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder as cmPlaceholder } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { indentWithTab } from "@codemirror/commands";
import { json } from "@codemirror/lang-json";
import { yaml } from "@codemirror/lang-yaml";
import { xml } from "@codemirror/lang-xml";
import { editorTheme } from "../lib/editorTheme";
import type { Format } from "../lib/types";
import type { Theme } from "../lib/theme";

function langExtension(format: Format | null) {
  if (format === "json") return json();
  if (format === "yaml") return yaml();
  if (format === "xml") return xml();
  return [];
}

interface InputPanelProps {
  value: string;
  format: Format | null;
  busy: boolean;
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
  const lastInternalRef = useRef<string>(value);
  const onTextChangeRef = useRef(onTextChange);
  onTextChangeRef.current = onTextChange;

  useEffect(() => {
    const langCompartment = langCompartmentRef.current;
    const themeCompartment = themeCompartmentRef.current;
    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          themeCompartment.of(editorTheme(theme)),
          langCompartment.of(langExtension(format)),
          cmPlaceholder("粘贴 JSON / YAML / XML 文本，粘贴后自动识别…"),
          EditorView.lineWrapping,
          keymap.of([indentWithTab]),
          EditorView.updateListener.of((update) => {
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

  // 外部改动（清空 / 示例按钮）时同步进编辑器
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
          <button className="btn primary" onClick={onFormatClick}>
            格式化
          </button>
          <button className="btn" onClick={onSample}>
            示例
          </button>
          <button className="btn" onClick={onClear}>
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
