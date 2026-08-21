import WebSocket from "ws";
import type { HermesGatewayEvent } from "./types";

type Pending = { resolve: (value: unknown) => void; reject: (reason?: unknown) => void; timer: NodeJS.Timeout };

// Renderer-facing allowlist. Mutating configuration and arbitrary slash commands
// are intentionally NOT exposed here; main.ts wraps those operations with
// dedicated validation instead.
const EXPOSED_METHODS = new Set([
  "session.create",
  "session.list",
  "session.resume",
  "session.history",
  "session.status",
  "session.usage",
  "session.interrupt",
  "session.close",
  "prompt.submit",
  "session.steer",
  "model.options",
  "setup.status",
  "setup.runtime_check"
]);

export class HermesGatewayClient {
  private socket: WebSocket | null = null;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private listeners = new Set<(event: HermesGatewayEvent) => void>();

  onEvent(listener: (event: HermesGatewayEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async connect(port: number, token: string): Promise<void> {
    this.close();
    const url = `ws://127.0.0.1:${port}/api/ws?token=${encodeURIComponent(token)}`;
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url, { handshakeTimeout: 12_000 });
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        ws.terminate();
        reject(new Error("Délai dépassé lors de la connexion au service IA local"));
      }, 15_000);
      ws.once("open", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.socket = ws;
        resolve();
      });
      ws.once("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
      ws.on("message", (raw) => this.handleMessage(raw.toString()));
      ws.on("close", () => {
        if (this.socket === ws) this.socket = null;
        for (const [, pending] of this.pending) {
          clearTimeout(pending.timer);
          pending.reject(new Error("Service IA local déconnecté"));
        }
        this.pending.clear();
        this.emit({ method: "gateway.disconnected", params: {} });
      });
    });
  }

  isConnected(): boolean { return this.socket?.readyState === WebSocket.OPEN; }

  async rpc(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (!EXPOSED_METHODS.has(method)) throw new Error(`Commande IA non autorisée depuis l'interface: ${method}`);
    // prompt.submit is only the JSON-RPC acknowledgement. The long-running Code
    // turn itself is observed separately through session.status/history. Keeping
    // this RPC open for six hours can hide a dead transport forever, so fail the
    // acknowledgement after one minute and let the Code watchdog recover.
    const timeoutMs = method === "prompt.submit" ? 60_000 : 120_000;
    return this.rawRpc(method, params, timeoutMs);
  }

  async switchModel(sessionId: string, model: string, provider = "openrouter"): Promise<unknown> {
    if (!sessionId.trim() || !model.trim() || !provider.trim()) throw new Error("Session ou modèle invalide");
    // Model switching is a first-class gateway configuration operation. Do not
    // send /model through command.dispatch: that RPC is reserved for quicks,
    // plugins and skills and is the source of the misleading
    // "not a quick/plugin/... command" interruption.
    return this.rawRpc("config.set", {
      session_id: sessionId,
      key: "model",
      value: `${provider.trim()}:${model.trim()}`
    });
  }

  async setApprovalMode(mode: "smart"): Promise<unknown> {
    // Sophenic intentionally never exposes Hermes' "off" / yolo mode.
    return this.rawRpc("config.set", { key: "approvals.mode", value: mode });
  }

  async setReasoningEffort(sessionId: string, effort: "none" | "minimal" | "low" | "medium" | "high"): Promise<unknown> {
    if (!sessionId.trim()) throw new Error("Session invalide");
    return this.rawRpc("config.set", {
      session_id: sessionId,
      key: "reasoning",
      value: effort
    });
  }

  async disableSessionYolo(sessionId: string): Promise<unknown> {
    // Session-scoped safety guard: explicitly disable approval bypass for every
    // Sophenic-created session without changing other Hermes clients.
    return this.rawRpc("config.set", {
      session_id: sessionId,
      key: "yolo",
      value: "off",
      scope: "session"
    });
  }

  async respondToPrompt(method: "approval.respond" | "clarify.respond" | "sudo.respond" | "secret.respond", params: Record<string, unknown>): Promise<unknown> {
    return this.rawRpc(method, params, 310_000);
  }

  private rawRpc(method: string, params: Record<string, unknown>, timeoutMs = 120_000): Promise<unknown> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error("Service IA local non connecté"));
    const id = ++this.seq;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Délai dépassé pour la commande IA: ${method}`));
        // A timed-out JSON-RPC call can leave a WebSocket that still looks OPEN
        // but no longer makes progress. Drop it so ensureGateway reconnects on
        // the next command instead of repeatedly talking to a stale channel.
        if (this.socket === socket) socket.terminate();
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      socket.send(payload, (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
        if (this.socket === socket) socket.terminate();
      });
    });
  }

  private emit(event: HermesGatewayEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private handleMessage(raw: string): void {
    let message: Record<string, unknown>;
    try { message = JSON.parse(raw) as Record<string, unknown>; } catch { return; }

    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        const error = message.error as { message?: string; code?: number };
        pending.reject(new Error(error.message ?? `Erreur du moteur IA ${error.code ?? "RPC"}`));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    // Hermes' TUI gateway sends events as:
    // { method: "event", params: { type, session_id, payload } }.
    // Normalize that envelope so React consumes first-class event names.
    if (message.method === "event" && message.params && typeof message.params === "object") {
      const envelope = message.params as Record<string, unknown>;
      const type = typeof envelope.type === "string" ? envelope.type : "";
      if (!type) return;
      const payload = envelope.payload && typeof envelope.payload === "object"
        ? { ...(envelope.payload as Record<string, unknown>) }
        : {};
      if (typeof envelope.session_id === "string") payload.session_id = envelope.session_id;
      this.emit({ method: type, params: payload });
      return;
    }

    const method = typeof message.method === "string" ? message.method : typeof message.event === "string" ? message.event : "";
    if (!method) return;
    const params = (message.params && typeof message.params === "object" ? message.params : message.data && typeof message.data === "object" ? message.data : {}) as Record<string, unknown>;
    this.emit({ method, params });
  }

  close(): void {
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Service IA local fermé"));
    }
    this.pending.clear();
  }
}
