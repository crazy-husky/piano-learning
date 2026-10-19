import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const defaultPreviewScript = join(homedir(), ".local", "bin", "piano-learning-mobile-preview.sh");
const previewScript = process.env.PIANO_MOBILE_PREVIEW_SCRIPT?.trim() || defaultPreviewScript;

let command;
let args;

if (process.platform === "darwin" && existsSync(previewScript)) {
  console.log("检测到手机预览脚本，正在启动 HTTPS 预览和热更新隧道…");
  command = "bash";
  args = [previewScript];
} else {
  if (process.platform === "darwin") {
    console.log("未找到手机预览脚本，改为启动本地开发服务器（127.0.0.1:6136）。");
  }

  command = process.execPath;
  args = [
    resolve(projectRoot, "node_modules/vite/bin/vite.js"),
    "--host",
    "127.0.0.1",
    "--port",
    "6136",
    "--strictPort",
  ];
}

const child = spawn(command, args, {
  cwd: projectRoot,
  env: process.env,
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(`启动开发服务失败：${error.message}`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1);
});
