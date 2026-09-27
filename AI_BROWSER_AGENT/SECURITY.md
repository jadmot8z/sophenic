# Sécurité — limites de confiance

## Protections implémentées

- Serveur lié à `127.0.0.1`, validation Host, rejet Origin/cross-site, jeton anti-CSRF par exécution.
- Aucune ressource distante dans l'interface ; CSP restrictive, anti-framing, rendu via `textContent`.
- Pas de commandes shell, JS produit par le modèle, téléchargement automatique ni chemins de fichier libres.
- Par défaut, consentement sélectif : indicateur `impact` du modèle + contrôles locaux sur libellés, URL, soumissions,
  uploads et Entrée hors recherche. Confirmation des risques détectés ; refus terminal et expiration.
- Connexion manuelle : pages Google d'authentification et champs password visibles provoquent une pause.
  Le modèle peut aussi demander une intervention via `ask_user`. Aucun outil n'est exécuté pendant cette
  attente. Les réponses de précision sont transmises au modèle local, pas enregistrées comme événement brut.
- Vérification de l'onglet, de l'URL et de la description de la cible avant l'action autorisée.
- Schémas JSON fermés, limites de taille, budget d'étapes, délais, détection des répétitions.
- Requêtes du navigateur filtrées : HTTP(S) public uniquement, ports 80/443, pas de credentials dans
  l'URL, refus des IP privées/réservées et de la résolution DNS privée pour les requêtes interceptées,
  y compris les sous-ressources. WebSockets et service workers désactivés.
- Arrêt = annulation du job + fermeture du navigateur, pas simplement arrêt du polling UI.

## Modes utilisateur dans 1.2

L’utilisateur peut choisir « Toujours demander », « Actions sensibles uniquement » (défaut), ou
**« Toujours accepter »**. Ce dernier désactive volontairement toutes les confirmations d’actions,
**y compris paiements, envois, suppressions, publications et uploads**. Son activation affiche un
avertissement explicite et l’API exige `accept_sensitive_risk: true`. Le réglage persiste après redémarrage.
Il ne peut pas être modifié par une commande du modèle ni via l’API de préférences générique.
Les interventions de connexion/clarification et restrictions réseau/fichiers restent appliquées.
Changer de mode ne répond pas à une confirmation déjà en attente et n’annule pas une action déjà lancée.

Les heuristiques décrites ci-dessous ne s'appliquent comme barrière de consentement qu'au mode sensible.
Le mode « Toujours accepter » ne protège pas contre une transaction erronée du modèle. Utiliser des
comptes jetables et surveiller Chromium. Les protections de fichiers et d'URL ne remplacent pas cette validation.

## Changement de politique dans 1.1

La confirmation systématique de 1.0 est remplacée par une politique basée sur le risque, à la demande
de l'utilisateur. **Cette version accepte davantage de risque** : les motifs français/anglais ne couvrent
pas tous les libellés ni toutes les langues, et le modèle peut mal classer un effet. Une URL anodine,
un clic, une case ou une saisie peuvent provoquer un envoi sans indice préalable. Les vérifications
locales ne constituent donc pas une garantie absolue de confirmation avant tout effet sensible.
Certaines soumissions ambiguës restent confirmées même si elles paraissent ordinaires. La connexion
Google peut être refusée par Google ; l'agent ne contourne pas cette protection.

## Ce que ces protections ne garantissent pas

1. **Ce n'est pas une sandbox réseau au niveau OS.** Chromium résout aussi les noms après le filtre :
   un DNS rebinding, une redirection non interceptée ou une modification du DNS entre contrôle et
   connexion reste possible. Pour les
   usages exposés, ajouter un proxy filtrant et des règles de pare-feu Windows bloquant tous les réseaux
   privés pour le processus Chromium. Ne pas naviguer sur des domaines malveillants avec des secrets.
2. **Le modèle peut être trompé.** Une injection dans une page peut influencer sa décision ou sa réponse.
   Le consentement humain reste nécessaire ; ne validez pas des instructions provenant uniquement d'un site.
3. **Le DOM peut changer après confirmation.** Les contrôles réduisent le risque sans supprimer toutes
   les courses entre observation et événement JavaScript. Une simple visite exécute déjà du JavaScript.
4. **Les actions externes sont irréversibles.** Arrêter ne récupère pas un paiement, un upload ou un message
   déjà envoyé. « Retour » est une navigation, pas une annulation de transaction.
5. **Stockage non chiffré.** Objectifs, réponses, erreurs et préférences peuvent contenir des informations
   privées. Les captures affichées peuvent montrer des données sensibles. Les actions masquent les valeurs
   mais il n'existe pas de garantie de nettoyage sémantique de tout texte produit par un modèle ou un site.
6. **API mono-utilisateur de confiance.** Le jeton n'est pas une authentification multi-utilisateur. Un
   processus local malveillant ou un utilisateur ayant accès à la session peut contrôler l'application.
   Ne pas l'exposer sur Internet, ne pas supprimer les protections Host pour publier un aperçu partagé.
7. **Pas de protection universelle des comptes.** Utiliser un profil éphémère et un compte de test, sans
   accès bancaire ou administratif. Cookies partagés entre tâches ; si le profil persistant est activé,
   ils peuvent survivre à la fermeture du navigateur. Associer une session authentifiée et « Toujours
   accepter » donne au modèle la capacité d'agir sans validation dans ces comptes : risque élevé.

Pour une utilisation à risque, privilégier une VM dédiée, comptes jetables et absence de secrets dans
le système invité. Signaler les défauts de sécurité sans inclure de jetons, cookies ou données personnelles.

## Profils et récupération dans 1.3

Le profil dédié réside dans `data/browser_profiles/<channel>` ; il n'est pas inclus dans le ZIP ou Git.
Il peut contenir cookies, historique, cache et autres données de navigation. Le stockage du navigateur
suit ses mécanismes propres ; l'application n'ajoute pas de chiffrement de profil. Protégez le compte
Windows et ses sauvegardes. Désactiver la persistance ne supprime pas un profil enregistré.

Chrome/Edge officiel ne rend pas légitime un contournement d'authentification. Aucun camouflage de
l'automatisation, `ignore_https_errors`, désactivation TLS, import de cookies personnels ou changement
de `navigator.webdriver` n'est introduit. Les refus de connexion doivent être respectés.

Une page fermée n'est pas une preuve d'échec d'une opération : la requête peut avoir atteint le site.
La récupération ne rejoue jamais de commande ni de navigation automatiquement. Une interruption pendant
une action demande une vérification humaine même en mode sans confirmations. La récupération ne garantit
pas une sémantique « exactement une fois » sur un service web ; n'utilisez pas de transaction réelle
comme premier test. Les profils de navigateur peuvent par ailleurs appliquer leurs propres réglages
de restauration d'onglets au démarrage ; l'application ne peut pas annuler un effet déjà reçu par un site.
