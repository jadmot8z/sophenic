# 1.3.0 — 27 septembre 2026

- Récupération bornée des onglets fermés, contextes déconnectés et pages crashées, avec invalidation des cibles.
- Nouvelle observation après fermeture manuelle ; pas de rejeu automatique des actions ou URL.
- Interruption pendant une action : vérification humaine du résultat incertain, y compris en Toujours accepter.
- Choix Chromium / Chrome installé / Edge installé et option de profil dédié persistant.
- Ouverture manuelle du navigateur depuis l'UI, réglages interdits pendant une tâche.
- Refus explicite Google « navigateur non sécurisé » (motifs français/anglais reconnus) : diagnostic et tâche incomplète, sans boucle de connexion.
- Version affichée et endpoint `/api/version` pour identifier les installations/processus anciens.
- 98 tests unitaires/API réussis ; Chrome/Edge Windows et connexions Google non validés ici.
- Les refus de connexion par les services ne sont pas contournés ni présentés comme résolus.

# 1.2.0 — 27 septembre 2026

- Trois boutons : Toujours demander / Actions sensibles uniquement / Toujours accepter.
- Choix persistant, avertissement explicite pour l'autorisation totale ; les pauses humaines restent actives.
- Date/fuseau de l'ordinateur injectés dans chaque prompt de planification et décision.
- Clarification de l'année avant recherche pour les demandes de billets datées sans année.
- Rejet d'une requête search inventant une année ou substituant un train à un vol explicitement demandé.
- Recherche de billets classée comme lecture, pas comme achat, même si Qwen la surclasse par erreur.
- Anti-boucle : champs (HMAC éphémère), focus, scroll et onglets comptent comme progrès.
- Deux replanifications sur blocage puis intervention, plutôt qu'une RuntimeError brute.
- Statut needs_attention en fin de budget d'étapes, sans annoncer un résultat non vérifié.
- 79 tests unitaires/API passants ; parcours réel de recherche de billets non validé ici.

# 1.1.0 — 27 septembre 2026

- Nouvelle action `ask_user` : connexion manuelle, CAPTCHA ou précision manquante, puis reprise.
- Pause automatique sur authentification Google / champ password, et protection des saisies OTP.
- État `WAITING_USER`, réponse facultative, timeout dédié, annulation et réobservation à la reprise.
- Le temps passé à se connecter ne consomme plus le budget de calcul actif de la tâche.
- Prompts : capacités réelles de navigation explicites, connexion non assimilée à une impossibilité,
  adresse du destinataire demandée si ambiguë, preuve d'envoi exigée avant déclaration de succès.
- Confirmations sélectives au lieu d'une validation à chaque clic : classification d'impact + garde-fous locaux.
- Résumé des opérations sensibles et boutons distincts « Autoriser » / « J’ai terminé — Reprendre ».
- Description du DOM enrichie (tooltips Gmail, rôle textbox, type effectif, focus, autocomplete, formulaire).
- Texte de capture corrigé lorsque Chromium est déjà ouvert.
- 58 tests unitaires/API passants ; Gmail/Chromium de bout en bout non validés dans l'environnement de travail.

La politique sélective est moins conservatrice que la 1.0 ; consulter SECURITY.md avant utilisation.
