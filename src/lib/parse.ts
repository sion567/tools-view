import { invoke } from "@tauri-apps/api/core";
import type { ParseResponse } from "./types";

export async function parseText(text: string): Promise<ParseResponse> {
  try {
    return await invoke<ParseResponse>("parse_text", { text });
  } catch (e) {
    return {
      ok: false,
      format: null,
      pretty: null,
      value: null,
      error: {
        message: typeof e === "string" ? e : String(e),
        line: null,
        column: null,
      },
    };
  }
}
