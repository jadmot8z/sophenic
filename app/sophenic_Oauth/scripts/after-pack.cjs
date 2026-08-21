const fs = require("node:fs/promises");
const path = require("node:path");

async function assertNonEmpty(file, label) {
  const info = await fs.stat(file);
  if (info.isFile() && info.size === 0) throw new Error(`${label} is empty.`);
}

async function assertNoDebugLog(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await assertNoDebugLog(full);
    else if (entry.name.toLowerCase() === "debug.log") throw new Error(`debug.log is forbidden in packaged output: ${full}`);
  }
}

exports.default = async function afterPack(context) {
  const source = path.resolve("dist-web");
  const resourcesDir = path.join(context.appOutDir, "resources");
  const destination = path.join(resourcesDir, "web");

  // electron-builder owns Electron/Chromium. The complete Next standalone tree
  // is copied after app.asar creation so nested node_modules cannot be filtered.
  await fs.rm(destination, { recursive: true, force: true });
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.cp(source, destination, { recursive: true, force: true, dereference: true });

  const required = [
    [path.join(context.appOutDir, "SOPHENIC.exe"), "SOPHENIC.exe"],
    [path.join(context.appOutDir, "icudtl.dat"), "Electron ICU data"],
    [path.join(context.appOutDir, "resources.pak"), "Chromium resources.pak"],
    [path.join(resourcesDir, "app.asar"), "Electron app.asar"],
    [path.join(resourcesDir, "icon.ico"), "SOPHENIC icon"],
    [path.join(resourcesDir, "launch", "splash.html"), "splash screen"],
    [path.join(resourcesDir, "launch", "intro.mp4"), "intro video"],
    [path.join(destination, "server.js"), "Next standalone server"],
    [path.join(destination, "node_modules", "next", "package.json"), "Next runtime"],
    [path.join(destination, "node_modules", "react", "package.json"), "React runtime"],
    [path.join(destination, "node_modules", "react-dom", "package.json"), "ReactDOM runtime"]
  ];

  for (const [file, label] of required) {
    await fs.access(file);
    await assertNonEmpty(file, label);
  }

  const localesDir = path.join(context.appOutDir, "locales");
  const locales = await fs.readdir(localesDir);
  if (!locales.some((name) => name.endsWith(".pak"))) {
    throw new Error("Electron locales are missing from the packaged Windows runtime.");
  }

  await assertNoDebugLog(context.appOutDir);
  console.log(`[afterPack] SOPHENIC Windows runtime verified in ${context.appOutDir}`);
};
