mod parse;

// async：命令跑在异步运行时而不是主线程，大文档解析期间 UI 不被冻结
#[tauri::command(async)]
fn parse_text(text: String, target: Option<String>) -> parse::ParseResponse {
    parse::parse_text(&text, target.as_deref())
}

/// 拖拽打开文件：读取文本内容（前端拿到后走自动识别）
#[tauri::command(async)]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("读取文件失败：{e}"))
}

/// 保存格式化结果到文件（路径来自前端 dialog.save）
#[tauri::command(async)]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("写入文件失败：{e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            parse_text,
            read_text_file,
            write_text_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
