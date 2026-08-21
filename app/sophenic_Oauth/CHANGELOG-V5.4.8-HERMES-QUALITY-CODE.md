# SOPHENIC 5.4.8 — Hermes Quality Code

- Hermes reste le moteur principal de Sophenic Code.
- Les watchdogs 90 s / 180 s et les fallbacks automatiques restent actifs.
- Les demandes `professionnel`, `commercialisable`, `meilleur résultat`, etc. déclenchent un **Quality Gate**.
- Le plan inclut architecture/UX, build + aperçu, parcours principal, audit visuel/responsive et corrections qualité.
- Après la première construction, Hermes reçoit automatiquement une seconde passe obligatoire sur le workspace réel.
- Pour les interfaces Web, un style navigateur/HTML par défaut, des interactions manquantes ou un unique prototype minimal ne sont plus considérés comme terminés.
- Si un outil navigateur/Computer Use/capture est disponible, Hermes doit tester réellement desktop + vue étroite et corriger ce qu’il observe. Sinon il ne doit jamais prétendre avoir inspecté visuellement.
- Le reviewer indépendant est plus strict et refuse `OK` sans preuves de build/test/aperçu pour une demande commerciale.
- Claude Code/Codex restent facultatifs et non bloquants.
