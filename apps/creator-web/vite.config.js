import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiTarget = process.env.REIGNS_AGENT_API ?? "http://127.0.0.1:4321";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    fs: {
      allow: [".."]
    },
    proxy: {
      "/api": apiTarget,
      "/classic": apiTarget,
      "/play": apiTarget,
      "/assets/dashboard.css": apiTarget,
      "/assets/dashboard.js": apiTarget,
      "/assets/swipe-input.js": apiTarget,
      "/assets/sample": apiTarget
    }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
