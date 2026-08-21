import fs from 'node:fs';
import path from 'node:path';

export class WorkspaceManager {
  constructor(private root = path.join(process.cwd(), 'workspace')) {}

  createProject(id: string) {
    const base = path.join(this.root, id);
    for (const folder of ['project', 'logs', 'checkpoints', 'tests', 'delivery']) {
      fs.mkdirSync(path.join(base, folder), { recursive: true });
    }
    return base;
  }

  checkpoint(id: string, data: unknown) {
    const file = path.join(this.root, id, 'checkpoints', `${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    return file;
  }
}
