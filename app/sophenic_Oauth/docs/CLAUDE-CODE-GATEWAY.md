# Sophenic Code — Claude Code Gateway

## Objectif

Sophenic Code utilise, lorsqu'il est installé sur la machine, le **CLI Claude Code officiel** comme moteur agentique de développement. Claude Code n'est pas un provider IA et ne devient pas un second cerveau : il fournit la boucle d'outils de code (lecture/édition du workspace, terminal, tests), tandis que **Sophenic Brain reste l'unique autorité de routage IA**.

Chemin normal :

```text
Utilisateur
  → Intent Router
  → Sophenic Code
  → Sophenic Brain
  → Provider → Model → Key → Fallbacks
  → passerelle Anthropic-compatible locale
  → Claude Code CLI (agent/outils)
  → workspace
  → résultat Sophenic
```

Si Claude Code n'est pas installé, Sophenic conserve le moteur Hermes Code existant comme solution de compatibilité. Hermes reste également utilisé pour les capacités PC/plugins existantes.

## Passerelle locale

`electron/runtime/claude-code-gateway.ts` démarre un serveur HTTP éphémère lié uniquement à `127.0.0.1`, avec un token aléatoire par lancement. Il expose le sous-ensemble Anthropic nécessaire à Claude Code :

- `GET /v1/models` : expose seulement `sophenic-auto` ;
- `POST /v1/messages/count_tokens` ;
- `POST /v1/messages` avec réponse JSON ou SSE.

La passerelle ne possède aucun sélecteur de modèle. Pour chaque tâche, elle demande un plan à `planSophenicAgentRoute()`, puis utilise les providers/modèles/clefs fournis par le Brain. Si le moteur choisi échoue avant une réponse exploitable, la passerelle passe au fallback suivant du Brain.

## Compatibilité protocolaire

`electron/runtime/anthropic-compat.ts` normalise les structures nécessaires à la boucle d'agent :

- messages `system`, `user`, `assistant` ;
- blocs texte et image ;
- `tool_use` / `tool_result` ;
- conversion `tool_calls` OpenAI-compatible ;
- événements SSE `content_block_*` et `message_*`.

Cette architecture est inspirée du principe de passerelle multi-provider du projet open source **Free Claude Code**, mais elle est réimplémentée en TypeScript pour s'intégrer nativement au Sophenic Brain et au coffre de clés existant. Le binaire Free Claude Code n'est pas embarqué.

## Sécurité

- aucune clé provider n'est transmise au renderer ;
- le token de la passerelle est aléatoire et local au processus ;
- Claude Code reçoit uniquement l'URL/token de la passerelle Sophenic ;
- les clés cloud sont récupérées depuis le coffre Sophenic par le main process ;
- le renderer n'obtient aucun `exec`, `spawn`, `fs` ou shell unrestricted ;
- le workspace est choisi par l'utilisateur avant une tâche Code ;
- Claude Code est lancé en `acceptEdits`, pas avec un bypass global des permissions ;
- Sophenic ne redistribue pas le binaire Claude Code : il détecte une installation existante.

## Choix des IA

Le renderer n'expose plus de sélecteur provider/modèle pour Chat, Code ou Image. Les providers/clés restent configurables comme **ressources** dans « Fournisseurs IA ».

`Rapide / Auto / Deep` reste un réglage d'effort Sophenic, conformément à l'architecture existante ; ce réglage ne choisit pas un provider ni un modèle.
