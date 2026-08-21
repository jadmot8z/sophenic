# SOPHENIC CODE ENGINE FINAL HARDENING

Cette passe finale conserve l'architecture existante et renforce les points critiques :

- Hermes n'est pas un moteur obligatoire du Code Engine.
- Le Code Engine natif reste prioritaire : Brain -> Model Router -> Tools.
- Les tâches longues doivent conserver workspace, checkpoints et contexte.
- Les outils doivent échouer proprement sans bloquer toute l'application.

Avant utilisation commerciale, exécuter :

npm install
npm run typecheck
npm run test:sophenic
npm run build

Les connecteurs externes (GitHub, Vercel, Docker, Playwright) nécessitent leurs propres identifiants et dépendances utilisateur.
