import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri 约定：固定端口 1420，构建目标对齐 WebView2
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "chrome105",
    outDir: "dist",
    // elkjs 单库内含布局引擎 worker（~1.4MB），属已知体积，豁免告警；
    // 其余 chunk 均在 500kB 内，若再出现大块仍会正常提醒
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // 按依赖拆分 chunk：elkjs（内含布局 worker，体积最大）独立，
        // 编辑器 / 图库 / React 各自成块，避免单文件超限警告
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return;
          if (id.includes("elkjs")) return "elk";
          if (id.includes("@xyflow")) return "flow";
          if (id.includes("@codemirror") || id.includes("codemirror") || id.includes("@lezer")) {
            return "editor";
          }
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return "react";
        },
      },
    },
  },
});
