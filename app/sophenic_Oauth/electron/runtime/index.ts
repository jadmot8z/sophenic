import type { BrowserWindow } from "electron";
import { inspectOllama } from "./ollama";
import { HermesRuntime } from "./hermes";
import { HermesGatewayClient } from "./gateway";
import { SophenicClaudeCodeGateway } from "./claude-code-gateway";
import { ClaudeCodeRuntime } from "./claude-code";
import { SophenicCodeEngine } from "./code-engine";
import { AutonomousCodeRuntime } from "./code-engine/autonomous-runtime";
import type { DesktopRuntimeStatus, HermesGatewayEvent } from "./types";

export class SophenicLocalRuntime {
  readonly hermes = new HermesRuntime();
  readonly gateway = new HermesGatewayClient();
  readonly claudeGateway = new SophenicClaudeCodeGateway();
  readonly claudeCode = new ClaudeCodeRuntime(this.claudeGateway); // optional external builder only
  readonly codeEngine = new SophenicCodeEngine();
  readonly code = new AutonomousCodeRuntime();
  private windows = new Set<BrowserWindow>();

  constructor() {
    this.gateway.onEvent((event) => this.broadcast(event));
  }

  attachWindow(window: BrowserWindow): void {
    this.windows.add(window);
    window.on("closed", () => this.windows.delete(window));
  }

  private broadcast(event: HermesGatewayEvent): void {
    for (const window of this.windows) {
      if (!window.isDestroyed()) window.webContents.send("sophenic:hermes:event", event);
    }
  }

  async status(): Promise<DesktopRuntimeStatus> {
    const [ollama] = await Promise.all([inspectOllama()]);
    const hermes = this.hermes.inspect();
    return {
      desktop: true,
      platform: process.platform,
      hermes: { ...hermes, connected: this.gateway.isConnected() || hermes.connected },
      claudeCode: this.claudeCode.inspect(),
      ollama,
      capabilities: {
        localModels: true,
        hermesGateway: true,
        claudeCodeAgent: true,
        brainManagedModels: true,
        approvalBridge: true,
        filesystemDirect: true,
        terminalDirect: true,
        autonomousCodeEngine: true
      }
    };
  }

  async startHermes(provider = ""): Promise<DesktopRuntimeStatus> {
    const ready = await this.hermes.start(provider);
    if (!this.gateway.isConnected()) await this.gateway.connect(ready.port, ready.token);
    return this.status();
  }

  stopHermes(): void {
    this.gateway.close();
    this.hermes.stop();
  }

  dispose(): void {
    this.stopHermes();
    this.claudeCode.dispose();
    this.code.dispose();
  }
}
