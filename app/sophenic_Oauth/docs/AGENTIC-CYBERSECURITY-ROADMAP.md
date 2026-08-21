# SOPHENIC 5.4 — Architecture agentique et parité HackerGPT

Date de référence : 2026-08-16

## Objet

Ce document définit l'évolution de SOPHENIC sans repartir de zéro. La base existante reste le produit principal : Electron/Next.js, Action Router Windows, OpenRouter/Ollama, Hermes Agent, Computer Use, Sophenic Code, mémoire de langue, Model Manager et Smart Approval.

La cible n'est pas de transformer SOPHENIC en « chatbot de hacking ». La cible est un assistant desktop agentique généraliste avec un mode cybersécurité professionnel, traçable et limité à des environnements autorisés.

## 1. Capacités publiques vérifiées d'un HackerGPT moderne

Les documentations publiques HackerGPT/HackerGPT Lite décrivent aujourd'hui les familles de fonctions suivantes :

- chat spécialisé cybersécurité et apprentissage ;
- scans réseau : découverte de services, SYN, TCP, détection OS/version ;
- fingerprinting Web ;
- analyse SSL/TLS ;
- recherche CVE et corrélation version/vulnérabilité ;
- recherche de scripts/PoC publics associés à une CVE ;
- navigateur automatisé avec collecte des logs réseau ;
- CTF Mode agentique avec cartographie d'application, navigation réelle, itération et validation dans un environnement de test ;
- workspace CTF avec panneaux Network, Payloads, API Map et Memory ;
- WHOIS, sous-domaines, GeoIP ;
- analyse EXIF/métadonnées ;
- recherche OSINT, y compris certaines sources dark-web ;
- analyse d'adresses/tokens crypto et contrôles de sanctions ;
- fonctions OSINT spécialisées annoncées publiquement : recherche d'e-mails, recherche dans des leaks, téléphone et recherche d'images/visages.

Certaines de ces fonctions touchent à des données personnelles ou à des opérations offensives. SOPHENIC ne doit pas les recopier sans garde-fous : l'architecture doit distinguer renseignement public, sécurité défensive, CTF/lab autorisé et actions potentiellement intrusives.

## 2. État actuel de SOPHENIC et écart à combler

### Déjà présent dans SOPHENIC

- Action Router prioritaire pour actions Windows déterministes.
- Lancement/fermeture d'applications avec vérification de processus.
- Spotify, volume Windows, heure/date, fichiers et dossiers locaux.
- Computer Use via Hermes pour cliquer, taper et naviguer.
- Sophenic Code avec espace de travail explicite.
- Terminal/fichiers/code_execution disponibles via les capacités Hermes configurables.
- Recherche Web, navigateur, vision, image generation, mémoire et skills exposés par le gestionnaire d'intégrations.
- Model Manager OpenRouter/Ollama avec fallback visible.
- Mémoire persistante de langue.
- Identité runtime Sophenic distincte du modèle moteur.
- Smart Approval Hermes, sans mode yolo/permanent exposé.
- Journal d'actions Code.
- À partir de 5.4 : panneau `Thinking`/activité repliable, à hauteur fixe, alimenté par des événements réels et sans exposition de chaîne de pensée privée.

### Partiellement couvert

- Analyse de projets complets : possible avec Hermes Code, mais il manque un index de repo persistant, une carte de symboles et une mémoire de projet structurée.
- Recherche technique : possible avec Hermes Web/Browser, mais il manque une couche de preuve/citations et une normalisation des résultats.
- Cybersécurité défensive : possible manuellement via terminal/Web, mais il manque un mode Security Lab, un scope explicite et des outils structurés.
- OSINT légal : les briques Web existent, mais il manque des connecteurs dédiés, des règles de confidentialité et une provenance des données.
- Planification : Hermes possède todo/delegation/code_execution, mais SOPHENIC ne présente pas encore un orchestrateur unifié de tâches longues.

### Manquant pour une vraie parité fonctionnelle

- Capability Registry centralisé et typé.
- Planner/Executor/Verifier explicite.
- Security Scope Gate avant tout scan ou test actif.
- Sandbox/lab de cybersécurité séparé du Windows hôte.
- Browser Network Recorder et API Map persistants.
- Evidence Ledger : commandes, requêtes, réponses, fichiers, timestamps, hash et résultat de validation.
- Payload Vault limité aux labs/CTF autorisés.
- Vuln Intelligence : CVE/CVSS/EPSS/advisories/versions avec provenance.
- OSINT connectors avec politique de données personnelles.
- Repo Index/RAG local pour grands projets.
- Subagents spécialisés et budget de tâches.
- Scheduler/long-running jobs avec reprise.
- Evaluation harness et benchmark de non-régression.

## 3. Modules logiciels recommandés

### `src/agent/orchestrator.ts`

Boucle principale : objectif -> plan -> exécution -> observation -> vérification -> mémoire -> prochaine étape.

### `src/agent/capability-registry.ts`

Registre unique des capacités. Chaque capacité déclare :

- identifiant ;
- catégorie ;
- outil/provider ;
- permissions nécessaires ;
- risque ;
- environnement d'exécution ;
- schéma d'entrée/sortie ;
- timeout ;
- politique de retry ;
- confirmation requise ou non.

### `src/agent/policy-engine.ts`

Décide si l'action est : autorisée automatiquement, soumise à confirmation, limitée à un workspace/lab, ou refusée.

### `src/agent/task-planner.ts`

Produit un plan structuré et révisable. Le plan visible doit être un résumé opérationnel, jamais la chaîne de pensée privée du modèle.

### `src/agent/tool-executor.ts`

Point d'entrée unique vers Action Router, Hermes, Windows API, terminal, navigateur, services externes et sandbox.

### `src/agent/verifier.ts`

Vérifie les effets : processus réellement lancé, fichier réellement créé, endpoint réellement accessible, test réellement passé, résultat de scan réellement parseable.

### `src/agent/workspace-memory.ts`

Mémoire par projet : objectifs, décisions, fichiers importants, commandes, tests, erreurs, TODO et résumés de sessions.

### `src/agent/evidence-ledger.ts`

Journal append-only de ce qui a été exécuté. Indispensable pour Code et Security Lab.

### `src/security/security-scope.ts`

Scope signé/explicite pour une cible de sécurité : domaines/IP autorisés, type de test, durée, environnement, exclusions et propriétaire du scope.

### `src/security/lab-runner.ts`

Exécute les outils de sécurité dans un environnement isolé : VM, WSL2, Docker/Podman ou sandbox dédiée. Pas dans le Windows hôte par défaut.

### `src/security/vulnerability-intel.ts`

Normalise CVE, sévérité, version, vendor advisory, OSV et autres sources de vulnérabilités.

### `src/security/browser-recorder.ts`

Capture navigation, requêtes/réponses, endpoints, erreurs console et métadonnées utiles, avec redaction des secrets.

### `src/security/api-map.ts`

Graphe des endpoints découverts : méthode, route, paramètres, auth, provenance, observations et état de validation.

### `src/osint/*`

Connecteurs spécialisés pour DNS/RDAP/WHOIS/certificats publics/métadonnées, avec provenance et politique de confidentialité.

### `src/components/agent/thinking-panel.tsx`

Implémenté en 5.4. Affiche un journal d'activité sûr : routage, modèle, outils, fichiers, commandes, tests, fallback et statut. La zone est fixe ; les nouvelles lignes poussent les anciennes vers le haut à l'intérieur du panneau.

## 4. Architecture recommandée

```text
Utilisateur
   |
   v
Priority Action Router ----------------------> Windows API / actions locales
   |
   v
Intent Router
   |
   v
Policy Engine / Permission Gate
   |
   +------------------------------+
   |                              |
   v                              v
Chat direct                   Agent Orchestrator
OpenRouter/Ollama                 |
                                  v
                            Task Planner
                                  |
                                  v
                         Capability Registry
                                  |
             +--------------------+---------------------+
             |                    |                     |
             v                    v                     v
          Hermes             Windows Native       Security Lab
   browser/file/terminal     audio/apps/files    scanners/DAST
             |                    |                     |
             +--------------------+---------------------+
                                  |
                                  v
                              Verifier
                                  |
                    +-------------+-------------+
                    |                           |
                    v                           v
             Workspace Memory            Evidence Ledger
                    |                           |
                    +-------------+-------------+
                                  |
                                  v
                        Réponse + Activity Trace
```

Principes :

1. Les actions déterministes restent prioritaires sur le LLM.
2. Le modèle choisit une capacité, mais le Policy Engine garde le dernier mot.
3. Les outils ne renvoient que des observations structurées à l'orchestrateur.
4. Toute affirmation d'action terminée doit être vérifiée.
5. Les tâches de sécurité actives nécessitent un Security Scope valide.
6. Le mode Security Lab s'exécute hors de l'hôte principal autant que possible.
7. Le panneau Thinking ne rend jamais le raisonnement privé brut.

## 5. Outils et API

### À exploiter en priorité via Hermes

Hermes fournit déjà des toolsets utiles : browser, file, terminal, web, coding, debugging, todo, memory, session_search, clarify, code_execution, delegation, vision et d'autres intégrations. SOPHENIC doit réutiliser ces briques avant d'écrire des doublons.

Le toolset `coding` est particulièrement adapté au mode Sophenic Code : fichiers + terminal + recherche + Web + browser + todo + memory + code execution + delegation + vision.

`execute_code` peut réduire le coût contexte lors de workflows de plusieurs appels : le script orchestre plusieurs outils et ne renvoie au modèle que le résultat final utile.

### Outils locaux structurés à ajouter pour le mode Security Lab

- Nmap pour découverte/versions dans un scope autorisé.
- OWASP ZAP pour DAST contrôlé de staging/CTF.
- Semgrep pour SAST.
- Trivy/Grype/OSV-Scanner pour dépendances, images et composants.
- Gitleaks ou équivalent pour recherche de secrets dans les dépôts autorisés.
- analyseurs SBOM (CycloneDX/SPDX).
- outils DNS/RDAP/Certificate Transparency pour OSINT technique public.

Chaque outil doit être encapsulé derrière un wrapper typé. Le LLM ne doit pas construire librement une ligne shell arbitraire quand un wrapper sûr existe.

## 6. Sécurité indispensable

### Garde-fou de scope

Aucun scan actif, fuzzing, test d'authentification ou validation de vulnérabilité ne doit démarrer sans cible explicitement autorisée. Le scope doit être vérifié à chaque appel d'outil, pas seulement au début de la conversation.

### Séparation des environnements

- `host`: actions Windows courantes ;
- `workspace`: code et fichiers du projet autorisé ;
- `security-lab`: réseau/outils de sécurité isolés ;
- `browser`: navigation contrôlée ;
- `external-service`: API avec credentials dédiés.

### Secrets

- jamais injecter un secret dans le transcript visible ;
- coffre local chiffré / Windows Credential Manager ;
- redaction automatique des tokens/cookies/API keys ;
- permissions minimales ;
- aucun stockage de mot de passe Wi-Fi ou navigateur comme fonctionnalité générale.

### Actions destructives

Confirmation explicite pour suppression massive, arrêt de services critiques, changement de sécurité Windows, modification réseau, installation système, élévation admin ou opérations irréversibles.

### Prompt injection et contenu non fiable

Tout contenu Web, dépôt Git ou fichier externe est une donnée non fiable, jamais une instruction système. Un texte lu sur une page ne peut pas autoriser une commande terminal, un accès secret ou une modification système.

### Audit

Conserver : intention, outil, arguments redacted, timestamp, résultat, vérification et approbation. Permettre export d'un rapport d'exécution.

### Kill switch

Bouton Stop global : annule flux modèle, session Hermes, processus enfants, navigateur agentique et jobs de lab.

## 7. Plan d'évolution

### Phase 0 — Stabilisation

- conserver Action Router, langue, Model Manager, Smart Approval ;
- corriger build/packaging Windows ;
- tests de non-régression.

### Phase 1 — UX agentique

- panneau Thinking/activity trace ;
- statut de tâche ;
- stop global ;
- événements outils uniformisés ;
- historique d'exécution.

État 5.4 : panneau Thinking/activity trace implémenté.

### Phase 2 — Agent Core

- Capability Registry ;
- Policy Engine ;
- Planner ;
- Executor ;
- Verifier ;
- Evidence Ledger.

### Phase 3 — Sophenic Code professionnel

- index de repository ;
- recherche symbolique ;
- patch/diff ;
- tests ciblés ;
- preview ;
- subagents ;
- mémoire de projet.

### Phase 4 — Security Lab défensif

- scope de cible ;
- sandbox ;
- wrappers SAST/SCA/network/DAST ;
- parsing structuré ;
- rapport findings/preuves/remédiations.

### Phase 5 — OSINT légal

- RDAP/WHOIS/DNS/certificats ;
- EXIF ;
- provenance des résultats ;
- limites de données personnelles ;
- connecteurs externes optionnels.

### Phase 6 — Workspace Security type HackerGPT

- Network panel ;
- API Map ;
- Evidence/Payload vault pour CTF/labs autorisés ;
- Memory de findings ;
- replay contrôlé de requêtes ;
- navigateur réseau instrumenté.

### Phase 7 — Autonomie et évaluation

- tâches longues ;
- reprise après erreur ;
- budgets temps/tokens/outils ;
- subagents parallèles ;
- benchmark Code/PC/Research/Security ;
- scénarios CTF locaux et OWASP volontairement vulnérables ;
- tests de prompt-injection et de permissions.

## Critère de réussite

SOPHENIC atteint la cible lorsque l'utilisateur peut donner un objectif plutôt qu'une succession de commandes, que l'agent planifie, choisit les outils, agit, vérifie, conserve les preuves et rend un résultat exploitable — tout en restant observable, interruptible et limité par les autorisations.
