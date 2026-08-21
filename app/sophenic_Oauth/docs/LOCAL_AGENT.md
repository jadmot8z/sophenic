# Sophenic Local Agent — Hermes + Ollama

## Objectif

Le chemin local doit permettre à Sophenic Desktop de sélectionner un modèle ouvert exécuté sur la machine, de piloter Hermes Agent et d'afficher toutes les actions sensibles avant leur exécution.

```text
Next.js standalone embarqué (loopback)
        |
        v
React renderer Desktop
        |
        | API contextBridge très limitée
        v
Electron preload
        |
        | IPC validé
        v
Electron main
        |
        +--> Hermes process: hermes serve --host 127.0.0.1 --port 0
        |       |
        |       +--> JSON-RPC / WebSocket localhost
        |       +--> tools / MCP / skills / sessions
        |
        +--> Ollama API localhost:11434
                +--> modèles installés
```

## Contrat de sécurité

Le renderer n'obtient pas `fs`, `child_process`, PowerShell ou `shell.exec`. Il peut uniquement demander des opérations de haut niveau au bridge. L'exécution d'outils reste la responsabilité de Hermes.

Sophenic applique en plus :

- en production, UI privilégiée Next.js embarquée et servie uniquement sur `127.0.0.1` ;
- aucune URL SaaS distante n’obtient le preload Hermes ;
- origine **et route** IPC vérifiées (`/desktop/agent`) ;
- gateway lié à `127.0.0.1` uniquement ;
- token WebSocket de session ;
- `yolo=off` forcé pour chaque session Sophenic ;
- modes d'approbation UI limités à `manual` et `smart` ;
- réponses d'approbation limitées à `once`, `session`, `always`, `deny` ;
- aucune permission Chromium distante ;
- aucune API directe fichiers/terminal dans le preload.

## Lifecycle UI Desktop

1. En développement, Electron accepte uniquement `SOPHENIC_DESKTOP_DEV_URL` sur loopback et la route `/desktop/agent`.
2. En production, Electron démarre `web/server.js` issu de la sortie Next.js `standalone` sur un port local aléatoire.
3. Le serveur est placé dans `resources/web` hors ASAR afin que le processus Node embarqué puisse exécuter `server.js` et conserver intact son arbre `node_modules` standalone.
4. Le preload ne répond qu’aux frames provenant de l’origine locale générée et de `/desktop/agent`.

## Lifecycle Hermes

1. Résoudre Hermes : variable `SOPHENIC_HERMES_COMMAND`, installation Windows standard, installation Unix standard, puis `PATH`.
2. Vérifier `hermes --version`.
3. Démarrer `hermes serve --host 127.0.0.1 --port 0`.
4. Attendre `HERMES_BACKEND_READY` ou `HERMES_DASHBOARD_READY`.
5. Lire le token réellement injecté par le backend et refuser un backend étranger si le child process n'est plus vivant.
6. Ouvrir `/api/ws?token=...`.
7. Épingler le toolset interactif complet `hermes-cli`, puis créer une session `source: desktop` avec le modèle/provider sélectionné par Sophenic.
8. Forcer le bypass session à `off`.
9. Streamer uniquement les événements visibles de réponse et d’outils ; traiter explicitement `approval`, `clarify`, `sudo` et `secret`, sans recopier `reasoning/thinking/analysis` dans le chat.
10. Pour les tâches Code, utiliser un dossier de travail autorisé et reprendre automatiquement une génération tronquée sur un modèle de secours en inspectant l’état réel du dossier.
11. Fermer le processus géré lorsque Sophenic quitte.

## Ollama

Sophenic utilise l'API native Ollama pour la découverte et comme secours local du chat :

- `/api/version` : état/version ;
- `/api/tags` : modèles installés ;
- `/api/chat` : fallback local lorsque les routes OpenRouter ont échoué avant le premier texte visible.

Le fallback écarte les modèles manifestement non conversationnels (embedding/reranking), privilégie les modèles chat/instruct légers et désactive la sortie de pensée séparée afin d’obtenir une réponse visible.

## Modèles et licences

`src/lib/open-model-policy.ts` est volontairement distinct de la découverte Ollama. Une image de modèle peut être locale tout en ayant une licence non compatible avec les règles Sophenic.

Le registre actuel est minimal : Qwen 3.x et DeepSeek-R1. Pour ajouter une famille :

1. vérifier la licence des **poids exacts** et pas seulement la licence du code ;
2. vérifier les dérivations/distillations ;
3. vérifier l'usage commercial et la redistribution ;
4. ajouter une règle précise dans le registre ;
5. ajouter un test de policy avant publication.

Ce registre technique ne remplace pas une revue juridique avant distribution commerciale.

## Prochaines étapes techniques

- Assistant d'onboarding Hermes/Ollama dans l'UI.
- Détection de la compatibilité RAM/VRAM et recommandations de quantification.
- Import/synchronisation opt-in des sessions Agent dans Supabase.
- Extension du sélecteur natif de dossier vers des portées fichiers/dossiers persistantes par projet.
- Affichage plus riche des tool calls et diff avant écriture.
- Profils de permissions par projet.
- Tests d'intégration Windows avec un vrai Hermes + Ollama.
- Signature de code et auto-update pour la distribution commerciale.
