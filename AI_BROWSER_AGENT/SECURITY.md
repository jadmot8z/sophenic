# Sécurité — limites de confiance

## Protections implémentées

- Serveur lié à `127.0.0.1`, validation Host, rejet Origin/cross-site, jeton anti-CSRF par exécution.
- Aucune ressource distante dans l'interface ; CSP restrictive, anti-framing, rendu via `textContent`.
- Pas de commandes shell, JS produit par le modèle, téléchargement automatique ni chemins de fichier libres.
- Confirmation obligatoire avant les interactions et navigations ; refus terminal, expiration des demandes.
- Vérification de l'onglet, de l'URL et de la description de la cible avant l'action autorisée.
- Schémas JSON fermés, limites de taille, budget d'étapes, délais, détection des répétitions.
- Requêtes du navigateur filtrées : HTTP(S) public uniquement, ports 80/443, pas de credentials dans
  l'URL, refus des IP privées/réservées et de la résolution DNS privée pour les requêtes interceptées,
  y compris les sous-ressources. WebSockets et service workers désactivés.
- Arrêt = annulation du job + fermeture du navigateur, pas simplement arrêt du polling UI.

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
   accès bancaire ou administratif. Cookies partagés entre tâches jusqu'à fermeture de Chromium.

Pour une utilisation à risque, privilégier une VM dédiée, comptes jetables et absence de secrets dans
le système invité. Signaler les défauts de sécurité sans inclure de jetons, cookies ou données personnelles.
