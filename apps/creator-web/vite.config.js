import react from "@vitejs/plugin-react";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const apiTarget = process.env.REIGNS_AGENT_API ?? "http://127.0.0.1:4321";
const dashboardHtml = new URL("../../packages/interface/web/dashboard.html", import.meta.url);
const playerHtml = new URL("../../packages/interface/web/player.html", import.meta.url);
const hostedSampleAssetRoot = new URL("../../packages/interface/web/assets/sample/", import.meta.url);
const productVersion = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version;
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
  define: {
    "import.meta.env.VITE_CREATOR_HOST": JSON.stringify(hosted ? "browser" : "http"),
    "import.meta.env.VITE_PRODUCT_VERSION": JSON.stringify(productVersion)
  },
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
    emptyOutDir: true,
    rollupOptions: hosted ? {
      input: {
        index: fileURLToPath(new URL("./index.html", import.meta.url)),
        "hosted-player-backend": fileURLToPath(new URL("./src/hosted-player-backend.js", import.meta.url))
      },
      output: {
        entryFileNames: (chunk) => chunk.name === "hosted-player-backend" ? "hosted-player-backend.js" : "assets/[name]-[hash].js"
      }
    } : undefined
  }
  });
});

function normalizeBase(value) {
  const clean = String(value || "/").trim().replace(/^\/+|\/+$/g, "");
  return clean ? `/${clean}/` : "/";
}

function hostedPwaPlugin(base) {
  return { name: "reigns-agent-hosted-pwa", generateBundle(_options, bundle) {
    const sharedPlayerSource = readFileSync(playerHtml, "utf8");
    const playerScriptMarker = "  <script type=\"module\">";
    if (!sharedPlayerSource.includes(playerScriptMarker)) throw new Error("Shared player HTML is missing its module script marker");
    const hostedPlayerSource = sharedPlayerSource
      .replaceAll("./assets/logo-alpha.png", `${base}logo-alpha.png`)
      .replace(playerScriptMarker, `  <script type="module" src="${base}hosted-player-backend.js"></script>\n\n${playerScriptMarker}`);
    this.emitFile({ type: "asset", fileName: "play.html", source: hostedPlayerSource });
    const playerAssets = ["dashboard.css", "swipe-input.js"].map((name) => ({
      fileName: `assets/${name}`,
      source: readFileSync(new URL(`../../packages/interface/web/assets/${name}`, import.meta.url))
    }));
    for (const asset of playerAssets) this.emitFile({ type: "asset", ...asset });
    const sampleAssets = readdirSync(hostedSampleAssetRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => ({ fileName: `assets/sample/${entry.name}`, source: readFileSync(new URL(entry.name, hostedSampleAssetRoot)) }));
    for (const asset of sampleAssets) this.emitFile({ type: "asset", ...asset });
    const files = ["play.html", ...playerAssets.map((asset) => asset.fileName), ...Object.keys(bundle).filter((name) => !name.endsWith(".map")), ...sampleAssets.map((asset) => asset.fileName)];
    const version = files.join("|").split("").reduce((hash, char) => ((hash * 31) + char.charCodeAt(0)) >>> 0, 0).toString(36);
    this.emitFile({ type: "asset", fileName: "manifest.webmanifest", source: JSON.stringify({ name: "ReignsAgent", short_name: "ReignsAgent", description: "Offline-first card narrative Creator", start_url: `${base}workbench`, scope: base, display: "standalone", background_color: "#111315", theme_color: "#111315", icons: [{ src: `${base}logo-alpha.png`, sizes: "512x512", type: "image/png", purpose: "any maskable" }] }, null, 2) });
    this.emitFile({ type: "asset", fileName: "sw.js", source: serviceWorkerSource({ base, files: ["index.html", "manifest.webmanifest", "logo-alpha.png", ...files], version }) });
  } };
}

function serviceWorkerSource({ base, files, version }) {
  return `const CACHE=${JSON.stringify(`reigns-agent-${version}`)};const BASE=${JSON.stringify(base)};const ASSETS=${JSON.stringify([...new Set(files)].map((file) => `${base}${file}`))};self.addEventListener("install",event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));self.addEventListener("activate",event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith("reigns-agent-")&&key!==CACHE).map(key=>caches.delete(key))))));self.addEventListener("message",event=>{if(event.data?.type==="SKIP_WAITING")self.skipWaiting()});self.addEventListener("fetch",event=>{if(event.request.method!=="GET")return;const url=new URL(event.request.url);if(url.origin!==location.origin||!url.pathname.startsWith(BASE))return;if(event.request.mode==="navigate"){const shell=url.pathname===BASE+"play.html"?BASE+"play.html":BASE+"index.html";event.respondWith(fetch(event.request).then(response=>response.ok?response:caches.match(shell).then(cached=>cached||response)).catch(()=>caches.match(shell)));return}event.respondWith(caches.match(event.request).then(hit=>hit||fetch(event.request).then(response=>{const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));return response}))) });`;
}
