# SOPHENIC 10.0.1 — OAuth GitHub/Vercel + rendu mathématique

## Connexions développeur

- Ajout de `Paramètres → Connexions développeur` avec statut **Connecté / Non connecté**.
- GitHub : autorisation OAuth officielle, callback, récupération du profil, persistance et déconnexion avec tentative de révocation distante.
- Vercel : flux **Sign in with Vercel** avec `state`, `nonce` et PKCE, callback, récupération du profil, persistance et révocation.
- Les jetons OAuth sont chiffrés côté serveur en AES-256-GCM avant stockage dans `tool_connections.secret_reference`.
- Ajout d'un accès visible depuis le dashboard et la navigation Paramètres.
- Suppression de l'UX qui demandait à l'utilisateur de saisir un Client ID / Token dans le panneau desktop.

## Rendu IA / mathématiques

- Ajout du renderer unique `src/components/MarkdownMathRenderer.tsx`.
- Toutes les vues de réponse IA identifiées utilisent ce renderer.
- Stack : `react-markdown`, `remark-math`, `rehype-katex`, `katex`.
- Support de `$...$`, `$$...$$`, `\(...\)`, `\[...\]` et des blocs ` ```math `.
- Réparation des blocs ` ```math ` non fermés pendant le streaming et de plusieurs lignes LaTeX brutes fréquentes.

## Configuration OAuth

Voir `.env.example`, `CONNEXIONS-DEVELOPPEUR.md` et `CONNEXIONS-DEVELOPPEUR-INTEGRE.md` pour les variables serveur et les URLs de callback.

## Validation

- `npm run verify:source` : assertions statiques OAuth, chiffrement, interface et renderer mathématique.
- Tests Sophenic et tests ciblés de normalisation mathématique / crypto-PKCE effectués dans l'environnement de livraison.
- Un build npm complet nécessite l'installation des dépendances. Le registre npm était inaccessible depuis l'environnement de livraison (`EAI_AGAIN`), donc `npm ci`/build complet n'a pas pu être finalisé ici.

## Desktop OAuth loopback fix

- Remplacement, dans l'interface Electron, du flux basé sur les cookies Supabase par un callback loopback natif `127.0.0.1:43821`.
- GitHub OAuth Authorization Code + `state` + PKCE, échange serveur local avec Client Secret.
- Vercel OAuth/OIDC Authorization Code + `state` + PKCE, support `client_secret_post`, `client_secret_basic` et clients publics `none`.
- Tokens OAuth stockés via `Electron safeStorage`, puis transmis aux connecteurs GitHub/Vercel réels de SOPHENIC Code.
- Refresh Token Vercel conservé et renouvelé au démarrage/statut lorsque nécessaire.
- Ajout de `npm run oauth:setup` et `CONFIGURER-OAUTH-DESKTOP.ps1`.
