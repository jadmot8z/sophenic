import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { planSophenicAgentRoute, type BrainAgentCandidate, type BrainAgentPlan, type SophenicEffortMode } from "../sophenic-brain";
import { chatWithCloudProvider } from "../provider-client";
import { isCloudProvider } from "../provider-registry";
import { chatWithLocalOllamaModel } from "../ollama";
import type { OpenRouterChatMessage } from "../openrouter";
import { buildCodeWorkspaceHandoff, clearCodeWorkspaceCheckpoint, saveCodeWorkspaceCheckpoint } from "../code-workspace";
import { CodeToolExecutor, type CodeToolName, type CodeToolResult } from "./tool-executor";
import { detectWorkspaceArtifacts, snapshotWorkspaceFiles, type CodeArtifact, type WorkspaceFileSnapshot } from "./artifact-tracker";

export type AutonomousCodeRunEvent =
  | { type: "status"; message: string }
  | { type: "delta"; text: string }
  | { type: "tool"; name: string; input?: unknown; ok?: boolean }
  | { type: "plan"; steps: string[]; profile: BrainAgentPlan["profile"] }
  | { type: "checkpoint"; step: number; message: string }
  | { type: "route" | "fallback"; provider: string; model: string; previousProvider?: string; previousModel?: string; reason?: string }
  | { type: "artifacts"; artifacts: CodeArtifact[] }
  | { type: "error"; message: string };

export type AutonomousCodeRunResult = {
  ok: true;
  text: string;
  sessionId: string;
  provider: string;
  model: string;
  fallbacks: Array<{ provider: string; model: string }>;
  version: string;
  changedFiles: string[];
  verification: unknown;
  artifacts: CodeArtifact[];
};

type AgentToolAction = { type: "tool"; tool: CodeToolName | string; args?: Record<string, unknown>; note?: string };
type AgentFinalAction = { type: "final"; message: string; summary?: string };
type AgentAction = AgentToolAction | AgentFinalAction;

const ENGINE_VERSION = "SOPHENIC Native Code Engine 6.0";
const MAX_TURNS = 56;
const MAX_PROTOCOL_ERRORS = 3;

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error || "Erreur inconnue"))
    .replace(/(?:sk-|AIza|ghp_|github_pat_|xox[baprs]-)[A-Za-z0-9_\-.]{8,}/g, "[secret]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1800);
}

function safeJson(value: unknown, max = 18_000): string {
  let text = "";
  try { text = JSON.stringify(value, null, 2); } catch { text = String(value); }
  return text.length > max ? `${text.slice(0, max)}\n…[tronqué par Sophenic]` : text;
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const clean = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    const parsed = JSON.parse(clean);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {}
  const start = clean.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < clean.length; i += 1) {
    const char = clean[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) {
      try {
        const parsed = JSON.parse(clean.slice(start, i + 1));
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
      } catch { return null; }
    }
  }
  return null;
}

function parseAction(text: string): AgentAction | null {
  const row = extractJsonObject(text);
  if (!row) return null;
  if (row.type === "final" && typeof row.message === "string" && row.message.trim()) return { type: "final", message: row.message.trim(), ...(typeof row.summary === "string" ? { summary: row.summary.trim() } : {}) };
  if (row.type === "tool" && typeof row.tool === "string" && row.tool.trim()) {
    const args = row.args && typeof row.args === "object" && !Array.isArray(row.args) ? row.args as Record<string, unknown> : {};
    return { type: "tool", tool: row.tool.trim(), args, ...(typeof row.note === "string" ? { note: row.note.trim() } : {}) };
  }
  return null;
}

function toolProtocolPrompt(plan: BrainAgentPlan, workspace: string, handoff: string, prompt: string): string {
  return `TU ES LE MODÈLE DÉVELOPPEUR ACTIF DE SOPHENIC CODE ENGINE.
SOPHENIC Brain t'a sélectionné pour exécuter une tâche réelle dans un workspace local. Hermes n'est PAS dans le chemin d'exécution et n'est jamais requis. Tu dois agir avec les outils natifs ci-dessous et continuer jusqu'à un résultat vérifié sans demander à l'utilisateur d'écrire "continue".

WORKSPACE AUTORISÉ : ${workspace}
DEMANDE UTILISATEUR :
${prompt}

PLAN SOPHENIC :
${plan.planSteps.map((step, index) => `${index + 1}. ${step}`).join("\n")}

PROFIL : complexité ${plan.profile.complexity}/10; qualité=${plan.profile.qualityRequested}; vérification=${plan.profile.verificationRequired}; compétences=${plan.profile.skills.join(", ")}.

ÉTAT INITIAL / HANDOFF :
${handoff || "Workspace à inspecter."}

PROTOCOLE DE SORTIE OBLIGATOIRE : réponds avec UN SEUL objet JSON valide et rien d'autre.
Pour utiliser un outil : {"type":"tool","tool":"filesystem.list","args":{"path":".","depth":3},"note":"raison courte"}
Quand le travail est réellement fini : {"type":"final","message":"résultat final utile pour l'utilisateur","summary":"résumé technique court"}

OUTILS NATIFS :
- filesystem.list {path, depth}
- filesystem.read {path, startLine, endLine}
- filesystem.write {path, content}
- filesystem.replace {path, oldText, newText, replaceAll}
- filesystem.mkdir {path}
- filesystem.delete {path, recursive}
- terminal.run {command, cwd, shell:"auto|powershell|cmd|bash", timeoutMs}
- project.verify {}
- environment.inspect {}
- docker.inspect {}, docker.run {image, command}, docker.compose {args, cwd}
- browser.open {url}, browser.click {selector}, browser.fill {selector,value}, browser.press {selector,key}, browser.inspect {}, browser.screenshot {path,fullPage}
- web.search {query,limit}, web.fetch {url,maxChars}
- image.generate {prompt,path,aspectRatio,quality}
- github.status {}, github.oauth_start {}, github.oauth_poll {deviceCode}, github.search_repositories {query,limit}, github.search_code {query,limit}, github.create_repo {name,description,private}, github.commit {message}, github.push {remote,branch}
- vercel.status {}, vercel.deploy {production}, vercel.logs {deployment,limit}

RÈGLES :
1. Inspecte avant de modifier un projet existant. Ne détruis pas ce qui fonctionne.
2. Pour un nouveau projet, crée toi-même l'arborescence et tous les fichiers utiles.
3. Utilise web.search/web.fetch quand la documentation actuelle améliore réellement le résultat; privilégie sources officielles.
4. Lance les commandes/tests/build nécessaires. Corrige toute erreur au lieu de la masquer.
5. Pour une UI/Web, utilise le navigateur Playwright quand une app peut être démarrée localement; vérifie erreurs console et rendu.
6. Aucune clé/API secrète dans le code source. Utilise variables d'environnement et fichiers .env.example.
7. Une erreur d'un outil est une information à corriger; ne termine pas tant que le besoin central n'est pas satisfait.
8. Ne prétends jamais qu'un test ou déploiement a réussi sans résultat d'outil correspondant.
9. Modifie uniquement le workspace autorisé. Les commandes système destructrices sont bloquées.
10. Réponds en français à l'utilisateur, mais conserve les noms techniques/code dans leur forme appropriée.`;
}

export class AutonomousCodeRuntime {
  private controllers = new Map<string, AbortController>();

  inspect() {
    return { installed: true, version: ENGINE_VERSION, native: true, hermesRequired: false, status: "ready" as const };
  }

  abort(requestId?: string): boolean {
    if (requestId) {
      const controller = this.controllers.get(requestId);
      if (!controller) return false;
      controller.abort(new Error("Tâche Sophenic Code annulée."));
      this.controllers.delete(requestId);
      return true;
    }
    let changed = false;
    for (const controller of this.controllers.values()) { controller.abort(new Error("Tâche Sophenic Code annulée.")); changed = true; }
    this.controllers.clear();
    return changed;
  }

  private async callModel(candidate: BrainAgentCandidate, messages: OpenRouterChatMessage[], plan: BrainAgentPlan, signal: AbortSignal): Promise<{ content: string; model: string }> {
    if (candidate.provider === "ollama") {
      const result = await chatWithLocalOllamaModel({ model: candidate.model, messages, signal });
      return { content: result.content, model: result.model };
    }
    if (!isCloudProvider(candidate.provider)) throw new Error(`Provider Code non supporté: ${candidate.provider}`);
    const result = await chatWithCloudProvider({
      provider: candidate.provider,
      model: candidate.model,
      messages,
      stream: false,
      signal,
      maxTokens: plan.mode === "deep" ? 7000 : 5200,
      reasoningEffort: plan.reasoningEffort
    });
    return { content: result.content, model: result.model || candidate.model };
  }

  private async compactMessages(messages: OpenRouterChatMessage[], workspace: string, plan: BrainAgentPlan): Promise<OpenRouterChatMessage[]> {
    if (messages.length <= 26) return messages;
    const handoff = buildCodeWorkspaceHandoff({ workspace });
    return [
      messages[0],
      { role: "user", content: `CONTEXTE SOPHENIC COMPACTÉ SANS PERTE D'ÉTAT. Le workspace/checkpoint est la source de vérité.\nPlan: ${plan.planSteps.join(" > ")}\n${handoff.summary}` },
      ...messages.slice(-20)
    ];
  }

  async runTask(input: { requestId: string; cwd: string; prompt: string; effortMode?: SophenicEffortMode; onEvent?: (event: AutonomousCodeRunEvent) => void }): Promise<AutonomousCodeRunResult> {
    const requestId = input.requestId.trim() || randomUUID();
    if (this.controllers.has(requestId)) throw new Error("Cette tâche Sophenic Code est déjà active.");
    const workspace = path.resolve(input.cwd.trim());
    if (!fs.existsSync(workspace) || !fs.statSync(workspace).isDirectory()) throw new Error("Workspace Sophenic Code invalide.");
    const prompt = input.prompt.trim();
    if (!prompt) throw new Error("Demande Sophenic Code vide.");
    const onEvent = input.onEvent || (() => undefined);
    const controller = new AbortController();
    this.controllers.set(requestId, controller);
    const sessionId = `SOPHENIC-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const executor = new CodeToolExecutor(workspace);
    // Baseline for artifact detection: only files that appear AFTER this point
    // are presented to the user as newly generated deliverables.
    const workspaceBaseline: WorkspaceFileSnapshot = snapshotWorkspaceFiles(workspace);
    const changedFiles = new Set<string>();
    const fallbacksUsed: Array<{ provider: string; model: string }> = [];
    let verification: unknown = null;
    let activeStep = 0;
    let currentPlan: BrainAgentPlan | null = null;
    let lastActive: BrainAgentCandidate | null = null;

    try {
      onEvent({ type: "status", message: "Sophenic Brain analyse la tâche et sélectionne le meilleur agent développeur." });
      const plan = await planSophenicAgentRoute({ messages: [{ role: "user", content: prompt }], mode: input.effortMode || "auto", purpose: "code" });
      currentPlan = plan;
      onEvent({ type: "plan", steps: plan.planSteps, profile: plan.profile });
      const candidates = [plan.primary, ...plan.fallbacks];
      let candidateIndex = 0;
      let active = candidates[candidateIndex];
      lastActive = active;
      onEvent({ type: "route", provider: active.provider, model: active.model, reason: active.reason });

      const handoff = buildCodeWorkspaceHandoff({ workspace });
      let messages: OpenRouterChatMessage[] = [{ role: "user", content: toolProtocolPrompt(plan, workspace, handoff.summary, prompt) }];
      let protocolErrors = 0;
      let reviewApplied = false;

      saveCodeWorkspaceCheckpoint({ workspace, originalPrompt: prompt, planSteps: plan.planSteps, activeStep, activeProvider: active.provider, activeModel: active.model, savedAt: Date.now(), reason: "Agent Code natif en cours" });

      for (let turn = 0; turn < MAX_TURNS; turn += 1) {
        if (controller.signal.aborted) throw controller.signal.reason instanceof Error ? controller.signal.reason : new Error("Tâche annulée.");
        let response: { content: string; model: string };
        try {
          response = await this.callModel(active, messages, plan, controller.signal);
          if (response.model && response.model !== active.model) active = { ...active, model: response.model };
        } catch (cause) {
          const previous = active;
          candidateIndex += 1;
          if (candidateIndex >= candidates.length) throw cause;
          active = candidates[candidateIndex];
          lastActive = active;
          fallbacksUsed.push({ provider: active.provider, model: active.model });
          onEvent({ type: "fallback", provider: active.provider, model: active.model, previousProvider: previous.provider, previousModel: previous.model, reason: errorText(cause) });
          saveCodeWorkspaceCheckpoint({ workspace, originalPrompt: prompt, planSteps: plan.planSteps, activeStep, activeProvider: active.provider, activeModel: active.model, savedAt: Date.now(), reason: `Fallback automatique: ${errorText(cause)}`, progressDigest: buildCodeWorkspaceHandoff({ workspace }).summary });
          continue;
        }

        const action = parseAction(response.content);
        if (!action) {
          protocolErrors += 1;
          messages.push({ role: "assistant", content: response.content.slice(0, 12_000) });
          messages.push({ role: "user", content: "FORMAT INVALIDE. Réponds maintenant avec UN SEUL objet JSON conforme au protocole Sophenic. N'ajoute aucun markdown ni explication hors JSON. Continue la même tâche; ne recommence pas le projet." });
          if (protocolErrors >= MAX_PROTOCOL_ERRORS && candidateIndex + 1 < candidates.length) {
            const previous = active;
            candidateIndex += 1;
            active = candidates[candidateIndex];
            lastActive = active;
            protocolErrors = 0;
            fallbacksUsed.push({ provider: active.provider, model: active.model });
            onEvent({ type: "fallback", provider: active.provider, model: active.model, previousProvider: previous.provider, previousModel: previous.model, reason: "Le modèle précédent n'a pas respecté le protocole d'outils après plusieurs corrections." });
          }
          messages = await this.compactMessages(messages, workspace, plan);
          continue;
        }
        protocolErrors = 0;

        if (action.type === "tool") {
          const toolName = action.tool;
          onEvent({ type: "tool", name: toolName, input: action.args });
          const result: CodeToolResult = await executor.execute(toolName, action.args || {});
          for (const file of result.changedFiles || []) changedFiles.add(file);
          if (/filesystem|terminal|docker|github|vercel/.test(toolName)) activeStep = Math.max(activeStep, Math.min(plan.planSteps.length - 1, 3));
          if (/verify|browser/.test(toolName)) activeStep = Math.max(activeStep, Math.min(plan.planSteps.length - 1, 4));
          onEvent({ type: "checkpoint", step: activeStep, message: `${toolName}: ${result.ok ? "terminé" : "erreur à corriger"}` });
          saveCodeWorkspaceCheckpoint({ workspace, originalPrompt: prompt, planSteps: plan.planSteps, activeStep, activeProvider: active.provider, activeModel: active.model, savedAt: Date.now(), reason: `${toolName}: ${result.ok ? "OK" : "échec"}`, progressDigest: buildCodeWorkspaceHandoff({ workspace }).summary });
          messages.push({ role: "assistant", content: response.content });
          messages.push({ role: "user", content: `TOOL_RESULT ${toolName}\n${safeJson(result)}\n\nContinue exactement la même tâche. Si l'outil a échoué, diagnostique et corrige. Si une étape est terminée, passe à la suivante.` });
          messages = await this.compactMessages(messages, workspace, plan);
          continue;
        }

        // A final answer is accepted only after a real quality gate for coding tasks.
        if (plan.profile.verificationRequired && !verification) {
          onEvent({ type: "status", message: "Quality Gate Sophenic: exécution automatique des tests/typecheck/build détectés." });
          const gate = await executor.verifyProject();
          verification = gate;
          onEvent({ type: "tool", name: "project.verify", input: {}, ok: gate.passed });
          if (!gate.passed) {
            messages.push({ role: "assistant", content: response.content });
            messages.push({ role: "user", content: `QUALITY GATE ÉCHOUÉ. Tu ne peux pas terminer. Corrige les erreurs ci-dessous puis relance les validations utiles.\n${safeJson(gate, 24_000)}` });
            verification = null;
            activeStep = Math.max(activeStep, Math.min(plan.planSteps.length - 1, 4));
            continue;
          }
        }

        if (!reviewApplied && plan.reviewers.length) {
          reviewApplied = true;
          const reviewer = plan.reviewers[0];
          try {
            const state = buildCodeWorkspaceHandoff({ workspace });
            const reviewMessages: OpenRouterChatMessage[] = [{ role: "user", content: `Tu es le reviewer indépendant de Sophenic Code. Analyse ce résultat de développement à partir de la demande, du handoff workspace et du Quality Gate. Réponds uniquement par JSON {"ok":true,"feedback":"..."} si le résultat paraît complet, ou {"ok":false,"feedback":"corrections concrètes"}.\n\nDEMANDE:\n${prompt}\n\nHANDOFF:\n${state.summary}\n\nQUALITY GATE:\n${safeJson(verification)}\n\nRÉPONSE PROPOSÉE:\n${action.message}` }];
            const review = await this.callModel(reviewer, reviewMessages, { ...plan, reasoningEffort: "medium" }, controller.signal);
            const parsed = extractJsonObject(review.content);
            if (parsed?.ok === false && typeof parsed.feedback === "string" && parsed.feedback.trim()) {
              onEvent({ type: "status", message: `Reviewer ${reviewer.provider}/${reviewer.model}: corrections demandées.` });
              messages.push({ role: "assistant", content: response.content });
              messages.push({ role: "user", content: `REVIEW INDÉPENDANTE SOPHENIC :\n${parsed.feedback}\n\nApplique uniquement les corrections pertinentes dans le workspace existant, puis revérifie. Ne recommence rien.` });
              verification = null;
              continue;
            }
          } catch (reviewError) {
            onEvent({ type: "status", message: `Reviewer optionnel indisponible: ${errorText(reviewError)}. Le résultat validé reste livrable.` });
          }
        }

        activeStep = plan.planSteps.length - 1;
        saveCodeWorkspaceCheckpoint({ workspace, originalPrompt: prompt, planSteps: plan.planSteps, activeStep, activeProvider: active.provider, activeModel: active.model, savedAt: Date.now(), reason: "Vérification finale terminée", progressDigest: buildCodeWorkspaceHandoff({ workspace }).summary });
        const finalText = action.message.trim();
        // Deliverables (ZIP, PDF, images, exports...) may have been produced by
        // terminal commands rather than filesystem tools: diff the whole
        // workspace against the run baseline and wait until files are stable.
        let runArtifacts: CodeArtifact[] = [];
        try {
          runArtifacts = await detectWorkspaceArtifacts(workspace, workspaceBaseline);
        } catch { /* artifact detection must never break delivery */ }
        if (runArtifacts.length) onEvent({ type: "artifacts", artifacts: runArtifacts });
        onEvent({ type: "delta", text: finalText });
        onEvent({ type: "checkpoint", step: activeStep, message: "Livraison terminée" });
        clearCodeWorkspaceCheckpoint(workspace);
        return { ok: true, text: finalText, sessionId, provider: active.provider, model: active.model, fallbacks: fallbacksUsed, version: ENGINE_VERSION, changedFiles: [...changedFiles], verification, artifacts: runArtifacts };
      }
      throw new Error(`Sophenic Code a atteint sa limite interne de ${MAX_TURNS} actions sans terminer. Le checkpoint est conservé automatiquement.`);
    } catch (cause) {
      const message = errorText(cause);
      onEvent({ type: "error", message });
      try {
        const state = buildCodeWorkspaceHandoff({ workspace });
        saveCodeWorkspaceCheckpoint({ workspace, originalPrompt: prompt, planSteps: currentPlan?.planSteps?.length ? currentPlan.planSteps : ["Reprendre la tâche depuis le checkpoint"], activeStep, activeProvider: lastActive?.provider || "sophenic", activeModel: lastActive?.model || "auto", savedAt: Date.now(), reason: message, progressDigest: state.summary });
      } catch {}
      throw cause;
    } finally {
      this.controllers.delete(requestId);
      await executor.dispose().catch(() => undefined);
    }
  }

  dispose(): void { this.abort(); }
}
