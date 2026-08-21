# SOPHENIC 5.4.5 — Resilient Code + Local Search

## Corrections de cette version

- **Sophenic Code / Hermes** : un `401 User not found` met maintenant en quarantaine la clé réellement utilisée, tente une autre clé vérifiée du même fournisseur, puis un autre fournisseur dans une nouvelle session Hermes. Une reconstruction de session Hermes n’arrive qu’en dernier recours. Claude Code et Codex restent facultatifs et leur panne ne bloque pas la route Code normale.
- **Localisation** : les formulations comme `donne alors la localisation Burger King Marrakech`, `Burger King Marrakech`, `où est Sephora...` et les recherches de commerces par catégorie sont interceptées avant le LLM. Nominatim est complété par une recherche Overpass de marque/catégorie en ville, avec fiches, coordonnées, itinéraire, site/téléphone/horaires quand les données cartographiques les contiennent.
- **Cloudflare** : la validation n’utilise plus une route `/models` incompatible. Elle vérifie d’abord le token, puis l’Account ID et l’accès Workers AI. L’import TXT n’impose plus un préfixe de token arbitraire.
- **Scaleway** : l’Access Key ID `SCW…` n’est plus traité comme une URL. La Secret Key est vérifiée sur l’endpoint Generative APIs. Les anciennes URL non-HTTPS erronées sont ignorées dans le coffre lors de la lecture.
- **xAI / Grok** : priorité de routage renforcée pour les conversations simples quand une clé xAI vérifiée est saine. Si xAI est invalide, en cooldown ou limité, le Brain passe immédiatement au classement normal.
- Les fonctions Image/référence déjà validées en 5.4.4 sont conservées.

## Production

Les endpoints publics Nominatim/Overpass restent des fallbacks de développement. Pour une distribution commerciale importante, utiliser des endpoints hébergés/self-hosted ou un fournisseur Places sous licence.
