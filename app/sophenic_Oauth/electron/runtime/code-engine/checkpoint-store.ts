export interface Checkpoint { id: string; createdAt: number; data: unknown; }

export class CheckpointStore {
  private checkpoints = new Map<string, Checkpoint[]>();
  save(id: string, data: unknown) {
    const item = { id, createdAt: Date.now(), data };
    const list = this.checkpoints.get(id) ?? [];
    list.push(item);
    this.checkpoints.set(id, list);
    return item;
  }
  latest(id: string) { return this.checkpoints.get(id)?.at(-1); }
  restore(id: string) { return this.latest(id)?.data; }
}
