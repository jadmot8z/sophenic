export type SophenicCloudProviderId =
  | "xai"
  | "groq"
  | "zai"
  | "gemini"
  | "cloudflare"
  | "siliconflow"
  | "openrouter"
  | "mistral"
  | "sambanova"
  | "cerebras"
  | "cohere"
  | "huggingface"
  | "aimlapi"
  | "nvidia"
  | "scaleway"
  | "alibaba";

export type SophenicSkill = "reasoning" | "coding" | "vision" | "documents" | "writing" | "research" | "tools" | "speed";

export type ProviderModelProfile = {
  id: string;
  name: string;
  context?: number;
  skills: Partial<Record<SophenicSkill, number>>;
  freeBias?: number;
};

export type ProviderProfile = {
  id: SophenicCloudProviderId;
  name: string;
  role: string;
  docsUrl: string;
  keyUrl: string;
  baseUrl: string;
  requiresAccountId?: boolean;
  supportsCustomBaseUrl?: boolean;
  defaultHeaders?: Record<string, string>;
  models: ProviderModelProfile[];
};

const model = (
  id: string,
  name: string,
  skills: Partial<Record<SophenicSkill, number>>,
  context?: number,
  freeBias = 75
): ProviderModelProfile => ({ id, name, skills, context, freeBias });

export const PROVIDER_REGISTRY: ProviderProfile[] = [
  {
    id: "xai",
    name: "xAI / Grok",
    role: "Priorité conversation simple · Grok · code et raisonnement",
    docsUrl: "https://docs.x.ai/",
    keyUrl: "https://console.x.ai/",
    baseUrl: "https://api.x.ai/v1",
    models: [
      model("grok-4.5", "Grok 4.5", { reasoning: 99, coding: 99, tools: 98, speed: 99, writing: 96, research: 94, vision: 96, documents: 93 }, 500_000, 92),
      model("grok-build-0.1", "Grok Build 0.1", { reasoning: 97, coding: 100, tools: 100, speed: 97, writing: 84, research: 90 }, 256_000, 88)
    ]
  },
  {
    id: "groq",
    name: "Groq",
    role: "Moteur rapide principal · raisonnement et code",
    docsUrl: "https://console.groq.com/docs/overview",
    keyUrl: "https://console.groq.com/keys",
    baseUrl: "https://api.groq.com/openai/v1",
    models: [
      model("openai/gpt-oss-120b", "GPT-OSS 120B", { reasoning: 98, coding: 95, tools: 95, speed: 100, writing: 86, research: 90 }, 131_072, 92),
      model("openai/gpt-oss-20b", "GPT-OSS 20B", { reasoning: 88, coding: 88, tools: 90, speed: 100, writing: 82, research: 84 }, 131_072, 95)
    ]
  },
  {
    id: "zai",
    name: "Z.AI",
    role: "Second cerveau · code, agents et multimodal",
    docsUrl: "https://docs.z.ai/guides/overview/quick-start",
    keyUrl: "https://z.ai/manage-apikey/apikey-list",
    baseUrl: "https://api.z.ai/api/paas/v4",
    defaultHeaders: { "Accept-Language": "en-US,en" },
    models: [
      model("glm-4.7-flash", "GLM-4.7 Flash", { reasoning: 94, coding: 96, tools: 93, research: 90, speed: 98, writing: 89 }, 200_000, 100),
      model("glm-4.6v-flash", "GLM-4.6V Flash", { vision: 99, coding: 92, reasoning: 92, documents: 97, tools: 92, speed: 94 }, 128_000, 100)
    ]
  },
  {
    id: "gemini",
    name: "Google Gemini",
    role: "Vision · documents · contexte long · multimodal",
    docsUrl: "https://ai.google.dev/gemini-api/docs/openai",
    keyUrl: "https://aistudio.google.com/app/apikey",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    models: [
      model("gemini-3.6-flash", "Gemini 3.6 Flash", { vision: 99, documents: 99, reasoning: 97, coding: 96, research: 95, speed: 96, writing: 94, tools: 96 }, 1_048_576, 94),
      model("gemini-3.1-flash-lite", "Gemini 3.1 Flash-Lite", { vision: 96, documents: 97, reasoning: 88, coding: 88, speed: 100, writing: 90, tools: 90 }, 1_048_576, 99)
    ]
  },
  {
    id: "cloudflare",
    name: "Cloudflare Workers AI",
    role: "Fallback quotidien · modèles OSS",
    docsUrl: "https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/",
    keyUrl: "https://dash.cloudflare.com/",
    baseUrl: "https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/v1",
    requiresAccountId: true,
    models: [
      model("@cf/openai/gpt-oss-120b", "GPT-OSS 120B", { reasoning: 96, coding: 94, tools: 92, speed: 90, writing: 87 }, 128_000, 94),
      model("@cf/zai-org/glm-4.7-flash", "GLM-4.7 Flash", { reasoning: 93, coding: 94, tools: 94, speed: 96, writing: 89, research: 88 }, 131_072, 98),
      model("@cf/moonshotai/kimi-k2.7-code", "Kimi K2.7 Code", { reasoning: 97, coding: 99, vision: 94, tools: 98, research: 93, documents: 92, speed: 72 }, 262_144, 38)
    ]
  },
  {
    id: "siliconflow",
    name: "SiliconFlow",
    role: "Diversité DeepSeek / Qwen · secours code et reasoning",
    docsUrl: "https://docs.siliconflow.com/en/userguide/quickstart",
    keyUrl: "https://cloud.siliconflow.com/account/ak",
    baseUrl: "https://api.siliconflow.com/v1",
    models: [
      model("Qwen/Qwen3-32B", "Qwen3 32B", { reasoning: 92, coding: 92, tools: 88, speed: 89, writing: 86 }, 131_072, 92),
      model("deepseek-ai/DeepSeek-V3", "DeepSeek V3", { reasoning: 95, coding: 96, tools: 89, writing: 88 }, 128_000, 88)
    ]
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    role: "Super-fallback · catalogue dynamique",
    docsUrl: "https://openrouter.ai/docs/quickstart",
    keyUrl: "https://openrouter.ai/settings/keys",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultHeaders: { "X-Title": "Sophenic", "HTTP-Referer": "https://sophenic.com" },
    models: [
      model("openrouter/free", "OpenRouter Free Router", { reasoning: 82, coding: 82, vision: 70, documents: 80, writing: 84, research: 82, tools: 75, speed: 78 }, 200_000, 100),
      model("openai/gpt-oss-120b:free", "GPT-OSS 120B Free", { reasoning: 96, coding: 94, tools: 90, speed: 82, writing: 86 }, 131_072, 98)
    ]
  },
  {
    id: "mistral",
    name: "Mistral",
    role: "Généraliste européen · code et outils",
    docsUrl: "https://docs.mistral.ai/api/endpoint/chat",
    keyUrl: "https://console.mistral.ai/",
    baseUrl: "https://api.mistral.ai/v1",
    models: [
      model("mistral-small-latest", "Mistral Small", { reasoning: 88, coding: 88, tools: 94, speed: 94, writing: 91, research: 86 }, 128_000, 92),
      model("codestral-latest", "Codestral", { coding: 97, reasoning: 89, tools: 91, speed: 91, writing: 78 }, 128_000, 88)
    ]
  },
  {
    id: "sambanova",
    name: "SambaNova",
    role: "Réserve de gros modèles",
    docsUrl: "https://docs.sambanova.ai/docs/en/get-started/api-keys-urls",
    keyUrl: "https://cloud.sambanova.ai/",
    baseUrl: "https://api.sambanova.ai/v1",
    models: [
      model("gpt-oss-120b", "GPT-OSS 120B", { reasoning: 96, coding: 94, tools: 89, speed: 93, writing: 85 }, 131_072, 88),
      model("Meta-Llama-3.3-70B-Instruct", "Llama 3.3 70B", { reasoning: 88, coding: 85, writing: 91, speed: 89 }, 128_000, 84)
    ]
  },
  {
    id: "cerebras",
    name: "Cerebras",
    role: "Accélérateur GPT-OSS · très faible latence",
    docsUrl: "https://inference-docs.cerebras.ai/resources/openai",
    keyUrl: "https://cloud.cerebras.ai/",
    baseUrl: "https://api.cerebras.ai/v1",
    models: [
      model("gpt-oss-120b", "GPT-OSS 120B", { reasoning: 97, coding: 95, tools: 92, speed: 100, writing: 87, documents: 91 }, 131_072, 96)
    ]
  },
  {
    id: "cohere",
    name: "Cohere",
    role: "Documents · RAG · recherche · rerank",
    docsUrl: "https://docs.cohere.com/docs/compatibility-api",
    keyUrl: "https://dashboard.cohere.com/api-keys",
    baseUrl: "https://api.cohere.ai/compatibility/v1",
    models: [
      model("command-a-plus-05-2026", "Command A Plus", { documents: 98, research: 97, writing: 94, reasoning: 89, tools: 93, coding: 81 }, 256_000, 80)
    ]
  },
  {
    id: "huggingface",
    name: "Hugging Face",
    role: "Modèles spécialisés · dernier fallback",
    docsUrl: "https://huggingface.co/docs/inference-providers/index",
    keyUrl: "https://huggingface.co/settings/tokens",
    baseUrl: "https://router.huggingface.co/v1",
    models: [
      model("openai/gpt-oss-120b:fastest", "GPT-OSS 120B (fastest provider)", { reasoning: 96, coding: 94, research: 90, tools: 88, speed: 86 }, 131_072, 62)
    ]
  },
  {
    id: "aimlapi",
    name: "AI/ML API",
    role: "Catalogue unifié externe · réserve faible priorité",
    docsUrl: "https://docs.aimlapi.com/quickstart/supported-sdks",
    keyUrl: "https://aimlapi.com/app/keys",
    baseUrl: "https://api.aimlapi.com/v1",
    models: [
      model("google/gemma-3-4b-it", "Gemma 3 4B", { reasoning: 76, coding: 72, writing: 80, speed: 91, tools: 70 }, 32_000, 30)
    ]
  },
  {
    id: "nvidia",
    name: "NVIDIA NIM",
    role: "Modèles spécialisés · Nemotron · expérimentation",
    docsUrl: "https://docs.api.nvidia.com/nim/reference/llm-apis",
    keyUrl: "https://build.nvidia.com/settings/api-keys",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    models: [
      model("nvidia/nemotron-3-super-120b-a12b", "Nemotron 3 Super 120B", { reasoning: 97, coding: 94, tools: 95, research: 94, writing: 90 }, 262_144, 72),
      model("openai/gpt-oss-120b", "GPT-OSS 120B", { reasoning: 96, coding: 94, tools: 91, speed: 85 }, 131_072, 72),
      model("moonshotai/kimi-k2.5", "Kimi K2.5", { reasoning: 97, coding: 97, vision: 94, documents: 92, tools: 97, research: 94 }, 262_144, 70)
    ]
  },
  {
    id: "scaleway",
    name: "Scaleway Generative APIs",
    role: "Réserve européenne · GPT-OSS",
    docsUrl: "https://www.scaleway.com/en/docs/generative-apis/reference-content/openai-compatibility/",
    keyUrl: "https://console.scaleway.com/",
    baseUrl: "https://api.scaleway.ai/v1",
    supportsCustomBaseUrl: true,
    models: [
      model("gpt-oss-120b", "GPT-OSS 120B", { reasoning: 96, coding: 94, tools: 90, speed: 86, writing: 86 }, 131_072, 88)
    ]
  },
  {
    id: "alibaba",
    name: "Alibaba Model Studio / Qwen",
    role: "Code · vision · OCR · multimodal",
    docsUrl: "https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope",
    keyUrl: "https://www.alibabacloud.com/help/en/model-studio/get-api-key",
    baseUrl: "https://dashscope-us.aliyuncs.com/compatible-mode/v1",
    supportsCustomBaseUrl: true,
    models: [
      model("qwen3.7-plus", "Qwen 3.7 Plus", { reasoning: 97, coding: 98, vision: 96, documents: 97, tools: 96, writing: 92, research: 93 }, 1_000_000, 88),
      model("qwen3-vl-plus", "Qwen3 VL Plus", { vision: 99, documents: 97, coding: 92, reasoning: 93, tools: 91 }, 262_144, 84)
    ]
  }
];

const index = new Map(PROVIDER_REGISTRY.map((entry) => [entry.id, entry] as const));

export function providerProfile(id: string): ProviderProfile | undefined {
  return index.get(id.trim().toLowerCase() as SophenicCloudProviderId);
}

export function isCloudProvider(id: string): id is SophenicCloudProviderId {
  return index.has(id.trim().toLowerCase() as SophenicCloudProviderId);
}

export function publicProviderCatalog() {
  return PROVIDER_REGISTRY.map((entry) => ({
    id: entry.id,
    name: entry.name,
    role: entry.role,
    docsUrl: entry.docsUrl,
    keyUrl: entry.keyUrl,
    requiresAccountId: Boolean(entry.requiresAccountId),
    supportsCustomBaseUrl: Boolean(entry.supportsCustomBaseUrl),
    models: entry.models.map((item) => ({ id: item.id, name: item.name, context: item.context }))
  }));
}
