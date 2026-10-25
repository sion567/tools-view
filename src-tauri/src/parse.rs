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
    /// 识别出的输入格式
    pub format: Option<&'static str>,
    pub pretty: Option<String>,
    /// 输出格式（转换时与 format 不同；None 表示与输入一致）
    pub target: Option<&'static str>,
    /// 归一化 JSON 值，供图线区建树。
    /// 输出格式为 json 时省略（None），前端直接 JSON.parse(pretty)，
    /// 大文档可省掉一份完整树走 IPC。
    pub value: Option<Json>,
    pub error: Option<ParseError>,
}

fn err_response(message: String, line: Option<u32>, column: Option<u32>) -> ParseResponse {
    ParseResponse {
        ok: false,
        format: None,
        pretty: None,
        target: None,
        value: None,
        error: Some(ParseError { message, line, column }),
    }
}

/// 自动识别格式：JSON →（XML / YAML / TOML 按首字符启发式排序）。
/// target 指定输出格式（None = 与输入相同），实现 JSON / YAML / XML / TOML 互转。
pub fn parse_text(text: &str, target: Option<&str>) -> ParseResponse {
    let cleaned = text.trim_start_matches('\u{feff}');
    let trimmed = cleaned.trim();

    if trimmed.is_empty() {
        return err_response(
            "输入为空，请先粘贴 JSON / YAML / XML / TOML 文本".into(),
            None,
            None,
        );
    }

    let (format, value) = match detect(trimmed) {
        Ok(d) => d,
        Err(e) => {
            return ParseResponse {
                ok: false,
                format: None,
                pretty: None,
                target: None,
                value: None,
                error: Some(e),
            }
        }
    };

    // 输出格式：未指定或不认识时与输入一致
    let out: &'static str = match target.unwrap_or("") {
        "json" => "json",
        "yaml" => "yaml",
        "xml" => "xml",
        "toml" => "toml",
        _ => format,
    };

    let pretty = match serialize(&value, out) {
        Ok(p) => p,
        Err(message) => return err_response(format!("转换为 {out} 失败：{message}"), None, None),
    };

    ParseResponse {
        ok: true,
        format: Some(format),
        pretty: Some(pretty),
        target: if out == format { None } else { Some(out) },
        value: if out == "json" { None } else { Some(value) },
        error: None,
    }
}

type Detected = (&'static str, Json);

/// 依次尝试各格式，返回第一个成功且"像结构化数据"的结果
fn detect(trimmed: &str) -> Result<Detected, ParseError> {
    // JSON 也是合法的 YAML，必须最先判定
    let json_err = match try_json(trimmed) {
        Ok(v) => return Ok(("json", v)),
        Err(e) => e,
    };

    // 以 '<' 开头优先后试 XML；以 '[' 开头（且不是 JSON）优先 TOML 段落；
    // 其余按 YAML → TOML 顺序
    let order: Vec<&str> = if trimmed.starts_with('<') {
        vec!["xml", "yaml", "toml"]
    } else if trimmed.starts_with('[') {
        vec!["toml", "yaml", "xml"]
    } else {
        vec!["yaml", "toml", "xml"]
    };

    let mut first_err: Option<ParseError> = None;
    let mut toml_err: Option<ParseError> = None;
    for kind in order {
        let result = match kind {
            "xml" => try_xml(trimmed),
            "yaml" => try_yaml(trimmed),
            _ => try_toml(trimmed),
        };
        match result {
            Ok(v) => return Ok((kind, v)),
            Err(e) => {
                // 留存 TOML 错误供末尾回退报告复用，避免把整个输入再解析一遍
                if kind == "toml" {
                    toml_err = Some(e.clone());
                }
                first_err.get_or_insert(e);
            }
        };
    }

    // 全部失败：按最可能的格式报告错误（含行列号）
    Err(if trimmed.starts_with('<') {
        first_err.unwrap_or(json_err)
    } else if trimmed.starts_with('{') || trimmed.starts_with('[') {
        json_err
    } else {
        // 非 '<'/'{'/'[' 开头：优先报告 YAML 的真实语法错误，
        // 只有"纯文本标量"这种未识别才回退到 TOML 错误
        match first_err {
            Some(e) if !e.message.contains("纯文本标量") => e,
            _ => match toml_err {
                Some(mut e) => {
                    e.message = format!("YAML/TOML 均解析失败，最近错误：{}", e.message);
                    e
                }
                None => first_err.unwrap_or(json_err),
            },
        }
    })
}

fn try_json(s: &str) -> Result<Json, ParseError> {
    serde_json::from_str(s).map_err(|e| ParseError {
        message: format!("JSON 解析失败：{e}"),
        line: Some(e.line() as u32),
        column: Some(e.column() as u32),
    })
}

fn try_yaml(s: &str) -> Result<Json, ParseError> {
    let yaml_value: yaml_serde::Value = yaml_serde::from_str(s).map_err(|e| {
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

    // 纯文本标量视为未识别，避免把任意一句话（或 TOML 的 k = v）误判成 YAML
    if !(yaml_value.is_mapping() || yaml_value.is_sequence()) {
        return Err(ParseError {
            message: "内容是纯文本标量，未识别出结构化数据".into(),
            line: None,
            column: None,
        });
    }

    serde_json::to_value(&yaml_value).map_err(|e| ParseError {
        message: format!("YAML 转 JSON 失败：{e}"),
        line: None,
        column: None,
    })
}

fn try_toml(s: &str) -> Result<Json, ParseError> {
    let toml_value: toml::Value = toml::from_str(s).map_err(|e| ParseError {
        message: format!("TOML 解析失败：{e}"),
        line: None,
        column: None,
    })?;
    serde_json::to_value(&toml_value).map_err(|e| ParseError {
        message: format!("TOML 转 JSON 失败：{e}"),
        line: None,
        column: None,
    })
}

// ---------- 归一化 JSON → 各格式序列化 ----------

fn serialize(value: &Json, fmt: &str) -> Result<String, String> {
    match fmt {
        "json" => serde_json::to_string_pretty(value).map_err(|e| e.to_string()),
        "yaml" => {
            use serde::Deserialize as _;
            let yaml_value =
                yaml_serde::Value::deserialize(value).map_err(|e| e.to_string())?;
            yaml_serde::to_string(&yaml_value).map_err(|e| e.to_string())
        }
        "xml" => {
            let root = json_to_xml("root", value);
            let mut out = String::new();
            pretty_xml(&root, 0, &mut out);
            Ok(out)
        }
        "toml" => toml::to_string_pretty(value).map_err(|e| e.to_string()),
        other => Err(format!("不支持的输出格式：{other}")),
    }
}

/// JSON → XML，规则与 xml_to_json 互逆：
/// 键 "@x" → 属性、"#text" → 文本、数组 → 同名重复子元素、其余 → 子元素
fn json_to_xml(name: &str, v: &Json) -> XmlEl {
    let mut el = XmlEl {
        name: name.to_string(),
        attrs: Vec::new(),
        text: String::new(),
        children: Vec::new(),
    };
    match v {
        Json::Object(map) => {
            for (k, item) in map {
                if let Some(attr) = k.strip_prefix('@') {
                    if let Json::String(s) = item {
                        el.attrs.push((attr.to_string(), s.clone()));
                    }
                } else if k == "#text" {
                    if let Json::String(s) = item {
                        el.text.push_str(s);
                    }
                } else {
                    match item {
                        Json::Array(items) => {
                            for it in items {
                                el.children.push(json_to_xml(k, it));
                            }
                        }
                        other => el.children.push(json_to_xml(k, other)),
                    }
                }
            }
        }
        other => {
            el.text = scalar_text(other);
        }
    }
    el
}

fn scalar_text(v: &Json) -> String {
    match v {
        Json::Null => String::new(),
        Json::String(s) => s.clone(),
        Json::Bool(b) => b.to_string(),
        Json::Number(n) => n.to_string(),
        Json::Array(_) | Json::Object(_) => String::new(),
    }
}

// ---------- XML ----------

struct XmlEl {
    name: String,
    attrs: Vec<(String, String)>,
    text: String,
    children: Vec<XmlEl>,
}

fn try_xml(s: &str) -> Result<Json, ParseError> {
    let root = parse_xml_tree(s).map_err(|(message, offset)| {
        let (line, column) = offset.map(|o| line_col(s, o)).unwrap_or((None, None));
        ParseError { message, line, column }
    })?;

    let mut obj = Map::new();
    obj.insert(root.name.clone(), xml_to_json(&root));

    let mut pretty = String::new();
    pretty_xml(&root, 0, &mut pretty);
    Ok(Json::Object(obj))
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

fn parse_xml_tree(text: &str) -> Result<XmlEl, (String, Option<usize>)> {
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
        let r = parse_text(r#"{"a": [1, 2], "b": {"c": true}}"#, None);
        assert!(r.ok);
        assert_eq!(r.format, Some("json"));
        assert!(r.pretty.unwrap().starts_with("{\n  \"a\""));
        assert!(r.value.is_none(), "JSON 输出应省略 value");
    }

    #[test]
    fn detects_yaml() {
        let r = parse_text("service: tools-view\nversion: 0.1.0\nparsers:\n  - name: json\n", None);
        assert!(r.ok);
        assert_eq!(r.format, Some("yaml"));
        assert!(r.pretty.unwrap().contains("parsers:"));
        assert!(r.value.is_some(), "YAML 输出需要 value 供图线区建树");
    }

    #[test]
    fn detects_toml() {
        let r = parse_text("[package]\nname = \"tools-view\"\nversion = \"0.1.0\"\n\n[deps]\nserde = \"1\"\n", None);
        assert!(r.ok, "TOML 应可解析：{:?}", r.error);
        assert_eq!(r.format, Some("toml"));
        assert!(r.pretty.unwrap().contains("[package]"));
    }

    #[test]
    fn detects_toml_preferred_for_bracket_start() {
        // 以 '[' 开头且不是 JSON：优先按 TOML 段落解释，而不是 YAML 流序列
        let r = parse_text("[dependencies]\nserde = \"1\"\n", None);
        assert!(r.ok);
        assert_eq!(r.format, Some("toml"));
    }

    #[test]
    fn detects_toml_kv_without_section() {
        let r = parse_text("title = \"hello\"\n[owner]\nname = \"tom\"\n", None);
        assert!(r.ok, "k = v 开头的 TOML 不应被误判：{:?}", r.error);
        assert_eq!(r.format, Some("toml"));
    }

    #[test]
    fn detects_xml_with_attrs_and_repeated_children() {
        let r = parse_text(
            "<catalog><book id=\"1\"><title>JSON</title></book><book id=\"2\"><title>YAML</title></book></catalog>",
            None,
        );
        assert!(r.ok);
        assert_eq!(r.format, Some("xml"));
        let s = r.pretty.unwrap();
        assert!(s.contains("  <book"));
        let v = r.value.unwrap().to_string();
        assert!(v.contains("@id") && v.contains("book\":[") && v.contains("#text"));
    }

    #[test]
    fn converts_json_to_yaml() {
        let r = parse_text(r#"{"a": 1, "b": [true, null]}"#, Some("yaml"));
        assert!(r.ok);
        assert_eq!(r.format, Some("json"));
        assert_eq!(r.target, Some("yaml"));
        let pretty = r.pretty.unwrap();
        assert!(pretty.contains("a: 1") && pretty.contains("- true"), "{pretty}");
        assert!(r.value.is_some());
        // 转换输出应能重新解析回等价结构
        let back = parse_text(&pretty, None);
        assert!(back.ok);
        assert_eq!(back.format, Some("yaml"));
    }

    #[test]
    fn converts_json_to_xml() {
        let r = parse_text(r#"{"name": "tools", "tags": ["a", "b"], "meta": {"@id": "1"}}"#, Some("xml"));
        assert!(r.ok);
        let pretty = r.pretty.unwrap();
        assert!(pretty.contains("<name>tools</name>"), "{pretty}");
        assert!(pretty.contains("<tags>a</tags>") && pretty.contains("<tags>b</tags>"));
        assert!(pretty.contains("<meta id=\"1\"/>"));
        // XML → JSON 的文本约定是 #text，数组还原为同名重复元素
        let back = parse_text(&pretty, None);
        assert!(back.ok);
        let v = back.value.unwrap().to_string();
        assert!(
            v.contains("\"tags\":[{\"#text\":\"a\"},{\"#text\":\"b\"}]"),
            "{v}"
        );
    }

    #[test]
    fn converts_json_to_toml() {
        let r = parse_text(r#"{"title": "demo", "owner": {"name": "tom"}}"#, Some("toml"));
        assert!(r.ok);
        let pretty = r.pretty.unwrap();
        assert!(pretty.contains("title = \"demo\"") && pretty.contains("[owner]"), "{pretty}");
    }

    #[test]
    fn toml_rejects_null() {
        // TOML 没有 null，转换失败应给出明确错误而不是崩溃
        let r = parse_text(r#"{"a": null}"#, Some("toml"));
        assert!(!r.ok);
        assert!(r.error.unwrap().message.contains("toml"));
    }

    #[test]
    fn json_error_has_line_and_column() {
        // 未闭合的 JSON，同时也不是合法 YAML/TOML，应报告带行列号的 JSON 错误
        let r = parse_text("{\n  \"a\": [1, 2", None);
        assert!(!r.ok);
        let e = r.error.unwrap();
        assert!(e.message.contains("JSON"), "{}", e.message);
        assert!(e.line.unwrap() >= 2);
        assert!(e.column.is_some());
    }

    #[test]
    fn xml_roundtrip_through_json() {
        let xml = "<config><srv id=\"1\">api</srv><srv id=\"2\">web</srv></config>";
        let to_json = parse_text(xml, Some("json"));
        assert!(to_json.ok);
        assert!(to_json.value.is_none(), "JSON 输出省略 value");
        assert!(to_json.pretty.unwrap().contains("\"@id\": \"1\""));
        // XML → JSON → XML 应还原出同名重复元素（2 个开标签）
        let back = parse_text(xml, Some("xml"));
        assert!(back.ok);
        assert!(back.pretty.unwrap().matches("<srv").count() == 2);
    }

    #[test]
    fn rejects_plain_text() {
        let r = parse_text("hello world this is not structured", None);
        assert!(!r.ok);
        assert!(r.error.is_some());
    }

    #[test]
    fn empty_input_is_rejected() {
        let r = parse_text("   \n  ", None);
        assert!(!r.ok);
    }

    #[test]
    fn yaml_scalar_is_not_mistaken_as_yaml() {
        let r = parse_text("just a plain sentence", None);
        assert!(!r.ok);
    }

    #[test]
    fn xml_error_reports_position() {
        let r = parse_text("<a>\n  <b></a>\n</a>", None);
        assert!(!r.ok);
        let e = r.error.unwrap();
        assert!(e.message.contains("XML"));
        assert!(e.line.is_some());
    }

    // 与 src/lib/samples.ts 的示例保持一致：未格式化的紧凑输入也应被正确识别
    #[test]
    fn detects_minified_json() {
        let r = parse_text(
            r#"{"name":"tools-view","version":"0.1.0","features":["auto-detect","pretty-print","graph-view"],"parsers":{"json":{"crate":"serde_json","stable":true},"yaml":{"crate":"yaml_serde","stable":true},"xml":{"crate":"quick-xml","stable":true}},"authors":[{"name":"张三","role":"maintainer"},{"name":"李四","role":"contributor"}],"config":{"theme":"dark","layout":"tidy-tree","direction":"DOWN","maxNodes":1200}}"#,
            None,
        );
        assert!(r.ok);
        assert_eq!(r.format, Some("json"));
        assert!(r.pretty.unwrap().starts_with("{\n  \"name\""));
    }

    #[test]
    fn detects_flow_style_yaml() {
        let r = parse_text(
            "{service: tools-view, version: 0.1.0, runtime: {rust: 1.84, node: 22, tauri: 2}, parsers: [{name: json, crate: serde_json, speed: fast}, {name: yaml, crate: yaml_serde, speed: fast}, {name: xml, crate: quick-xml, speed: fast}], ui: {editor: [codemirror, monaco], graph: {library: react-flow, layout: tidy-tree, direction: DOWN}}, features: {enabled: true, items: [pretty-print, auto-detect, export-image]}}",
            None,
        );
        assert!(r.ok, "flow 风格 YAML 应可解析：{:?}", r.error);
        assert_eq!(r.format, Some("yaml"));
        assert!(
            r.pretty.unwrap().lines().count() > 5,
            "flow 输入应展开为多行块输出"
        );
    }

    #[test]
    fn detects_single_line_xml() {
        let r = parse_text(
            r#"<?xml version="1.0" encoding="UTF-8"?><catalog><book id="bk101"><author>张三</author><title>JSON 指南</title><price currency="CNY">49.9</price><tags><tag>json</tag><tag>入门</tag></tags></book><book id="bk102"><author>李四</author><title>YAML 实战</title><price currency="CNY">39.9</price><tags><tag>yaml</tag></tags></book><meta total="2" updated="2026-10-22"/></catalog>"#,
            None,
        );
        assert!(r.ok);
        assert_eq!(r.format, Some("xml"));
        assert!(r.pretty.unwrap().contains("  <book"));
    }
}
