import { TaskManager } from './task-manager';
import { CheckpointStore } from './checkpoint-store';
import { CodeTask } from './types';

export class AutonomousDeveloperLoop {
  constructor(
    private tasks = new TaskManager(),
    private checkpoints = new CheckpointStore()
  ) {}

  start(task: CodeTask) {
    this.tasks.create(task);
    this.checkpoints.save(task.id, { phase: 'analysis', task });
    return task;
  }

  progress(id: string, phase: string, payload: unknown) {
    this.checkpoints.save(id, { phase, payload });
    return this.tasks.get(id);
  }

  resume(id: string) {
    return this.checkpoints.restore(id);
  }
}
