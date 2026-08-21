# SOPHENIC — Import sécurisé des clés API

Cette version **n’intègre aucune clé API en clair dans le code, le ZIP ou l’EXE**.

## Pool reconnu dans le fichier utilisateur

| Fournisseur | Entrées attendues |
|---|---:|
| OpenRouter | 7 clés |
| Groq | 6 clés |
| Z.AI | 4 clés |
| Google Gemini | 5 clés |
| Cloudflare Workers AI | 4 couples Token + Account ID |
| SiliconFlow | 5 clés |
| Mistral | 5 clés |
| SambaNova | 4 clés |
| Cerebras | 5 clés |
| Cohere | 5 clés |
| Hugging Face | 1 token |
| AI/ML API | 1 clé |
| Scaleway | 1 Secret Key (+ Access Key ID comme métadonnée) |

Total: **53 secrets d’authentification utilisables** dans le fichier fourni.

Le libellé `GROK AI` du fichier est volontairement interprété comme **Groq**, car les identifiants de cette section correspondent au format utilisé pour les clés Groq. Cela ne crée pas un fournisseur xAI/Grok.

## Import dans Sophenic

1. Compile et installe Sophenic.
2. Ouvre **Fournisseurs IA**.
3. Clique **Importer TXT**.
4. Sélectionne ton fichier de clés.
5. Sophenic parse le fichier, associe chaque clé au bon fournisseur et écrit le résultat dans le coffre local.
6. Sous Windows, le coffre utilise `electron.safeStorage`.
7. Après confirmation de l’import, **supprime le fichier TXT en clair**.

Les clés ne sont jamais réaffichées dans l’interface.

## Cas particuliers

### Cloudflare

Chaque token Cloudflare est conservé avec **son propre Account ID**. Le routeur peut donc utiliser plusieurs comptes Cloudflare sans mélanger un token avec le mauvais compte.

### Scaleway

Pour Generative APIs, l’authentification d’inférence utilise la **Secret Key** en `Bearer`. L’Access Key ID est conservé uniquement comme métadonnée locale. L’URL Serverless par défaut est :

`https://api.scaleway.ai/v1`

### AI/ML API

AI/ML API est ajouté comme fournisseur de réserve à faible priorité. Il utilise :

`https://api.aimlapi.com/v1`

Il n’est pas considéré comme une ressource gratuite illimitée : le Brain le garde derrière les fournisseurs prioritaires.

## Sécurité / quotas

Le routeur suit les réponses HTTP, `Retry-After`, cooldowns et erreurs de quota. Plusieurs clés ne doivent pas être utilisées pour contourner une limite imposée au niveau d’un même compte, projet ou organisation. Sophenic traite les identifiants comme des routes configurées et respecte les refus/rate limits des fournisseurs.

Comme des clés ont été partagées dans une conversation avant l’import local, la meilleure pratique est de **les révoquer/régénérer après validation du système**, puis de réimporter le nouveau fichier localement.
