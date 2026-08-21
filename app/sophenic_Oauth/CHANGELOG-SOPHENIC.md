# CHANGELOG-SOPHENIC.md

## Sophenic Desktop V5.4.0 — Brain central + Claude Code Gateway

Date de cette correction : 18 août 2026.

Cette livraison modifie uniquement le projet Sophenic Desktop existant. Aucune application parallèle n'a été recréée et le design général, le coffre sécurisé de clés, les providers existants, les fallbacks, les modes Rapide / Auto / Deep et les fonctions Hermes/PC existantes sont conservés.

## Architecture principale

Le choix manuel du provider et du modèle IA a été retiré de l'interface Chat / Code / Image. L'utilisateur configure uniquement des **ressources** (providers, clés API, Ollama local). Le choix opérationnel appartient maintenant à Sophenic Brain :

```text
Utilisateur
    ↓
Sophenic Intent Router
    ↓
Sophenic Brain
    ↓
Task / effort analysis
    ↓
Provider → Model → Key
    ↓
Fallbacks
    ↓
Réponse / outil / action
```

`Rapide / Auto / Deep` reste disponible : ce réglage exprime l'effort demandé, mais ne permet pas de choisir un modèle ou un provider.

## Sophenic Code — moteur Claude Code

Sophenic Code peut maintenant utiliser l'installation locale officielle de **Claude Code CLI** comme moteur agentique de développement. Claude Code n'est pas traité comme un provider ou un deuxième cerveau : il est un moteur d'exécution spécialisé pour les tâches Code.

Chemin ajouté :

```text
Utilisateur
    ↓
Sophenic Code
    ↓
Sophenic Brain choisit provider / modèle / clé / fallback
    ↓
Passerelle locale Anthropic-compatible Sophenic
    ↓
Claude Code CLI
    ↓
workspace / outils / modifications
```

La passerelle locale expose uniquement le modèle logique `sophenic-auto`. Claude Code ne reçoit donc pas un sélecteur de modèles réels. À chaque tâche, la passerelle demande à Sophenic Brain une route réelle et exécute celle-ci via les providers configurés ou Ollama.

La compatibilité de protocole couvre notamment les messages Anthropic, tool calls / tool results, images d'entrée compatibles, réponses Anthropic et événements SSE nécessaires au streaming Claude Code.

### Important sur le terme « gratuit »

Cette intégration ne transforme pas un modèle Anthropic Claude payant en modèle gratuit. Elle permet d'utiliser le **harness/agent Claude Code** avec les ressources choisies automatiquement par Sophenic Brain. Lorsque Brain sélectionne Ollama local ou un provider réellement gratuit, il n'y a pas de coût API pour cette route. Une route cloud payante reste soumise aux conditions et tarifs du provider concerné.

Claude Code CLI n'est pas redistribué dans ce ZIP. Sophenic le détecte s'il est installé sur la machine. En son absence, le chemin Code peut revenir au moteur Hermes déjà présent afin de préserver la fonctionnalité existante.

## Inspirations Free Claude Code

La passerelle est une réimplémentation TypeScript native, adaptée à l'architecture Sophenic, du principe de proxy Anthropic-compatible utilisé par le projet open source **Free Claude Code**. Aucun binaire FCC et aucune application Python FCC ne sont embarqués. La notice de licence/inspiration est conservée dans `THIRD-PARTY-NOTICES.md`.

## Image

Le sélecteur de modèle d'image a été retiré du renderer. L'interface vérifie seulement qu'une capacité image est disponible. La sélection réelle du modèle est réalisée côté main process par la politique Sophenic Brain. Les paramètres de modèle éventuellement fournis par un renderer sont ignorés.

## Sécurité conservée / renforcée

- aucune clé API n'est ajoutée dans le code ;
- le coffre sécurisé Electron/Windows existant reste la source des secrets ;
- la passerelle Claude Code écoute uniquement sur `127.0.0.1` ;
- elle utilise un token local aléatoire par processus ;
- le renderer n'obtient pas `fs`, `child_process`, `exec` ou `spawn` ;
- les appels cloud réutilisent la rotation de clés, le health/cooldown et les headers du registre provider existant ;
- Ollama reste un provider local du Brain, pas un contrôleur indépendant ;
- Hermes reste conservé pour les outils PC/plugins et comme secours Code si Claude Code n'est pas installé.

## Fichiers ajoutés

- `electron/runtime/anthropic-compat.ts` — conversion Anthropic ↔ format de chat provider, tools, réponses et SSE.
- `electron/runtime/claude-code-gateway.ts` — passerelle loopback `sophenic-auto`, route Brain et fallbacks.
- `electron/runtime/claude-code.ts` — détection et lancement headless de Claude Code CLI, streaming et interruption.
- `docs/CLAUDE-CODE-GATEWAY.md` — documentation de la nouvelle architecture.
- `THIRD-PARTY-NOTICES.md` — notice tierce / inspiration Free Claude Code.

## Fichiers modifiés

- `electron/main.ts` — IPC Claude Code, Brain-only pour Chat/route/image, suppression de l'override provider/modèle venant du renderer.
- `electron/preload.ts` — bridge Code borné et API image sans choix de modèle.
- `electron/runtime/index.ts` — intégration Claude Code Gateway/Runtime dans le runtime central.
- `electron/runtime/ollama.ts` — exécution de chat Ollama pour la passerelle Brain.
- `electron/runtime/provider-client.ts` — exécution cloud générique avec coffre, rotation et health existants.
- `electron/runtime/sophenic-brain.ts` — sélection des routes Code compatibles tools et politique image centrale.
- `electron/runtime/types.ts` — statut/capacités Claude Code et Brain-managed models.
- `src/components/agent/local-agent-workspace.tsx` — suppression des pickers IA, affichage Sophenic Brain Auto, Code via Claude Code, image Brain-only.
- `src/types/electron.d.ts` — types IPC/Claude Code/image mis à jour.
- `scripts/verify-source.mjs` — invariants source Brain-only + gateway Claude Code.
- `scripts/test-sophenic.mjs` — tests de non-régression Brain-only / Claude Code / image.

## Fonctionnalités explicitement non supprimées

- Provider → Model → Key ;
- coffre sécurisé des clés ;
- rotation et fallbacks ;
- Rapide / Auto / Deep ;
- Ollama local ;
- providers cloud existants ;
- Hermes ;
- actions PC et gouvernance Agent PC ;
- plugins/intégrations existants ;
- Chat, Code, Image et design Sophenic.

## Limites connues de cette livraison

- Claude Code CLI doit être installé séparément sur la machine pour utiliser ce moteur ; il n'est pas redistribué par Sophenic.
- Le vrai comportement Claude Code + workspace + provider n'a pas pu être smoke-testé sous Windows dans ce sandbox Linux.
- Le typecheck/build complet ne peut pas être validé dans ce sandbox parce que le ZIP ne contient pas `node_modules` et l'accès à `registry.npmjs.org` échoue avec `EAI_AGAIN`. Voir `TEST-REPORT.md` pour les commandes réellement exécutées.
