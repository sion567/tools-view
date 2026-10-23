import { EditorView } from "@codemirror/view";
import { oneDark } from "@codemirror/theme-one-dark";
import type { Extension } from "@codemirror/state";

/**
 * 编辑器配色跟随应用主题。
 * 颜色统一用 CSS 变量，切换 :root[data-theme] 时无需重建编辑器实例。
 */
const shared = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "13px",
    backgroundColor: "var(--panel)",
    color: "var(--text)",
  },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: "'Cascadia Mono', Consolas, monospace",
  },
  ".cm-content": {
    caretColor: "var(--text)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--panel)",
    color: "var(--text-dim)",
    borderRight: "1px solid var(--border)",
  },
  ".cm-activeLine": { backgroundColor: "var(--panel-2)" },
  ".cm-activeLineGutter": {
    backgroundColor: "var(--panel-2)",
    color: "var(--text)",
  },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, .cm-content ::selection":
    {
      backgroundColor: "rgba(79, 140, 255, 0.28)",
    },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--text)" },
  ".cm-placeholder": { color: "var(--text-dim)" },
});

const lightOverrides = EditorView.theme({
  ".cm-activeLine": { backgroundColor: "rgba(79, 140, 255, 0.07)" },
  ".cm-activeLineGutter": { backgroundColor: "rgba(79, 140, 255, 0.07)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, .cm-content ::selection":
    {
      backgroundColor: "rgba(47, 111, 228, 0.22)",
    },
});

/** 明亮模式不启用 oneDark，语法高亮回落到 basicSetup 自带的默认亮色高亮 */
export function editorTheme(theme: "light" | "dark"): Extension {
  return theme === "dark" ? [oneDark, shared] : [shared, lightOverrides];
}
