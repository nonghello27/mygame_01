import { defineConfig } from "vite";

// Relative base keeps built asset paths portable across hosts
// (Vercel, GitHub Pages, plain static servers, etc.).
export default defineConfig({
  base: "./",
  server: {
    open: true,
    port: 5173,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
