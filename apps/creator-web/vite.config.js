import react from "@vitejs/plugin-react";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { defineConfig } from "vite";

const apiTarget = process.env.REIGNS_AGENT_API ?? "http://127.0.0.1:4321";
const dashboardHtml = new URL("../../packages/interface/web/dashboard.html", import.meta.url);
const playerHtml = new URL("../../packages/interface/web/player.html", import.meta.url);
const MIME = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml"
};

async function sendHtml(server, res, fileUrl, urlPath) {
  const html = await readFile(fileUrl, "utf8");
  const transformed = await server.transformIndexHtml(urlPath, html);
  res.statusCode = 200;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(transformed);
}

async function sendAsset(res, pathname) {
  const filePath = new URL(`../../packages/interface/web${pathname}`, import.meta.url);
  if (!existsSync(filePath)) {
    return false;
  }

  const buffer = await readFile(filePath);
  const type = MIME[extname(pathname).toLowerCase()] ?? "application/octet-stream";
  res.statusCode = 200;
  res.setHeader("content-type", type);
  res.end(buffer);
  return true;
}

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
        server.middlewares.use(async (req, res, next) => {
          if (req.method !== "GET" || !req.url) {
            next();
            return;
          }

          const [pathname] = req.url.split("?");
          if (pathname === "/classic") {
            await sendHtml(server, res, dashboardHtml, pathname);
            return;
          }
          if (pathname === "/play") {
            await sendHtml(server, res, playerHtml, pathname);
            return;
          }
          if (pathname.startsWith("/assets/")) {
            const ok = await sendAsset(res, pathname);
            if (ok) return;
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
      "/api": apiTarget
    }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
