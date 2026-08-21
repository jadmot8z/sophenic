# Connexions développeur intégrées

Implémentation active :
- Paramètres → Connexions développeur (application Desktop)
- GitHub OAuth officiel : connexion, callback, persistance chiffrée, révocation/déconnexion
- Vercel OAuth officiel : connexion avec PKCE, callback, persistance chiffrée, révocation/déconnexion
- Statuts Connecté / Non connecté
- Saisie manuelle des clés : « Entrer votre clé/token GitHub ici » et « Entrer votre clé/token Vercel ici »,
  avec un bouton « Enregistrer la clé » par fournisseur.

## Saisie manuelle des clés GitHub / Vercel (nouveau)

- Le token est **validé auprès de l'API réelle** (`api.github.com/user` / `api.vercel.com/v2/user`)
  **avant** tout enregistrement. Un token refusé (invalide, révoqué) n'est jamais stocké.
- Après validation, le token est chiffré avec **Electron `safeStorage`** (DPAPI sous Windows) et stocké
  dans `%APPDATA%/SOPHENIC/connector-secrets/`. Il n'est **jamais** écrit en clair, jamais affiché après
  enregistrement (le champ est vidé), jamais journalisé, jamais inclus dans le code source ni les réponses IPC.
- Les credentials **persistent après fermeture/redémarrage** de Sophenic : ils sont restaurés au démarrage
  via `restoreDeveloperOAuth` et revalidés à l'affichage du statut.
- Un nouvel enregistrement **remplace** le token existant ; « Déconnecter » le **supprime** définitivement.
- L'état « Connecté / Non connecté » (avec le compte lié) est affiché en continu.

## Indépendance vis-à-vis de `.env.local` (correctif)

Cause historique du bug : la recherche de configuration lisait `.env.local`/`.env` via `process.cwd()`.
Lancée depuis VS Code/PowerShell, l'application avait comme répertoire courant la racine du projet
(qui contient `.env.local`) ; lancée depuis le raccourci de l'application installée, le répertoire courant
est le dossier d'installation → configuration introuvable → GitHub/Vercel « non connectés ».

Ordre de résolution désormais :
1. variables d'environnement du processus ;
2. **`%APPDATA%/SOPHENIC/sophenic.env`** (emplacement stable pour l'application installée) ;
3. `.env.local` / `.env` du répertoire courant (développement uniquement).

L'application installée fonctionne donc **sans `.env.local`** : l'utilisateur colle directement ses
clés dans l'interface. Le fichier `sophenic.env` reste utile pour un Client ID OAuth d'application
(GitHub/Vercel), sans jamais contenir de token utilisateur.

Exemple `sophenic.env` (aucune valeur réelle à committer) :
```
SOPHENIC_GITHUB_CLIENT_ID=
SOPHENIC_GITHUB_CLIENT_SECRET=
SOPHENIC_VERCEL_CLIENT_ID=
SOPHENIC_VERCEL_CLIENT_SECRET=
SOPHENIC_OAUTH_LOOPBACK_PORT=43821
```
