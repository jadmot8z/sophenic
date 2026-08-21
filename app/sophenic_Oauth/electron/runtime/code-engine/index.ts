import { WorkspaceManager } from './workspace-manager';
import { decideCodeExecution } from './brain-orchestrator';
import { FileOperationEngine } from './file-engine';
import { DockerSandbox } from './connectors/docker-sandbox';
import { PlaywrightAgent } from './connectors/playwright-agent';
import { GithubConnector } from './connectors/github';
import { VercelConnector } from './connectors/vercel';
import { TaskManager } from './task-manager';
import { CheckpointStore } from './checkpoint-store';
import { AutonomousDeveloperLoop } from './autonomous-loop';
import { FallbackRouter } from './fallback-router';
import { FileHistory } from './file-history';
import { ModelRouter } from './model-router';
import { AgentCoordinator } from './agent-system';

export class SophenicCodeEngine {
  readonly workspace = new WorkspaceManager();
  readonly files = new FileOperationEngine();
  readonly docker = new DockerSandbox();
  readonly browser = new PlaywrightAgent();
  readonly github = new GithubConnector(process.env.GITHUB_TOKEN);
  readonly vercel = new VercelConnector(process.env.VERCEL_TOKEN);
  readonly tasks = new TaskManager();
  readonly checkpoints = new CheckpointStore();
  readonly loop = new AutonomousDeveloperLoop(this.tasks, this.checkpoints);
  readonly fallback = new FallbackRouter([]);
  readonly history = new FileHistory();
  readonly models = new ModelRouter();
  readonly agents = new AgentCoordinator();

  analyze(prompt: string) {
    return decideCodeExecution(prompt);
  }

  startTask(prompt: string) {
    const id = `TASK-${Date.now()}`;
    const folder = this.workspace.createProject(id);
    const decision = this.analyze(prompt);
    this.workspace.checkpoint(id, { prompt, state: 'analysis', decision });
    return { id, folder, decision };
  }

  async environment() {
    return {
      docker: await this.docker.inspect(),
      github: this.github.connected(),
      vercel: this.vercel.connected()
    };
  }
}
