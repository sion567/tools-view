import { useEffect, useState } from "react";

/** localStorage 读取 + 解析失败/不可用时的回退 */
export function readPersisted<T>(
  key: string,
  fallback: T,
  parse: (raw: string) => T | null,
): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) {
      const v = parse(raw);
      if (v !== null) return v;
    }
  } catch {
    // localStorage 不可用
  }
  return fallback;
}

/**
 * 带 localStorage 持久化的 state。
 * parse 返回 null 表示存储值不合法，使用 fallback。
 */
export function usePersistentState<T>(
  key: string,
  fallback: T,
  parse: (raw: string) => T | null,
  serialize: (v: T) => string,
) {
  const [value, setValue] = useState<T>(() => readPersisted(key, fallback, parse));
  useEffect(() => {
    // 拖拽分割条会以指针频率连发更新，防抖落盘避免高频同步写 localStorage
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem(key, serialize(value));
      } catch {
        // 忽略写入失败
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, [key, value, serialize]);
  return [value, setValue] as const;
}

/** 常用解析器：正整数 */
export function parsePositiveInt(raw: string): number | null {
  const v = Number(raw);
  return Number.isFinite(v) && v >= 1 ? v : null;
}

/** 常用解析器：枚举值 */
export function parseEnum<T extends string>(values: readonly T[]) {
  return (raw: string): T | null => (values.includes(raw as T) ? (raw as T) : null);
}
