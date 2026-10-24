export type Format = "json" | "yaml" | "xml" | "toml";

/** 输出格式："auto" = 与输入一致，其余为显式转换目标 */
export type FormatTarget = Format | "auto";

export interface ParseErrorInfo {
  message: string;
  line: number | null;
  column: number | null;
}

export interface ParseResponse {
  ok: boolean;
  /** 识别出的输入格式 */
  format: Format | null;
  pretty: string | null;
  /** 实际输出格式；null = 与输入一致（未转换） */
  target: Format | null;
  /** 归一化 JSON 值。输出为 JSON 时 Rust 不传，由前端 JSON.parse(pretty) 补齐 */
  value: unknown;
  error: ParseErrorInfo | null;
}
