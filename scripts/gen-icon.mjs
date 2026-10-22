// 生成应用图标：src-tauri/icons/icon.png (1024) 与 icon.ico (内嵌 256 PNG)
// 纯 Node 实现，无需任何图像库。
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "src-tauri", "icons");
mkdirSync(outDir, { recursive: true });

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ crcTable[(c ^ buf[i]) & 0xff];
  return (c ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function encodePng(size, rgba) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    rgba.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// 图案：渐变圆角方块背景 + 三节点树形连线（root → 两个子节点）
function render(S) {
  const px = Buffer.alloc(S * S * 4);
  const c1 = [79, 108, 255];
  const c2 = [158, 92, 246];
  const radius = S * 0.19;
  const nodeR = S * 0.095;
  const feather = Math.max(1, S * 0.006);
  const lineHalf = S * 0.016;
  const circles = [
    [0.5, 0.26],
    [0.28, 0.7],
    [0.72, 0.7],
  ];
  const segments = [
    [0.5, 0.26, 0.28, 0.7],
    [0.5, 0.26, 0.72, 0.7],
    [0.28, 0.7, 0.72, 0.7],
  ];

  const distToSeg = (x, y, seg) => {
    const [ax, ay, bx, by] = seg;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = ((x - ax) * dx + (y - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
  };

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      // 圆角矩形裁剪
      const cx = Math.max(radius - x, x - (S - 1 - radius), 0);
      const cy = Math.max(radius - y, y - (S - 1 - radius), 0);
      if (Math.hypot(cx, cy) > radius) continue;

      const t = (x + y) / (2 * S);
      let r = c1[0] + (c2[0] - c1[0]) * t;
      let g = c1[1] + (c2[1] - c1[1]) * t;
      let b = c1[2] + (c2[2] - c1[2]) * t;

      // 连线
      for (const seg of segments) {
        if (distToSeg(x, y, seg) < lineHalf) {
          r = 255;
          g = 255;
          b = 255;
        }
      }
      // 节点圆（带抗锯齿软边）
      for (const [nx, ny] of circles) {
        const d = Math.hypot(x - nx * S, y - ny * S);
        const f = Math.max(0, Math.min(1, (nodeR - d) / feather));
        if (f > 0) {
          r = 255 * f + r * (1 - f);
          g = 255 * f + g * (1 - f);
          b = 255 * f + b * (1 - f);
        }
      }

      px[i] = Math.round(r);
      px[i + 1] = Math.round(g);
      px[i + 2] = Math.round(b);
      px[i + 3] = 255;
    }
  }
  return px;
}

const png256 = encodePng(256, render(256));
writeFileSync(join(outDir, "icon.png"), encodePng(1024, render(1024)));

// ICO：单条目录项，内嵌 PNG（Vista+ 支持 PNG 压缩图标）
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
const entry = Buffer.alloc(16);
entry[0] = 0; // 256 宽
entry[1] = 0; // 256 高
entry[4] = 1; // planes
entry[6] = 32; // bpp
entry.writeUInt32LE(png256.length, 8);
entry.writeUInt32LE(22, 12); // 数据偏移 = 6 + 16
writeFileSync(join(outDir, "icon.ico"), Buffer.concat([header, entry, png256]));

console.log("icons written to", outDir);
