use serde::Serialize;
use serde_json::{Map, Value as Json};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseError {
    pub message: String,
    pub line: Option<u32>,
    pub column: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseResponse {
    pub ok: bool,
    pub format: Option<&'static str>,
    pub pretty: Option<String>,
    pub value: Option<Json>,
    pub error: Option<ParseError>,
}

/// 自动识别格式：JSON → (XML|YAML 按首字符启发式排序)。
/// 成功时返回该格式的美化文本 + 归一化后的 JSON 值（供图线区建树）。
pub fn parse_text(text: &str) -> ParseResponse {
    let cleaned = text.trim_start_matches('\u{feff}');
    let trimmed = cleaned.trim();

    if trimmed.is_empty() {
        return ParseResponse {
            ok: false,
            format: None,
            pretty: None,
            value: None,
            error: Some(ParseError {
                message: "输入为空，请先粘贴 JSON / YAML / XML 文本".into(),
                line: None,
                column: None,
            }),
        };
    }

    let json_err: Option<ParseError>;
    let mut yaml_err: Option<ParseError> = None;
    let mut xml_err: Option<ParseError> = None;

    // JSON 也是合法的 YAML，必须最先判定
    match try_json(trimmed) {
        Ok((pretty, value)) => return success("json", pretty, value),
        Err(e) => json_err = Some(e),
    }

    // 以 '<' 开头优先后试 XML，否则优先 YAML；一种失败再互试
    let looks_xml = trimmed.starts_with('<');
    let order: [&str; 2] = if looks_xml { ["xml", "yaml"] } else { ["yaml", "xml"] };

    for kind in order {
        let result = if kind == "xml" {
            try_xml(trimmed).inspect_err(|e| xml_err = Some(e.clone()))
        } else {
            try_yaml(trimmed).inspect_err(|e| yaml_err = Some(e.clone()))
        };
        if let Ok((pretty, value)) = result {
            return success(if kind == "xml" { "xml" } else { "yaml" }, pretty, value);
        }
    }

    // 全部失败：按最可能的格式报告错误（含行列号）
    let primary = if looks_xml {
        xml_err.as_ref().or_else(|| yaml_err.as_ref())
    } else if trimmed.starts_with('{') || trimmed.starts_with('[') {
        json_err.as_ref().or_else(|| yaml_err.as_ref())
    } else {
        yaml_err.as_ref().or_else(|| xml_err.as_ref())
    };

    let error = primary.cloned().unwrap_or(ParseError {
        message: "无法识别输入格式，请检查内容是否为合法的 JSON / YAML / XML".into(),
        line: None,
        column: None,
    });

    ParseResponse {
        ok: false,
        format: None,
        pretty: None,
        value: None,
        error: Some(error),
    }
}

fn success(format: &'static str, pretty: String, value: Json) -> ParseResponse {
    ParseResponse {
        ok: true,
        format: Some(format),
        pretty: Some(pretty),
        value: Some(value),
        error: None,
    }
}

fn try_json(s: &str) -> Result<(String, Json), ParseError> {
    let value: Json = serde_json::from_str(s).map_err(|e| ParseError {
        message: format!("JSON 解析失败：{e}"),
        line: Some(e.line() as u32),
        column: Some(e.column() as u32),
    })?;
    let pretty = serde_json::to_string_pretty(&value).map_err(|e| ParseError {
        message: format!("JSON 序列化失败：{e}"),
        line: None,
        column: None,
    })?;
    Ok((pretty, value))
}

fn try_yaml(s: &str) -> Result<(String, Json), ParseError> {
    let yaml_value: serde_yaml::Value = serde_yaml::from_str(s).map_err(|e| {
        let (line, column) = e
            .location()
            .map(|loc| (Some(loc.line() as u32), Some(loc.column() as u32)))
            .unwrap_or((None, None));
        ParseError {
            message: format!("YAML 解析失败：{e}"),
            line,
            column,
        }
    })?;

    // 纯文本标量视为未识别，避免把任意一句话误判成 YAML
    if !(yaml_value.is_mapping() || yaml_value.is_sequence()) {
        return Err(ParseError {
            message: "内容是纯文本标量，未识别出结构化数据".into(),
            line: None,
            column: None,
        });
    }

    let value = serde_json::to_value(&yaml_value).map_err(|e| ParseError {
        message: format!("YAML 转 JSON 失败：{e}"),
        line: None,
        column: None,
    })?;
    let pretty = serde_yaml::to_string(&yaml_value).map_err(|e| ParseError {
        message: format!("YAML 序列化失败：{e}"),
        line: None,
        column: None,
    })?;
    Ok((pretty, value))
}

// ---------- XML ----------

struct XmlEl {
    name: String,
    attrs: Vec<(String, String)>,
    text: String,
    children: Vec<XmlEl>,
}

type XmlError = (String, Option<usize>);

fn try_xml(s: &str) -> Result<(String, Json), ParseError> {
    let root = parse_xml_tree(s).map_err(|(message, offset)| {
        let (line, column) = offset.map(|o| line_col(s, o)).unwrap_or((None, None));
        ParseError { message, line, column }
    })?;

    let mut obj = Map::new();
    obj.insert(root.name.clone(), xml_to_json(&root));

    let mut pretty = String::new();
    pretty_xml(&root, 0, &mut pretty);
    Ok((pretty, Json::Object(obj)))
}

fn bytes_to_string<B: AsRef<[u8]>>(b: B) -> String {
    String::from_utf8_lossy(b.as_ref()).into_owned()
}

fn unescape_bytes(raw: &[u8]) -> Result<String, String> {
    let s = std::str::from_utf8(raw).map_err(|e| format!("XML 编码错误：{e}"))?;
    quick_xml::escape::unescape(s)
        .map(|c| c.into_owned())
        .map_err(|e| format!("XML 转义字符解码失败：{e}"))
}

fn parse_xml_tree(text: &str) -> Result<XmlEl, XmlError> {
    use quick_xml::events::Event;

    let mut reader = quick_xml::Reader::from_str(text);
    reader.config_mut().trim_text(true);

    let mut stack: Vec<XmlEl> = Vec::new();
    let mut root: Option<XmlEl> = None;

    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                let mut attrs = Vec::new();
                for attr in e.attributes() {
                    let attr = attr.map_err(|err| (format!("XML 属性解析错误：{err}"), None))?;
                    let key = bytes_to_string(&attr.key);
                    let value = unescape_bytes(&attr.value).map_err(|m| (m, None))?;
                    attrs.push((key, value));
                }
                stack.push(XmlEl {
                    name: bytes_to_string(e.name()),
                    attrs,
                    text: String::new(),
                    children: Vec::new(),
                });
            }
            Ok(Event::Empty(e)) => {
                let mut attrs = Vec::new();
                for attr in e.attributes() {
                    let attr = attr.map_err(|err| (format!("XML 属性解析错误：{err}"), None))?;
                    let key = bytes_to_string(&attr.key);
                    let value = unescape_bytes(&attr.value).map_err(|m| (m, None))?;
                    attrs.push((key, value));
                }
                let el = XmlEl {
                    name: bytes_to_string(e.name()),
                    attrs,
                    text: String::new(),
                    children: Vec::new(),
                };
                attach(&mut stack, &mut root, el).map_err(|m| (m, None))?;
            }
            Ok(Event::Text(t)) => {
                let raw = t.into_inner();
                let content = unescape_bytes(&raw).map_err(|m| (m, None))?;
                if let Some(top) = stack.last_mut() {
                    top.text.push_str(&content);
                }
            }
            Ok(Event::CData(t)) => {
                let raw = t.into_inner();
                let content = String::from_utf8_lossy(&raw).into_owned();
                if let Some(top) = stack.last_mut() {
                    top.text.push_str(&content);
                }
            }
            Ok(Event::End(_)) => {
                let el = stack
                    .pop()
                    .ok_or_else(|| ("出现多余的 XML 结束标签".to_string(), None))?;
                attach(&mut stack, &mut root, el).map_err(|m| (m, None))?;
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(err) => {
                let pos = reader.error_position() as usize;
                return Err((format!("XML 格式错误：{err}"), Some(pos)));
            }
        }
    }

    if stack.len() > 1 {
        return Err(("存在未闭合的 XML 标签".to_string(), None));
    }
    root.ok_or_else(|| ("未找到 XML 根元素".to_string(), None))
}

fn attach(stack: &mut Vec<XmlEl>, root: &mut Option<XmlEl>, el: XmlEl) -> Result<(), String> {
    match stack.last_mut() {
        Some(parent) => parent.children.push(el),
        None => {
            if root.is_some() {
                return Err("XML 只能有一个根元素".into());
            }
            *root = Some(el);
        }
    }
    Ok(())
}

/// XML 元素转 JSON：属性记作 "@attr"，文本记作 "#text"，
/// 同名子元素合并为数组，保持文档顺序。
fn xml_to_json(el: &XmlEl) -> Json {
    let mut map = Map::new();
    for (k, v) in &el.attrs {
        map.insert(format!("@{k}"), Json::String(v.clone()));
    }

    for child in &el.children {
        let cj = xml_to_json(child);
        match map.get_mut(&child.name) {
            None => {
                map.insert(child.name.clone(), cj);
            }
            Some(Json::Array(arr)) => arr.push(cj),
            Some(existing) => {
                let prev = std::mem::replace(existing, Json::Null);
                *existing = Json::Array(vec![prev, cj]);
            }
        }
    }

    let text = el.text.trim();
    if !text.is_empty() {
        map.insert("#text".to_string(), Json::String(text.to_string()));
    }

    if map.is_empty() {
        Json::String(String::new())
    } else {
        Json::Object(map)
    }
}

fn xml_escape_text(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

fn xml_escape_attr(s: &str) -> String {
    xml_escape_text(s).replace('"', "&quot;")
}

fn pretty_xml(el: &XmlEl, depth: usize, out: &mut String) {
    let pad = "  ".repeat(depth);
    out.push_str(&pad);
    out.push('<');
    out.push_str(&el.name);
    for (k, v) in &el.attrs {
        out.push(' ');
        out.push_str(k);
        out.push_str("=\"");
        out.push_str(&xml_escape_attr(v));
        out.push('"');
    }

    let text = el.text.trim();
    if el.children.is_empty() {
        if text.is_empty() {
            out.push_str("/>\n");
        } else {
            out.push('>');
            out.push_str(&xml_escape_text(text));
            out.push_str(&format!("</{}>\n", el.name));
        }
        return;
    }

    out.push_str(">\n");
    if !text.is_empty() {
        out.push_str(&pad);
        out.push_str("  ");
        out.push_str(&xml_escape_text(text));
        out.push('\n');
    }
    for child in &el.children {
        pretty_xml(child, depth + 1, out);
    }
    out.push_str(&pad);
    out.push_str(&format!("</{}>\n", el.name));
}

/// 字节偏移 → (行, 列)，均从 1 开始
fn line_col(text: &str, offset: usize) -> (Option<u32>, Option<u32>) {
    let mut off = offset.min(text.len());
    while off > 0 && !text.is_char_boundary(off) {
        off -= 1;
    }
    let before = &text[..off];
    let line = before.matches('\n').count() as u32 + 1;
    let col = before
        .rsplit('\n')
        .next()
        .map(|s| s.chars().count() as u32 + 1)
        .unwrap_or(1);
    (Some(line), Some(col))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_json() {
        let r = parse_text(r#"{"a": [1, 2], "b": {"c": true}}"#);
        assert!(r.ok);
        assert_eq!(r.format, Some("json"));
        assert!(r.pretty.unwrap().contains("\"a\""));
        assert!(r.value.is_some());
    }

    #[test]
    fn detects_yaml() {
        let r = parse_text("service: tools-view\nversion: 0.1.0\nparsers:\n  - name: json\n");
        assert!(r.ok);
        assert_eq!(r.format, Some("yaml"));
        assert!(r.pretty.unwrap().contains("parsers:"));
    }

    #[test]
    fn detects_xml_with_attrs_and_repeated_children() {
        let r = parse_text(
            "<catalog><book id=\"1\"><title>JSON</title></book><book id=\"2\"><title>YAML</title></book></catalog>",
        );
        assert!(r.ok);
        assert_eq!(r.format, Some("xml"));
        let s = r.value.unwrap().to_string();
        assert!(s.contains("@id"));
        assert!(s.contains("book\":["));
        assert!(s.contains("#text")); // title 的文本内容
        // pretty 输出应保留缩进
        assert!(r.pretty.unwrap().contains("  <book"));
    }

    #[test]
    fn rejects_plain_text() {
        let r = parse_text("hello world this is not structured");
        assert!(!r.ok);
        assert!(r.error.is_some());
    }

    #[test]
    fn json_error_has_line_and_column() {
        // 未闭合的 JSON，同时也不是合法 YAML，应报告带行列号的 JSON 错误
        let r = parse_text("{\n  \"a\": [1, 2");
        assert!(!r.ok);
        let e = r.error.unwrap();
        assert!(e.message.contains("JSON"));
        assert!(e.line.is_some());
        assert!(e.line.unwrap() >= 2);
        assert!(e.column.is_some());
    }

    #[test]
    fn empty_input_is_rejected() {
        let r = parse_text("   \n  ");
        assert!(!r.ok);
    }

    #[test]
    fn yaml_scalar_is_not_mistaken_as_yaml() {
        // 纯文本标量不应被识别为 YAML
        let r = parse_text("just a plain sentence");
        assert!(!r.ok);
    }

    #[test]
    fn xml_error_reports_position() {
        let r = parse_text("<a>\n  <b></a>\n</a>");
        assert!(!r.ok);
        let e = r.error.unwrap();
        assert!(e.message.contains("XML"));
        assert!(e.line.is_some());
    }
}
