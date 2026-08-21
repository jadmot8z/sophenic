import crypto from "node:crypto";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { anthropicRequestToBrainMessages, anthropicResponseToSse, anthropicToOpenAIChat, estimateAnthropicInputTokens, openAIToAnthropic } from "./anthropic-compat";
import { requestOllamaChatCompletion } from "./ollama";
import { requestCloudProviderChatCompletion } from "./provider-client";
import { planSophenicAgentRoute, type BrainAgentCandidate, type BrainAgentPlan, type SophenicEffortMode } from "./sophenic-brain";
import type { OpenRouterChatMessage } from "./openrouter";

type JsonRecord = Record<string, unknown>;

export type ClaudeGatewayRouteEvent = {
  type: "route" | "fallback" | "error";
  provider: string;
  model: string;
  previousProvider?: string;
  previousModel?: string;
  reason?: string;
};

export type ClaudeGatewayInfo = {
  running: boolean;
  port?: number;
  baseUrl?: string;
  model: "sophenic-auto";
};

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error || "Erreur inconnue")).replace(/\s+/g, " ").trim().slice(0, 1000);
}

async function readJson(req: IncomingMessage, maxBytes = 32 * 1024 * 1024): Promise<JsonRecord> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new Error("Requête Claude Code trop volumineuse.");
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return {};
  const parsed = JSON.parse(text) as unknown;
  return record(parsed);
}

function json(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

function anthropicError(res: ServerResponse, status: number, message: string): void {
  json(res, status, { type: "error", error: { type: status === 400 ? "invalid_request_error" : "api_error", message } });
}

function uniqueCandidates(plan: BrainAgentPlan): BrainAgentCandidate[] {
  const seen = new Set<string>();
  return [plan.primary, ...plan.fallbacks].filter((candidate) => {
    const key = `${candidate.provider}:${candidate.model}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export class SophenicClaudeCodeGateway {
  private server: http.Server | null = null;
  private token = "";
  private port = 0;
  private mode: SophenicEffortMode = "auto";
  private plan: BrainAgentPlan | null = null;
  private candidates: BrainAgentCandidate[] = [];
  private lastSuccessful: BrainAgentCandidate | null = null;
  private listeners = new Set<(event: ClaudeGatewayRouteEvent) => void>();

  onRoute(listener: (event: ClaudeGatewayRouteEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: ClaudeGatewayRouteEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  inspect(): ClaudeGatewayInfo {
    return this.server && this.port
      ? { running: true, port: this.port, baseUrl: `http://127.0.0.1:${this.port}`, model: "sophenic-auto" }
      : { running: false, model: "sophenic-auto" };
  }

  credentials(): { baseUrl: string; token: string; model: "sophenic-auto" } {
    if (!this.server || !this.port || !this.token) throw new Error("La passerelle Claude Code Sophenic n’est pas démarrée.");
    return { baseUrl: `http://127.0.0.1:${this.port}`, token: this.token, model: "sophenic-auto" };
  }

  async prepareTask(prompt: string, mode: SophenicEffortMode = "auto"): Promise<BrainAgentPlan> {
    this.mode = mode;
    this.plan = await planSophenicAgentRoute({ messages: [{ role: "user", content: `Sophenic Code agent task. Coding and tool use are required when appropriate.\n\n${prompt}` }], mode });
    this.candidates = uniqueCandidates(this.plan);
    this.emit({ type: "route", provider: this.plan.primary.provider, model: this.plan.primary.model, reason: this.plan.primary.reason });
    return this.plan;
  }

  clearTask(): void {
    this.plan = null;
    this.candidates = [];
    this.lastSuccessful = null;
    this.mode = "auto";
  }

  resolvedRoute(): BrainAgentCandidate | null {
    return this.lastSuccessful ? { ...this.lastSuccessful } : null;
  }

  async start(): Promise<ClaudeGatewayInfo> {
    if (this.server && this.port) return this.inspect();
    this.token = crypto.randomBytes(32).toString("hex");
    const server = http.createServer((req, res) => { void this.handle(req, res); });
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Impossible d’allouer un port local pour Claude Code.");
    this.port = address.port;
    return this.inspect();
  }

  stop(): void {
    const server = this.server;
    this.server = null;
    this.port = 0;
    this.token = "";
    this.clearTask();
    if (server) server.close();
  }

  private authorized(req: IncomingMessage): boolean {
    const auth = String(req.headers.authorization || "");
    const apiKey = String(req.headers["x-api-key"] || "");
    return auth === `Bearer ${this.token}` || apiKey === this.token;
  }

  private async activeRoute(body: JsonRecord): Promise<BrainAgentCandidate[]> {
    if (this.candidates.length) return [...this.candidates];
    const messages = anthropicRequestToBrainMessages(body);
    const brainMessages: OpenRouterChatMessage[] = messages.length ? messages : [{ role: "user", content: "Sophenic Code agent task" }];
    const plan = await planSophenicAgentRoute({ messages: brainMessages, mode: this.mode });
    this.plan = plan;
    this.candidates = uniqueCandidates(plan);
    return [...this.candidates];
  }

  private async complete(body: JsonRecord): Promise<ReturnType<typeof openAIToAnthropic>> {
    const candidates = await this.activeRoute(body);
    let previous: BrainAgentCandidate | null = null;
    let lastError: unknown = null;

    for (const candidate of candidates) {
      try {
        if (previous) this.emit({ type: "fallback", provider: candidate.provider, model: candidate.model, previousProvider: previous.provider, previousModel: previous.model, reason: errorText(lastError) });
        const openAI = anthropicToOpenAIChat(body, candidate.model);
        const payload = candidate.provider === "ollama"
          ? await requestOllamaChatCompletion({ model: candidate.model, body: openAI })
          : (await requestCloudProviderChatCompletion({ provider: candidate.provider, model: candidate.model, body: openAI })).payload;
        const result = openAIToAnthropic(payload, "sophenic-auto");
        // Keep the successful route first for the rest of the current Claude Code turn.
        this.lastSuccessful = candidate;
        this.candidates = [candidate, ...candidates.filter((item) => item !== candidate)];
        this.emit({ type: "route", provider: candidate.provider, model: candidate.model, reason: candidate.reason });
        return result;
      } catch (cause) {
        lastError = cause;
        previous = candidate;
        this.emit({ type: "error", provider: candidate.provider, model: candidate.model, reason: errorText(cause) });
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Aucun moteur Sophenic n’a pu répondre à Claude Code.");
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const method = req.method || "GET";
      const url = new URL(req.url || "/", `http://127.0.0.1:${this.port || 80}`);
      if (method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
        json(res, 200, { status: "ok", service: "sophenic-claude-code-gateway", model: "sophenic-auto" });
        return;
      }
      if (!this.authorized(req)) {
        anthropicError(res, 401, "Authentification locale Sophenic refusée.");
        return;
      }
      if (method === "GET" && url.pathname === "/v1/models") {
        json(res, 200, {
          data: [{ type: "model", id: "sophenic-auto", display_name: "Sophenic Auto", created_at: "2026-08-18T00:00:00Z" }],
          has_more: false,
          first_id: "sophenic-auto",
          last_id: "sophenic-auto"
        });
        return;
      }
      if (method === "POST" && url.pathname === "/v1/messages/count_tokens") {
        const body = await readJson(req);
        json(res, 200, { input_tokens: estimateAnthropicInputTokens(body) });
        return;
      }
      if (method === "POST" && url.pathname === "/v1/messages") {
        const body = await readJson(req);
        const response = await this.complete(body);
        if (body.stream === true) {
          const payload = anthropicResponseToSse(response);
          res.writeHead(200, {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive"
          });
          res.end(payload);
        } else {
          json(res, 200, response);
        }
        return;
      }
      anthropicError(res, 404, `Route locale inconnue: ${method} ${url.pathname}`);
    } catch (cause) {
      anthropicError(res, 500, errorText(cause));
    }
  }
}
