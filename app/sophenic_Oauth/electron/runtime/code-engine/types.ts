export type EngineTaskKind = 'chat' | 'create' | 'modify' | 'debug' | 'deploy' | 'test';
export type AgentRole = 'architect' | 'developer' | 'reviewer' | 'tester';

export type CodeTaskState = 'analysis' | 'planning' | 'coding' | 'testing' | 'delivery' | 'failed' | 'completed';

export interface CodeTask {
  id: string;
  prompt: string;
  kind: EngineTaskKind;
  state: CodeTaskState;
  role: AgentRole;
  createdAt: number;
  updatedAt: number;
  checkpoint?: string;
}

export interface BrainDecision {
  complexity: number;
  modelTier: 'fast' | 'balanced' | 'powerful';
  useMultiAgent: boolean;
  needsTests: boolean;
  needsResearch: boolean;
  estimatedTokens: number;
  reason: string[];
}
