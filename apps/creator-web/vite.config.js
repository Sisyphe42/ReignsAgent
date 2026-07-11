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
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

async function sendHtml(server, res, fileUrl, urlPath) {
  const html = await readFile(fileUrl, "utf8");
  const transformed = await server.transformIndexHtml(urlPath, html);
  res.statusCode = 200;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(transformed);
}

async function sendRawHtml(res, fileUrl) {
  const html = await readFile(fileUrl, "utf8");
  res.statusCode = 200;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(html);
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

export default defineConfig(({ mode }) => {
  const hosted = mode === "hosted";
  const base = normalizeBase(process.env.REIGNS_AGENT_BASE_PATH ?? "/");
  return ({
  base,
  define: { "import.meta.env.VITE_CREATOR_HOST": JSON.stringify(hosted ? "browser" : "http") },
  plugins: [
    react(),
    ...(hosted ? [hostedPwaPlugin(base)] : []),
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
            await sendRawHtml(res, playerHtml);
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
    allowedHosts: true,
    fs: {
      allow: [".."]
    },
    proxy: {
      "/api": apiTarget
    }
  },
  build: {
    outDir: hosted ? "dist-hosted" : "dist",
    emptyOutDir: true
  }
  });
});

function normalizeBase(value) {
  const clean = String(value || "/").trim().replace(/^\/+|\/+$/g, "");
  return clean ? `/${clean}/` : "/";
}

function hostedPwaPlugin(base) {
  return { name: "reigns-agent-hosted-pwa", generateBundle(_options, bundle) {
    const files = Object.keys(bundle).filter((name) => !name.endsWith(".map"));
    const version = files.join("|").split("").reduce((hash, char) => ((hash * 31) + char.charCodeAt(0)) >>> 0, 0).toString(36);
    this.emitFile({ type: "asset", fileName: "manifest.webmanifest", source: JSON.stringify({ name: "ReignsAgent", short_name: "ReignsAgent", description: "Offline-first card narrative Creator", start_url: `${base}workbench`, scope: base, display: "standalone", background_color: "#111315", theme_color: "#111315", icons: [{ src: `${base}logo-alpha.png`, sizes: "512x512", type: "image/png", purpose: "any maskable" }] }, null, 2) });
    this.emitFile({ type: "asset", fileName: "sw.js", source: serviceWorkerSource({ base, files: ["index.html", "manifest.webmanifest", "logo-alpha.png", ...files], version }) });
  } };
}

function serviceWorkerSource({ base, files, version }) {
  return `const CACHE=${JSON.stringify(`reigns-agent-${version}`)};const BASE=${JSON.stringify(base)};const ASSETS=${JSON.stringify([...new Set(files)].map((file) => `${base}${file}`))};self.addEventListener("install",event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));self.addEventListener("activate",event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith("reigns-agent-")&&key!==CACHE).map(key=>caches.delete(key))))));self.addEventListener("message",event=>{if(event.data?.type==="SKIP_WAITING")self.skipWaiting()});self.addEventListener("fetch",event=>{if(event.request.method!=="GET")return;const url=new URL(event.request.url);if(url.origin!==location.origin||!url.pathname.startsWith(BASE))return;if(event.request.mode==="navigate"){event.respondWith(fetch(event.request).catch(()=>caches.match(BASE+"index.html")));return}event.respondWith(caches.match(event.request).then(hit=>hit||fetch(event.request).then(response=>{const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));return response}))) });`;
}
