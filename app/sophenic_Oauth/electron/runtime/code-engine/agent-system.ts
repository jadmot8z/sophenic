import type { AgentRole, CodeTask } from './types';

export interface AgentContext {
  task: CodeTask;
  plan: string[];
  filesChanged: string[];
  logs: string[];
}

export interface AgentResult {
  role: AgentRole;
  status: 'completed' | 'blocked';
  output: string;
}

abstract class BaseAgent {
  constructor(public readonly role: AgentRole) {}

  run(context: AgentContext): AgentResult {
    return {
      role: this.role,
      status: 'completed',
      output: `${this.role} prepared next execution step for ${context.task.id}`
    };
  }
}

export class ArchitectAgent extends BaseAgent {
  constructor() { super('architect'); }
}

export class DeveloperAgent extends BaseAgent {
  constructor() { super('developer'); }
}

export class ReviewerAgent extends BaseAgent {
  constructor() { super('reviewer'); }
}

export class TesterAgent extends BaseAgent {
  constructor() { super('tester'); }
}

export class AgentCoordinator {
  readonly agents = [
    new ArchitectAgent(),
    new DeveloperAgent(),
    new ReviewerAgent(),
    new TesterAgent()
  ];

  execute(context: AgentContext) {
    return this.agents.map(agent => agent.run(context));
  }
}
