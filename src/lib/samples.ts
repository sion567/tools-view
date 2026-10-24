export interface Sample {
  name: string;
  content: string;
}

export const SAMPLES: Sample[] = [
  {
    name: "JSON",
    content: `{
  "name": "tools-view",
  "version": "0.1.0",
  "features": ["auto-detect", "pretty-print", "graph-view"],
  "parsers": {
    "json": { "crate": "serde_json", "stable": true },
    "yaml": { "crate": "yaml_serde", "stable": true },
    "xml": { "crate": "quick-xml", "stable": true }
  },
  "authors": [
    { "name": "张三", "role": "maintainer" },
    { "name": "李四", "role": "contributor" }
  ],
  "config": {
    "theme": "dark",
    "layout": "layered",
    "direction": "DOWN",
    "maxNodes": 1200
  }
}`,
  },
  {
    name: "YAML",
    content: `service: tools-view
version: 0.1.0
runtime:
  rust: 1.84
  node: 22
  tauri: 2
parsers:
  - name: json
    crate: serde_json
    speed: fast
  - name: yaml
    crate: yaml_serde
    speed: fast
  - name: xml
    crate: quick-xml
    speed: fast
ui:
  editor:
    - codemirror
    - monaco
  graph:
    library: react-flow
    layout: tidy-tree
    direction: DOWN
features:
  enabled: true
  items: [pretty-print, auto-detect, export-image]`,
  },
  {
    name: "XML",
    content: `<?xml version="1.0" encoding="UTF-8"?>
<catalog>
  <book id="bk101">
    <author>张三</author>
    <title>JSON 指南</title>
    <price currency="CNY">49.9</price>
    <tags>
      <tag>json</tag>
      <tag>入门</tag>
    </tags>
  </book>
  <book id="bk102">
    <author>李四</author>
    <title>YAML 实战</title>
    <price currency="CNY">39.9</price>
    <tags>
      <tag>yaml</tag>
    </tags>
  </book>
  <meta total="2" updated="2026-10-22"/>
</catalog>`,
  },
];
