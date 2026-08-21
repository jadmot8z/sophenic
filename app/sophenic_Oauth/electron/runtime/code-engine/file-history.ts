import fs from 'node:fs';
import path from 'node:path';

export class FileHistory {
  constructor(private root = path.join(process.cwd(), 'workspace', 'checkpoints')) {}

  snapshot(file: string) {
    if (!fs.existsSync(file)) throw new Error('File missing');
    fs.mkdirSync(this.root, { recursive: true });
    const id = `${Date.now()}-${path.basename(file)}`;
    fs.writeFileSync(path.join(this.root, id), fs.readFileSync(file));
    return id;
  }

  restore(id: string, destination: string) {
    const source = path.join(this.root, id);
    if (!fs.existsSync(source)) throw new Error('Checkpoint missing');
    fs.writeFileSync(destination, fs.readFileSync(source));
  }
}
