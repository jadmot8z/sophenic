# Rapport de validation

Date : 27 septembre 2026 — version 1.1.0.

## Exécuté dans l'environnement de développement

Environnement disponible : Linux, Python **3.11.2**. Le projet et ses lanceurs ciblent Python **3.12+**.
Les dépendances ont été installées directement pour pouvoir vérifier le code dans cet environnement ;
cela ne remplace pas la recette avec la version Python déclarée dans `pyproject.toml`.

- `pytest -q --ignore=tests/test_browser.py` : **58 tests réussis**.
- `ruff check .` : réussi.
- `ruff format --check .` : réussi.
- Compilation des modules Python : réussie.
- `node --check interface/static/app.js` : réussi.

Les tests couvrent : validations JSON, refus d'actions inconnues, réparation Ollama bornée, URLs privées,
chemins d'upload, masquage des valeurs d'action, anti-boucle, confirmations et IDs périmés, API Host/Origin/
CSRF, préférences, persistance SQLite, contexte court borné, réponse finale, refus sans effet de bord,
annulation, tâche exclusive et reprise après crash. Les tests Ollama et orchestration utilisent des
doubles **uniquement dans les tests**.

Tests supplémentaires 1.1 : navigation/recherche/rédaction sans confirmation, contrôles sensibles non
rétrogradables par `impact=routine`, mots de passe et OTP manuels, contrat ask_user, délai/annulation/
reprise d'intervention, page de connexion Google suspendue sans appel LLM de décision, réobservation
après connexion, suspension du budget actif et passage des précisions utilisateur à la décision suivante.

La capture fournie par l'utilisateur montre l'interface 1.0 en fonctionnement et Ollama connecté sous
Windows. Elle montre aussi un refus de capacité du modèle au stade du plan ; les prompts et le flux
d'intervention ont été corrigés pour cela. Cela ne valide pas encore un envoi Gmail avec la version 1.1.

Un avertissement de dépréciation Starlette/TestClient relatif à httpx est émis par les versions installées.
Il ne provoque pas d'échec et ne concerne pas les appels de production à Ollama.

## Non validé ici

- Installation et exécution Windows des `.bat` et de la boucle Proactor.
- Dialogue réel avec Ollama et `qwen3:14b`, performance sur RTX, qualité des réponses.
- Intégration Chromium : le téléchargement Playwright a échoué avec `ECONNRESET` / erreur TLS sur
  les serveurs de distribution. Aucun succès navigateur n'est revendiqué à partir de tests simulés.
- Parcours de bout en bout sur des sites externes, CAPTCHA, authentification et formulaires commerciaux.
- Audit de sécurité indépendant, signature de distribution et packaging EXE/MSI.

## Recette Windows à réaliser

1. Installer Python 3.12+, Ollama et exécuter `installer.bat` sur un chemin contenant des espaces.
2. Charger `qwen3:14b`, exécuter `lancer.bat`, vérifier l'interface et la fenêtre Chromium.
3. Exécuter `pytest -q`, notamment `tests/test_browser.py` (vrai Chromium, aucun réseau nécessaire).
4. Demander « Ouvre https://example.com et résume la page avec son URL » ; navigation sans confirmation.
5. Vérifier plan, action, capture, réponse finale et persistance après redémarrage.
6. Tester une recherche, les onglets, retour/avance, rafraîchissement et défilement.
7. Tester type/select/double clic/upload sur un formulaire de test sans effets réels.
8. Refuser une action : aucune alternative ne doit être exécutée ; la tâche doit s'arrêter.
9. Arrêter pendant un appel LLM puis pendant une confirmation ; vérifier fermeture du navigateur.
10. Tester Ollama absent, modèle absent, page inexistante, bouton détaché et timeout.
11. Vérifier que l'accès aux adresses locales depuis Chromium est bloqué.
12. Examiner les fichiers SQLite/logs avec des données de test et appliquer votre politique de rétention.

Ne pas utiliser un achat ou une suppression réels comme premier test de recette.

## Recette supplémentaire 1.1

- Ouvrir Gmail sans session : WAITING_USER doit apparaître et aucun outil ne doit agir pendant l'attente.
- Se connecter directement dans Chromium puis reprendre : l'agent doit relire la boîte de réception.
- Demander un mail à un prénom ambigu : l'agent doit demander l'adresse exacte et utiliser la réponse.
- Préparer un brouillon de test : saisie automatique, puis confirmation avant Envoyer avec résumé.
- Refuser l'envoi : aucune soumission ne doit avoir lieu. Accepter uniquement avec un compte de test.
- Tester « Envoyer » déclaré routine par un double de modèle : le contrôle local exige tout de même l'accord.
- Annuler ou laisser expirer une intervention : aucune reprise automatique.
- Si Google refuse le navigateur, vérifier le signalement du blocage ; ne pas contourner sa protection.
