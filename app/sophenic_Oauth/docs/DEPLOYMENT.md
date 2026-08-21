# Déploiement Sophenic

## Web / SaaS

1. Créer un projet Supabase.
2. Appliquer `supabase/migrations/0001_init.sql`, puis `supabase/migrations/0002_local_agent.sql`.
3. Copier `.env.example` vers `.env.local` et renseigner les variables Supabase.
4. Déployer Next.js sur une plateforme Node compatible.
5. Configurer Stripe uniquement si le billing SaaS est activé.

Le Local Agent ne nécessite pas OpenRouter. Les variables OpenRouter de `.env.example` appartiennent uniquement à l'ancien module cloud optionnel.

## Windows / Agent local

La machine utilisateur doit disposer de Hermes Agent et Ollama. Sophenic les détecte et peut ouvrir/copier les instructions officielles, mais ne lance pas silencieusement une installation système.

Hermes doit être configuré sur le provider `custom` pointant vers Ollama :

```text
http://localhost:11434/v1
```

La taille de modèle dépend du GPU, de la VRAM et de la RAM de la machine.

## Build Windows

PowerShell :

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\build-sophenic.ps1"
```

Le renderer Desktop privilégié n’utilise pas le domaine SaaS : `next build` produit une sortie `standalone` incluse dans l’installateur. Electron la démarre sur `127.0.0.1` avec un port éphémère. `SOPHENIC_CLOUD_URL` reste optionnel pour de futures fonctions cloud non privilégiées.

Résultat attendu :

```text
release/Sophenic Setup.exe
```

## Signature Windows

Pour une distribution publique, utilisez un certificat de signature de code via `CSC_LINK` et `CSC_KEY_PASSWORD`. Ne commitez jamais le certificat, le mot de passe ou les secrets Supabase/Stripe dans le dépôt.

## CI

Le workflow Windows du dépôt peut compiler l'installateur sur un runner Windows après installation des dépendances. Avant une release, ajoutez des tests réels avec Hermes + Ollama et une matrice GPU/CPU représentative.
