# SOPHENIC 5.4.2 — Commercial Router

Cette révision renforce Sophenic Brain comme orchestrateur multi-IA et isole les pannes de providers/outils.

## Routage et providers

- Une clé ou un modèle invalide ne termine plus immédiatement la demande : rotation de clés puis fallback vers d'autres modèles/providers compatibles.
- Les clés invalides ou en quota sont mises en cooldown par le registre de santé.
- xAI / Grok reçoit une priorité pour les conversations simples lorsqu'une clé valide est disponible.
- Les identifiants internes Sophenic ne sont plus utilisés comme identifiants de modèle xAI dans le pipeline Code.

## Code multi-IA

- Auto reste léger pour les tâches simples.
- Auto active un plan + relecture si la tâche est complexe ou si l'utilisateur demande explicitement un résultat premium/commercialisable/production-ready.
- Deep utilise une orchestration Planner → Builder → Reviewer.
- Le panneau Code affiche un plan persistant : en attente, en cours, terminé, pause ou erreur.
- `MODELS USED` peut afficher séparément le modèle de planification, de construction et de relecture.

## Hermes et reprise

- Plus de limite arbitraire basée sur la durée totale d'une tâche.
- Tant que fichiers, terminal, tests ou état progressent, le travail continue.
- Après environ 120 secondes sans progrès utile, le tour est interrompu proprement et un checkpoint est conservé.
- Une demande « continue / reprends / poursuis » recharge le workspace et reprend le plan depuis l'étape courante.
- Hermes est arrêté dès que le tour Code se termine normalement, est mis en pause ou échoue définitivement.

## Images et enrichissement

- Génération d'images : fallback xAI → Gemini → OpenRouter.
- Recherche d'images de référence : jusqu'à 5 résultats dans un carrousel horizontal.
- Les questions visuelles courtes peuvent être enrichies automatiquement par des images réelles.

## Lieux

- Recherche de lieux pour les demandes telles que « magasin gamer Grenoble » ou « où se trouve X à Paris ».
- Jusqu'à 5 résultats : nom, adresse, coordonnées, horaires/téléphone/site quand la source les fournit, carte et itinéraire.
- Le géocodeur est configurable par `SOPHENIC_GEOCODER_URL` pour une infrastructure de production.

## Validation effectuée dans l'environnement de préparation

- `node scripts/verify-source.mjs` : OK — 61 fichiers critiques.
- `node scripts/test-sophenic.mjs` : OK — 23 groupes / 140+ assertions.
- Analyse syntaxique TypeScript des fichiers modifiés : OK.
- Le `npm run typecheck` complet est également exécuté par `RUN-SOPHENIC-VSCODE.ps1` sur Windows avant le lancement. L'installation npm complète n'a pas terminé dans l'environnement de préparation, donc ce contrôle s'effectue sur la machine de test Windows.
