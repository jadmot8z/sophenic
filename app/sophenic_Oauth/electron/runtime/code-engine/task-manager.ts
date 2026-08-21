import { CodeTask, CodeTaskState } from './types';

export class TaskManager {
  private tasks = new Map<string, CodeTask>();

  create(task: CodeTask) { this.tasks.set(task.id, task); return task; }
  get(id: string) { return this.tasks.get(id); }
  update(id: string, state: CodeTaskState) {
    const task = this.tasks.get(id);
    if (!task) return undefined;
    task.state = state;
    task.updatedAt = Date.now();
    return task;
  }
  list() { return [...this.tasks.values()]; }
}
