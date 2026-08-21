import type { BrainDecision } from './types';

export function decideCodeExecution(prompt: string): BrainDecision {
  const text = prompt.toLowerCase();
  const complex = /(application|saas|architecture|complete|full stack|production|deploy|refactor|autonomous|agent)/.test(text);
  const coding = /(code|bug|typescript|javascript|python|react|next|api|database|function)/.test(text);
  const research = /(research|documentation|latest|compare|source)/.test(text);
  const complexity = Math.min(10, Math.max(1, Math.ceil(prompt.length / 250) + (complex ? 4 : 0) + (coding ? 2 : 0)));

  return {
    complexity,
    modelTier: complexity >= 8 ? 'powerful' : complexity >= 4 ? 'balanced' : 'fast',
    useMultiAgent: complexity >= 8,
    needsTests: coding || complexity >= 6,
    needsResearch: research,
    estimatedTokens: complexity * 4000,
    reason: [
      `complexity=${complexity}`,
      complex ? 'complex project detected' : 'normal task',
      coding ? 'development workflow enabled' : 'conversation workflow'
    ]
  };
}
