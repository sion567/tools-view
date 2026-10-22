import { useState } from "react";
import type { ParseResponse } from "../lib/types";

interface FormatPanelProps {
  response: ParseResponse | null;
  busy: boolean;
}

export default function FormatPanel({ response, busy }: FormatPanelProps) {
  const [copied, setCopied] = useState(false);

  const pretty = response?.ok ? (response.pretty ?? "") : "";
  const error = response && !response.ok ? response.error : null;
  const format = response?.ok ? response.format : null;

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

  return (
    <section className="panel format-panel">
      <header className="panel-header">
        <span className="panel-title">格式化区</span>
        {format && <span className={`badge fmt-${format}`}>{format.toUpperCase()}</span>}
        <div className="panel-actions">
          <button className="btn" onClick={copy} disabled={!pretty}>
            {copied ? "已复制" : "复制"}
          </button>
        </div>
      </header>
      <div className="panel-body">
        {error ? (
          <div className="error-box">
            <div className="error-title">✕ 解析失败</div>
            <div className="error-message">{error.message}</div>
            {(error.line !== null || error.column !== null) && (
              <div className="error-pos">
                行 {error.line ?? "?"}，列 {error.column ?? "?"}
              </div>
            )}
          </div>
        ) : pretty ? (
          <pre className="pretty">{pretty}</pre>
        ) : (
          <div className="placeholder">{busy ? "解析中…" : "解析结果将显示在这里"}</div>
        )}
      </div>
    </section>
  );
}
