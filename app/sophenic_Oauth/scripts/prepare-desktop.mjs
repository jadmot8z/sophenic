import { access, cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const out = path.join(root, "dist-desktop");
const webOut = path.join(root, "dist-web");
const standalone = path.join(root, ".next", "standalone");

async function assertFile(file, label = file) {
  await access(file);
  const info = await stat(file);
  if (!info.isFile() || info.size === 0) throw new Error(`Fichier runtime invalide: ${label}`);
}

await assertFile(path.join(standalone, "server.js"), ".next/standalone/server.js");
for (const pkg of ["next", "react", "react-dom"]) {
  await assertFile(path.join(standalone, "node_modules", pkg, "package.json"), `standalone node_modules/${pkg}`);
}

await rm(out, { recursive: true, force: true });
await rm(webOut, { recursive: true, force: true });
await mkdir(out, { recursive: true });

// Main process: compiled CommonJS only. The packaged application never executes
// TypeScript sources and never depends on the source tree at runtime.
await cp(path.join(root, "dist-electron"), out, { recursive: true, force: true, dereference: true });

const desktopPackage = JSON.parse(await readFile(path.join(root, "electron", "package.electron.json"), "utf8"));
const rootPackage = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
desktopPackage.version = rootPackage.version;
desktopPackage.description = rootPackage.description;
desktopPackage.author = rootPackage.author || "SOPHENIC";
desktopPackage.dependencies = { ws: rootPackage.dependencies.ws };
await writeFile(path.join(out, "package.json"), JSON.stringify(desktopPackage, null, 2) + "\n");

// The Electron main process imports ws. Copy it into app.asar rather than doing
// a second npm install inside dist-desktop.
await mkdir(path.join(out, "node_modules"), { recursive: true });
await cp(path.join(root, "node_modules", "ws"), path.join(out, "node_modules", "ws"), {
  recursive: true,
  force: true,
  dereference: true
});

// Next.js standalone remains outside ASAR under resources/web. Dereference any
// workspace links now so the installer is independent from the build machine.
await cp(standalone, webOut, { recursive: true, force: true, dereference: true });

const config = JSON.parse(await readFile(path.join(root, "electron", "desktop-config.production.json"), "utf8"));
if (process.env.SOPHENIC_CLOUD_URL) config.cloudUrl = process.env.SOPHENIC_CLOUD_URL;
await writeFile(path.join(out, "desktop-config.json"), JSON.stringify(config, null, 2) + "\n");

for (const required of [
  path.join(out, "main.js"),
  path.join(out, "preload.js"),
  path.join(out, "runtime", "web.js"),
  path.join(out, "node_modules", "ws", "package.json"),
  path.join(webOut, "server.js"),
  path.join(webOut, ".next"),
  path.join(webOut, "node_modules", "next", "package.json"),
  path.join(webOut, "node_modules", "react", "package.json"),
  path.join(webOut, "node_modules", "react-dom", "package.json")
]) await access(required);

console.log(`Desktop package prepared: app=${path.relative(root, out)}, web=${path.relative(root, webOut)}`);
