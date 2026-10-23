import { useCallback, useEffect, useRef, useState } from "react";
import InputPanel from "./components/InputPanel";
import FormatPanel from "./components/FormatPanel";
import GraphPanel from "./components/GraphPanel";
import { parseText } from "./lib/parse";
import { SAMPLES } from "./lib/samples";
import { useTheme } from "./lib/theme";
import type { ParseResponse } from "./lib/types";

export default function App() {
  const { theme, toggleTheme } = useTheme();
  const [text, setText] = useState("");
  const [response, setResponse] = useState<ParseResponse | null>(null);
  const [busy, setBusy] = useState(false);
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

  const graphValue = response?.ok ? response.value : null;

  return (
    <main className="app">
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
      <div className="app-bottom">
        <FormatPanel response={response} busy={busy} />
        <GraphPanel value={graphValue} theme={theme} />
      </div>
    </main>
  );
}
