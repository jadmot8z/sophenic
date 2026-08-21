import { app, BrowserWindow, clipboard, dialog, ipcMain, screen, session, shell, type IpcMainInvokeEvent, type OpenDialogOptions } from "electron";
import fs from "node:fs";
import path from "node:path";
import { SophenicLocalRuntime } from "./runtime";
import { DesktopWebRuntime } from "./runtime/web";
import { WebResearchConnector } from "./runtime/code-engine/web-research";
import { configureOpenRouter, inspectEngineConfig, inspectModelSelection, prepareHermesProvider, rememberUserLanguage, setDefaultModel, setPersonalization } from "./runtime/config";
import { engineSetupStatus, ensureEngineInstalled } from "./runtime/provision";
import { getOpenRouterAccountInfo, listOpenRouterModels, type OpenRouterChatMessage } from "./runtime/openrouter";
import { generateSophenicImage, listSophenicImageEngines } from "./runtime/image-router";
import { chatWithModelManager, modelManagerStatus, validateModelSelection } from "./runtime/model-manager";
import { finishGoogleOAuth, integrationEnabled, listIntegrationPermissions, setIntegrationPermission, setupComputerUse, startGoogleOAuth } from "./runtime/integrations";
import { routeIntent } from "./runtime/intent-router";
import { tryNativePcAction } from "./runtime/system-actions";
import { executeRoutedAction } from "./runtime/action-router";
import { clearProviderCredential, listProviderSecretStatus, providerVaultInfo, saveProviderCredential } from "./runtime/provider-secrets";
import { publicProviderCatalog } from "./runtime/provider-registry";
import { importSophenicKeyFileText } from "./runtime/provider-import";
import { planSophenicAgentRoute, type SophenicEffortMode } from "./runtime/sophenic-brain";
import { tryAppendAgentAudit } from "./runtime/agent-governance";
import { searchPlaces, searchReferenceImages } from "./runtime/enrichment";
import { chatWithCloudProvider } from "./runtime/provider-client";
import { isCloudProvider } from "./runtime/provider-registry";
import { inspectCodeEngines } from "./runtime/code-engines";
import { validateProviderKeys } from "./runtime/provider-validation";
import { reportHermesProviderFailure } from "./runtime/sophenic-agent-routing";
import { buildCodeWorkspaceHandoff, clearCodeWorkspaceCheckpoint, createManagedCodeWorkspace, externalFileInfo, externalProjectInfo, findLatestCodeWorkspaceCheckpoint, saveCodeWorkspaceCheckpoint, type CodeWorkspaceCheckpoint } from "./runtime/code-workspace";
import { connectDeveloperOAuth, developerOAuthConfiguration, developerOAuthStatus, disconnectDeveloperOAuth, restoreDeveloperOAuth, saveDeveloperPersonalToken, type DeveloperOAuthProvider } from "./runtime/developer-oauth";

const runtime = new SophenicLocalRuntime();
const webRuntime = new DesktopWebRuntime();
const nativeResearch = new WebResearchConnector();
let trustedAppOrigin = "";
let primaryWindow: BrowserWindow | null = null;
const openRouterRequests = new Map<string, AbortController>();

// Never emit Chromium's debug.log beside the executable. Packaged diagnostics stay
// in-memory and startup failures are surfaced through the native error dialog.
delete process.env.ELECTRON_ENABLE_LOGGING;
delete process.env.ELECTRON_ENABLE_STACK_DUMPING;
app.commandLine.appendSwitch("disable-logging");
app.commandLine.appendSwitch("log-level", "3");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

// A desktop application should have one primary instance. A second launch from
// the Desktop/Start Menu focuses the existing SOPHENIC window instead of
// starting a second local Next.js server.
const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) app.quit();

app.on("second-instance", () => {
  const window = primaryWindow ?? BrowserWindow.getAllWindows()[0] ?? null;
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
});


function writeSmokeReadyMarker(): void {
  const prefix = "--sophenic-smoke-ready=";
  const arg = process.argv.find((entry) => entry.startsWith(prefix));
  if (!arg) return;
  const target = arg.slice(prefix.length).trim();
  if (!target) return;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify({ pid: process.pid, readyAt: new Date().toISOString() }), "utf8");
  } catch {
    // Smoke-test instrumentation must never affect a normal application launch.
  }
}

function applicationIconPath(): string {
  return app.isPackaged ? path.join(process.resourcesPath, "icon.ico") : path.join(process.cwd(), "build", "icon.ico");
}

function launchAssetPath(file: string): string {
  const base = app.isPackaged ? path.join(process.resourcesPath, "launch") : path.join(process.cwd(), "build", "launch");
  return path.join(base, file);
}

async function createLaunchIntro(): Promise<{ window: BrowserWindow; finished: Promise<void> }> {
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.min(1120, Math.max(760, Math.round(workArea.width * 0.68)));
  const height = Math.round(width * 9 / 16);
  const intro = new BrowserWindow({
    width,
    height,
    useContentSize: true,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: "#050506",
    icon: applicationIconPath(),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true }
  });

  await intro.loadFile(launchAssetPath("splash.html"));
  intro.center();
  intro.show();

  const finished = intro.webContents.executeJavaScript(`new Promise((resolve) => {
    const video = document.getElementById("intro");
    if (!video || video.ended || document.body.dataset.finished === "true") return resolve(true);
    video.addEventListener("ended", () => resolve(true), { once: true });
    video.addEventListener("error", () => resolve(true), { once: true });
    window.setTimeout(() => resolve(true), 12000);
  })`, true).then(() => undefined).catch(() => undefined);

  return { window: intro, finished };
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
}

function validateLocalDesktopUrl(candidate: string): URL {
  const url = new URL(candidate);
  if (url.protocol !== "http:" || !isLoopbackHostname(url.hostname)) {
    throw new Error("L'interface Desktop privilégiée doit être servie uniquement depuis loopback.");
  }
  if (!url.pathname.startsWith("/desktop/agent")) {
    throw new Error("Route Desktop privilégiée invalide.");
  }
  return url;
}

function isAllowedDesktopPage(candidate: string, allowedOrigin: string): boolean {
  try {
    const url = new URL(candidate);
    return url.origin === allowedOrigin && url.pathname.startsWith("/desktop/agent");
  } catch {
    return false;
  }
}

function assertTrustedFrame(event: IpcMainInvokeEvent): void {
  if (!trustedAppOrigin) throw new Error("Origine Desktop non initialisée");
  const senderUrl = event.senderFrame?.url;
  if (!senderUrl) throw new Error("Contexte IPC introuvable");
  const sender = new URL(senderUrl);
  if (sender.origin !== trustedAppOrigin || !sender.pathname.startsWith("/desktop/agent")) {
    throw new Error("Origine IPC refusée");
  }
}

function packagedServerScript(): string {
  // The Next.js standalone server is copied with electron-builder.extraResources.
  // Keeping it outside app.asar preserves its traced node_modules tree.
  return path.join(process.resourcesPath, "web", "server.js");
}

async function resolveDesktopUrl(): Promise<string> {
  if (!app.isPackaged) {
    const configured = process.env.SOPHENIC_DESKTOP_DEV_URL || "http://127.0.0.1:3000/desktop/agent";
    return validateLocalDesktopUrl(configured).toString();
  }
  return validateLocalDesktopUrl(await webRuntime.start(packagedServerScript())).toString();
}

async function ensureGateway(provider = ""): Promise<void> {
  const requested = provider.trim().toLowerCase();
  if (!runtime.gateway.isConnected() || (requested && runtime.hermes.getActiveProvider() !== requested)) {
    await runtime.startHermes(requested);
  }
}

function registerDesktopIpc(): void {
  ipcMain.handle("sophenic:developer-connections:status", async (event) => {
    assertTrustedFrame(event);
    return { connections: await developerOAuthStatus(runtime.codeEngine), configuration: developerOAuthConfiguration() };
  });
  ipcMain.handle("sophenic:developer-connections:connect", async (event, provider: unknown) => {
    assertTrustedFrame(event);
    if (provider !== "github" && provider !== "vercel") throw new Error("Fournisseur OAuth développeur invalide");
    return { connections: await connectDeveloperOAuth(provider as DeveloperOAuthProvider, runtime.codeEngine), configuration: developerOAuthConfiguration() };
  });
  ipcMain.handle("sophenic:developer-connections:disconnect", async (event, provider: unknown) => {
    assertTrustedFrame(event);
    if (provider !== "github" && provider !== "vercel") throw new Error("Fournisseur OAuth développeur invalide");
    return { connections: await disconnectDeveloperOAuth(provider as DeveloperOAuthProvider, runtime.codeEngine), configuration: developerOAuthConfiguration() };
  });
  ipcMain.handle("sophenic:developer-connections:save-token", async (event, provider: unknown, token: unknown) => {
    assertTrustedFrame(event);
    if (provider !== "github" && provider !== "vercel") throw new Error("Fournisseur développeur invalide");
    if (typeof token !== "string" || !token.trim()) throw new Error("Aucune clé/token fournie.");
    // The token is validated against the real provider API, then stored
    // encrypted with safeStorage. It is never logged and never returned.
    return { connections: await saveDeveloperPersonalToken(provider as DeveloperOAuthProvider, token, runtime.codeEngine), configuration: developerOAuthConfiguration() };
  });
  ipcMain.handle("sophenic:runtime:status", async (event) => {
    assertTrustedFrame(event);
    return runtime.status();
  });
  ipcMain.handle("sophenic:code:status", async (event) => {
    assertTrustedFrame(event);
    return runtime.code.inspect();
  });
  ipcMain.handle("sophenic:code:engines", async (event, force: unknown) => {
    assertTrustedFrame(event);
    return inspectCodeEngines({ force: force === true, live: true });
  });
  ipcMain.handle("sophenic:code:run", async (event, input: unknown) => {
    assertTrustedFrame(event);
    const body = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
    const requestId = typeof body.requestId === "string" && body.requestId.trim() ? body.requestId.trim() : `${Date.now()}`;
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    const cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";
    const requestedMode = body.effortMode;
    const effortMode: SophenicEffortMode = requestedMode === "quick" || requestedMode === "deep" ? requestedMode : "auto";
    if (!prompt || !cwd) throw new Error("Prompt ou workspace Sophenic Code manquant.");
    rememberUserLanguage(prompt);
    return runtime.code.runTask({
      requestId,
      prompt,
      cwd,
      effortMode,
      onEvent: (payload) => {
        if (!event.sender.isDestroyed()) event.sender.send("sophenic:code:event", { requestId, ...payload });
      }
    });
  });
  ipcMain.handle("sophenic:code:abort", async (event, requestId: unknown) => {
    assertTrustedFrame(event);
    return runtime.code.abort(typeof requestId === "string" ? requestId : undefined);
  });
  // Deliverable files produced by a Sophenic Code run (ZIP, PDF, images...).
  // The path always comes from the main-process artifact tracker, is re-checked
  // on disk before use, and never exposes anything outside a real workspace file.
  const artifactFile = (input: unknown): { path: string; name: string } => {
    const body = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
    const target = typeof body.path === "string" ? body.path.trim() : "";
    if (!target || !path.isAbsolute(target)) throw new Error("Chemin de fichier Sophenic invalide.");
    let stat: fs.Stats;
    try { stat = fs.statSync(target); } catch { throw new Error("Fichier introuvable sur le disque."); }
    if (!stat.isFile()) throw new Error("Le chemin désigné n’est pas un fichier.");
    return { path: target, name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : path.basename(target) };
  };
  ipcMain.handle("sophenic:code:artifact-save", async (event, input: unknown) => {
    assertTrustedFrame(event);
    const artifact = artifactFile(input);
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: "Enregistrer le fichier Sophenic",
      defaultPath: path.join(app.getPath("downloads"), artifact.name),
      filters: [{ name: artifact.name, extensions: [path.extname(artifact.name).replace(".", "") || "*"] }]
    };
    const result = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return { saved: false };
    await fs.promises.copyFile(artifact.path, result.filePath);
    return { saved: true, path: result.filePath };
  });
  ipcMain.handle("sophenic:code:artifact-open", async (event, input: unknown) => {
    assertTrustedFrame(event);
    const artifact = artifactFile(input);
    const failure = await shell.openPath(artifact.path);
    if (failure) throw new Error(`Impossible d’ouvrir le fichier: ${failure}`);
    return true;
  });
  ipcMain.handle("sophenic:code:artifact-reveal", async (event, input: unknown) => {
    assertTrustedFrame(event);
    const artifact = artifactFile(input);
    shell.showItemInFolder(artifact.path);
    return true;
  });
  ipcMain.handle("sophenic:runtime:setup-status", async (event) => {
    assertTrustedFrame(event);
    return engineSetupStatus();
  });
  ipcMain.handle("sophenic:runtime:ensure-engine", async (event) => {
    assertTrustedFrame(event);
    await ensureEngineInstalled();
    return engineSetupStatus();
  });
  ipcMain.handle("sophenic:runtime:engine-config", async (event) => {
    assertTrustedFrame(event);
    return inspectEngineConfig();
  });
  ipcMain.handle("sophenic:runtime:model-selection", async (event) => {
    assertTrustedFrame(event);
    return inspectModelSelection();
  });
  ipcMain.handle("sophenic:runtime:route-intent", async (event, prompt: unknown) => {
    assertTrustedFrame(event);
    if (typeof prompt !== "string") throw new Error("Demande invalide");
    return routeIntent(prompt);
  });

  ipcMain.handle("sophenic:runtime:search-places", async (event, query: unknown) => {
    assertTrustedFrame(event);
    if (typeof query !== "string" || !query.trim()) return [];
    return searchPlaces(query.trim());
  });
  ipcMain.handle("sophenic:runtime:search-reference-images", async (event, query: unknown) => {
    assertTrustedFrame(event);
    if (typeof query !== "string" || !query.trim()) return [];
    return searchReferenceImages(query.trim());
  });
  ipcMain.handle("sophenic:runtime:web-search", async (event, query: unknown, limit: unknown) => {
    assertTrustedFrame(event);
    if (typeof query !== "string" || !query.trim()) return [];
    const safeLimit = typeof limit === "number" && Number.isFinite(limit) ? Math.max(1, Math.min(10, Math.floor(limit))) : 6;
    return nativeResearch.search(query.trim(), safeLimit);
  });
  ipcMain.handle("sophenic:runtime:review-code", async (event, input: unknown) => {
    assertTrustedFrame(event);
    const body = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    const candidates = Array.isArray(body.candidates) ? body.candidates : [];
    if (!prompt) throw new Error("Prompt de relecture manquant.");
    let lastError: unknown = null;
    for (const raw of candidates) {
      const row = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
      const provider = typeof row.provider === "string" ? row.provider.trim().toLowerCase() : "";
      const model = typeof row.model === "string" ? row.model.trim() : "";
      if (!isCloudProvider(provider) || !model) continue;
      try {
        const result = await chatWithCloudProvider({ provider, model, messages: [{ role: "user", content: prompt }], stream: false, reasoningEffort: "medium" });
        return { provider, model: result.model || model, content: result.content };
      } catch (cause) { lastError = cause; }
    }
    throw lastError instanceof Error ? lastError : new Error("Aucun reviewer IA distinct n'est disponible.");
  });
  ipcMain.handle("sophenic:runtime:remember-language", async (event, prompt: unknown) => {
    assertTrustedFrame(event);
    if (typeof prompt !== "string") throw new Error("Demande invalide");
    return rememberUserLanguage(prompt);
  });
  ipcMain.handle("sophenic:runtime:try-native-pc-action", async (event, prompt: unknown) => {
    assertTrustedFrame(event);
    if (typeof prompt !== "string") throw new Error("Demande invalide");
    return tryNativePcAction(prompt);
  });
  ipcMain.handle("sophenic:runtime:execute-action", async (event, action: unknown) => {
    assertTrustedFrame(event);
    const owner = BrowserWindow.fromWebContents(event.sender);
    return executeRoutedAction(action, owner);
  });
  ipcMain.handle("sophenic:runtime:configure-openrouter", async (event, apiKey: unknown, model: unknown) => {
    assertTrustedFrame(event);
    if (typeof apiKey !== "string" || !apiKey.trim()) throw new Error("Clé API invalide");
    const validation = await validateProviderKeys({ provider: "openrouter", keys: [apiKey.trim()] });
    const checked = validation[0];
    if (!checked?.ok) throw new Error(checked?.message || "La clé OpenRouter n’a pas pu être vérifiée et n’a pas été enregistrée.");
    runtime.stopHermes();
    const config = configureOpenRouter(apiKey.trim(), typeof model === "string" && model.trim() ? model : undefined);
    return config;
  });
  ipcMain.handle("sophenic:runtime:set-default-model", async (event, provider: unknown, model: unknown) => {
    assertTrustedFrame(event);
    if (typeof provider !== "string" || typeof model !== "string") throw new Error("Modèle invalide");
    const validated = await validateModelSelection(provider, model);
    return setDefaultModel(validated.provider, validated.model);
  });
  ipcMain.handle("sophenic:runtime:model-manager-status", async (event) => {
    assertTrustedFrame(event);
    return modelManagerStatus();
  });
  ipcMain.handle("sophenic:runtime:plan-agent-route", async (event, input: unknown) => {
    assertTrustedFrame(event);
    const body = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) throw new Error("La demande agent est vide.");
    const requestedMode = body.effortMode;
    const effortMode: SophenicEffortMode = requestedMode === "quick" || requestedMode === "deep" ? requestedMode : "auto";
    const purpose = body.purpose === "pc" ? "pc" : body.purpose === "code" ? "code" : "assistant";
    // Provider/model are deliberately NOT accepted from the renderer. Sophenic Brain is the
    // sole authority for Provider → Model → Key and fallback selection.
    const brain = await planSophenicAgentRoute({ messages: [{ role: "user", content: prompt }], mode: effortMode, purpose });
    return {
      requestedProvider: "sophenic",
      requestedModel: "auto",
      provider: brain.primary.provider,
      model: brain.primary.model,
      reasoningEffort: brain.reasoningEffort,
      fallbacks: brain.fallbacks.slice(0, 12),
      reviewers: brain.reviewers,
      orchestration: brain.orchestration,
      planSteps: brain.planSteps,
      profile: brain.profile,
      mode: brain.mode
    };
  });
  ipcMain.handle("sophenic:runtime:provider-status", async (event) => {
    assertTrustedFrame(event);
    return {
      providers: listProviderSecretStatus(),
      catalog: publicProviderCatalog(),
      vault: providerVaultInfo()
    };
  });
  ipcMain.handle("sophenic:runtime:report-agent-provider-failure", async (event, provider: unknown, message: unknown) => {
    assertTrustedFrame(event);
    if (typeof provider !== "string") throw new Error("Fournisseur IA invalide");
    return reportHermesProviderFailure(provider, typeof message === "string" ? message : "Erreur agent Code");
  });
  ipcMain.handle("sophenic:runtime:provider-save", async (event, input: unknown) => {
    assertTrustedFrame(event);
    const body = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
    const provider = typeof body.provider === "string" ? body.provider : "";
    const keys = Array.isArray(body.keys) ? body.keys.filter((entry): entry is string => typeof entry === "string") : [];
    const accountId = typeof body.accountId === "string" ? body.accountId : undefined;
    const rawBaseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
    // A Scaleway Access Key ID (SCW...) is not an API URL. Older UI wording made
    // this easy to confuse; ignore it and use the official serverless endpoint.
    const baseUrl = provider.trim().toLowerCase() === "scaleway" && rawBaseUrl && !/^https:\/\//i.test(rawBaseUrl) ? undefined : rawBaseUrl || undefined;
    const mode = body.mode === "replace" ? "replace" : "append";
    const validation = keys.length ? await validateProviderKeys({ provider, keys, accountId, baseUrl }) : [];
    const rejected = validation.filter((item) => !item.ok);
    if (rejected.length) {
      const reasons = rejected.map((item, index) => `Clé ${index + 1}: ${item.message}`).join("\n");
      throw new Error(`Sophenic a refusé ${rejected.length} clé(s) non vérifiée(s).\n${reasons}`);
    }
    const acceptedKeys = validation.length ? validation.filter((item) => item.ok).map((item) => item.key) : keys;
    const providers = saveProviderCredential({ provider, keys: acceptedKeys, accountId, baseUrl, mode });
    runtime.stopHermes();
    return { providers, vault: providerVaultInfo(), validation: validation.map(({ key: _key, ...item }) => item) };
  });
  ipcMain.handle("sophenic:runtime:provider-clear", async (event, provider: unknown) => {
    assertTrustedFrame(event);
    if (typeof provider !== "string") throw new Error("Fournisseur IA invalide");
    const providers = clearProviderCredential(provider);
    runtime.stopHermes();
    return { providers, vault: providerVaultInfo() };
  });
  ipcMain.handle("sophenic:runtime:provider-import-file", async (event) => {
    assertTrustedFrame(event);
    const owner = BrowserWindow.fromWebContents(event.sender) || primaryWindow || undefined;
    const options: OpenDialogOptions = {
      title: "Importer les clés API Sophenic",
      properties: ["openFile"],
      filters: [
        { name: "Fichier texte de clés", extensions: ["txt"] },
        { name: "Tous les fichiers", extensions: ["*"] }
      ]
    };
    const selection = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
    if (selection.canceled || !selection.filePaths[0]) return { canceled: true };
    const target = selection.filePaths[0];
    const stat = fs.statSync(target);
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw new Error("Le fichier de clés est invalide ou trop volumineux.");
    const text = fs.readFileSync(target, "utf8");
    const result = await importSophenicKeyFileText(text);
    runtime.stopHermes();
    return {
      canceled: false,
      fileName: path.basename(target),
      summaries: result.summaries,
      warnings: result.warnings,
      providers: result.providers,
      vault: result.vault
    };
  });
  ipcMain.handle("sophenic:runtime:provider-open-url", async (event, provider: unknown, kind: unknown) => {
    assertTrustedFrame(event);
    if (typeof provider !== "string") throw new Error("Fournisseur IA invalide");
    const profile = publicProviderCatalog().find((item) => item.id === provider.trim().toLowerCase());
    if (!profile) throw new Error("Fournisseur IA inconnu");
    const target = kind === "docs" ? profile.docsUrl : profile.keyUrl;
    await shell.openExternal(target);
    return true;
  });
  ipcMain.handle("sophenic:runtime:set-personalization", async (event, value: unknown) => {
    assertTrustedFrame(event);
    if (typeof value !== "string") throw new Error("Personnalisation invalide");
    return setPersonalization(value);
  });
  ipcMain.handle("sophenic:openrouter:models", async (event, force: unknown) => {
    assertTrustedFrame(event);
    return listOpenRouterModels(force === true);
  });
  ipcMain.handle("sophenic:openrouter:account", async (event) => {
    assertTrustedFrame(event);
    return getOpenRouterAccountInfo();
  });
  ipcMain.handle("sophenic:openrouter:image-models", async (event, force: unknown) => {
    assertTrustedFrame(event);
    return listSophenicImageEngines(force === true);
  });
  ipcMain.handle("sophenic:openrouter:chat", async (event, input: unknown) => {
    assertTrustedFrame(event);
    const body = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
    const requestId = typeof body.requestId === "string" && body.requestId.trim() ? body.requestId.trim() : `${Date.now()}`;
    // Chat is always Brain-managed. Provider/model fields from the renderer are ignored.
    const provider = "sophenic";
    const model = "auto";
    const effortMode = body.effortMode === "quick" || body.effortMode === "deep" ? body.effortMode : "auto";
    const rawMessages = Array.isArray(body.messages) ? body.messages : [];
    const messages: OpenRouterChatMessage[] = rawMessages.map((entry) => {
      const row = entry && typeof entry === "object" && !Array.isArray(entry) ? entry as Record<string, unknown> : {};
      const role: OpenRouterChatMessage["role"] = row.role === "assistant" ? "assistant" : "user";
      const content = typeof row.content === "string" ? row.content : "";
      return { role, content };
    }).filter((message) => message.content.trim());
    if (!messages.length) throw new Error("Message vide.");
    const latestUserMessage = [...messages].reverse().find((message) => message.role === "user")?.content || "";
    if (latestUserMessage) rememberUserLanguage(latestUserMessage);
    const controller = new AbortController();
    openRouterRequests.set(requestId, controller);
    const sendDelta = (text: string) => {
      if (!event.sender.isDestroyed()) event.sender.send("sophenic:openrouter:stream", { requestId, text });
    };
    const sendNotice = (notice: unknown) => {
      if (!event.sender.isDestroyed()) event.sender.send("sophenic:model-manager:notice", { requestId, notice });
    };
    try {
      return await chatWithModelManager({ provider, model, messages, effortMode, signal: controller.signal, onDelta: sendDelta, onNotice: sendNotice });
    } finally {
      openRouterRequests.delete(requestId);
    }
  });
  ipcMain.handle("sophenic:openrouter:image", async (event, input: unknown) => {
    assertTrustedFrame(event);
    const body = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
    const requestId = typeof body.requestId === "string" && body.requestId.trim() ? body.requestId.trim() : `${Date.now()}`;
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    const aspectRatio = typeof body.aspectRatio === "string" ? body.aspectRatio.trim() : undefined;
    const quality = body.quality === "low" || body.quality === "medium" || body.quality === "high" ? body.quality : "auto";
    if (!prompt) throw new Error("Description d’image manquante.");
    // Image routing is Brain-managed. xAI/Grok Imagine is preferred when configured;
    // OpenRouter is an independent fallback and cannot disable the whole Image mode.
    rememberUserLanguage(prompt);
    const controller = new AbortController();
    openRouterRequests.set(requestId, controller);
    try {
      return await generateSophenicImage({ prompt, aspectRatio, quality, signal: controller.signal });
    } finally {
      openRouterRequests.delete(requestId);
    }
  });
  ipcMain.handle("sophenic:openrouter:abort", async (event, requestId: unknown) => {
    assertTrustedFrame(event);
    if (typeof requestId !== "string") return false;
    const controller = openRouterRequests.get(requestId);
    if (!controller) return false;
    controller.abort();
    openRouterRequests.delete(requestId);
    return true;
  });
  ipcMain.handle("sophenic:runtime:open-openrouter-keys", async (event) => {
    assertTrustedFrame(event);
    await shell.openExternal("https://openrouter.ai/settings/keys");
    return true;
  });
  ipcMain.handle("sophenic:runtime:start-hermes", async (event) => {
    assertTrustedFrame(event);
    return runtime.startHermes();
  });
  ipcMain.handle("sophenic:runtime:stop-hermes", async (event) => {
    assertTrustedFrame(event);
    runtime.stopHermes();
    return runtime.status();
  });
  ipcMain.handle("sophenic:runtime:logs", (event) => {
    assertTrustedFrame(event);
    return [...webRuntime.recentLogs(), ...runtime.hermes.getRecentLogs()].slice(-160);
  });
  ipcMain.handle("sophenic:runtime:choose-workspace", async (event) => {
    assertTrustedFrame(event);
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options = { title: "Choisir un projet/dossier existant pour Sophenic Code", properties: ["openDirectory"] as "openDirectory"[] };
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return null;
    return externalProjectInfo(result.filePaths[0]);
  });
  ipcMain.handle("sophenic:runtime:choose-code-file", async (event) => {
    assertTrustedFrame(event);
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = { title: "Sélectionner le fichier à modifier avec Sophenic Code", properties: ["openFile"] };
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return null;
    return externalFileInfo(result.filePaths[0]);
  });
  ipcMain.handle("sophenic:runtime:create-code-workspace", async (event, prompt: unknown) => {
    assertTrustedFrame(event);
    return createManagedCodeWorkspace(typeof prompt === "string" ? prompt : "Projet Sophenic");
  });
  ipcMain.handle("sophenic:runtime:recover-code-checkpoint", async (event) => {
    assertTrustedFrame(event);
    return findLatestCodeWorkspaceCheckpoint();
  });
  ipcMain.handle("sophenic:runtime:save-code-checkpoint", async (event, input: unknown) => {
    assertTrustedFrame(event);
    const body = input && typeof input === "object" && !Array.isArray(input) ? input as CodeWorkspaceCheckpoint : null;
    if (!body?.workspace) return false;
    saveCodeWorkspaceCheckpoint(body);
    return true;
  });
  ipcMain.handle("sophenic:runtime:clear-code-checkpoint", async (event, workspace: unknown) => {
    assertTrustedFrame(event);
    if (typeof workspace !== "string" || !workspace.trim()) return false;
    clearCodeWorkspaceCheckpoint(workspace);
    return true;
  });
  ipcMain.handle("sophenic:runtime:code-handoff", async (event, input: unknown) => {
    assertTrustedFrame(event);
    const body = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
    const workspace = typeof body.workspace === "string" ? body.workspace : "";
    if (!workspace.trim()) throw new Error("Workspace manquant pour le handoff Sophenic Code.");
    const checkpoint = body.checkpoint && typeof body.checkpoint === "object" && !Array.isArray(body.checkpoint) ? body.checkpoint as CodeWorkspaceCheckpoint : undefined;
    const targetFile = typeof body.targetFile === "string" ? body.targetFile : undefined;
    return buildCodeWorkspaceHandoff({ workspace, checkpoint, targetFile });
  });
  ipcMain.handle("sophenic:runtime:open-code-workspace", async (event, workspace: unknown, targetFile: unknown) => {
    assertTrustedFrame(event);
    const folder = typeof workspace === "string" ? workspace.trim() : "";
    const file = typeof targetFile === "string" ? targetFile.trim() : "";
    if (!folder) return false;
    if (file && fs.existsSync(file)) {
      shell.showItemInFolder(file);
      return true;
    }
    const result = await shell.openPath(folder);
    if (result) throw new Error(result);
    return true;
  });
  ipcMain.handle("sophenic:runtime:copy-hermes-install", (event) => {
    assertTrustedFrame(event);
    const command = "iex (irm https://hermes-agent.nousresearch.com/install.ps1)";
    clipboard.writeText(command);
    return command;
  });
  ipcMain.handle("sophenic:runtime:copy-hermes-model", (event) => {
    assertTrustedFrame(event);
    const command = "hermes model";
    clipboard.writeText(command);
    return command;
  });
  ipcMain.handle("sophenic:runtime:open-ollama", async (event) => {
    assertTrustedFrame(event);
    await shell.openExternal("https://ollama.com/download/windows");
    return true;
  });
  ipcMain.handle("sophenic:runtime:open-hermes", async (event) => {
    assertTrustedFrame(event);
    await shell.openExternal("https://hermes-agent.nousresearch.com/");
    return true;
  });
  ipcMain.handle("sophenic:integrations:list", async (event) => {
    assertTrustedFrame(event);
    return listIntegrationPermissions();
  });
  ipcMain.handle("sophenic:integrations:set-permission", async (event, id: unknown, enabled: unknown, scopes: unknown) => {
    assertTrustedFrame(event);
    if (typeof id !== "string" || typeof enabled !== "boolean") throw new Error("Autorisation invalide.");
    const cleanScopes = Array.isArray(scopes) ? scopes.map(String) : undefined;
    const result = setIntegrationPermission(id, enabled, cleanScopes);
    tryAppendAgentAudit({ capability: "permissions", action: `permission:${id}`, risk: "sensitive", outcome: enabled ? "allowed" : "denied" });
    return result;
  });
  ipcMain.handle("sophenic:integrations:setup-computer", async (event) => {
    assertTrustedFrame(event);
    const result = await setupComputerUse();
    setIntegrationPermission("computer_use", true);
    return result;
  });
  ipcMain.handle("sophenic:integrations:google-start", async (event) => {
    assertTrustedFrame(event);
    if (!integrationEnabled("google-workspace")) throw new Error("Autorise d’abord Google Workspace dans la page Plugins.");
    await ensureEngineInstalled();
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: "Sélectionner le client OAuth Google (JSON)",
      filters: [{ name: "Google OAuth JSON", extensions: ["json"] }],
      properties: ["openFile"] as "openFile"[]
    };
    const choice = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
    if (choice.canceled || !choice.filePaths[0]) return { canceled: true };
    const started = startGoogleOAuth(choice.filePaths[0]);
    await shell.openExternal(started.authUrl);
    return { canceled: false, ...started };
  });
  ipcMain.handle("sophenic:integrations:google-finish", async (event, redirectUrl: unknown) => {
    assertTrustedFrame(event);
    if (typeof redirectUrl !== "string") throw new Error("URL Google invalide.");
    return finishGoogleOAuth(redirectUrl);
  });
  ipcMain.handle("sophenic:integrations:open-hermes-dashboard", async (event) => {
    assertTrustedFrame(event);
    await runtime.startHermes();
    const ready = runtime.hermes.getReadyInfo();
    if (!ready) throw new Error("Le tableau de bord Hermes n’est pas prêt.");
    await shell.openExternal(`http://127.0.0.1:${ready.port}/`);
    return true;
  });
  ipcMain.handle("sophenic:hermes:rpc", async (event, method: unknown, params: unknown) => {
    assertTrustedFrame(event);
    if (typeof method !== "string") throw new Error("Méthode RPC invalide");
    if (!params || typeof params !== "object" || Array.isArray(params)) throw new Error("Paramètres RPC invalides");
    await ensureGateway();
    return runtime.gateway.rpc(method, params as Record<string, unknown>);
  });
  ipcMain.handle("sophenic:hermes:create-session", async (event, input: unknown) => {
    assertTrustedFrame(event);
    const body = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
    const cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";
    const model = typeof body.model === "string" ? body.model.trim() : "";
    const provider = typeof body.provider === "string" ? body.provider.trim() : "";
    const purpose = body.purpose === "pc" ? "pc" : body.purpose === "code" ? "code" : "assistant";
    if (purpose === "pc" && !integrationEnabled("computer_use")) throw new Error("Le contrôle du PC n’est pas autorisé. Active-le dans Plugins.");
    if (provider.toLowerCase() === "sophenic") throw new Error("Sophenic Auto doit être résolu par Sophenic Brain avant la création d’une session Hermes.");
    const hermesProvider = provider ? prepareHermesProvider(provider, model) : "";
    await ensureGateway(provider);
    const result = await runtime.gateway.rpc("session.create", {
      cols: 96,
      source: "desktop",
      ...(cwd ? { cwd } : {}),
      ...(model ? { model, ...(hermesProvider ? { provider: hermesProvider } : {}) } : {}),
      fast: false
    }) as Record<string, unknown>;
    const sessionId = typeof result?.session_id === "string" ? result.session_id : "";
    if (sessionId) {
      // Never allow a Sophenic session to inherit a session-scoped yolo bypass.
      await runtime.gateway.disableSessionYolo(sessionId).catch(() => undefined);
    }
    return result;
  });
  ipcMain.handle("sophenic:hermes:model", async (event, sessionId: unknown, model: unknown, provider: unknown) => {
    assertTrustedFrame(event);
    if (typeof sessionId !== "string" || typeof model !== "string") throw new Error("Session ou modèle invalide");
    const cleanProvider = typeof provider === "string" && provider.trim() ? provider.trim() : "openrouter";
    if (cleanProvider.toLowerCase() === "sophenic") throw new Error("Sophenic Auto doit être résolu par Sophenic Brain avant Hermes.");
    const hermesProvider = prepareHermesProvider(cleanProvider, model);
    // A provider change requires a fresh provider-pinned Hermes gateway/session.
    // The renderer already recreates Code sessions on cross-provider fallback;
    // reject unsafe in-place switches instead of silently reusing credentials.
    if (runtime.gateway.isConnected() && runtime.hermes.getActiveProvider() && runtime.hermes.getActiveProvider() !== cleanProvider.toLowerCase()) {
      throw new Error("Le provider Code a changé; une nouvelle session Hermes est requise.");
    }
    await ensureGateway(cleanProvider);
    return runtime.gateway.switchModel(sessionId, model, hermesProvider);
  });
  ipcMain.handle("sophenic:hermes:approval-mode", async (event, mode: unknown) => {
    assertTrustedFrame(event);
    if (mode !== "smart") throw new Error("Sophenic impose Smart Approval pour les sessions autorisées.");
    await ensureGateway();
    return runtime.gateway.setApprovalMode("smart");
  });
  ipcMain.handle("sophenic:hermes:reasoning", async (event, sessionId: unknown, effort: unknown) => {
    assertTrustedFrame(event);
    if (typeof sessionId !== "string" || !sessionId.trim()) throw new Error("Session invalide");
    if (!new Set(["none", "minimal", "low", "medium", "high"]).has(String(effort))) throw new Error("Niveau de raisonnement invalide");
    await ensureGateway();
    return runtime.gateway.setReasoningEffort(sessionId, effort as "none" | "minimal" | "low" | "medium" | "high");
  });
  ipcMain.handle("sophenic:hermes:approval", async (event, requestId: unknown, choice: unknown) => {
    assertTrustedFrame(event);
    if (typeof requestId !== "string" || !requestId) throw new Error("request_id invalide");
    if (!new Set(["once", "session", "deny"]).has(String(choice))) throw new Error("Choix d'approbation invalide");
    await ensureGateway();
    const result = await runtime.gateway.respondToPrompt("approval.respond", { request_id: requestId, choice: String(choice) });
    tryAppendAgentAudit({ capability: "approval", action: `approval:${String(choice)}`, risk: "sensitive", outcome: choice === "deny" ? "denied" : "allowed", requestId });
    return result;
  });
  ipcMain.handle("sophenic:hermes:clarify", async (event, requestId: unknown, answer: unknown) => {
    assertTrustedFrame(event);
    if (typeof requestId !== "string" || typeof answer !== "string") throw new Error("Réponse de clarification invalide");
    await ensureGateway();
    return runtime.gateway.respondToPrompt("clarify.respond", { request_id: requestId, answer });
  });
  ipcMain.handle("sophenic:hermes:sudo", async (event, requestId: unknown, password: unknown) => {
    assertTrustedFrame(event);
    if (typeof requestId !== "string" || !requestId || typeof password !== "string") throw new Error("Réponse sudo invalide");
    await ensureGateway();
    return runtime.gateway.respondToPrompt("sudo.respond", { request_id: requestId, password });
  });
  ipcMain.handle("sophenic:hermes:secret", async (event, requestId: unknown, value: unknown) => {
    assertTrustedFrame(event);
    if (typeof requestId !== "string" || !requestId || typeof value !== "string") throw new Error("Secret invalide");
    await ensureGateway();
    return runtime.gateway.respondToPrompt("secret.respond", { request_id: requestId, value });
  });
}

async function createWindow(): Promise<BrowserWindow> {
  const desktopUrl = await resolveDesktopUrl();
  const parsed = validateLocalDesktopUrl(desktopUrl);
  trustedAppOrigin = parsed.origin;

  const window = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1040,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#08090b",
    title: "SOPHENIC",
    icon: applicationIconPath(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  primaryWindow = window;
  window.on("closed", () => { if (primaryWindow === window) primaryWindow = null; });
  runtime.attachWindow(window);
  const readyToShow = new Promise<void>((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    window.once("ready-to-show", finish);
    // Chromium can occasionally omit ready-to-show on specific GPU/driver
    // combinations. loadURL still guarantees a usable renderer, so never keep
    // a healthy application invisible forever.
    const timer = setTimeout(finish, 3_000);
    timer.unref?.();
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedDesktopPage(url, trustedAppOrigin)) {
      void window.loadURL(url);
      return { action: "deny" };
    }
    try {
      const target = new URL(url);
      if (target.protocol === "https:" || target.protocol === "http:") void shell.openExternal(url);
    } catch {
      // Invalid or non-web external URL: deny silently.
    }
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedDesktopPage(url, trustedAppOrigin)) {
      event.preventDefault();
      try {
        const target = new URL(url);
        if (target.protocol === "https:" || target.protocol === "http:") void shell.openExternal(url);
      } catch {
        // Denied.
      }
    }
  });

  try {
    await window.loadURL(desktopUrl);
    await readyToShow;
    return window;
  } catch (error) {
    if (primaryWindow === window) primaryWindow = null;
    if (!window.isDestroyed()) window.destroy();
    throw error;
  }
}

async function launchDesktopExperience(): Promise<void> {
  const intro = await createLaunchIntro().catch(() => null);
  const mainWindowPromise = createWindow();
  const mainWindow = await mainWindowPromise;
  if (intro) {
    await intro.finished;
    if (!intro.window.isDestroyed()) intro.window.destroy();
  }
  if (!mainWindow.isDestroyed()) {
    mainWindow.center();
    mainWindow.show();
    mainWindow.focus();
    writeSmokeReadyMarker();
  }
}

app.whenReady().then(async () => {
  if (!singleInstanceLock) return;
  app.setName("SOPHENIC");
  if (process.platform === "win32") app.setAppUserModelId("com.sophenic.desktop");
  await restoreDeveloperOAuth(runtime.codeEngine).catch(() => undefined);
  registerDesktopIpc();
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const trusted = Boolean(trustedAppOrigin) && webContents.getURL().startsWith(trustedAppOrigin);
    const allowLocation = permission === "geolocation" && trusted && integrationEnabled("location");
    callback(allowLocation);
  });
  session.defaultSession.on("will-download", (_event, item) => {
    item.setSaveDialogOptions({ title: "Télécharger avec Sophenic" });
  });

  try {
    await launchDesktopExperience();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox("Sophenic n'a pas pu démarrer", `${detail}\n\n${webRuntime.recentLogs().slice(-12).join("\n")}`);
    app.quit();
    return;
  }

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      try { await launchDesktopExperience(); } catch { app.quit(); }
    }
  });
});

app.on("before-quit", () => {
  runtime.dispose();
  webRuntime.stop();
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
