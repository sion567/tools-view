import { getSmoothStepPath, Position, type Edge } from "@xyflow/react";
import { NODE_HEIGHT, NODE_WIDTH, type GraphNode } from "./graph";

/**
 * 把图线区导出为一张自包含的 SVG / PNG。
 *
 * 之前用 html-to-image 截取 .flow-wrap，有两个问题：
 *   1. 截的是"当前视口"，节点多时 fitView 会缩到 0.05，
 *      整张图被压进一屏，文字糊成一条线，pixelRatio 再高也没用；
 *   2. toSvg 产出的是 foreignObject 包裹的 SVG，Illustrator / Figma 等
 *      工具会直接丢弃内容。
 *
 * 这里改成：按图的真实坐标（zoom = 1）重新生成一份纯 SVG，
 * 节点和边都按逻辑坐标绘制，PNG 由这份 SVG 光栅化而来。
 * 因此放大到任意倍数都清晰，SVG 也是真正的矢量。
 */

const PADDING = 24; // 图外围留白
const TEXT_PADDING = 12;
const FONT_FAMILY = "'Cascadia Mono', Consolas, monospace";
const FONT_SIZE = 12;
const NODE_RADIUS = 9;
const TEXT_MAX_WIDTH = NODE_WIDTH - TEXT_PADDING * 2;

const CANVAS_MAX_DIM = 65535; // 浏览器 canvas 单边上限（实测 Chromium 为 65535）
const CANVAS_MAX_PIXELS = 100_000_000; // 约 400MB RGBA，再大容易卡死
const MAX_SCALE = 2; // 常规图放大到 2 倍已经足够清晰，再大只是徒增体积

export interface GraphSvg {
  svg: string;
  width: number;
  height: number;
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

let measureCtx: CanvasRenderingContext2D | null = null;

function textWidth(text: string): number {
  if (!measureCtx) {
    measureCtx = document.createElement("canvas").getContext("2d");
  }
  if (!measureCtx) return text.length * FONT_SIZE * 0.6;
  measureCtx.font = `${FONT_SIZE}px ${FONT_FAMILY}`;
  return measureCtx.measureText(text).width;
}

/** 模拟编辑器里的 text-overflow: ellipsis */
function truncateLabel(text: string): string {
  if (textWidth(text) <= TEXT_MAX_WIDTH) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (textWidth(text.slice(0, mid) + "…") <= TEXT_MAX_WIDTH) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + "…";
}

interface HandlePoint {
  x: number;
  y: number;
  position: Position;
}

/**
 * 边的端点直接落在节点边框上。
 * 屏幕上 React Flow 的边停在 handle 外沿（边框外约 3.5px），空隙被 handle
 * 圆点盖住；导出不画 handle 圆点，端点若不贴到边框，每条边两头都会露出空隙。
 */
function handlesOf(node: GraphNode): { source: HandlePoint; target: HandlePoint } {
  const { x, y } = node.position;
  if (node.data.direction === "horizontal") {
    return {
      source: {
        x: x + NODE_WIDTH,
        y: y + NODE_HEIGHT / 2,
        position: Position.Right,
      },
      target: {
        x,
        y: y + NODE_HEIGHT / 2,
        position: Position.Left,
      },
    };
  }
  return {
    source: {
      x: x + NODE_WIDTH / 2,
      y: y + NODE_HEIGHT,
      position: Position.Bottom,
    },
    target: {
      x: x + NODE_WIDTH / 2,
      y,
      position: Position.Top,
    },
  };
}

export function graphBounds(nodes: GraphNode[]): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  if (nodes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.position.x);
    minY = Math.min(minY, n.position.y);
    maxX = Math.max(maxX, n.position.x + NODE_WIDTH);
    maxY = Math.max(maxY, n.position.y + NODE_HEIGHT);
  }
  return {
    x: minX - PADDING,
    y: minY - PADDING,
    width: maxX - minX + PADDING * 2,
    height: maxY - minY + PADDING * 2,
  };
}

export function buildGraphSvg(nodes: GraphNode[], edges: Edge[]): GraphSvg {
  return buildGraphContent(nodes, edges).full;
}

/** 图的内容 + 尺寸；full 是整图 SVG，bands 用于分块光栅化 */
export interface GraphContent {
  full: GraphSvg;
  /** 内容的内部 markup，可按任意 viewBox 重新拼装 */
  content: string;
  width: number;
  height: number;
}

export function buildGraphContent(
  nodes: GraphNode[],
  edges: Edge[],
): GraphContent {
  if (nodes.length === 0) {
    throw new Error("没有可导出的节点");
  }

  const bg = cssVar("--flow-bg");
  const nodeBg = cssVar("--node-bg");
  const nodeBorder = cssVar("--node-border");
  const nodeText = cssVar("--node-text");
  const edgeStroke = cssVar("--edge-stroke");
  const accent = cssVar("--accent");
  const purple = cssVar("--purple");
  const green = cssVar("--green");

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const bounds = graphBounds(nodes);
  const w = Math.round(bounds.width);
  const h = Math.round(bounds.height);

  // 边：按 React Flow 的 smoothstep 算法生成，路径与屏幕一致
  const edgePaths: string[] = [];
  for (const edge of edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) continue;
    const s = handlesOf(source).source;
    const t = handlesOf(target).target;
    const [d] = getSmoothStepPath({
      sourceX: s.x,
      sourceY: s.y,
      sourcePosition: s.position,
      targetX: t.x,
      targetY: t.y,
      targetPosition: t.position,
      borderRadius: 5,
      offset: 20,
      stepPosition: 0.5,
    });
    edgePaths.push(
      `<path d="${d}" fill="none" stroke="${edgeStroke}" stroke-width="1.5"/>`,
    );
  }

  // 节点
  const nodeMarkup: string[] = [];
  for (const node of nodes) {
    const kindColor =
      node.data.kind === "object"
        ? accent
        : node.data.kind === "array"
          ? purple
          : green;
    const label = truncateLabel(node.data.label);
    nodeMarkup.push(
      `<g transform="translate(${node.position.x - bounds.x} ${
        node.position.y - bounds.y
      })">` +
        `<rect x="0.5" y="0.5" width="${NODE_WIDTH - 1}" height="${
          NODE_HEIGHT - 1
        }" rx="${NODE_RADIUS}" fill="${nodeBg}" stroke="${nodeBorder}" stroke-width="1"/>` +
        `<g clip-path="url(#node-clip)"><rect x="0" y="0" width="3.5" height="${NODE_HEIGHT}" fill="${kindColor}"/></g>` +
        `<text x="${TEXT_PADDING}" y="${NODE_HEIGHT / 2}" dominant-baseline="central" ` +
        `font-family="${escapeXml(FONT_FAMILY)}" font-size="${FONT_SIZE}" fill="${nodeText}">${escapeXml(
          label,
        )}</text>` +
        `</g>`,
    );
  }

  const content =
    `<defs><clipPath id="node-clip"><rect x="0" y="0" width="${NODE_WIDTH}" height="${NODE_HEIGHT}" rx="${NODE_RADIUS}"/></clipPath></defs>` +
    // 背景必须用绝对尺寸：分块导出时 viewBox 被平移，100% 会画到可视区之外
    `<rect x="0" y="0" width="${w}" height="${h}" fill="${bg}"/>` +
    `<g>${edgePaths.join("")}</g>` +
    `<g>${nodeMarkup.join("")}</g>`;

  const full = {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${content}</svg>`,
    width: w,
    height: h,
  };

  return { full, content, width: w, height: h };
}

/**
 * 把图切成若干块，每块的宽高都在 canvas 能承载的范围内。
 * 超大图（例如上千个节点铺开有十万像素宽）单张 PNG 放不下，
 * 就分段导出成多个 PNG，保证每一块都是原始分辨率。
 * 纵向布局的图是"宽而矮"，横向布局的是"高而窄"，两个方向都要能切。
 */
export function planBands(width: number, height: number): Band[] {
  const bands: Band[] = [];
  const maxW = Math.min(CANVAS_MAX_DIM, Math.floor(Math.sqrt(CANVAS_MAX_PIXELS / 1)));
  const maxH = Math.min(CANVAS_MAX_DIM, Math.floor(Math.sqrt(CANVAS_MAX_PIXELS / 1)));
  for (let y = 0; y < height; y += maxH) {
    const bandH0 = Math.min(maxH, height - y);
    for (let x = 0; x < width; x += maxW) {
      let bandW = Math.min(maxW, width - x);
      let bandH = bandH0;
      // 像素总量也要控制，否则 canvas 分配内存失败
      while (bandW * bandH > CANVAS_MAX_PIXELS) {
        if (bandW >= bandH) bandW = Math.floor(bandW / 2);
        else bandH = Math.floor(bandH / 2);
      }
      bands.push({ x, y, width: bandW, height: bandH });
    }
  }
  return bands;
}

export interface Band {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 在浏览器 canvas 的尺寸限制内，选一个尽量高的放大倍率 */
export function pickScale(width: number, height: number): number {
  const byDim = CANVAS_MAX_DIM / Math.max(width, height);
  const byPixels = Math.sqrt(CANVAS_MAX_PIXELS / (width * height));
  return Math.max(0.25, Math.min(MAX_SCALE, byDim, byPixels));
}

/** 图宽高是否超出单张 canvas 能承载的范围 */
export function exceedsCanvas(width: number, height: number): boolean {
  return width > CANVAS_MAX_DIM || height > CANVAS_MAX_DIM;
}

/** 把 SVG 光栅化成 PNG Blob */
export async function rasterizeSvg(
  svg: string,
  width: number,
  height: number,
): Promise<Blob> {
  const scale = pickScale(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));

  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("SVG 光栅化失败"));
      img.src = url;
    });
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法创建 canvas 上下文");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => {
        if (b) resolve(b);
        else reject(new Error("PNG 编码失败"));
      }, "image/png");
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 把图的某一条竖带光栅化成 PNG（用 viewBox 平移截取） */
export async function rasterizeBand(
  content: string,
  band: Band,
  scale: number,
): Promise<Blob> {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${band.width}" height="${band.height}" ` +
    `viewBox="${band.x} ${band.y} ${band.width} ${band.height}">${content}</svg>`;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(band.width * scale));
  canvas.height = Math.max(1, Math.round(band.height * scale));

  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("SVG 光栅化失败"));
      img.src = url;
    });
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法创建 canvas 上下文");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => {
        if (b) resolve(b);
        else reject(new Error("PNG 编码失败"));
      }, "image/png");
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
