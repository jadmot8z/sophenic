# Hermes — transition de V2 future vers runtime actif

Ce document existait initialement comme plan V2. L'intégration a maintenant commencé : le Desktop contient un vrai bridge vers le gateway JSON-RPC/WebSocket de Hermes et l'interface `/agent` consomme les événements runtime.

## Déjà implémenté

- détection et démarrage du processus Hermes ;
- port local éphémère ;
- authentification WebSocket locale ;
- sessions Desktop ;
- streaming messages ;
- événements tools ;
- approvals `once/session/always/deny` ;
- clarifications ;
- changement de modèle ;
- `yolo` désactivé par session ;
- approbations `manual/smart` seulement ;
- découverte Ollama et policy modèles ouverts.

## Encore à implémenter

Les capacités avancées seront ajoutées sans donner un shell arbitraire à React : sélection native de fichiers, portée dossier, diff avant écriture, navigateur contrôlé, GitHub/MCP, installations et automatisations. Hermes exécutera les outils ; Sophenic restera responsable de l'expérience de permission, de la portée et de l'audit produit.

## Règle produit

`LLM intent -> Hermes tool request -> Sophenic approval UX -> Hermes execution -> result -> optional local/cloud audit`

Aucune action système critique ne doit être rendue silencieuse dans une build commerciale Sophenic.
