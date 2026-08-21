# SOPHENIC 5.4.4 — Code Engines & Reliability

## Sophenic Code / Hermes

- Hermes reste le moteur d’exécution principal du mode Code.
- Détection dédiée de `HTTP 401: User not found` : la session Hermes est recréée et la tâche reprend depuis le workspace/checkpoint au lieu de s’arrêter.
- Claude Code et Codex deviennent des accélérateurs facultatifs. Leur échec, absence, quota ou problème d’authentification n’arrête jamais Sophenic Code.
- Le mode Code interdit le déclenchement de Google OAuth lorsque la demande ne concerne pas explicitement un service Google.
- Le header Code affiche `Claude Code` et `Codex` avec check/croix. Le check exige installation + auth + mini appel réel réussi, pas seulement la présence du binaire.

## Providers

- Les nouvelles clés saisies sont testées auprès du provider avant sauvegarde.
- 401/403 ou clé invalide : clé refusée et non stockée.
- 402/429 : credential reconnu mais limité ; il peut être conservé et géré en cooldown.

## Chat / Image

- Une demande explicite de génération d’image depuis Chat est redirigée automatiquement vers Sophenic Image.
- Les images générées ouvrent l’image elle-même et disposent d’un bouton de téléchargement.
- Une demande explicite de photos réelles utilise le moteur Wikimedia déterministe. Aucun résultat = aucune URL inventée et pas de fallback LLM halluciné.

## Lieux

- Les requêtes commerciales/locales passent par la recherche cartographique déterministe avant tout LLM.
- Des variantes sont utilisées pour les recherches comme `magasins gaming à Grenoble` et `Sephora Champs-Élysées`.
- Aucun résultat vérifié = Sophenic le dit explicitement au lieu d’inventer commerces, adresses, téléphones ou sites.
- Les résultats vérifiés alimentent la fiche latérale avec photo de référence si disponible, adresse, téléphone, horaires, site et itinéraire.

## Mathématiques

- Normalisation de plusieurs formes de pseudo-LaTeX vers les délimiteurs KaTeX.
- Les problèmes mathématiques difficiles déclenchent plus facilement une vérification multi-IA en mode Auto.
