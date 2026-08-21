# SOPHENIC Desktop — GitHub + Vercel

## GitHub

SOPHENIC Desktop utilise le vrai flux OAuth GitHub dans le navigateur externe.

Variables dans `.env.local` :

```env
SOPHENIC_GITHUB_CLIENT_ID=Ov23...
SOPHENIC_GITHUB_CLIENT_SECRET=...
SOPHENIC_GITHUB_OAUTH_SCOPES=read:user user:email repo
SOPHENIC_OAUTH_LOOPBACK_PORT=43821
```

Redirect URI GitHub :

```text
http://127.0.0.1:43821/oauth/github/callback
```

## Vercel

Pour l'application Desktop, le mode recommandé est le Personal Access Token Vercel. Il suffit pour l'API REST et le CLI Vercel utilisés par le moteur Code. Aucun Client ID ni Redirect URI n'est requis.

```env
SOPHENIC_VERCEL_TOKEN=vcp_...
```

Le bouton **Connecter Vercel** valide le token auprès de `https://api.vercel.com/v2/user`, puis SOPHENIC l'enregistre dans le coffre chiffré Electron/Windows pour la session de connexion.

Le mode OAuth App Vercel avec Client ID / Secret reste supporté en option pour les distributions multi-utilisateurs.

## Assistant de configuration

```powershell
npm run oauth:setup
```

Le script refuse maintenant les valeurs invalides dans le champ GitHub Client ID afin d'éviter qu'une commande telle que `npm run sophenic:start` soit enregistrée par erreur.
