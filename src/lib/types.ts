export type Format = "json" | "yaml" | "xml";

export interface ParseErrorInfo {
  message: string;
  line: number | null;
  column: number | null;
}

export interface ParseResponse {
  ok: boolean;
  format: Format | null;
  pretty: string | null;
  value: unknown;
  error: ParseErrorInfo | null;
}
