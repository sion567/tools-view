# Tools View · JSON / YAML / XML / TOML 格式化与可视化

Rust + Tauri 桌面工具：粘贴或拖入 JSON / YAML / XML / TOML，自动识别格式，左侧编辑、中间格式化（可跨格式转换）、右侧节点关系图。

## 功能

- **自动识别格式**：粘贴/输入停顿后自动检测（JSON → YAML/XML/TOML 按首字符启发式），无需手动选类型；也可点「格式化」或 `Ctrl+Enter` 手动触发
- **跨格式转换**：格式化区可选输出格式（原格式 / JSON / YAML / XML / TOML），输入输出可以不同
- **布局**：T 字形三栏。上下分割条可拖拽调整输入区高度，下方双栏之间有竖向分割条；格式化区 / 图线区各自可「全屏」或「并排」（`Ctrl+1/2/3`），全部记忆
- **输入区**（CodeMirror 6，语法高亮跟随识别结果）：格式化 / 清空（`Ctrl+L`）/ 示例；支持直接拖入 `.json/.yaml/.xml/.toml` 文件；解析失败时错误行在编辑器内标红，点击错误信息可跳转定位
- **格式化区**：Rust 侧 pretty-print，解析失败显示错误信息 + 行列号；行号显示、按块折叠/展开（JSON 括号 / YAML 缩进块 / XML 标签 / TOML 表头）、全部折叠/展开、关键字搜索高亮（图线区同步淡化未命中节点）、复制、保存到文件；虚拟滚动，超大文档不卡
- **图线区**：React Flow（@xyflow/react）+ 自研 Reingold–Tilford 树布局（带轮廓合并）
  - 纵向（DOWN）/ 横向（RIGHT）切换，节点 handle 位置联动
  - 缩放、拖拽、小地图（超 1500 节点自动隐藏）；节点按 object / array / scalar 着色
  - 点击节点 → 格式化区滚动定位并闪烁（JSON 输出下可用）；双击节点复制其 JSON path
  - 下载 PNG / SVG：按图的真实坐标（zoom = 1）重新生成纯矢量 SVG，边线端点严格贴合节点边框；图宽超过单张画布上限（65535px）时自动分块导出多个 PNG

## 快捷键

| 按键 | 作用 |
|---|---|
| `Ctrl+Enter` | 立即格式化 |
| `Ctrl+L` | 清空输入 |
| `Ctrl+1 / 2 / 3` | 并排 / 格式化区全屏 / 图线区全屏 |

## 技术栈

| 模块 | 实现 |
|---|---|
| 后端解析 | Rust：serde_json、yaml_serde、quick-xml、toml（识别 + 归一化 + 转换） |
| IPC | 输出为 JSON 时省略 value，前端 `JSON.parse(pretty)` 自行补齐（大文档省一半传输） |
| 输入区 | CodeMirror 6 精简扩展集 + 自动格式识别（350ms 防抖）+ 错误行标记 |
| 格式化区 | Rust pretty-print + 行号 / 块折叠（lib/fold.ts）/ 搜索 / 虚拟滚动 |
| 图线区 | @xyflow/react + 自研树布局（Reingold–Tilford / RIGHT·DOWN）+ 节点↔行联动（lib/linkage.ts） |
| 下载图片 | 自绘 SVG（zoom = 1）→ PNG / SVG |
| 打包 | Tauri v2（dialog 插件用于保存文件） |

## 开发

```bash
npm install
npm run tauri dev
```

## 测试 / 检查

```bash
npm test          # 前端单测（vitest：fold / graph / linkage / graphExport）
npm run lint      # ESLint（含 react-hooks 规则）
cargo test --manifest-path src-tauri/Cargo.toml   # Rust 解析/转换测试
npm run build     # tsc + vite 产物构建
```

CI（GitHub Actions）：push / PR 自动跑 lint + 前后端测试 + 构建。

## 构建安装包

```bash
npm run tauri build
```

产物在 `src-tauri/target/release/bundle/`。

## 结构

```
src/                  前端（React + TS）
  components/         InputPanel / FormatPanel / GraphPanel
  lib/graph.ts        JSON 值 → React Flow 节点树 + 树布局（Reingold–Tilford）
  lib/linkage.ts      图节点 ↔ 格式化区行号 / JSON path 映射
  lib/fold.ts         三/四格式按行折叠解析
  lib/parse.ts        invoke 封装（解析 / 文件读写）
  lib/usePersistentState.ts  localStorage 持久化 state
src-tauri/
  src/parse.rs        格式识别 + 解析 + 归一化 + 跨格式序列化
  src/lib.rs          命令注册（parse / 文件读写）+ dialog 插件
scripts/gen-icon.mjs  图标生成（node scripts/gen-icon.mjs）
```

## 说明

- XML 转 JSON 约定：属性记作 `@attr`，文本记作 `#text`，同名兄弟元素合并为数组；JSON → XML 按相同约定互逆
- TOML 无 null，含 null 的 JSON 转换为 TOML 时会提示失败；`[` 开头的非 JSON 输入优先按 TOML 表头识别
- 图节点上限 3000，超出自动截断并提示；仅视口内节点参与渲染（大图滚动流畅）
- 主题跟随系统深浅色（手动切换后固定为手动选择）
