# SOPHENIC 5.4.3 — Robust Multi-AI

- Routage Brain diversifié par spécialité + pénalité de répétition pour éviter un Gemini systématique.
- Deep/Auto complexe expose tous les modèles réellement utilisés (agents + synthèse).
- Le routage Sophenic normal n'est plus affiché comme un faux « fallback ».
- Hermes n'interrompt plus automatiquement le travail après 2 minutes d'inactivité visuelle ; seule une vraie fin/erreur ou l'arrêt utilisateur termine le tour.
- Les erreurs fournisseur visibles dans Hermes (401, clé, quota, modèle) déclenchent un fallback automatique vers une autre route. Une nouvelle session Hermes est créée sur le provider de secours pour éviter de conserver une session empoisonnée.
- Fiches lieux visuelles : panneau latéral type fiche lieu, image, adresse, horaires/téléphone si disponibles, Google Maps, itinéraire, autres résultats. Les requêtes de lieu utilisent directement le moteur local au lieu de laisser le LLM inventer l’adresse.
- Recherche d'images réelle via Wikimedia Commons avec suggestion Wikipedia en cas de faute approximative ; aucune URL fictive.
- Génération image : xAI → Cloudflare FLUX → Hugging Face Inference Providers → Gemini → OpenRouter.
- Mathématiques : Markdown + remark-math + KaTeX.
- xAI inclut Grok 4.5 et Grok Build 0.1 dans le catalogue Brain.

Tests attendus : `npm run verify:source`, `npm run test:sophenic`, `npm run typecheck`.
