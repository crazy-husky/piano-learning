import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import packageJson from "./package.json";

const projectRoot = dirname(fileURLToPath(import.meta.url));
const pagesRepoName = process.env.GITHUB_REPOSITORY?.split("/")[1];
const tailscaleAllowedHosts = process.env.TAILSCALE_HOSTNAME
  ? [process.env.TAILSCALE_HOSTNAME]
  : [];
const buildTime = new Date().toISOString();
const buildId = `${process.env.GITHUB_SHA || "local"}-${buildTime}`;
const buildVersion = packageJson.version;
const sharedMediaAssetPattern =
  /\.(?:avif|gif|jpe?g|png|svg|webp|woff2?|ttf|otf|mp3|ogg|wav|m4a|aac)$/i;
let appCodeAssetFiles: string[] = [];
let appSharedMediaFiles: string[] = [];

const appBuildVersionPlugin: Plugin = {
  name: "app-build-version",
  apply: "build" as const,
  generateBundle(_options, bundle) {
    appCodeAssetFiles = Object.keys(bundle).filter((fileName) => /\.(?:js|css)$/.test(fileName));
    appSharedMediaFiles = Object.keys(bundle).filter((fileName) =>
      sharedMediaAssetPattern.test(fileName)
    );

    this.emitFile({
      type: "asset",
      fileName: "version.json",
      source: JSON.stringify({ version: buildVersion, buildId, buildTime }),
    });
  },
  writeBundle(options) {
    const outputDirectory = resolve(options.dir || resolve(projectRoot, "dist"));
    const serviceWorkerTemplate = readFileSync(
      resolve(projectRoot, "public/service-worker.js"),
      "utf8"
    );
    const serviceWorker = serviceWorkerTemplate
      .replace(/__APP_BUILD_ID__/g, JSON.stringify(buildId))
      .replace("__APP_ASSET_FILES__", JSON.stringify(appCodeAssetFiles))
      .replace("__APP_SHARED_MEDIA_FILES__", JSON.stringify(appSharedMediaFiles));

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
