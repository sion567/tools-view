import { useEffect, useRef } from "react";
import { IconButton } from "./icons";

const SHORTCUTS: { keys: string[]; desc: string }[] = [
  { keys: ["Ctrl", "Enter"], desc: "立即格式化（不必等输入停顿）" },
  { keys: ["Ctrl", "L"], desc: "清空输入" },
  { keys: ["Ctrl", "1"], desc: "双栏并排显示" },
  { keys: ["Ctrl", "2"], desc: "格式化区全屏" },
  { keys: ["Ctrl", "3"], desc: "图线区全屏" },
  { keys: ["Enter"], desc: "搜索：下一个匹配" },
  { keys: ["Shift", "Enter"], desc: "搜索：上一个匹配" },
  { keys: ["Esc"], desc: "关闭弹窗 / 清空搜索" },
  { keys: ["F1"], desc: "打开本帮助" },
  { keys: ["Ctrl", "Z"], desc: "输入区撤销" },
  { keys: ["Ctrl", "Y"], desc: "输入区重做" },
  { keys: ["Tab"], desc: "输入区缩进（编辑器内）" },
];

const TIPS: string[] = [
  "把 .json / .yaml / .xml / .toml 文件直接拖进窗口即可打开",
  "拖动输入区下缘的横条调整其高度，拖动下方双栏之间的竖条调整比例（自动记忆）",
  "格式化区点 ▾ 折叠任意块；「全部折叠 / 全部展开」在工具栏图标里（悬浮有名称提示）",
  "搜索是浏览器式的：全文保留、只加高亮，当前项橙色；图线区会同步高亮命中节点、淡化其余",
  "图线区：单击节点 → 格式化区滚动定位并闪烁；双击节点 → 复制其 JSON path（如 $.a.b[0]）；滚轮缩放、空白处拖拽平移",
  "解析失败时点错误信息里的「行 x，列 y」可跳转到输入区对应行（行内标红）",
  "「输出格式」下拉可把输入转换为另一种格式（JSON / YAML / XML / TOML 互转；TOML 不支持 null）",
  "主题默认跟随系统深浅色，手动切换后固定为所选",
  "图节点上限 3000（超出截断提示）；超过 1500 节点时自动隐藏小地图以保证流畅",
];

export default function HelpModal({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Esc 关闭；焦点圈进弹窗
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="帮助与快捷键"
        ref={dialogRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="help-head">
          <h2>帮助与快捷键</h2>
          <IconButton icon={<span className="help-close-x">✕</span>} label="关闭（Esc）" onClick={onClose} />
        </div>

        <h3>快捷键</h3>
        <table className="help-table">
          <tbody>
            {SHORTCUTS.map((s) => (
              <tr key={s.desc}>
                <td>
                  {s.keys.map((k) => (
                    <kbd key={k}>{k}</kbd>
                  ))}
                </td>
                <td>{s.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3>操作技巧</h3>
        <ul className="help-list">
          {TIPS.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
