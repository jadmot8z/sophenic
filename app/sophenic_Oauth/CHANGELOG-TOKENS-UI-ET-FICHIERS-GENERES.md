# 10.0.2 — Correctif clés GitHub/Vercel + livraison des fichiers générés

## Problème 1 — Clés/API GitHub et Vercel indisponibles dans l'application installée

**Cause exacte** : `electron/runtime/developer-oauth.ts` résolvait la configuration via
`process.env` et un fichier `.env.local`/`.env` lu depuis `process.cwd()`. Depuis
VS Code/PowerShell, le répertoire courant est la racine du projet (`.env.local` présent,
variables héritées de la session) → tout fonctionne. Depuis l'application installée
(raccourci Bureau/Menu démarrer), le répertoire courant est le dossier d'installation :
`.env.local` est introuvable et les variables de session n'existent pas → tokens
GitHub/Vercel absents → « Non connecté ».

**Correctifs**
- Nouvelle interface « Clés / tokens personnels » dans Paramètres → Connexions développeur :
  « Entrer votre clé/token GitHub ici », « Entrer votre clé/token Vercel ici », bouton
  « Enregistrer la clé » par fournisseur.
- Validation réelle du token auprès de l'API du fournisseur **avant** enregistrement ;
  un token refusé n'est jamais persisté.
- Stockage chiffré via Electron `safeStorage` (coffre `userData/connector-secrets`),
  persistance après redémarrage, remplacement et suppression possibles, statut
  Connecté / Non connecté affiché. Jamais d'affichage en clair après saisie, jamais de log.
- Nouvelle source de configuration stable pour l'application installée :
  `userData/sophenic.env` (lue avant `.env.local`, qui reste utile en développement).
  L'application installée ne dépend plus de `process.cwd()` ni de `.env.local`.
- IPC dédié `sophenic:developer-connections:save-token` protégé par `assertTrustedFrame`.

## Problème 2 — Fichiers produits par Sophenic Code

- Nouveau module `electron/runtime/code-engine/artifact-tracker.ts` :
  - instantané du workspace en début de tâche ;
  - détection de **tous** les nouveaux fichiers en fin de tâche, quelle que soit la
    source (outil filesystem, **commande terminal** type `Compress-Archive`/`zip`,
    génération d'images, scripts…) ;
  - un fichier déjà présent avant la tâche n'est jamais présenté comme généré ;
  - attente de stabilité (taille stable > 0) avant d'annoncer un fichier : un fichier
    encore en cours d'écriture n'est jamais livré ;
  - classement par pertinence (ZIP/archives, documents, images, médias, texte).
- Le moteur autonome émet un événement `artifacts` et l'ajoute au résultat de la tâche.
- Nouvelle carte « Fichier prêt » sous le dernier message de l'IA : nom du fichier,
  type, taille, et boutons **Télécharger** (Enregistrer sous), **Ouvrir**,
  **Afficher dans le dossier**. Fonctionne pour ZIP, PDF, images, texte, médias, etc.
- IPC dédiés `sophenic:code:artifact-save|open|reveal` avec vérification du chemin sur
  disque avant toute action.

## Corrections annexes

- `src/app/(app)/settings/connections/page.tsx` : erreur TypeScript préexistante sur
  `config.mode` (union github/vercel) corrigée ; apostrophes JSX échappées.
- `electron/runtime/code-engine/agents/system-check.ts` : suppression des `any`.
- `eslint.config.mjs` : exclusion ciblée des points d'entrée CommonJS pour un lint à 0 erreur.
- Nouvelle suite de tests `scripts/test-desktop-runtime.mjs` (mock Electron, sans binaire) :
  fallback `sophenic.env`, validation avant stockage, persistance après redémarrage simulé,
  déconnexion propre, absence de token dans statuts/logs, détection d'artefacts.
