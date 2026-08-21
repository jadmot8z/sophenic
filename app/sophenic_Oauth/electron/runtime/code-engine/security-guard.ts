const forbidden: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bformat\s+[a-z]:/i, reason: "formatage de disque" },
  { pattern: /\bshutdown\b|\brestart-computer\b|\bstop-computer\b/i, reason: "arrêt/redémarrage du système" },
  { pattern: /\brm\s+-rf\s+(?:\/|~|\.\.)(?:\s|$)/i, reason: "suppression récursive hors workspace" },
  { pattern: /\b(?:del|erase)\s+\/s\s+\/q\s+(?:[a-z]:\\|\\\\|\*\.\*)/i, reason: "suppression récursive système" },
  { pattern: /\bRemove-Item\b[^\n]*(?:-Recurse[^\n]*)?(?:[A-Za-z]:\\|\\\\|\$env:(?:USERPROFILE|WINDIR|SYSTEMROOT))/i, reason: "suppression PowerShell hors workspace" },
  { pattern: /\b(?:diskpart|bcdedit|cipher\s+\/w|manage-bde)\b/i, reason: "commande disque/boot sensible" },
  { pattern: /\breg\s+(?:delete|add)\s+HK(?:LM|CU)\\[^\n]+\/f/i, reason: "modification forcée du registre" },
  { pattern: /\b(?:net\s+user|net\s+localgroup|New-LocalUser|Add-LocalGroupMember)\b/i, reason: "modification des comptes système" },
  { pattern: /\b(?:curl|wget|irm|Invoke-RestMethod|Invoke-WebRequest)\b[^\n|;]*(?:\||;)\s*(?:bash|sh|iex|Invoke-Expression|powershell)/i, reason: "exécution aveugle de code distant" },
  { pattern: /\bSet-MpPreference\b|\bAdd-MpPreference\b|\bDisableRealtimeMonitoring\b/i, reason: "désactivation de sécurité" }
];

export function validateCommand(command: string): true {
  const clean = command.trim();
  if (!clean) throw new Error("Security Guard: commande vide");
  if (clean.length > 16_000) throw new Error("Security Guard: commande anormalement longue");
  const hit = forbidden.find((entry) => entry.pattern.test(clean));
  if (hit) throw new Error(`Security Guard: commande interdite (${hit.reason})`);
  return true;
}

export function commandRisk(command: string): "low" | "medium" | "high" {
  validateCommand(command);
  if (/\b(?:npm\s+(?:publish|token)|git\s+push|docker\s+(?:rm|rmi|system\s+prune)|vercel\s+--prod|gh\s+repo\s+delete)\b/i.test(command)) return "high";
  if (/\b(?:npm\s+install|pip\s+install|git\s+(?:commit|checkout|reset)|docker\s+(?:build|run)|npx\s+playwright\s+install)\b/i.test(command)) return "medium";
  return "low";
}
