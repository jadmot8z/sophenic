import { inspectModelSelection, type ModelSelection } from "./config";
import {
  chatWithOpenRouter,
  getOpenRouterAccountInfo,
  isOpenRouterAvailabilityError,
  listOpenRouterModels,
  type OpenRouterChatMessage,
  type OpenRouterChatResult,
  type OpenRouterModel
} from "./openrouter";
import { chatWithLocalOllamaModel, inspectOllama, ollamaThinkingSetting } from "./ollama";
import { chatWithSophenicBrain, type SophenicEffortMode } from "./sophenic-brain";
import { chatWithCloudProvider } from "./provider-client";
import { configuredProviderIds } from "./provider-secrets";
import { isCloudProvider, providerProfile, type SophenicCloudProviderId } from "./provider-registry";

export type SophenicProvider = "sophenic" | "openrouter" | "ollama" | SophenicCloudProviderId;

export type ModelAttempt = {
  provider: SophenicProvider;
  model: string;
  status: "trying" | "success" | "failed";
  reason?: string;
};

export type ModelFallback = {
  activated: boolean;
  fromProvider: string;
  fromModel: string;
  toProvider: string;
  toModel: string;
  reason: string;
};

export type ManagedChatResult = OpenRouterChatResult & {
  provider: SophenicProvider;
  requestedProvider: string;
  requestedModel: string;
  fallback?: ModelFallback;
  attempts: ModelAttempt[];
  agents?: Array<{ role: string; provider: string; model: string }>;
};

export type ModelManagerNotice = {
  type: "attempt" | "fallback" | "selected" | "failed" | "reasoning" | "brain" | "agent";
  provider: string;
  model: string;
  previousProvider?: string;
  previousModel?: string;
  reason?: string;
  reasoningEffort?: string;
};

function cleanProvider(value: string): SophenicProvider {
  const clean = value.trim().toLowerCase();
  if (clean === "sophenic") return "sophenic";
  if (clean === "ollama") return "ollama";
  if (isCloudProvider(clean)) return clean;
  return "openrouter";
}

function stripOllamaPrefix(value: string): string {
  return value.trim().replace(/^ollama\//i, "");
}

function scoreOpenRouterFallback(model: OpenRouterModel): number {
  const text = `${model.id} ${model.name}`.toLowerCase();
  const rules: Array<[RegExp, number]> = [
    [/nemotron.*ultra/, 1000],
    [/qwen.*coder/, 970],
    [/deepseek.*coder|deepseek.*v3|deepseek.*r1/, 950],
    [/glm/, 900],
    [/gpt[- ]oss.*120b/, 880],
    [/mistral|codestral/, 850],
    [/llama/, 800]
  ];
  const ruleScore = rules.reduce((score, [pattern, value]) => Math.max(score, pattern.test(text) ? value : 0), 0);
  const tools = model.supportedParameters.some((parameter) => /^(tools?|tool_choice)$/i.test(parameter)) ? 120 : 0;
  return ruleScore + tools + Math.min(100, Math.round((model.contextLength || 0) / 10_000));
}

function openRouterFallbackOrder(models: OpenRouterModel[], requested: string, allowPaid: boolean): OpenRouterModel[] {
  const eligible = models.filter((item) => item.id !== requested && item.id !== "openrouter/free");
  const free = eligible.filter((item) => item.free).sort((a, b) => scoreOpenRouterFallback(b) - scoreOpenRouterFallback(a));
  const paid = allowPaid ? eligible.filter((item) => !item.free).sort((a, b) => scoreOpenRouterFallback(b) - scoreOpenRouterFallback(a)) : [];
  const freeRouter = models.find((item) => item.id === "openrouter/free" && item.id !== requested);
  return [...free.slice(0, 4), ...(freeRouter ? [freeRouter] : []), ...paid.slice(0, 2)];
}

function reasonText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || "Erreur inconnue");
  return raw.replace(/^Error:\s*/i, "").slice(0, 600);
}

export async function validateModelSelection(provider: string, model: string): Promise<ModelSelection> {
  const clean = cleanProvider(provider);
  const requested = model.trim();
  if (!requested) throw new Error("Le nom du modèle est vide.");

  if (clean === "sophenic") {
    if (!["auto", "quick", "deep"].includes(requested.toLowerCase())) throw new Error("Mode Sophenic invalide.");
    const local = await inspectOllama().catch(() => null);
    if (!configuredProviderIds().length && local?.state !== "ready") throw new Error("Aucun fournisseur IA Sophenic ni modèle Ollama local n’est disponible.");
    return { provider: "sophenic", model: "auto" };
  }

  if (clean === "ollama") {
    const status = await inspectOllama();
    if (status.state !== "ready") throw new Error("Ollama n’est pas disponible sur cet ordinateur.");
    const exact = stripOllamaPrefix(requested);
    if (!status.models.some((item) => item.model === exact || item.name === exact)) {
      throw new Error(`Le modèle Ollama « ${exact} » n’est pas installé.`);
    }
    return { provider: "ollama", model: exact };
  }

  if (clean !== "openrouter" && isCloudProvider(clean)) {
    const profile = providerProfile(clean);
    if (!profile?.models.some((item) => item.id === requested)) throw new Error(`Le modèle ${requested} n’est pas enregistré pour ${profile?.name || clean}.`);
    if (!configuredProviderIds().includes(clean)) throw new Error(`${profile?.name || clean} n’est pas configuré dans le coffre Sophenic.`);
    return { provider: clean, model: requested };
  }

  if (!configuredProviderIds().includes("openrouter")) throw new Error("OpenRouter n’est pas configuré dans le coffre Sophenic.");
  const models = await listOpenRouterModels(true);
  if (!models.some((item) => item.id === requested)) {
    throw new Error(`Le modèle OpenRouter « ${requested} » n’existe pas ou n’est plus disponible.`);
  }
  return { provider: "openrouter", model: requested };
}

export async function modelManagerStatus(): Promise<{
  selected: ModelSelection;
  selectedValid: boolean;
  validationError?: string;
  openRouterReachable: boolean;
  ollamaReachable: boolean;
  ollamaModels: string[];
  configuredProviders: string[];
}> {
  const selected = inspectModelSelection();
  const [openRouterResult, ollama] = await Promise.all([
    listOpenRouterModels().then((models) => ({ reachable: true, models })).catch(() => ({ reachable: false, models: [] as OpenRouterModel[] })),
    inspectOllama()
  ]);
  let selectedValid = false;
  let validationError = "";
  const selectedProvider = cleanProvider(selected.provider);
  const configuredProviders = configuredProviderIds();
  if (selectedProvider === "sophenic") {
    selectedValid = configuredProviders.length > 0 || ollama.state === "ready";
    if (!selectedValid) validationError = "Ajoute au moins une clé dans Fournisseurs IA ou démarre Ollama avec un modèle local.";
  } else if (selectedProvider === "ollama") {
    const exact = stripOllamaPrefix(selected.model);
    selectedValid = ollama.state === "ready" && ollama.models.some((item) => item.model === exact || item.name === exact);
    if (!selectedValid) validationError = ollama.state === "ready" ? `Le modèle Ollama « ${exact} » n’est pas installé.` : "Ollama est indisponible.";
  } else if (selectedProvider !== "openrouter" && isCloudProvider(selectedProvider)) {
    const profile = providerProfile(selectedProvider);
    selectedValid = configuredProviders.includes(selectedProvider) && Boolean(profile?.models.some((item) => item.id === selected.model));
    if (!selectedValid) validationError = `${profile?.name || selectedProvider} n’est pas configuré ou le modèle n’est pas enregistré.`;
  } else {
    selectedValid = openRouterResult.reachable && openRouterResult.models.some((item) => item.id === selected.model);
    if (!selectedValid) validationError = openRouterResult.reachable ? `Le modèle OpenRouter « ${selected.model} » n’est pas disponible.` : "OpenRouter est actuellement inaccessible.";
  }
  return {
    selected,
    selectedValid,
    ...(validationError ? { validationError } : {}),
    openRouterReachable: openRouterResult.reachable,
    ollamaReachable: ollama.state === "ready" && ollama.models.length > 0,
    ollamaModels: ollama.models.map((item) => item.model),
    configuredProviders
  };
}

export async function chatWithModelManager(input: {
  provider?: string;
  model: string;
  messages: OpenRouterChatMessage[];
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
  onNotice?: (notice: ModelManagerNotice) => void;
  effortMode?: SophenicEffortMode;
}): Promise<ManagedChatResult> {
  const requestedProvider = cleanProvider(input.provider || "sophenic");
  const requestedModel = input.model.trim() || (requestedProvider === "ollama" ? "" : requestedProvider === "sophenic" ? "auto" : "openrouter/free");
  const attempts: ModelAttempt[] = [];

  if (requestedProvider === "sophenic") {
    const result = await chatWithSophenicBrain({
      messages: input.messages,
      mode: input.effortMode || "auto",
      signal: input.signal,
      onDelta: input.onDelta,
      onNotice: (notice) => input.onNotice?.({
        type: notice.type as ModelManagerNotice["type"],
        provider: notice.provider,
        model: notice.model,
        previousProvider: notice.previousProvider,
        previousModel: notice.previousModel,
        reason: notice.reason || notice.detail,
        reasoningEffort: notice.reasoningEffort
      })
    });
    const mappedAttempts: ModelAttempt[] = result.attempts.map((item) => ({ ...item, provider: cleanProvider(item.provider) }));
    const firstFailure = mappedAttempts.find((attempt) => attempt.status === "failed");
    return {
      content: result.content,
      model: result.model,
      usage: result.usage,
      contextMax: result.contextMax,
      images: result.images,
      provider: result.provider,
      requestedProvider: "sophenic",
      requestedModel: input.effortMode || "auto",
      attempts: mappedAttempts,
      agents: result.agents,
      ...(firstFailure ? {
        fallback: {
          activated: true,
          fromProvider: firstFailure.provider,
          fromModel: firstFailure.model,
          toProvider: result.provider,
          toModel: result.model,
          reason: firstFailure.reason || "Une route précédente a échoué ; Sophenic a poursuivi automatiquement."
        }
      } : {})
    };
  }

  if (requestedProvider !== "openrouter" && requestedProvider !== "ollama" && isCloudProvider(requestedProvider)) {
    const result = await chatWithCloudProvider({ provider: requestedProvider, model: requestedModel, messages: input.messages, signal: input.signal, stream: true, onDelta: input.onDelta });
    return { ...result, provider: requestedProvider, requestedProvider, requestedModel, attempts: [{ provider: requestedProvider, model: result.model, status: "success" }] };
  }
  let firstFailure = "";
  let previousProvider: SophenicProvider = requestedProvider;
  let previousModel = requestedModel;

  const emitAttempt = (provider: SophenicProvider, model: string) => {
    attempts.push({ provider, model, status: "trying" });
    input.onNotice?.({ type: "attempt", provider, model });
  };
  const markSuccess = (provider: SophenicProvider, model: string) => {
    const last = attempts[attempts.length - 1];
    if (last && last.provider === provider && last.model === model) last.status = "success";
    input.onNotice?.({ type: "selected", provider, model });
  };
  const markFailure = (provider: SophenicProvider, model: string, error: unknown) => {
    const reason = reasonText(error);
    const last = attempts[attempts.length - 1];
    if (last && last.provider === provider && last.model === model) {
      last.status = "failed";
      last.reason = reason;
    }
    if (!firstFailure) firstFailure = reason;
    input.onNotice?.({ type: "failed", provider, model, reason });
    return reason;
  };
  const emitFallback = (provider: SophenicProvider, model: string, reason: string) => {
    input.onNotice?.({
      type: "fallback",
      provider,
      model,
      previousProvider,
      previousModel,
      reason
    });
    previousProvider = provider;
    previousModel = model;
  };

  let openRouterModels: OpenRouterModel[] = [];
  let allowPaid = false;
  if (requestedProvider === "openrouter") {
    try {
      openRouterModels = await listOpenRouterModels();
      allowPaid = !(await getOpenRouterAccountInfo().catch(() => ({ isFreeTier: true }))).isFreeTier;
    } catch {
      // A network failure is handled by the exact request and Ollama fallback below.
    }
  }

  const openRouterCandidates: string[] = [];
  if (requestedProvider === "openrouter") {
    openRouterCandidates.push(requestedModel || "openrouter/free");
    for (const item of openRouterFallbackOrder(openRouterModels, requestedModel, allowPaid)) {
      if (!openRouterCandidates.includes(item.id)) openRouterCandidates.push(item.id);
    }
  }

  let lastError: unknown = null;
  for (let index = 0; index < openRouterCandidates.length; index += 1) {
    const candidate = openRouterCandidates[index];
    let emitted = false;
    if (index > 0) emitFallback("openrouter", candidate, firstFailure || "Le modèle précédent est indisponible.");
    emitAttempt("openrouter", candidate);
    try {
      const result = await chatWithOpenRouter({
        model: candidate,
        messages: input.messages,
        signal: input.signal,
        onDelta: (text) => {
          emitted = emitted || Boolean(text);
          input.onDelta?.(text);
        },
        onReasoningConfigured: (effort) => input.onNotice?.({ type: "reasoning", provider: "openrouter", model: candidate, reasoningEffort: effort })
      });
      markSuccess("openrouter", result.model || candidate);
      return {
        ...result,
        provider: "openrouter",
        requestedProvider,
        requestedModel,
        attempts,
        ...(result.model !== requestedModel || candidate !== requestedModel ? {
          fallback: {
            activated: true,
            fromProvider: requestedProvider,
            fromModel: requestedModel,
            toProvider: "openrouter",
            toModel: result.model || candidate,
            reason: firstFailure || "Le modèle demandé n’était pas disponible."
          }
        } : {})
      };
    } catch (error) {
      lastError = error;
      const reason = markFailure("openrouter", candidate, error);
      // Once the user has seen streamed text, retrying another model would duplicate
      // or contradict the visible response. Stop and surface the failure instead.
      if (emitted || !isOpenRouterAvailabilityError(error)) throw error;
      if (!firstFailure) firstFailure = reason;
    }
  }

  const ollama = await inspectOllama();
  const localCandidates = ollama.state === "ready" ? ollama.models.map((item) => item.model).slice(0, 4) : [];
  if (requestedProvider === "ollama") {
    const exact = stripOllamaPrefix(requestedModel);
    const ordered = [exact, ...localCandidates.filter((item) => item !== exact)].filter(Boolean);
    localCandidates.splice(0, localCandidates.length, ...ordered);
  }

  for (let index = 0; index < localCandidates.length; index += 1) {
    const candidate = localCandidates[index];
    const reason = firstFailure || (requestedProvider === "ollama" ? "Le modèle local demandé est indisponible." : "OpenRouter est indisponible.");
    if (requestedProvider !== "ollama" || index > 0) emitFallback("ollama", candidate, reason);
    emitAttempt("ollama", candidate);
    let emitted = false;
    try {
      const localThinking = ollamaThinkingSetting(candidate);
      if (localThinking) input.onNotice?.({ type: "reasoning", provider: "ollama", model: candidate, reasoningEffort: localThinking === true ? "enabled" : localThinking });
      const result = await chatWithLocalOllamaModel({ model: candidate, messages: input.messages, signal: input.signal, onDelta: (text) => { emitted = emitted || Boolean(text); input.onDelta?.(text); } });
      markSuccess("ollama", candidate);
      return {
        content: result.content,
        model: result.model,
        usage: result.usage,
        contextMax: undefined,
        images: [],
        provider: "ollama",
        requestedProvider,
        requestedModel,
        attempts,
        ...((requestedProvider !== "ollama" || stripOllamaPrefix(requestedModel) !== candidate) ? {
          fallback: {
            activated: true,
            fromProvider: requestedProvider,
            fromModel: requestedModel,
            toProvider: "ollama",
            toModel: candidate,
            reason
          }
        } : {})
      };
    } catch (error) {
      lastError = error;
      markFailure("ollama", candidate, error);
      if (emitted) throw error;
    }
  }

  // When the user explicitly selected Ollama, keep the local rotation first.
  // If every local model fails and OpenRouter is reachable, continue with an
  // explicit, user-visible provider fallback instead of changing silently.
  if (requestedProvider === "ollama") {
    try {
      const models = openRouterModels.length ? openRouterModels : await listOpenRouterModels();
      const account = await getOpenRouterAccountInfo().catch(() => ({ isFreeTier: true }));
      const candidates = openRouterFallbackOrder(models, "", !account.isFreeTier);
      for (const item of candidates) {
        const reason = firstFailure || "Les modèles Ollama locaux sont indisponibles.";
        emitFallback("openrouter", item.id, reason);
        emitAttempt("openrouter", item.id);
        let emitted = false;
        try {
          const result = await chatWithOpenRouter({
            model: item.id,
            messages: input.messages,
            signal: input.signal,
            onDelta: (text) => { emitted = emitted || Boolean(text); input.onDelta?.(text); },
            onReasoningConfigured: (effort) => input.onNotice?.({ type: "reasoning", provider: "openrouter", model: item.id, reasoningEffort: effort })
          });
          markSuccess("openrouter", result.model || item.id);
          return {
            ...result,
            provider: "openrouter",
            requestedProvider,
            requestedModel,
            attempts,
            fallback: {
              activated: true,
              fromProvider: requestedProvider,
              fromModel: requestedModel,
              toProvider: "openrouter",
              toModel: result.model || item.id,
              reason
            }
          };
        } catch (error) {
          lastError = error;
          markFailure("openrouter", item.id, error);
          if (emitted) throw error;
        }
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Aucun modèle IA disponible. Vérifie OpenRouter ou démarre Ollama avec un modèle local.");
}
