import { defineConfig } from "@playwright/test";

const basePath = `/${String(process.env.REIGNS_AGENT_BASE_PATH ?? "").replace(/^\/+|\/+$/g, "")}`.replace(/\/$/, "");
const appBase = `http://127.0.0.1:4173${basePath}/`;

export default defineConfig({
  testDir: "./test/browser",
  testMatch: "*.spec.js",
  timeout: 30_000,
  use: { baseURL: appBase, headless: true, serviceWorkers: "allow" },
  webServer: {
    command: "npm run preview -w @reigns-agent/creator-web -- --mode hosted --host 127.0.0.1 --port 4173",
    url: `${appBase}workbench`,
    reuseExistingServer: false,
    timeout: 30_000
  }
});
