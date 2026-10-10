import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import packageJson from "./package.json";

const projectRoot = dirname(fileURLToPath(import.meta.url));
const publicDirectory = resolve(projectRoot, "public");
const pagesRepoName = process.env.GITHUB_REPOSITORY?.split("/")[1];
const tailscaleAllowedHosts = process.env.TAILSCALE_HOSTNAME ? [process.env.TAILSCALE_HOSTNAME] : [];
const buildTime = new Date().toISOString();
const buildId = `${process.env.GITHUB_SHA || "local"}-${buildTime}`;
const buildVersion = packageJson.version;
let appAssetFiles: string[] = [];

function listPublicAssetFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "models") return [];
      return listPublicAssetFiles(entryPath);
    }
    if (!entry.isFile() || entry.name === "service-worker.js") return [];
    return [relative(publicDirectory, entryPath).split(sep).join("/")];
  });
}

const appBuildVersionPlugin: Plugin = {
  name: "app-build-version",
  apply: "build" as const,
  generateBundle(options, bundle) {
    const bundledAssets = Object.keys(bundle).filter((fileName) => (
      fileName !== "service-worker.js"
      && !fileName.endsWith(".map")
      && fileName !== "version.json"
    ));
    appAssetFiles = Array.from(new Set([...bundledAssets, ...listPublicAssetFiles(publicDirectory)]));

    this.emitFile({
      type: "asset",
      fileName: "version.json",
      source: JSON.stringify({ version: buildVersion, buildId, buildTime }),
    });
  },
  writeBundle(options) {
    const outputDirectory = resolve(options.dir || resolve(projectRoot, "dist"));
    const serviceWorkerTemplate = readFileSync(resolve(publicDirectory, "service-worker.js"), "utf8");
    const serviceWorker = serviceWorkerTemplate
      .replace(/__APP_BUILD_ID__/g, JSON.stringify(buildId))
      .replace("__APP_ASSET_FILES__", JSON.stringify(appAssetFiles));

    writeFileSync(resolve(outputDirectory, "service-worker.js"), serviceWorker);
  },
};

export default defineConfig({
  base: process.env.GITHUB_PAGES && pagesRepoName ? `/${pagesRepoName}/` : "/",
  define: {
    __APP_BUILD_ID__: JSON.stringify(buildId),
    __APP_VERSION__: JSON.stringify(buildVersion),
    __APP_BUILD_TIME__: JSON.stringify(buildTime),
  },
  plugins: [react(), appBuildVersionPlugin],
  worker: {
    format: "es",
  },
  server: {
    allowedHosts: tailscaleAllowedHosts,
  },
  preview: {
    allowedHosts: tailscaleAllowedHosts,
  },
  build: {
    target: ["chrome108", "edge108", "firefox101", "safari16.4"],
    chunkSizeWarningLimit: 700,
    sourcemap: "hidden",
    rollupOptions: {
      output: {
        manualChunks: {
          audio: ["tone"],
          notation: ["vexflow"],
          storage: ["dexie"],
        },
      },
    },
  },
});
