import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type FutureAgentCapability = "application_control" | "browser" | "email" | "files" | "diagnostics" | "terminal";
export type AgentActionRisk = "read" | "write" | "sensitive";
export type AgentAuditOutcome = "requested" | "allowed" | "denied" | "completed" | "failed";

export type FutureAgentCapabilityPolicy = {
  capability: FutureAgentCapability;
  permissionId: string;
  confirmationForSensitive: true;
  auditRequired: true;
};

export const FUTURE_AGENT_CAPABILITY_POLICY: readonly FutureAgentCapabilityPolicy[] = [
  { capability: "application_control", permissionId: "computer_use", confirmationForSensitive: true, auditRequired: true },
  { capability: "browser", permissionId: "browser", confirmationForSensitive: true, auditRequired: true },
  { capability: "email", permissionId: "google-workspace", confirmationForSensitive: true, auditRequired: true },
  { capability: "files", permissionId: "file", confirmationForSensitive: true, auditRequired: true },
  { capability: "diagnostics", permissionId: "computer_use", confirmationForSensitive: true, auditRequired: true },
  { capability: "terminal", permissionId: "terminal", confirmationForSensitive: true, auditRequired: true }
] as const;

export type AgentAuditRecord = {
  at?: string;
  capability: FutureAgentCapability | "permissions" | "approval";
  action: string;
  risk: AgentActionRisk;
  outcome: AgentAuditOutcome;
  requestId?: string;
};

function sophenicDataHome(): string {
  if (process.platform === "win32" && process.env.LOCALAPPDATA) return path.join(process.env.LOCALAPPDATA, "Sophenic");
  return path.join(os.homedir(), ".sophenic");
}

export function agentAuditPath(): string {
  return path.join(sophenicDataHome(), "agent-action-audit.jsonl");
}

function cleanAuditToken(value: string | undefined, max = 160): string | undefined {
  const clean = value?.trim().replace(/[\r\n\t]+/g, " ").slice(0, max);
  return clean || undefined;
}

/**
 * Writes metadata only. Prompts, file contents, passwords, OAuth values and API
 * keys are intentionally excluded from the audit schema.
 */
export function appendAgentAudit(record: AgentAuditRecord): void {
  const target = agentAuditPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const safe: AgentAuditRecord = {
    at: new Date().toISOString(),
    capability: record.capability,
    action: cleanAuditToken(record.action, 120) || "unknown",
    risk: record.risk,
    outcome: record.outcome,
    ...(cleanAuditToken(record.requestId, 120) ? { requestId: cleanAuditToken(record.requestId, 120) } : {})
  };
  fs.appendFileSync(target, `${JSON.stringify(safe)}\n`, { encoding: "utf8", mode: 0o600 });
  try { fs.chmodSync(target, 0o600); } catch { /* Windows may ignore POSIX permissions. */ }
}

export function tryAppendAgentAudit(record: AgentAuditRecord): boolean {
  try {
    appendAgentAudit(record);
    return true;
  } catch {
    return false;
  }
}

export function futureAgentPolicy(capability: FutureAgentCapability): FutureAgentCapabilityPolicy {
  const policy = FUTURE_AGENT_CAPABILITY_POLICY.find((item) => item.capability === capability);
  if (!policy) throw new Error(`Capacité agent inconnue: ${capability}`);
  return policy;
}

/**
 * Contract for future native PC actions. Sensitive operations fail closed unless
 * the product-level permission and the per-action confirmation are both present.
 * The authorization decision itself must also be journaled successfully.
 */
export function authorizeFutureAgentAction(input: {
  capability: FutureAgentCapability;
  action: string;
  risk: AgentActionRisk;
  permissionGranted: boolean;
  userConfirmed: boolean;
  requestId?: string;
}): void {
  const policy = futureAgentPolicy(input.capability);
  const sensitive = input.risk === "sensitive";
  const allowed = input.permissionGranted && (!sensitive || (policy.confirmationForSensitive && input.userConfirmed));
  const record: AgentAuditRecord = {
    capability: input.capability,
    action: input.action,
    risk: input.risk,
    outcome: allowed ? "allowed" : "denied",
    requestId: input.requestId
  };
  // For sensitive operations, missing audit storage is itself a safety failure.
  if (sensitive) appendAgentAudit(record);
  else tryAppendAgentAudit(record);
  if (!input.permissionGranted) throw new Error(`Permission Sophenic requise: ${policy.permissionId}`);
  if (sensitive && !input.userConfirmed) throw new Error("Confirmation utilisateur requise pour cette action sensible.");
}

export function routedActionCapability(kind: string): FutureAgentCapability | null {
  if (kind.startsWith("application.") || kind.startsWith("spotify.") || kind.startsWith("audio.")) return "application_control";
  if (kind.startsWith("web.")) return "browser";
  if (kind.startsWith("filesystem.")) return "files";
  if (kind.startsWith("system.")) return "diagnostics";
  return null;
}
