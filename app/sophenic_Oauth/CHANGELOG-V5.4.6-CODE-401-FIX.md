# SOPHENIC 5.4.6 — Code 401 Fix

## Objectif

Éliminer la classe de panne `HTTP 401: User not found` observée dans SOPHENIC Code lorsque Hermes héritait d'un état d'authentification/provider sans rapport avec la route réellement choisie par Sophenic Brain.

## Corrections

- Profil Hermes dédié à SOPHENIC Code via `HERMES_HOME` : `%LOCALAPPDATA%\Sophenic\hermes-code` sous Windows.
- Le profil utilisateur Hermes existant (`~/.hermes` / `%LOCALAPPDATA%\hermes`) n'est plus utilisé comme source de sessions, auth pools ou fallback provider pour SOPHENIC Code.
- Le gateway Hermes est verrouillé sur **un seul provider Brain à la fois**. Un changement de provider redémarre proprement le gateway avant de créer une nouvelle session.
- Seule la clé du provider actif est injectée dans le processus Hermes ; les variables de providers héritées sont supprimées.
- Les custom providers Hermes utilisent `base_url`, `api`, `key_env` et une référence `${ENV_VAR}` dans `api_key` pour contourner les régressions Hermes connues autour de `key_env`, sans écrire la vraie clé dans `config.yaml`.
- `model.provider` et `model.default` sont verrouillés avant le démarrage du gateway afin que les tâches auxiliaires Hermes utilisent la même route que le builder.
- Le renderer Code ne démarre plus un Hermes générique avant `session.create`.
- Les deltas Hermes ne sont plus considérés comme source autoritaire en Code ; `session.history` + `session.status` pilotent le rendu.
- Un `HTTP 401: User not found` auxiliaire n'est plus affiché comme réponse utilisateur tant que le tour principal continue.
- Une erreur d'identité Hermes non attribuable au provider actif ne met plus une clé saine en cooldown/invalid.
- Reconnexion isolée automatique jusqu'à deux fois, puis fallback provider sans invalider arbitrairement la clé précédente.
- Claude Code et Codex restent strictement non bloquants.

## Sécurité

Aucune clé provider n'est écrite en clair dans le nouveau profil Hermes. Le coffre Electron `safeStorage` reste la source de vérité des secrets SOPHENIC.
