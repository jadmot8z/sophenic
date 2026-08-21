export type RuntimeState = "missing" | "stopped" | "starting" | "ready" | "error";

export interface OllamaModel {
  name: string;
  model: string;
  modifiedAt?: string;
  size: number;
  digest?: string;
  details?: {
    format?: string;
    family?: string;
    families?: string[];
    parameterSize?: string;
    quantizationLevel?: string;
  };
}

export interface OllamaStatus {
  state: RuntimeState;
  baseUrl: string;
  version?: string;
  models: OllamaModel[];
  error?: string;
}

export interface HermesStatus {
  state: RuntimeState;
  command?: string;
  version?: string;
  port?: number;
  connected: boolean;
  managed: boolean;
  error?: string;
}

export interface ClaudeCodeDesktopStatus {
  installed: boolean;
  command?: string;
  version?: string;
  gateway: { running: boolean; port?: number; baseUrl?: string; model: "sophenic-auto" };
  error?: string;
}

export interface DesktopRuntimeStatus {
  desktop: true;
  platform: string;
  hermes: HermesStatus;
  claudeCode: ClaudeCodeDesktopStatus;
  ollama: OllamaStatus;
  capabilities: {
    localModels: true;
    hermesGateway: true;
    claudeCodeAgent: true;
    brainManagedModels: true;
    approvalBridge: true;
    filesystemDirect: true;
    terminalDirect: true;
    autonomousCodeEngine: true;
  };
}

export interface HermesGatewayEvent {
  method: string;
  params: Record<string, unknown>;
}
