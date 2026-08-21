# SOPHENIC 5.4.7 — Code Watchdog

- Supprime l’attente potentielle de six heures de `prompt.submit` : l’ACK JSON-RPC est borné à 60 s.
- Ajoute un watchdog de progression Code : 90 s avant la première sortie/action réelle, 180 s entre deux progressions après démarrage.
- Une stagnation ne stoppe pas SOPHENIC et ne demande jamais « continue » : une nouvelle session Hermes est créée automatiquement.
- Si la nouvelle session rebloque, l’incident est traité comme une indisponibilité et Sophenic Brain bascule vers un provider de fallback tout en conservant le workspace/checkpoint.
- Les demandes interactives (approval/clarify/sudo/secret) suspendent le watchdog afin de ne pas interrompre une vraie attente utilisateur.
- Le profil Hermes isolé et la protection contre `HTTP 401: User not found` de la 5.4.6 restent actifs.
