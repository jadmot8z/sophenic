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
