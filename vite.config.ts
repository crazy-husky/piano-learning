import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const pagesRepoName = process.env.GITHUB_REPOSITORY?.split("/")[1];
const tailscaleAllowedHosts = process.env.TAILSCALE_HOSTNAME ? [process.env.TAILSCALE_HOSTNAME] : [];
const buildId = process.env.GITHUB_SHA || new Date().toISOString();

const appBuildVersionPlugin: Plugin = {
  name: "app-build-version",
  apply: "build" as const,
  generateBundle() {
    this.emitFile({
      type: "asset",
      fileName: "version.json",
      source: JSON.stringify({ buildId }),
    });
  },
};

export default defineConfig({
  base: process.env.GITHUB_PAGES && pagesRepoName ? `/${pagesRepoName}/` : "/",
  define: { __APP_BUILD_ID__: JSON.stringify(buildId) },
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
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          music: ["vexflow", "tone"],
          charts: ["echarts"],
          storage: ["dexie"],
        },
      },
    },
  },
});
