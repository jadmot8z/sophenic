import { access, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const required = [
  "electron/main.js",
  "dist-electron/main.js",
  "dist-electron/preload.js",
  "dist-electron/runtime/index.js",
  "dist-electron/runtime/hermes.js",
  "dist-electron/runtime/ollama.js",
  "dist-electron/runtime/gateway.js",
  "dist-electron/runtime/web.js"
];
for (const file of required) await access(path.join(root, file));

const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
if (pkg.main !== "electron/main.js") throw new Error("Root Electron entry point must be electron/main.js");

const main = await readFile(path.join(root, "dist-electron/main.js"), "utf8");
if (!main.includes("sophenic:runtime:start-hermes")) throw new Error("Hermes IPC missing from desktop build");
if (!main.includes("process.resourcesPath") || !main.includes('"web"') || !main.includes('"server.js"')) {
  throw new Error("Bundled local Next.js runtime path is missing");
}
if (!main.includes("disable-logging")) throw new Error("Chromium debug logging is not disabled");
if (!main.includes("requestSingleInstanceLock")) throw new Error("Single-instance desktop guard is missing");
if (!main.includes("sophenic-smoke-ready")) throw new Error("Packaged-window smoke-test marker is missing");
console.log("SOPHENIC Desktop bridge: OK");
