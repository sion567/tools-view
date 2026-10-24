/// <reference types="vitest/config" />
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
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  build: {
    target: "chrome105",
    outDir: "dist",
    rollupOptions: {
      output: {
        // 按依赖拆分 chunk：编辑器 / 图库 / React 各自成块
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return;
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
