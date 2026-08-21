# Connexions développeur — GitHub + Vercel

SOPHENIC fournit désormais de vrais boutons OAuth dans :

`Paramètres → Connexions développeur`

## GitHub

1. Créer une OAuth App GitHub.
2. Ajouter comme callback :
   - local : `http://localhost:3000/api/connections/github/callback`
   - production : `https://VOTRE-DOMAINE/api/connections/github/callback`
3. Configurer `SOPHENIC_GITHUB_CLIENT_ID` et `SOPHENIC_GITHUB_CLIENT_SECRET`.
4. Le bouton **Connecter GitHub** redirige vers l'écran officiel GitHub, valide `state`, échange le `code`, vérifie le compte et enregistre la connexion.
5. **Déconnecter GitHub** révoque le token côté GitHub puis efface le secret local.

## Vercel

1. Créer une Vercel App et activer Sign in with Vercel.
2. Ajouter comme callback :
   - local : `http://localhost:3000/api/connections/vercel/callback`
   - production : `https://VOTRE-DOMAINE/api/connections/vercel/callback`
3. Configurer `SOPHENIC_VERCEL_CLIENT_ID` et `SOPHENIC_VERCEL_CLIENT_SECRET`.
4. Configurer dans la Vercel App les permissions de ressources dont SOPHENIC a besoin.
5. Le bouton **Connecter Vercel** utilise `state`, `nonce` et PKCE (`S256`), échange le code et enregistre la connexion.
6. **Déconnecter Vercel** appelle l'endpoint officiel de révocation puis efface le secret local.

## Stockage des tokens

Les access/refresh tokens ne sont jamais envoyés au navigateur après le callback. Ils sont chiffrés en AES-256-GCM dans `tool_connections.secret_reference` avec `SOPHENIC_CONNECTIONS_ENCRYPTION_KEY`. Si cette variable n'est pas définie, une clé est dérivée du `SUPABASE_SERVICE_ROLE_KEY` déjà serveur-only.

Les métadonnées non secrètes (identifiant de compte, username, scopes, date de connexion) restent visibles pour afficher le statut **Connecté / Non connecté**.
