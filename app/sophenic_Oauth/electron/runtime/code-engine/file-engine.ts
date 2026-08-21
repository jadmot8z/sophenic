import fs from 'node:fs';
import path from 'node:path';

export class FileOperationEngine {
  write(file: string, content: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf8');
  }

  read(file: string) {
    return fs.readFileSync(file, 'utf8');
  }

  remove(file: string) {
    if (fs.existsSync(file)) fs.rmSync(file);
  }

  exists(file: string) {
    return fs.existsSync(file);
  }
}
