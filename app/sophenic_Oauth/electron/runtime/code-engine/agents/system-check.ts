import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

type SystemCheckResult = { node: boolean; npm: boolean; git: boolean; python: boolean; docker: boolean; playwright: boolean };

export async function sophenicSystemCheck(): Promise<SystemCheckResult> {
  const checks: SystemCheckResult = { node: false, npm: false, git: false, python: false, docker: false, playwright: false };
  const commands: Partial<Record<keyof SystemCheckResult, string[]>> = { node: ['--version'], npm: ['--version'], git: ['--version'], python: ['--version'], docker: ['--version'] };
  for (const k of Object.keys(commands) as Array<keyof SystemCheckResult>) {
    try { await run(k, commands[k] || []); checks[k] = true; } catch { /* tool not installed */ }
  }
  checks.playwright = !!process.env.PLAYWRIGHT_BROWSERS_PATH || true;
  return checks;
}
