# SOPHENIC 5.4.9 — Autonomous Code Workspace & Stable Handoff

## Objectif

Sophenic Code devient un moteur de développement généraliste : site Web, application desktop/Windows/Electron, backend/API, CLI/script, librairie/package ou autre projet logiciel. Hermes reste le moteur agentique principal, mais l'état du projet appartient désormais à Sophenic et non au modèle/provider courant.

## Workspace autonome

- Par défaut, aucune sélection de dossier n'est requise.
- Sophenic crée automatiquement un espace sous `%LOCALAPPDATA%\Sophenic\workspaces`.
- L'agent choisit lui-même technologie, arborescence et types de fichiers adaptés.
- Bouton `Ouvrir` pour afficher l'espace courant dans l'Explorateur Windows.
- Si l'utilisateur demande de corriger/modifier un fichier existant, Sophenic ouvre un sélecteur de fichier.
- Si l'utilisateur demande d'améliorer/modifier un projet existant, Sophenic ouvre un sélecteur de dossier.
- L'état Sophenic d'un projet externe est stocké hors du projet, dans `%LOCALAPPDATA%\Sophenic\code-state`.

## Continuité multi-modèles

- Checkpoint persistant sur disque : plan, étape active, provider/modèle, demande initiale et état de progression.
- Handoff régénéré à chaque reprise/fallback avec arborescence utile, fichiers récents et `git status --short`.
- Un changement de modèle signifie « nouveau builder sur le même chantier », jamais « nouvelle tâche ».
- Le contenu/progrès déjà obtenu n'est plus effacé lors du fallback.
- Le watchdog tolère davantage le raisonnement initial : 180 s avant première progression réelle et 300 s entre progressions après démarrage.
- Trois recréations Hermes avec le MÊME builder sont tentées avant de changer de provider/modèle. Le changement de builder est un dernier recours.
- Pas de durée maximale globale tant que la tâche progresse réellement.

## Recherche Web / Git / documentation

Les capacités sûres de développement sont activées par défaut (désactivables explicitement dans Plugins) : fichiers, terminal, exécution de code, navigateur, Web, vision et skills Hermes.

Pour une tâche Code, l'agent peut utiliser :
- documentation officielle ;
- dépôts Git et GitHub ;
- issues/releases/exemples ;
- npm/PyPI/SDK/API et autres références techniques ;
- terminal/Git/build/tests ;
- navigateur, captures et vision quand disponibles.

Sécurité des scripts externes : Sophenic doit lire le contenu, vérifier provenance/licence, préférer un dépôt officiel et épingler version/commit quand pertinent. Les pipelines aveugles `curl|bash` ou `irm|iex` ne doivent pas être utilisés comme méthode normale d'intégration d'un script trouvé sur Internet.

## Quality Gate universel

La validation n'est plus centrée sur les sites Web :
- Web/UI : lancement, parcours principal, responsive, console, interactions et captures si disponibles ;
- Desktop/Windows/Electron : build, lancement, logs/processus et interactions UI via Computer Use/vision si disponibles ;
- Backend/API : serveur, endpoints, codes d'erreur, validation et logs ;
- CLI/script : cas nominal + erreur/entrée invalide + effets/codes de sortie ;
- Librairie/package : tests, typecheck/lint et exemple d'utilisation ;
- autres logiciels : preuve de fonctionnement adaptée.

Une demande professionnelle/commercialisable ajoute une passe de finition plus stricte, mais toutes les tâches Code doivent être réellement vérifiées avant livraison.

## Claude Code / Codex

Ils restent des accélérateurs optionnels. Leur absence, auth, quota, timeout ou erreur ne bloque jamais Sophenic Code : Hermes + le builder Brain actif continuent la tâche.
