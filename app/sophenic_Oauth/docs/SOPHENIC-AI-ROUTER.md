# SOPHENIC AI Router — Brain multi-provider

Cette version ajoute à Sophenic une couche d’orchestration **Provider → Modèle → Clé**. Le but est que l’utilisateur demande une tâche sans avoir à choisir manuellement Gemini, GPT-OSS, Qwen, etc.

## Où mettre les clés API

Dans l’application Windows, ouvre **Fournisseurs IA** dans la barre latérale ou l’en-tête.

1. Choisis le fournisseur.
2. Clique sur **Obtenir une clé** si nécessaire.
3. Colle de 1 à 20 clés dans **Coffre de clés**, une par ligne.
4. Pour Cloudflare, ajoute aussi l’**Account ID**.
5. Pour Alibaba ou Scaleway, l’URL régionale peut être remplacée par l’URL HTTPS officielle de ton compte/région.
6. Clique sur **Enregistrer dans le coffre**.

Les clés existantes ne sont jamais réaffichées. Sous Windows, le fichier de coffre est protégé avec `electron.safeStorage` et enregistré sous `%LOCALAPPDATA%\Sophenic\provider-secrets.json`. Le routeur n’enregistre dans son historique de santé qu’une empreinte SHA-256 tronquée de chaque clé, jamais la clé elle-même.

> Ne mets pas les clés globales d’un futur service public dans l’EXE. Pour une distribution multi-utilisateur, conserve les secrets maîtres dans un backend/secret vault et utilise un système BYOK séparé pour les clés privées des utilisateurs.

## Fournisseurs prévus

| Fournisseur | Rôle dans Sophenic | Configuration supplémentaire |
|---|---|---|
| Groq | moteur rapide, GPT-OSS, code/reasoning | clé API |
| Z.AI | raisonnement, code, vision | clé API |
| Google Gemini | vision, documents, contexte long | clé API |
| Cloudflare Workers AI | pool OSS / fallback | clé + Account ID |
| SiliconFlow | DeepSeek / Qwen | clé API |
| OpenRouter | catalogue / super-fallback | clé API |
| Mistral | généraliste / code | clé API |
| SambaNova | réserve gros modèles | clé API |
| Cerebras | GPT-OSS rapide | clé API |
| Cohere | documents / recherche / RAG | clé API |
| Hugging Face | modèles spécialisés | token |
| NVIDIA NIM | spécialistes / Nemotron | clé API |
| Scaleway Generative APIs | réserve européenne | clé API + URL régionale optionnelle |
| Alibaba Model Studio / Qwen | code, OCR, vision, multimodal | clé API + URL régionale optionnelle |

Les identifiants de modèles et les offres gratuites changent. Le registre se trouve dans `electron/runtime/provider-registry.ts` afin de pouvoir être mis à jour sans réécrire le cerveau.

## Modes utilisateur

- **Rapide** : privilégie latence et faible consommation, normalement une seule IA.
- **Auto** : profilage automatique. Sophenic choisit une IA et peut déclencher un conseil multi-IA seulement pour les tâches réellement complexes et parallélisables.
- **Deep** : privilégie la qualité et tente plusieurs fournisseurs distincts, puis fait une synthèse finale.

Le cerveau ne doit pas exposer les chaînes de pensée privées des modèles. L’interface peut afficher des événements opérationnels utiles : fournisseur testé, modèle choisi, fallback, cooldown, agent spécialisé et synthèse.

## Routage et fallback

`TaskAnalyzer` détecte notamment reasoning, coding, vision, documents, recherche, écriture et outils. Chaque couple Provider/Modèle reçoit un score combinant qualité par compétence, disponibilité réelle des clés, fiabilité observée, vitesse, contexte et préférence pour les ressources gratuites.

Le `ProviderClient` sélectionne ensuite une clé prête. Sur erreurs de disponibilité (`429`, timeout, `5xx`, etc.), la clé est mise en cooldown et la suivante est essayée. Les erreurs d’authentification sont elles aussi mises à l’écart temporairement afin de ne pas ralentir chaque requête. Le cooldown est réévalué automatiquement.

Cette approche est volontairement **passive** : Sophenic apprend des headers et erreurs des vraies requêtes plutôt que de brûler des quotas avec un health-check de toutes les clés avant chaque message.

## Architecture ajoutée

- `provider-registry.ts` — fournisseurs, modèles, capacités et scores initiaux.
- `provider-secrets.ts` — coffre chiffré, jusqu’à 20 clés par fournisseur.
- `provider-health.ts` — état ready/cooldown/invalid, latence et fiabilité.
- `provider-client.ts` — transport compatible OpenAI + rotation de clés.
- `sophenic-brain.ts` — profilage, scoring, fallback et conseil multi-IA.
- `provider-settings-modal.tsx` — configuration sécurisée des fournisseurs.

Le moteur Hermes/Ollama existant reste séparé pour les actions PC/Code afin que l’ajout du routeur IA ne casse pas les automatisations Windows déjà présentes.

## Variables d’environnement optionnelles

Le coffre de l’application est la méthode recommandée. Pour du développement ou de la CI, `.env.example` documente aussi `SOPHENIC_<PROVIDER>_API_KEYS`. Elles ne doivent pas être utilisées pour embarquer des secrets dans un build distribué.
