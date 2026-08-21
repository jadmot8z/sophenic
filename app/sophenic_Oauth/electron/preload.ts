import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { HermesGatewayEvent } from "./runtime/types";

contextBridge.exposeInMainWorld("sophenicDesktop", {
  isDesktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chromium: process.versions.chrome
  },
  runtime: {
    status: () => ipcRenderer.invoke("sophenic:runtime:status"),
    setupStatus: () => ipcRenderer.invoke("sophenic:runtime:setup-status"),
    ensureEngine: () => ipcRenderer.invoke("sophenic:runtime:ensure-engine"),
    engineConfig: () => ipcRenderer.invoke("sophenic:runtime:engine-config"),
    modelSelection: () => ipcRenderer.invoke("sophenic:runtime:model-selection"),
    routeIntent: (prompt: string) => ipcRenderer.invoke("sophenic:runtime:route-intent", prompt),
    searchPlaces: (query: string) => ipcRenderer.invoke("sophenic:runtime:search-places", query),
    searchReferenceImages: (query: string) => ipcRenderer.invoke("sophenic:runtime:search-reference-images", query),
    webSearch: (query: string, limit = 6) => ipcRenderer.invoke("sophenic:runtime:web-search", query, limit),
    reviewCode: (input: { prompt: string; candidates: Array<{ provider: string; model: string }> }) => ipcRenderer.invoke("sophenic:runtime:review-code", input),
    rememberLanguage: (prompt: string) => ipcRenderer.invoke("sophenic:runtime:remember-language", prompt),
    tryNativePcAction: (prompt: string) => ipcRenderer.invoke("sophenic:runtime:try-native-pc-action", prompt),
    executeAction: (action: Record<string, unknown>) => ipcRenderer.invoke("sophenic:runtime:execute-action", action),
    modelManagerStatus: () => ipcRenderer.invoke("sophenic:runtime:model-manager-status"),
    planAgentRoute: (input: { prompt: string; purpose?: "pc" | "code" | "assistant"; provider?: string; model?: string; effortMode?: "quick" | "auto" | "deep" }) => ipcRenderer.invoke("sophenic:runtime:plan-agent-route", input),
    providerStatus: () => ipcRenderer.invoke("sophenic:runtime:provider-status"),
    reportAgentProviderFailure: (provider: string, message: string) => ipcRenderer.invoke("sophenic:runtime:report-agent-provider-failure", provider, message),
    saveProvider: (input: { provider: string; keys?: string[]; accountId?: string; baseUrl?: string; mode?: "replace" | "append" }) => ipcRenderer.invoke("sophenic:runtime:provider-save", input),
    clearProvider: (provider: string) => ipcRenderer.invoke("sophenic:runtime:provider-clear", provider),
    importProviderFile: () => ipcRenderer.invoke("sophenic:runtime:provider-import-file"),
    openProviderUrl: (provider: string, kind: "key" | "docs" = "key") => ipcRenderer.invoke("sophenic:runtime:provider-open-url", provider, kind),
    configureOpenRouter: (apiKey: string, model?: string) => ipcRenderer.invoke("sophenic:runtime:configure-openrouter", apiKey, model),
    setDefaultModel: (provider: string, model: string) => ipcRenderer.invoke("sophenic:runtime:set-default-model", provider, model),
    setPersonalization: (value: string) => ipcRenderer.invoke("sophenic:runtime:set-personalization", value),
    openOpenRouterKeys: () => ipcRenderer.invoke("sophenic:runtime:open-openrouter-keys"),
    startHermes: () => ipcRenderer.invoke("sophenic:runtime:start-hermes"),
    stopHermes: () => ipcRenderer.invoke("sophenic:runtime:stop-hermes"),
    logs: () => ipcRenderer.invoke("sophenic:runtime:logs"),
    chooseWorkspace: () => ipcRenderer.invoke("sophenic:runtime:choose-workspace"),
    chooseCodeFile: () => ipcRenderer.invoke("sophenic:runtime:choose-code-file"),
    createCodeWorkspace: (prompt: string) => ipcRenderer.invoke("sophenic:runtime:create-code-workspace", prompt),
    recoverCodeCheckpoint: () => ipcRenderer.invoke("sophenic:runtime:recover-code-checkpoint"),
    saveCodeCheckpoint: (checkpoint: Record<string, unknown>) => ipcRenderer.invoke("sophenic:runtime:save-code-checkpoint", checkpoint),
    clearCodeCheckpoint: (workspace: string) => ipcRenderer.invoke("sophenic:runtime:clear-code-checkpoint", workspace),
    codeHandoff: (input: { workspace: string; checkpoint?: Record<string, unknown>; targetFile?: string }) => ipcRenderer.invoke("sophenic:runtime:code-handoff", input),
    openCodeWorkspace: (workspace: string, targetFile?: string) => ipcRenderer.invoke("sophenic:runtime:open-code-workspace", workspace, targetFile),
    copyHermesInstallCommand: () => ipcRenderer.invoke("sophenic:runtime:copy-hermes-install"),
    copyHermesModelCommand: () => ipcRenderer.invoke("sophenic:runtime:copy-hermes-model"),
    openHermesWebsite: () => ipcRenderer.invoke("sophenic:runtime:open-hermes"),
    openOllamaDownload: () => ipcRenderer.invoke("sophenic:runtime:open-ollama")
  },
  developerConnections: {
    status: () => ipcRenderer.invoke("sophenic:developer-connections:status"),
    connect: (provider: "github" | "vercel") => ipcRenderer.invoke("sophenic:developer-connections:connect", provider),
    disconnect: (provider: "github" | "vercel") => ipcRenderer.invoke("sophenic:developer-connections:disconnect", provider),
    saveToken: (provider: "github" | "vercel", token: string) => ipcRenderer.invoke("sophenic:developer-connections:save-token", provider, token)
  },
  code: {
    status: () => ipcRenderer.invoke("sophenic:code:status"),
    engines: (force = false) => ipcRenderer.invoke("sophenic:code:engines", force),
    run: (input: { requestId: string; cwd: string; prompt: string; effortMode?: "quick" | "auto" | "deep" }) => ipcRenderer.invoke("sophenic:code:run", input),
    abort: (requestId?: string) => ipcRenderer.invoke("sophenic:code:abort", requestId),
    saveArtifact: (artifact: { path: string; name: string }) => ipcRenderer.invoke("sophenic:code:artifact-save", artifact),
    openArtifact: (artifact: { path: string; name: string }) => ipcRenderer.invoke("sophenic:code:artifact-open", artifact),
    revealArtifact: (artifact: { path: string; name: string }) => ipcRenderer.invoke("sophenic:code:artifact-reveal", artifact),
    onEvent: (listener: (event: { requestId: string; type: string; [key: string]: unknown }) => void) => {
      const handler = (_event: IpcRendererEvent, payload: { requestId: string; type: string; [key: string]: unknown }) => listener(payload);
      ipcRenderer.on("sophenic:code:event", handler);
      return () => ipcRenderer.removeListener("sophenic:code:event", handler);
    }
  },
  integrations: {
    list: () => ipcRenderer.invoke("sophenic:integrations:list"),
    setPermission: (id: string, enabled: boolean, scopes?: string[]) => ipcRenderer.invoke("sophenic:integrations:set-permission", id, enabled, scopes),
    setupComputerUse: () => ipcRenderer.invoke("sophenic:integrations:setup-computer"),
    startGoogleOAuth: () => ipcRenderer.invoke("sophenic:integrations:google-start"),
    finishGoogleOAuth: (redirectUrl: string) => ipcRenderer.invoke("sophenic:integrations:google-finish", redirectUrl),
    openHermesDashboard: () => ipcRenderer.invoke("sophenic:integrations:open-hermes-dashboard")
  },
  openrouter: {
    models: (force = false) => ipcRenderer.invoke("sophenic:openrouter:models", force),
    account: () => ipcRenderer.invoke("sophenic:openrouter:account"),
    imageModels: (force = false) => ipcRenderer.invoke("sophenic:openrouter:image-models", force),
    chat: (input: { requestId: string; provider?: string; model: string; effortMode?: "quick" | "auto" | "deep"; messages: Array<{ role: "user" | "assistant"; content: string }> }) => ipcRenderer.invoke("sophenic:openrouter:chat", input),
    generateImage: (input: { requestId: string; prompt: string; aspectRatio?: string; quality?: "auto" | "low" | "medium" | "high" }) => ipcRenderer.invoke("sophenic:openrouter:image", input),
    abort: (requestId: string) => ipcRenderer.invoke("sophenic:openrouter:abort", requestId),
    onStream: (listener: (event: { requestId: string; text: string }) => void) => {
      const handler = (_event: IpcRendererEvent, payload: { requestId: string; text: string }) => listener(payload);
      ipcRenderer.on("sophenic:openrouter:stream", handler);
      return () => ipcRenderer.removeListener("sophenic:openrouter:stream", handler);
    },
    onModelNotice: (listener: (event: { requestId: string; notice: Record<string, unknown> }) => void) => {
      const handler = (_event: IpcRendererEvent, payload: { requestId: string; notice: Record<string, unknown> }) => listener(payload);
      ipcRenderer.on("sophenic:model-manager:notice", handler);
      return () => ipcRenderer.removeListener("sophenic:model-manager:notice", handler);
    }
  },
  agent: {
    rpc: (method: string, params: Record<string, unknown> = {}) => ipcRenderer.invoke("sophenic:hermes:rpc", method, params),
    createSession: (input: { cwd?: string; model?: string; provider?: string; purpose?: "pc" | "code" | "assistant" } = {}) => ipcRenderer.invoke("sophenic:hermes:create-session", input),
    switchModel: (sessionId: string, model: string, provider = "openrouter") => ipcRenderer.invoke("sophenic:hermes:model", sessionId, model, provider),
    setApprovalMode: (mode: "smart") => ipcRenderer.invoke("sophenic:hermes:approval-mode", mode),
    setReasoningEffort: (sessionId: string, effort: "none" | "minimal" | "low" | "medium" | "high") => ipcRenderer.invoke("sophenic:hermes:reasoning", sessionId, effort),
    respondApproval: (requestId: string, choice: "once" | "session" | "deny") => ipcRenderer.invoke("sophenic:hermes:approval", requestId, choice),
    respondClarify: (requestId: string, answer: string) => ipcRenderer.invoke("sophenic:hermes:clarify", requestId, answer),
    respondSudo: (requestId: string, password: string) => ipcRenderer.invoke("sophenic:hermes:sudo", requestId, password),
    respondSecret: (requestId: string, value: string) => ipcRenderer.invoke("sophenic:hermes:secret", requestId, value),
    onEvent: (listener: (event: HermesGatewayEvent) => void) => {
      const handler = (_event: IpcRendererEvent, payload: HermesGatewayEvent) => listener(payload);
      ipcRenderer.on("sophenic:hermes:event", handler);
      return () => ipcRenderer.removeListener("sophenic:hermes:event", handler);
    }
  }
});
