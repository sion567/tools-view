# Tools View · JSON / YAML / XML 格式化与可视化

Rust + Tauri 桌面工具：粘贴 JSON / YAML / XML，自动识别格式，左侧编辑、中间格式化、右侧节点关系图。

## 功能

- **自动识别格式**：粘贴/输入停顿后自动检测（JSON → YAML/XML），无需手动选类型；也可点「格式化」手动触发
- **输入区**（CodeMirror 6，语法高亮跟随识别结果）：格式化 / 清空 / 示例
- **格式化区**：Rust 侧 pretty-print（JSON 缩进输出 / YAML / 缩进 XML），解析失败显示错误信息 + 行列号
- **图线区**：React Flow（@xyflow/react）+ elkjs 分层布局（`elk.algorithm: layered`）
  - 纵向（DOWN）/ 横向（RIGHT）切换，节点 handle 位置联动（上/下进出 ↔ 左/右进出）
  - 缩放、拖拽、小地图；节点按 object / array / scalar 着色
  - 下载 PNG / SVG：按图的真实坐标（zoom = 1）重新生成纯矢量 SVG，PNG 由其光栅化，因此放大不糊；
    图宽超过单张画布上限（65535px）时自动分块导出多个 PNG

## 技术栈

| 模块 | 实现 |
|---|---|
| 后端解析 | Rust：serde_json、yaml_serde、quick-xml |
| 输入区 | CodeMirror 6 + 自动格式识别（350ms 防抖） |
| 格式化区 | Rust pretty-print + 错误提示（行列定位） |
| 图线区 | @xyflow/react + elkjs（layered / RIGHT·DOWN） |
| 下载图片 | 自绘 SVG（zoom = 1）→ PNG / SVG |
| 打包 | Tauri v2 |

## 开发

```bash
npm install
npm run tauri dev
```

## 构建安装包

```bash
npm run tauri build
```

产物在 `src-tauri/target/release/bundle/`。

## 结构

```
src/                  前端（React + TS）
  components/         InputPanel / FormatPanel / GraphPanel
  lib/graph.ts        JSON 值 → React Flow 节点树 + elkjs 布局
  lib/parse.ts        invoke 封装
src-tauri/
  src/parse.rs        格式识别 + 解析 + 归一化 JSON + pretty-print
scripts/gen-icon.mjs  图标生成（node scripts/gen-icon.mjs）
```

## 说明

- XML 转 JSON 约定：属性记作 `@attr`，文本记作 `#text`，同名兄弟元素合并为数组
- 图节点上限 1200，超出自动截断并提示（防止大文档卡顿）
