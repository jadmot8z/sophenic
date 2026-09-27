# Architecture et contrats internes

## Flux de contrôle

```text
Interface → POST /api/tasks → TaskManager (une tâche exclusive)
  → Ollama health → Chromium → Planner (Plan validé)
  → OBSERVE : viewport, DOM, onglets, alertes
  → THINK : goal + plan + contexte récent + préférences + erreurs → Ollama
  → Action Pydantic + LoopGuard
  → ask_user / connexion détectée : WAITING_USER → intervention → nouvelle observation
  → AUTHORIZE : politique de risque ; actions ordinaires automatiques, risques confirmés
  → ACT : adaptateur BrowserTools → Playwright
  → VERIFY : nouveau DOM, URL, changements, erreurs de page
  → MEMORY : journal SQLite + contexte court ; erreur → nouveau plan
  → étape suivante ou réponse finale / arrêt / échec
```

Le LLM ne reçoit pas de capacité shell, Python, JavaScript ou de requête HTTP libre. Les fonctions
JavaScript nécessaires à l'extraction DOM et les méthodes Playwright sont écrites par l'application.
Le plan et la décision sont deux rôles logiques du même modèle, pas plusieurs modèles chargés en VRAM.
L'exécution est séquentielle : plusieurs agents concurrents dans la même page rendraient le consentement
et la validité des cibles difficiles à garantir.

## Modules centraux

- `agent_engine.py` orchestre la boucle et les transitions. Une enveloppe `asyncio.timeout` couvre
  aussi la planification et les confirmations sensibles. Le délai actif est suspendu pendant une
  intervention `ask_user`, elle-même bornée par `human_timeout`. Aucune relance illimitée.
- `task_manager.py` refuse les tâches concurrentes, annule le job et marque les tâches interrompues
  au redémarrage. Une nouvelle tâche ne rejoue jamais une transaction d'une ancienne tâche.
- `action_policy.py` combine impact déclaré par le LLM et règles locales qui peuvent uniquement
  renforcer la prudence. Navigation et rédaction sont automatiques ; soumissions ambiguës, opérations
  détectées et uploads demandent une confirmation. La classification n’est pas une preuve de sûreté.
- `decision_system.py` applique cette politique et gère aussi les pauses utilisateur. Aucune sortie du modèle ne peut
  supprimer une confirmation. Les IDs de confirmation expirent et ne sont pas réutilisables.
- `ollama_client.py` appelle `/api/chat` sans streaming, fournit le JSON Schema Pydantic et valide
  à nouveau la réponse. Une seule réparation est permise après une sortie mal formée.
- `element_detector.py` conserve des handles des véritables nœuds, associés à une génération
  d'observation. Les libellés exacts ne sont acceptés que s'ils sont uniques ; aucun sélecteur CSS
  arbitraire n'est accepté. Un changement d'onglet/URL ou de description invalide la cible.
- `sqlite_storage.py` utilise WAL, transactions courtes et verrou local. Le navigateur et ses captures
  partagent un verrou asynchrone pour éviter des opérations Playwright concurrentes.

## Contrat des outils

```json
{"action":"open_url","url":"https://example.com","reason":"Consulter la source"}
```

```json
{"action":"click","target":"e3-2","reason":"Ouvrir les filtres"}
```

```json
{"action":"type","target":"e4-0","value":"RTX 4070 laptop"}
```

```json
{"action":"finish","answer":"Comparaison et URL des sources consultées…"}
```

Exemple d'intervention :

```json
{"action":"ask_user","value":"Connectez-vous à Gmail dans Chromium, puis cliquez sur J’ai terminé."}
```

Exemple d'étape finale :

```json
{"action":"click","target":"e7-3","impact":"send","summary":"Envoyer à ami@example.com le message : Salut"}
```

`ask_user` ne déclenche aucune action Playwright. Son acquittement réutilise `/api/confirm/{id}`
avec `approved` et une `response` facultative ; `kind=intervention` distingue ce cas du consentement.
La réponse reste dans le contexte court ; aucun mot de passe ni code ne doit y être saisi.
Les identifiants DOM précédant l'intervention sont remplacés par une nouvelle observation.

Champs supplémentaires refusés. Le schéma complet se trouve dans `core/models.py`.
`finish` ne correspond pas à une action navigateur et ne peut pas déclencher de transaction.

## API locale

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/api/session` | Jeton anti-CSRF de cette exécution |
| GET | `/api/health` | Disponibilité d'Ollama et du modèle |
| GET | `/api/state` | Phase, onglets, confirmation en attente |
| GET / POST | `/api/tasks` | Historique / nouvelle tâche |
| GET | `/api/tasks/{id}/events?after=0` | Journal incrémental, 500 événements maximum par lecture |
| POST | `/api/stop` | Annuler et fermer Chromium |
| POST | `/api/confirm/{id}` | Accord ou refus à usage unique |
| GET | `/api/screenshot` | JPEG réel en mémoire |
| GET | `/api/preferences` | Préférences persistées |
| PUT | `/api/preferences/{key}` | Préférence saisie par l'utilisateur |
| GET | `/api/files` | Fichiers autorisés disponibles |

Les mutations nécessitent `X-Agent-Token`. L'interface effectue un polling non concurrent toutes les
1,2 secondes et recharge les événements par curseur. Pas de CORS permissif ni de dépendance CDN.

## Choix et limites

La fenêtre Chromium native reste la meilleure surface de contrôle humain. L'interface web locale évite
une seconde pile Electron/Qt et distribue des fichiers statiques sans compilation Node. Il ne s'agit pas
d'un installateur MSI, d'un EXE signé ou d'un Chromium intégré au widget UI : ce packaging peut être
ajouté après une recette Windows complète.

Les entrées web non fiables sont séparées des instructions système dans les prompts. Cela ne constitue
pas une preuve de résistance à toutes les injections. La nouvelle observation vérifie l'effet matériel
mais pas une vérité sémantique universelle. Ne confondez pas une action Playwright terminée avec une
commande commerciale confirmée. Les succès, blocages et limites doivent figurer dans la réponse finale.
