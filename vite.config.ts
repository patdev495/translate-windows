import { defineConfig } from "vite";
import { resolve } from "path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  define: {
    __LEARNING_API_BASE__: JSON.stringify(process.env.LEARNING_API_BASE || 'https://learning.peebot.shop'),
    __LEARNING_WEB_BASE__: JSON.stringify(process.env.LEARNING_WEB_BASE || 'https://learning.peebot.shop'),
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**", "**/.scratch/**", "**/.worktrees/**", "**/third_party/**", "**/public/hanzi-data/**", "**/public/hanzi-dictionary/**", "**/public/pdf-assets/**", "**/public/models/**"],
    },
  },

  optimizeDeps: { entries: ['index.html','settings.html','tooltip.html','snippet.html','pdf.html','hanzi.html','capture-toast.html'] },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        tooltip: resolve(__dirname, "tooltip.html"),
        snippet: resolve(__dirname, "snippet.html"),
        settings: resolve(__dirname, "settings.html"),
        captureToast: resolve(__dirname, "capture-toast.html"),
        pdf: resolve(__dirname, "pdf.html"),
        hanzi: resolve(__dirname, "hanzi.html"),
      },
    },
  },
}));
