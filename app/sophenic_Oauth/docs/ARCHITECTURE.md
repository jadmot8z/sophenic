# Sophenic — Architecture local-first

## 1. Vue générale

Sophenic possède deux plans séparés : **le plan SaaS cloud** et **le plan Agent local**.

```text
                         SOPHENIC

  Cloud / Web                                  Windows / Local
  ---------------------------                  ---------------------------
  Next.js 15                                   Electron main + preload
       |                                               |
       +--> Supabase                                   +--> Hermes Agent
       |     Auth / DB / RLS / Storage                 |      tools / MCP
       |                                               |      sessions
       +--> Stripe (optionnel)                         |      approvals
       |                                               |
       +--> ancien module cloud optionnel              +--> Ollama
                                                         modèles ouverts
```

Le chat cloud historique et le Local Agent ne sont plus confondus. Le produit peut fonctionner en mode local sans OpenRouter.

## 2. Frontières de sécurité

### Renderer Electron

- `nodeIntegration: false` ;
- `contextIsolation: true` ;
- sandbox activée ;
- aucun `fs` ou `child_process` exposé ;
- origine IPC vérifiée côté main ;
- navigation limitée à l'origine Sophenic ;
- permissions Chromium distantes refusées.

### Sophenic Local Runtime

- Hermes est un processus séparé géré par Electron ;
- écoute uniquement sur `127.0.0.1` avec port éphémère ;
- le token WebSocket réellement servi est résolu avant connexion ;
- les RPC renderer sont allow-listés ;
- les mutations sensibles utilisent des méthodes Electron dédiées avec validation ;
- chaque session Sophenic force le bypass Hermes `yolo` à `off` ;
- l'UI n'expose jamais le mode d'approbation `off`.

## 3. Flux Agent local

```text
Utilisateur
   |
   v
LocalAgentWorkspace
   |
   | createSession({model, provider:'custom', cwd})
   v
Electron IPC
   |
   v
Hermes JSON-RPC gateway
   |
   +--> modèle local via Ollama /v1
   |
   +--> tool.start
   +--> approval.request ----> Sophenic modal ----> approval.respond
   +--> tool.complete
   +--> message.delta -------> UI streaming
```

La sélection native actuelle de dossier retourne uniquement le chemin explicitement choisi et le transmet comme `cwd` de session. Les futures portées fichiers/dossiers persistantes garderont la même règle : jamais d’accès générique `fs` dans le renderer.

## 4. Modèles

Ollama est une couche d'exécution, pas une autorité de licence. `src/lib/open-model-policy.ts` filtre donc le catalogue détecté. Un modèle non revu est affiché comme « À vérifier » et ne peut pas démarrer une session Sophenic.

Le registre initial approuve Qwen 3.x (Apache-2.0) et DeepSeek-R1 (MIT, avec vigilance pour les distillations).

## 5. SaaS / Supabase

Supabase continue de gérer l'identité, les conversations Web, dossiers, préférences, usage, abonnements et RLS. Les données locales sensibles doivent rester hors cloud par défaut.

Une future table de synchronisation Agent ne devra stocker que ce que l'utilisateur active explicitement. Les logs terminal, chemins de fichiers et secrets d'outils ne doivent pas être synchronisés aveuglément.

## 6. Ancien module cloud

Les routes OpenRouter existantes sont conservées pour ne pas casser le starter SaaS pendant la migration, mais elles sont désormais optionnelles et ne font pas partie du chemin Local Agent. Elles pourront être supprimées ou transformées plus tard en connecteur facultatif.

## 7. Distribution Windows

`npm run build` suit le pipeline : Next.js `standalone` -> TypeScript Electron -> copie du serveur Web local dans `dist-desktop/web` -> `asarUnpack` -> electron-builder NSIS. L’interface qui possède les capacités Hermes est donc livrée avec l’application au lieu d’être chargée depuis un domaine distant. La distribution commerciale devra ajouter code-signing, auto-update et tests E2E sur Windows réel.
