# SOPHENIC CODE ENGINE 6.0

## Architecture active

```text
Utilisateur
   ↓
SOPHENIC Brain
   ↓
Analyse tâche (complexité, domaine, langages, taille, image, recherche, tests, tokens, coût, qualité)
   ↓
Provider / modèle / clé sélectionnés + fallbacks + reviewer éventuel
   ↓
SOPHENIC Native Code Engine
   ├─ Filesystem + versions
   ├─ Terminal PowerShell / CMD / Bash
   ├─ Docker
   ├─ Playwright
   ├─ Web research
   ├─ Image generation
   ├─ GitHub OAuth / search / repo / commit / push
   ├─ Vercel deploy / logs
   └─ Quality Gate + checkpoints + delivery
```

Hermes n'est plus un moteur obligatoire de Code. Il reste disponible comme module optionnel pour Computer Use et certains plugins existants. Une absence, une panne ou une erreur Hermes ne provoque aucun fallback Code vers Hermes et ne bloque pas la boucle autonome native.

## Workspace persistant

Le workspace géré se trouve sous `%LOCALAPPDATA%\Sophenic\workspace` sous Windows et contient :

```text
workspace/
  projects/
  logs/
  checkpoints/
  versions/
  tests/
  delivery/
```

Chaque projet géré possède aussi un état `.sophenic/`. Les checkpoints globaux permettent de détecter une tâche interrompue au prochain lancement et l'interface affiche **Projet détecté** avec l'action **Reprendre la tâche**.

## Boucle autonome

Le modèle choisi par Sophenic Brain reçoit un protocole d'outils. Il inspecte le workspace, agit, reçoit le résultat réel de chaque outil, corrige les erreurs et continue jusqu'à la validation. En cas d'échec du modèle ou de sa clé, le moteur conserve les messages, le handoff, les fichiers et le checkpoint puis passe au candidat suivant. Il ne recommence pas le projet depuis zéro.

Une réponse finale de développement n'est acceptée qu'après le Quality Gate détecté pour le projet. Pour Node.js, le moteur installe les dépendances si nécessaire puis exécute les scripts disponibles parmi `typecheck`, `test`, `lint` et `build`.

## Sécurité

- Les chemins fichiers sont confinés au workspace autorisé.
- Les suppressions de racine et `.git` sont refusées.
- Les commandes système dangereuses sont bloquées avant exécution.
- Les clés IA sont validées avant sauvegarde et stockées dans le coffre `electron.safeStorage`.
- Les jetons GitHub issus du Device OAuth sont stockés chiffrés quand le chiffrement OS est disponible; aucun fallback plaintext n'est utilisé.
- `.env.example` ne contient aucun secret réel.
- Le renderer Electron ne reçoit ni `fs`, ni `child_process`.

## Premier lancement Windows

Exécuter :

```powershell
powershell -ExecutionPolicy Bypass -File .\RUN-SOPHENIC-VSCODE.ps1
```

Le script vérifie Node.js, npm, Git, Python, Docker, Playwright et VS Code, propose `winget` pour les composants absents, installe les dépendances npm, propose Chromium Playwright, exécute le typecheck, ouvre VS Code puis démarre l'application Desktop.

## Commandes de validation

```bash
npm install
npm run typecheck
npm test
npm run build
```

Pour produire l'installateur Windows NSIS, utiliser séparément :

```bash
npm run build:installer
```
