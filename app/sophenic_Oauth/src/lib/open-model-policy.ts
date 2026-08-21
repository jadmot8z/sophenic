export type OpenModelPolicy = {
  status: "approved" | "review";
  family?: string;
  license?: string;
  source?: string;
  note?: string;
};

/**
 * Sophenic is local-first and intentionally refuses to equate "installed in
 * Ollama" with "approved open model". Ollama can host models under many
 * different licenses. This registry is therefore deliberately conservative.
 *
 * Add a family only after checking the model-weights license for the exact
 * release intended for commercial distribution. The UI may show models under
 * review, but only approved entries can be selected in Agent mode.
 */
const APPROVED_FAMILIES: Array<{
  match: RegExp;
  policy: Omit<OpenModelPolicy, "status">;
}> = [
  {
    match: /(^|[/:_-])qwen3(?:\.|[/:_-]|$)/i,
    policy: {
      family: "Qwen 3.x",
      license: "Apache-2.0",
      source: "QwenLM",
      note: "Famille open-weight approuvée pour le prototype Sophenic."
    }
  },
  {
    match: /(^|[/:_-])deepseek-r1(?:[/:_-]|$)/i,
    policy: {
      family: "DeepSeek R1",
      license: "MIT",
      source: "DeepSeek",
      note: "Poids DeepSeek-R1 approuvés; les variantes distillées peuvent hériter de conditions supplémentaires."
    }
  }
];

export function openModelPolicy(modelName: string): OpenModelPolicy {
  const normalized = modelName.trim();
  const approved = APPROVED_FAMILIES.find(({ match }) => match.test(normalized));
  if (approved) return { status: "approved", ...approved.policy };
  return {
    status: "review",
    note: "Modèle local détecté mais licence non encore validée dans le registre Sophenic."
  };
}

export function isApprovedOpenModel(modelName: string): boolean {
  return openModelPolicy(modelName).status === "approved";
}
