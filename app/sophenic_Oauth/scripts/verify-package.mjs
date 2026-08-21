import { access, readdir, stat } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const release = path.join(root, "release");
const unpacked = path.join(release, "win-unpacked");
const resources = path.join(unpacked, "resources");
const packagedWeb = path.join(resources, "web");

const required = [
  path.join(root, ".next", "standalone", "server.js"),
  path.join(root, "dist-web", "server.js"),
  path.join(root, "dist-web", "node_modules", "next", "package.json"),
  path.join(unpacked, "SOPHENIC.exe"),
  path.join(unpacked, "icudtl.dat"),
  path.join(unpacked, "resources.pak"),
  path.join(unpacked, "locales"),
  path.join(resources, "app.asar"),
  path.join(resources, "icon.ico"),
  path.join(resources, "launch", "splash.html"),
  path.join(resources, "launch", "intro.mp4"),
  path.join(packagedWeb, "server.js"),
  path.join(packagedWeb, "node_modules", "next", "package.json"),
  path.join(packagedWeb, "node_modules", "react", "package.json"),
  path.join(packagedWeb, "node_modules", "react-dom", "package.json"),
  path.join(release, "Sophenic Setup.exe")
];

for (const file of required) {
  await access(file);
  console.log(`OK: ${path.relative(root, file)}`);
}

const locales = await readdir(path.join(unpacked, "locales"));
if (!locales.some((name) => name.endsWith(".pak"))) throw new Error("Locales Chromium absentes.");

const modules = await readdir(path.join(packagedWeb, "node_modules"));
if (modules.length < 3) throw new Error(`Runtime node_modules incomplet: seulement ${modules.length} entrées.`);

const installer = await stat(path.join(release, "Sophenic Setup.exe"));
if (installer.size < 40_000_000) throw new Error(`Installateur anormalement petit: ${installer.size} octets.`);

async function assertNoDebugLog(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await assertNoDebugLog(full);
    else if (entry.name.toLowerCase() === "debug.log") throw new Error(`debug.log interdit: ${full}`);
  }
}
await assertNoDebugLog(release);

console.log(`OK: ${locales.filter((name) => name.endsWith(".pak")).length} locale(s) Chromium.`);
console.log(`OK: runtime web contient ${modules.length} entrées dans node_modules.`);
console.log("Package Windows vérifié: ICU, Chromium resources, ASAR, Next standalone, splash, vidéo et installateur NSIS sont présents.");
