export {};

type RuntimeState = "missing" | "stopped" | "starting" | "ready" | "error";

type CodeWorkspaceKind = "managed" | "external-project" | "external-file";
type CodeWorkspaceInfo = { workspace: string; kind: CodeWorkspaceKind; targetFile?: string; projectId?: string; createdAt?: string; stateDir: string };
type CodeWorkspaceCheckpoint = { workspace: string; originalPrompt: string; planSteps: string[]; activeStep?: number; activeProvider: string; activeModel: string; savedAt: number; reason?: string; workspaceKind?: CodeWorkspaceKind; targetFile?: string; progressDigest?: string };
type CodeWorkspaceHandoff = { workspace: string; stateDir: string; summary: string; files: string[]; recentFiles: string[]; gitStatus: string[]; checkpoint?: CodeWorkspaceCheckpoint | null };

type CodeArtifactInfo = {
  id: string;
  name: string;
  path: string;
  relativePath: string;
  extension: string;
  kind: "archive" | "document" | "image" | "text" | "media" | "other";
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
};

type LocalModel = {
  name: string;
  model: string;
  modifiedAt?: string;
  size: number;
  digest?: string;
  details?: { format?: string; family?: string; families?: string[]; parameterSize?: string; quantizationLevel?: string };
};

type DesktopRuntimeStatus = {
  desktop: true;
  platform: string;
  hermes: { state: RuntimeState; command?: string; version?: string; port?: number; connected: boolean; managed: boolean; error?: string };
  claudeCode: { installed: boolean; command?: string; version?: string; gateway: { running: boolean; port?: number; baseUrl?: string; model: "sophenic-auto" }; error?: string };
  ollama: { state: RuntimeState; baseUrl: string; version?: string; models: LocalModel[]; error?: string };
  capabilities: { localModels: true; hermesGateway: true; claudeCodeAgent: true; brainManagedModels: true; approvalBridge: true; filesystemDirect: true; terminalDirect: true; autonomousCodeEngine: true };
};

type HermesGatewayEvent = { method: string; params: Record<string, unknown> };
type SophenicLocalAction = Record<string, unknown> & { kind: string };
type SophenicLocalActionResult = { handled: true; ok: boolean; kind: string; message: string; target?: string; verified?: boolean };

type EngineSetupStatus = {
  installed: boolean;
  readyForChat: boolean;
  provider: string;
  model: string;
  openRouterKeyConfigured: boolean;
  aiProviderCount: number;
  configuredProviders: string[];
  version?: string;
};

type EngineConfig = {
  installed: boolean;
  provider: string;
  model: string;
  openRouterKeyConfigured: boolean;
  aiProviderCount: number;
  configuredProviders: string[];
  personalization: string;
  preferredLanguage?: "fr" | "en" | "es" | "de" | "it" | "pt";
  version?: string;
};



type SophenicIntentDecision = {
  intent: "chat" | "code" | "agent_pc" | "research" | "project";
  label: string;
  requiresHermes: boolean;
  purpose: "assistant" | "code" | "pc";
  confidence: number;
  reason: string;
};

type ModelFallback = {
  activated: boolean;
  fromProvider: string;
  fromModel: string;
  toProvider: string;
  toModel: string;
  reason: string;
};

type ModelManagerStatus = {
  selected: { provider: string; model: string };
  selectedValid: boolean;
  validationError?: string;
  openRouterReachable: boolean;
  ollamaReachable: boolean;
  ollamaModels: string[];
  configuredProviders: string[];
};

type SophenicAgentRouteCandidate = {
  provider: string;
  model: string;
  score: number;
  reason: string;
};

type SophenicAgentRoutePlan = {
  requestedProvider: string;
  requestedModel: string;
  provider: string;
  model: string;
  reasoningEffort: "minimal" | "low" | "medium" | "high";
  fallbacks: SophenicAgentRouteCandidate[];
  reviewers: SophenicAgentRouteCandidate[];
  orchestration: "single" | "review" | "deep";
  planSteps: string[];
  profile: { complexity: number; risk: number; skills: string[]; verificationRequired: boolean; parallelizable: boolean; qualityRequested: boolean; domain: "frontend" | "backend" | "desktop" | "mobile" | "data" | "devops" | "general"; languages: string[]; projectSize: "small" | "medium" | "large"; needsImages: boolean; needsResearch: boolean; needsTests: boolean; estimatedTokens: number; costSensitivity: "low" | "balanced" | "quality-first" };
  mode: "quick" | "auto" | "deep";
};

type ProviderSecretStatus = {
  id: string;
  name: string;
  role: string;
  keyCount: number;
  accountCount?: number;
  configured: boolean;
  requiresAccountId: boolean;
  accountIdConfigured: boolean;
  baseUrlConfigured: boolean;
  docsUrl: string;
  keyUrl: string;
  models: Array<{ id: string; name: string; context?: number }>;
};

type ProviderVaultInfo = {
  encrypted: boolean;
  path: string;
  providerCount: number;
  maxKeysPerProvider: number;
};

type ProviderCatalogItem = {
  id: string;
  name: string;
  role: string;
  docsUrl: string;
  keyUrl: string;
  requiresAccountId: boolean;
  supportsCustomBaseUrl: boolean;
  models: Array<{ id: string; name: string; context?: number }>;
};

type ProviderStatusResult = {
  providers: ProviderSecretStatus[];
  catalog?: ProviderCatalogItem[];
  vault: ProviderVaultInfo;
};


type ProviderImportResult = {
  canceled: boolean;
  fileName?: string;
  summaries?: Array<{ provider: string; name: string; imported: number; accountCount?: number }>;
  warnings?: string[];
  providers?: ProviderSecretStatus[];
  vault?: ProviderVaultInfo;
};

type OpenRouterModel = {
  id: string;
  name: string;
  contextLength?: number;
  free: boolean;
  promptPrice?: number;
  completionPrice?: number;
  inputModalities: string[];
  outputModalities: string[];
  supportedParameters: string[];
};

type OpenRouterImageModel = {
  id: string;
  name: string;
  description?: string;
  inputModalities: string[];
  outputModalities: string[];
  supportedParameters: string[];
  supportsStreaming: boolean;
  free: boolean;
};

type OpenRouterAccount = { isFreeTier: boolean; limit?: number; limitRemaining?: number; usage?: number };

type OpenRouterImage = { url: string; sourceUrl: string; title: string };
type SophenicPlaceResult = {
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  category?: string;
  type?: string;
  website?: string;
  phone?: string;
  openingHours?: string;
  sourceUrl: string;
  mapsUrl?: string;
  directionsUrl?: string;
};

type SophenicReferenceImage = { url: string; sourceUrl: string; title: string };

type OpenRouterChatResult = {
  content: string;
  model: string;
  provider: string;
  requestedProvider: string;
  requestedModel: string;
  fallback?: ModelFallback;
  attempts: Array<{ provider: string; model: string; status: "trying" | "success" | "failed"; reason?: string }>;
  agents?: Array<{ role: string; provider: string; model: string }>;
  usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number; costUsd?: number };
  contextMax?: number;
  images: OpenRouterImage[];
};


type IntegrationPermission = {
  id: string;
  name: string;
  description: string;
  category: string;
  kind: "capability" | "skill" | "plugin";
  enabled: boolean;
  connected?: boolean;
  requiresSetup?: boolean;
  source?: string;
  toolset?: string;
  scopes?: string[];
};
type OpenRouterGeneratedImageResult = {
  provider?: "xai" | "cloudflare" | "huggingface" | "gemini" | "openrouter";
  model: string;
  images: OpenRouterImage[];
  usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number; costUsd?: number };
};

declare global {
  interface Window {
    sophenicDesktop?: {
      isDesktop: true;
      platform: string;
      versions: { electron?: string; chromium?: string };
      runtime: {
        status(): Promise<DesktopRuntimeStatus>;
        setupStatus(): Promise<EngineSetupStatus>;
        ensureEngine(): Promise<EngineSetupStatus>;
        engineConfig(): Promise<EngineConfig>;
        modelSelection(): Promise<{ provider: string; model: string }>;
        routeIntent(prompt: string): Promise<SophenicIntentDecision>;
        searchPlaces(query: string): Promise<SophenicPlaceResult[]>;
        searchReferenceImages(query: string): Promise<SophenicReferenceImage[]>;
        webSearch(query: string, limit?: number): Promise<Array<{ title: string; url: string; snippet: string }>>;
        reviewCode(input: { prompt: string; candidates: Array<{ provider: string; model: string }> }): Promise<{ provider: string; model: string; content: string }>;
        rememberLanguage(prompt: string): Promise<EngineConfig>;
        tryNativePcAction(prompt: string): Promise<{ handled: boolean; ok?: boolean; message?: string; target?: string; verified?: boolean }>;
        executeAction(action: SophenicLocalAction): Promise<SophenicLocalActionResult>;
        modelManagerStatus(): Promise<ModelManagerStatus>;
        planAgentRoute(input: { prompt: string; purpose?: "pc" | "code" | "assistant"; provider?: string; model?: string; effortMode?: "quick" | "auto" | "deep" }): Promise<SophenicAgentRoutePlan>;
        providerStatus(): Promise<ProviderStatusResult>;
        reportAgentProviderFailure(provider: string, message: string): Promise<{ remainingReady: number; keyCount: number }>;
        saveProvider(input: { provider: string; keys?: string[]; accountId?: string; baseUrl?: string; mode?: "replace" | "append" }): Promise<{ providers: ProviderSecretStatus[]; vault: ProviderVaultInfo }>;
        clearProvider(provider: string): Promise<{ providers: ProviderSecretStatus[]; vault: ProviderVaultInfo }>;
        importProviderFile(): Promise<ProviderImportResult>;
        openProviderUrl(provider: string, kind?: "key" | "docs"): Promise<boolean>;
        configureOpenRouter(apiKey: string, model?: string): Promise<EngineConfig>;
        setDefaultModel(provider: string, model: string): Promise<EngineConfig>;
        setPersonalization(value: string): Promise<EngineConfig>;
        openOpenRouterKeys(): Promise<boolean>;
        startHermes(): Promise<DesktopRuntimeStatus>;
        stopHermes(): Promise<DesktopRuntimeStatus>;
        logs(): Promise<string[]>;
        chooseWorkspace(): Promise<CodeWorkspaceInfo | null>;
        chooseCodeFile(): Promise<CodeWorkspaceInfo | null>;
        createCodeWorkspace(prompt: string): Promise<CodeWorkspaceInfo>;
        recoverCodeCheckpoint(): Promise<CodeWorkspaceCheckpoint | null>;
        saveCodeCheckpoint(checkpoint: CodeWorkspaceCheckpoint): Promise<boolean>;
        clearCodeCheckpoint(workspace: string): Promise<boolean>;
        codeHandoff(input: { workspace: string; checkpoint?: CodeWorkspaceCheckpoint; targetFile?: string }): Promise<CodeWorkspaceHandoff>;
        openCodeWorkspace(workspace: string, targetFile?: string): Promise<boolean>;
        copyHermesInstallCommand(): Promise<string>;
        copyHermesModelCommand(): Promise<string>;
        openHermesWebsite(): Promise<boolean>;
        openOllamaDownload(): Promise<boolean>;
      };
      developerConnections: {
        status(): Promise<{
          connections: Array<{ provider: "github" | "vercel"; connected: boolean; username?: string; name?: string; accountId?: string; scopes: string[]; connectedAt?: string; expiresAt?: string }>;
          configuration: { port: number; github: { configured: boolean; callbackUrl: string }; vercel: { configured: boolean; mode?: "token" | "oauth"; callbackUrl: string } };
        }>;
        connect(provider: "github" | "vercel"): Promise<{
          connections: Array<{ provider: "github" | "vercel"; connected: boolean; username?: string; name?: string; accountId?: string; scopes: string[]; connectedAt?: string; expiresAt?: string }>;
          configuration: { port: number; github: { configured: boolean; callbackUrl: string }; vercel: { configured: boolean; mode?: "token" | "oauth"; callbackUrl: string } };
        }>;
        disconnect(provider: "github" | "vercel"): Promise<{
          connections: Array<{ provider: "github" | "vercel"; connected: boolean; username?: string; name?: string; accountId?: string; scopes: string[]; connectedAt?: string; expiresAt?: string }>;
          configuration: { port: number; github: { configured: boolean; callbackUrl: string }; vercel: { configured: boolean; mode?: "token" | "oauth"; callbackUrl: string } };
        }>;
        saveToken(provider: "github" | "vercel", token: string): Promise<{
          connections: Array<{ provider: "github" | "vercel"; connected: boolean; username?: string; name?: string; accountId?: string; scopes: string[]; connectedAt?: string; expiresAt?: string }>;
          configuration: { port: number; github: { configured: boolean; callbackUrl: string }; vercel: { configured: boolean; mode?: "token" | "oauth"; callbackUrl: string } };
        }>;
      };
      codeArtifacts: {
        save(artifact: CodeArtifactInfo): Promise<{ saved: boolean; path?: string }>;
        open(artifact: CodeArtifactInfo): Promise<boolean>;
        reveal(artifact: CodeArtifactInfo): Promise<boolean>;
      };
      code: {
        status(): Promise<{ installed: true; version: string; native: true; hermesRequired: false; status: "ready" }>;
        engines(force?: boolean): Promise<{
          claudeCode: { id: "claude-code"; name: string; installed: boolean; authenticated: boolean; functional: boolean; command?: string; version?: string; authLabel?: string; checkedAt: number; error?: string };
          codex: { id: "codex"; name: string; installed: boolean; authenticated: boolean; functional: boolean; command?: string; version?: string; authLabel?: string; checkedAt: number; error?: string };
          checkedAt: number;
        }>;
        run(input: { requestId: string; cwd: string; prompt: string; effortMode?: "quick" | "auto" | "deep" }): Promise<{ ok: true; text: string; sessionId: string; provider: string; model: string; fallbacks: Array<{ provider: string; model: string }>; version: string; changedFiles: string[]; verification: unknown; artifacts?: CodeArtifactInfo[] }>;
        abort(requestId?: string): Promise<boolean>;
        saveArtifact(artifact: { path: string; name: string }): Promise<{ saved: boolean; path?: string }>;
        openArtifact(artifact: { path: string; name: string }): Promise<boolean>;
        revealArtifact(artifact: { path: string; name: string }): Promise<boolean>;
        onEvent(listener: (event: { requestId: string; type: string; text?: string; message?: string; name?: string; provider?: string; model?: string; previousProvider?: string; previousModel?: string; reason?: string; input?: unknown; ok?: boolean; steps?: string[]; step?: number; profile?: SophenicAgentRoutePlan["profile"]; artifacts?: CodeArtifactInfo[] }) => void): () => void;
      };
      integrations: {
        list(): Promise<IntegrationPermission[]>;
        setPermission(id: string, enabled: boolean, scopes?: string[]): Promise<IntegrationPermission[]>;
        setupComputerUse(): Promise<{ ok: boolean; message: string }>;
        startGoogleOAuth(): Promise<{ canceled: boolean; authUrl?: string; message?: string }>;
        finishGoogleOAuth(redirectUrl: string): Promise<{ ok: boolean; message: string }>;
        openHermesDashboard(): Promise<boolean>;
      };
      openrouter: {
        models(force?: boolean): Promise<OpenRouterModel[]>;
        account(): Promise<OpenRouterAccount>;
        imageModels(force?: boolean): Promise<OpenRouterImageModel[]>;
        chat(input: { requestId: string; provider?: string; model: string; effortMode?: "quick" | "auto" | "deep"; messages: Array<{ role: "user" | "assistant"; content: string }> }): Promise<OpenRouterChatResult>;
        generateImage(input: { requestId: string; prompt: string; aspectRatio?: string; quality?: "auto" | "low" | "medium" | "high" }): Promise<OpenRouterGeneratedImageResult>;
        abort(requestId: string): Promise<boolean>;
        onStream(listener: (event: { requestId: string; text: string }) => void): () => void;
        onModelNotice(listener: (event: { requestId: string; notice: Record<string, unknown> }) => void): () => void;
      };
      agent: {
        rpc(method: string, params?: Record<string, unknown>): Promise<unknown>;
        createSession(input?: { cwd?: string; model?: string; provider?: string; purpose?: "pc" | "code" | "assistant" }): Promise<Record<string, unknown>>;
        switchModel(sessionId: string, model: string, provider?: string): Promise<unknown>;
        setApprovalMode(mode: "smart"): Promise<unknown>;
        setReasoningEffort(sessionId: string, effort: "none" | "minimal" | "low" | "medium" | "high"): Promise<unknown>;
        respondApproval(requestId: string, choice: "once" | "session" | "deny"): Promise<unknown>;
        respondClarify(requestId: string, answer: string): Promise<unknown>;
        respondSudo(requestId: string, password: string): Promise<unknown>;
        respondSecret(requestId: string, value: string): Promise<unknown>;
        onEvent(listener: (event: HermesGatewayEvent) => void): () => void;
      };
    };
  }
}
