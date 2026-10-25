import type { ReactNode } from "react";

/**
 * 内联 SVG 图标（16×16、描边风格，不引入图标库）。
 * 全部用于 icon 按钮视觉，无障碍名称由按钮的 aria-label 提供。
 */

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** 格式化（</>） */
export const IconFormat = () => (
  <Svg>
    <path d="M5.5 4.5 2.5 8l3 3.5" />
    <path d="m10.5 4.5 3 3.5-3 3.5" />
  </Svg>
);

/** 示例（文档） */
export const IconSample = () => (
  <Svg>
    <path d="M4 2h5l3 3v9H4z" />
    <path d="M9 2v3h3" />
    <path d="M6 8.5h4M6 11h4" />
  </Svg>
);

/** 清空（垃圾桶） */
export const IconTrash = () => (
  <Svg>
    <path d="M3 4.5h10" />
    <path d="M6.5 4.5V3h3v1.5" />
    <path d="M4.5 4.5 5.5 13.5h5L11.5 4.5" />
  </Svg>
);

/** 全部折叠（双箭头上） */
export const IconCollapseAll = () => (
  <Svg>
    <path d="m4 8.5 4-4 4 4" />
    <path d="m4 13 4-4 4 4" />
  </Svg>
);

/** 全部展开（双箭头下） */
export const IconExpandAll = () => (
  <Svg>
    <path d="m4 3.5 4 4 4-4" />
    <path d="m4 8 4 4 4-4" />
  </Svg>
);

/** 复制（叠放矩形） */
export const IconCopy = () => (
  <Svg>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 5.5V4A1.5 1.5 0 0 0 9 2.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" />
  </Svg>
);

/** 保存（下载落盘） */
export const IconSave = () => (
  <Svg>
    <path d="M8 2.5V10" />
    <path d="M5 7.5l3 3 3-3" />
    <path d="M3 13.5h10" />
  </Svg>
);

/** 全屏（四角外扩） */
export const IconMaximize = () => (
  <Svg>
    <path d="M6 2.5H2.5V6" />
    <path d="M10 2.5h3.5V6" />
    <path d="M6 13.5H2.5V10" />
    <path d="M10 13.5h3.5V10" />
  </Svg>
);

/** 并排（双栏） */
export const IconColumns = () => (
  <Svg>
    <rect x="2.5" y="3.5" width="11" height="9" rx="1.5" />
    <path d="M8 3.5v9" />
  </Svg>
);

/** 下载 PNG（图片） */
export const IconPng = () => (
  <Svg>
    <rect x="2.5" y="3.5" width="11" height="9" rx="1.5" />
    <circle cx="6" cy="7" r="1" />
    <path d="m4 11 3-3 2.5 2.5L11 9l2.5 2.5" />
  </Svg>
);

/** 下载 SVG（矢量曲线） */
export const IconSvg = () => (
  <Svg>
    <path d="M4.5 11.5C9 11.5 7 4.5 11.5 4.5" />
    <rect x="2.5" y="10" width="3" height="3" rx="0.5" />
    <rect x="10.5" y="3" width="3" height="3" rx="0.5" />
  </Svg>
);

/** 上一个匹配 */
export const IconChevronUp = () => (
  <Svg>
    <path d="M4.5 9.5 8 6l3.5 3.5" />
  </Svg>
);

/** 下一个匹配 */
export const IconChevronDown = () => (
  <Svg>
    <path d="M4.5 6.5 8 10l3.5-3.5" />
  </Svg>
);

/** 完成（✓，用于复制/保存成功的瞬时反馈） */
export const IconCheck = () => (
  <Svg>
    <path d="m3 8.5 3.2 3L13 5" />
  </Svg>
);

/** 帮助（圆圈问号） */
export const IconHelp = () => (
  <Svg>
    <circle cx="8" cy="8" r="6.25" />
    <path d="M6.2 6.2a1.9 1.9 0 1 1 2.8 1.7c-.65.38-.95.8-.95 1.6" />
    <path d="M8 11.9v.05" />
  </Svg>
);

/** 图标按钮：视觉只有图标，悬浮 title + aria-label 提供名称 */
export function IconButton({
  icon,
  label,
  onClick,
  disabled,
  primary,
}: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      className={`btn icon${primary ? " primary" : ""}`}
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}
