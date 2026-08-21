# SOPHENIC 10.0.1 — Desktop connection hotfix

- Corrige l'erreur TypeScript `TS2339` dans `electron/runtime/developer-oauth.ts` en séparant explicitement la validation GitHub et Vercel.
- GitHub Desktop reste en OAuth navigateur + callback loopback `127.0.0.1`.
- Ajoute une validation stricte du GitHub Client ID afin qu'une commande shell ne puisse plus être enregistrée par erreur comme Client ID.
- Vercel Desktop utilise désormais par défaut `SOPHENIC_VERCEL_TOKEN` (Personal Access Token, typiquement `vcp_...`).
- Le bouton **Connecter Vercel** valide réellement le token via l'API Vercel, puis le copie dans le coffre chiffré Electron `safeStorage`.
- Aucun Client ID Vercel ni callback n'est requis en mode Personal Access Token.
- Le mode Vercel OAuth App reste disponible en fallback si un Client ID/Secret OAuth est volontairement configuré.
- Le script `npm run oauth:setup` demande désormais le Personal Access Token Vercel et nettoie les anciennes variables Client ID/Secret Vercel du `.env.local`.
- Améliore l'encodage UTF-8 du script PowerShell de configuration.
