mod parse;

#[tauri::command]
fn parse_text(text: String) -> parse::ParseResponse {
    parse::parse_text(&text)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![parse_text])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
