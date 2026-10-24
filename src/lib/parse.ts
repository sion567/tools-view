import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type { FormatTarget, ParseResponse } from "./types";

function fail(message: string): ParseResponse {
  return {
    ok: false,
    format: null,
    pretty: null,
    target: null,
    value: null,
    error: { message, line: null, column: null },
  };
}

export async function parseText(
  text: string,
  target: FormatTarget = "auto",
): Promise<ParseResponse> {
  try {
    const r = await invoke<ParseResponse>("parse_text", {
      text,
      target: target === "auto" ? null : target,
    });
    // 输出为 JSON 时 Rust 省略 value（省一份完整树走 IPC），这里自行补齐
    if (r.ok && r.value == null && r.pretty != null) {
      try {
        return { ...r, value: JSON.parse(r.pretty) };
      } catch {
        return fail("内部错误：JSON 输出无法解析");
      }
    }
    return r;
  } catch (e) {
    return fail(typeof e === "string" ? e : String(e));
  }
}

/** 拖拽打开文件后读取文本内容 */
export async function readTextFile(path: string): Promise<string> {
  return invoke<string>("read_text_file", { path });
}

/** 弹出保存对话框并写入文件；用户取消时返回 "cancelled" */
export async function saveTextFile(
  contents: string,
  defaultName: string,
): Promise<"saved" | "cancelled"> {
  const path = await save({ defaultPath: defaultName });
  if (!path) return "cancelled";
  await invoke("write_text_file", { path, contents });
  return "saved";
}
