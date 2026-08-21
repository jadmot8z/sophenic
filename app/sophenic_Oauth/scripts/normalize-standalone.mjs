import { access, cp, mkdir, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const nextDir = path.join(root, ".next");
const standalone = path.join(nextDir, "standalone");

async function exists(target) {
  try { await access(target); return true; } catch { return false; }
}

async function findStandaloneServers(dir, depth = 0, results = []) {
  if (depth > 10) return results;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      if (entry.name === "server.js") results.push(path.join(dir, entry.name));
      continue;
    }
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    await findStandaloneServers(path.join(dir, entry.name), depth + 1, results);
  }
  return results;
}

await access(standalone);
let server = path.join(standalone, "server.js");

if (!(await exists(server))) {
  const candidates = await findStandaloneServers(standalone);
  if (!candidates.length) {
    throw new Error("Next.js standalone a été généré sans server.js.");
  }

  candidates.sort((a, b) => {
    const ad = path.relative(standalone, a).split(path.sep).length;
    const bd = path.relative(standalone, b).split(path.sep).length;
    return ad - bd || a.localeCompare(b);
  });

  const nestedServer = candidates[0];
  const nestedRoot = path.dirname(nestedServer);
  const staging = path.join(nextDir, `standalone-normalized-${process.pid}-${Date.now()}`);

  // Keep the root traced node_modules tree, then overlay the actual application
  // root emitted by Next.js when another lockfile/workspace root was detected.
  await cp(standalone, staging, { recursive: true, force: true, dereference: false });
  await cp(nestedRoot, staging, { recursive: true, force: true, dereference: false });
  await rm(standalone, { recursive: true, force: true });
  await rename(staging, standalone);
  server = path.join(standalone, "server.js");
}

// Next.js documents that public/ and .next/static are not copied into standalone
// automatically. Put them beside server.js so the minimal server is self-contained.
const publicDir = path.join(root, "public");
if (await exists(publicDir)) {
  await rm(path.join(standalone, "public"), { recursive: true, force: true });
  await cp(publicDir, path.join(standalone, "public"), { recursive: true, force: true });
}

const staticDir = path.join(nextDir, "static");
if (await exists(staticDir)) {
  await mkdir(path.join(standalone, ".next"), { recursive: true });
  await rm(path.join(standalone, ".next", "static"), { recursive: true, force: true });
  await cp(staticDir, path.join(standalone, ".next", "static"), { recursive: true, force: true });
}

for (const required of [
  server,
  path.join(standalone, "node_modules", "next", "package.json"),
  path.join(standalone, "node_modules", "react", "package.json"),
  path.join(standalone, "node_modules", "react-dom", "package.json"),
  path.join(standalone, ".next")
]) {
  await access(required);
}

console.log(`Next.js standalone normalisé: ${path.relative(root, server)}`);
