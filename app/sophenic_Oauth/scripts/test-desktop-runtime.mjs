// Headless tests for the Sophenic desktop main-process logic that normally
// needs Electron: encrypted token persistence, the userData sophenic.env
// fallback (the root cause of the installed-app GitHub/Vercel bug), and
// token validation before storage. Electron is mocked through require.cache
// so the compiled dist-electron code runs under plain Node.
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const assert = (value, message) => { if (!value) throw new Error(message); };

const projectRoot = path.resolve(import.meta.dirname, "..");
const distElectron = (file) => path.join(projectRoot, "dist-electron", file);

// The test runs against the compiled Electron sources. On a fresh clone
// (no dist-electron yet), compile them first with the project toolchain.
if (!existsSync(distElectron("runtime/developer-oauth.js")) || !existsSync(distElectron("runtime/code-engine/artifact-tracker.js"))) {
  const tsc = path.join(projectRoot, "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc");
  const compiled = spawnSync(tsc, ["-p", path.join(projectRoot, "tsconfig.electron.json")], { stdio: "inherit", cwd: projectRoot });
  assert(compiled.status === 0, "La compilation Electron (tsconfig.electron.json) a échoué.");
}

const temp = await mkdtemp(path.join(os.tmpdir(), "sophenic-desktop-runtime-"));
const userData = path.join(temp, "userData");
await mkdir(userData, { recursive: true });

// ------------------------------------------------------------------ Electron mock
const realFetch = global.fetch;
const capturedLogs = [];
const originalLog = console.log;
console.log = (...args) => { capturedLogs.push(args.map(String).join(" ")); };

let fetchHandler = null;
global.fetch = (url, init) => fetchHandler ? fetchHandler(url, init) : realFetch(url, init);

const state = { tokens: { github: "", vercel: "" } };
const connectors = {
  github: {
    setToken: (token) => { state.tokens.github = token; },
    async validate() { return state.tokens.github ? { connected: true, login: "octo-dev" } : { connected: false }; }
  },
  vercel: {
    setToken: (token) => { state.tokens.vercel = token; },
    async validate() { return state.tokens.vercel ? { connected: true, username: "vercel-user" } : { connected: false }; }
  }
};

const electronMock = {
  app: {
    isReady: () => true,
    isPackaged: true,
    getName: () => "SOPHENIC",
    getPath: (name) => (name === "userData" ? userData : path.join(temp, name))
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`enc:${Buffer.from(value, "utf8").toString("base64")}`, "utf8"),
    decryptString: (buffer) => {
      const raw = buffer.toString("utf8");
      assert(raw.startsWith("enc:"), "Le secret stocké doit passer par safeStorage.encryptString.");
      return Buffer.from(raw.slice(4), "base64").toString("utf8");
    }
  },
  shell: { openExternal: async () => undefined, openPath: async () => "", showItemInFolder: () => undefined },
  clipboard: { writeText: () => undefined },
  dialog: { showErrorBox: () => undefined, showSaveDialog: async () => ({ canceled: true }), showOpenDialog: async () => ({ canceled: true }) },
  ipcMain: { handle: () => undefined },
  BrowserWindow: class { constructor() {} loadURL() { return Promise.resolve(); } },
  session: { defaultSession: { setPermissionRequestHandler: () => undefined, on: () => undefined } },
  screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }) }
};

const electronEntry = require.resolve("electron");
const installMock = () => {
  require.cache[electronEntry] = { id: electronEntry, filename: electronEntry, loaded: true, exports: electronMock };
};
const flushSophenicModules = () => {
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(path.join(projectRoot, "dist-electron"))) delete require.cache[key];
  }
};

const FAKE_GITHUB_TOKEN = "github_pat_SOPHENICTESTDO-not-a-real-key-0001";
const FAKE_VERCEL_TOKEN = "vcp_faketoken_sophenic_test_not_real_0001";

try {
  installMock();

  // 1) The installed app reads SOPHENIC_* config from userData/sophenic.env
  //    even when process.cwd() has NO .env.local (the exact VS Code vs
  //    installed-app difference that broke GitHub/Vercel).
  process.chdir(temp); // cwd without .env.local/.env
  await writeFile(path.join(userData, "sophenic.env"), `SOPHENIC_VERCEL_TOKEN=${FAKE_VERCEL_TOKEN}\nSOPHENIC_OAUTH_LOOPBACK_PORT=44888\n`, "utf8");
  const oauth1 = require(distElectron("runtime/developer-oauth.js"));
  const configuration1 = oauth1.developerOAuthConfiguration();
  assert(configuration1.vercel.configured === true, "sophenic.env (userData) doit configurer Vercel sans .env.local.");
  assert(configuration1.vercel.mode === "token", "Vercel doit être en mode token via sophenic.env.");
  assert(configuration1.port === 44888, "Le port OAuth doit être lu depuis sophenic.env.");
  assert(configuration1.github.configured === false, "GitHub OAuth doit rester non configuré sans client id.");

  // 2) A personal token is validated against the real API BEFORE storage.
  fetchHandler = async (url) => {
    assert(!String(url).includes("undefined"), "L'appel de validation ne doit pas contenir undefined.");
    if (String(url).startsWith("https://api.github.com/user")) {
      return { ok: false, status: 401, json: async () => ({ message: "Bad credentials" }) };
    }
    throw new Error(`fetch inattendu: ${url}`);
  };
  let refused = false;
  try { await oauth1.saveDeveloperPersonalToken("github", FAKE_GITHUB_TOKEN, connectors); }
  catch { refused = true; }
  assert(refused, "Un token refusé par l'API GitHub ne doit jamais être enregistré.");
  const secretsDir = path.join(userData, "connector-secrets");
  assert(!existsSync(path.join(secretsDir, "github-oauth.enc")), "Aucun secret ne doit être écrit après un échec de validation.");
  assert(state.tokens.github === "", "Le connecteur ne doit pas recevoir un token non validé.");

  // 3) A valid token is stored encrypted, activates the connector and the
  //    returned status never leaks the token itself.
  fetchHandler = async (url) => {
    if (String(url).startsWith("https://api.github.com/user")) {
      return { ok: true, status: 200, json: async () => ({ login: "octo-dev", name: "Octo Dev", id: 42 }) };
    }
    throw new Error(`fetch inattendu: ${url}`);
  };
  const status = await oauth1.saveDeveloperPersonalToken("github", FAKE_GITHUB_TOKEN, connectors);
  assert(Array.isArray(status), "Le statut développeur doit être une liste de connexions.");
  const githubStatus = status.find((row) => row.provider === "github");
  assert(githubStatus.connected === true, "GitHub doit être connecté après enregistrement validé.");
  assert(githubStatus.username === "octo-dev", "Le compte GitHub validé doit être remonté.");
  assert(state.tokens.github === FAKE_GITHUB_TOKEN, "Le connecteur actif doit utiliser le token enregistré.");
  assert(!JSON.stringify(status).includes(FAKE_GITHUB_TOKEN), "Le statut ne doit jamais contenir le token en clair.");
  const storedBundle = await readFile(path.join(secretsDir, "github-oauth.enc"), "utf8");
  assert(!storedBundle.includes(FAKE_GITHUB_TOKEN), "Le fichier du coffre ne doit jamais contenir le token en clair (safeStorage requis).");

  // 4) Tokens survive an application restart: fresh module instances restore
  //    credentials from the encrypted vault only.
  flushSophenicModules();
  installMock();
  fetchHandler = null;
  const oauth2 = require(distElectron("runtime/developer-oauth.js"));
  const connectors2 = {
    github: { setToken: (token) => { state.tokens.github = token; }, async validate() { return { connected: true, login: "octo-dev" }; } },
    vercel: { setToken: (token) => { state.tokens.vercel = token; }, async validate() { return { connected: true, username: "vercel-user" }; } }
  };
  state.tokens.github = "";
  await oauth2.restoreDeveloperOAuth(connectors2);
  assert(state.tokens.github === FAKE_GITHUB_TOKEN, "Le token GitHub doit être restauré depuis le coffre après redémarrage.");

  // 5) Disconnect removes the stored credentials entirely.
  fetchHandler = async () => ({ ok: true, status: 200, json: async () => ({}) });
  await oauth2.disconnectDeveloperOAuth("github", connectors2);
  assert(state.tokens.github === "", "La déconnexion doit vider le connecteur.");
  assert(!existsSync(path.join(secretsDir, "github-oauth.enc")), "La déconnexion doit supprimer le secret chiffré.");
  assert(!existsSync(path.join(secretsDir, "github.enc")), "La déconnexion doit aussi supprimer le secret simple.");

  // 6) No token value ever reaches the logs.
  for (const line of capturedLogs) {
    assert(!line.includes(FAKE_GITHUB_TOKEN) && !line.includes(FAKE_VERCEL_TOKEN), "Un token ne doit jamais apparaître dans les logs.");
  }

  // 7) Compiled artifact tracker: new ZIP detected, pre-existing file ignored.
  const tracker = require(distElectron("runtime/code-engine/artifact-tracker.js"));
  const run = path.join(temp, "ws");
  await mkdir(run, { recursive: true });
  await writeFile(path.join(run, "existant.txt"), "avant");
  const baseline = tracker.snapshotWorkspaceFiles(run);
  await writeFile(path.join(run, "site-voyage.zip"), Buffer.alloc(128, 9));
  const artifacts = await tracker.detectWorkspaceArtifacts(run, baseline);
  assert(artifacts.some((a) => a.name === "site-voyage.zip" && a.kind === "archive"), "Le ZIP doit être détecté comme artefact livrable.");
  assert(!artifacts.some((a) => a.name === "existant.txt"), "Un fichier déjà présent ne doit pas être signalé.");
} finally {
  console.log = originalLog;
  global.fetch = realFetch;
  process.chdir(projectRoot);
  await rm(temp, { recursive: true, force: true });
}

console.log("SOPHENIC desktop runtime tests: OK — userData sophenic.env fallback, validated token storage, restart persistence, safe disconnect, secret-free status/logs, artifact detection.");
