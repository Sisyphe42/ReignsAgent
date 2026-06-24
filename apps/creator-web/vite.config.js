import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiTarget = process.env.REIGNS_AGENT_API ?? "http://127.0.0.1:4321";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "reigns-agent-workbench-routes",
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (req.method !== "GET" || !req.url) {
            next();
            return;
          }

          const [pathname] = req.url.split("?");
          if (pathname === "/workbench" || pathname.startsWith("/workbench/")) {
            req.url = "/index.html";
          }

          next();
        });
      }
    }
  ],
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
