# SOPHENIC 5.4.2 — Révision Brain multi-IA

Cette révision remet Sophenic Brain au centre de l'application.

## Modifications principales

- Le routeur d'intention sépare désormais une demande **sur le code** d'une demande **d'exécution de code**.
  - « Donne-moi un prompt pour créer un site » reste dans Chat.
  - « Explique ce code » reste dans Chat.
  - « Crée ce site dans mon dossier » ouvre Code.
  - « Modifie App.tsx » ouvre Code.
- Le mode Code utilise de nouveau le pipeline Sophenic Brain + Hermes multi-provider. Claude Code n'est plus le moteur par défaut.
- xAI / Grok est ajouté au registre multi-provider et reçoit un bonus de routage pour les conversations simples quand une clé xAI est disponible.
- L'import de clés distingue maintenant correctement `GROK AI` (xAI) de `Groq`.
- Sophenic Image essaie xAI, puis Gemini, puis OpenRouter. Une panne d’un moteur ou d’une clé ne bloque plus les moteurs suivants.
- La galerie Image est limitée à cinq résultats et conserve un défilement horizontal compact.
- Une permission « Localisation » a été ajoutée. Une demande explicite de position peut produire une carte de coordonnées et un lien vers OpenStreetMap.
- Les diagnostics de modèle restent visibles via `MODEL USED` afin de vérifier quel provider/modèle a réellement répondu.

## Test Windows / VS Code

Dans le terminal PowerShell de VS Code :

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
.\RUN-SOPHENIC-VSCODE.ps1
```

Le script installe les dépendances, répare Electron si son binaire Windows est absent, lance les vérifications puis ouvre l'application en mode développement.


Pour la liste complète des correctifs 5.4.2, voir `CHANGELOG-V5.4.2-COMMERCIAL-ROUTER.md`.
