# AI Browser Agent — 1.3.1

Application locale pour Windows 10/11 : **FastAPI + Playwright/Chromium + Ollama `qwen3:14b`**.
L'interface de bureau s'ouvre dans votre navigateur sur `http://127.0.0.1:8765` ; le navigateur
piloté est une **autre fenêtre réelle**, Chromium par défaut ou Chrome/Edge installé selon votre choix. Il n'y a aucun service LLM cloud, navigateur
simulé, réponse de démonstration ou exécution de code produit par le modèle.

> **État de livraison :** implémentation fonctionnelle, modulaire, avec tests unitaires/API.
> La validation complète sur Windows et avec Qwen3 reste à effectuer. Ne pas considérer ce
> dépôt comme un produit certifié pour les achats, les comptes sensibles ou une autonomie sans surveillance.
> Voir [VALIDATION.md](VALIDATION.md) pour les essais effectivement réalisés.

## Installation Windows

1. Installer **Python 3.12 ou plus récent**, avec le lanceur Windows `py`.
2. Installer [Ollama pour Windows](https://ollama.com/download/windows).
3. Exécuter `launcher\installer.bat` depuis l'Explorateur. Ce script crée un environnement
   virtuel, installe les dépendances et télécharge Chromium avec Playwright.
4. Exécuter `launcher\lancer.bat`. Il vérifie Python, le port local, Ollama et `qwen3:14b`,
   démarre le service Ollama si nécessaire et propose le téléchargement du modèle s'il est absent.
5. Attendre l'ouverture de l'interface et soumettre une tâche.

Installation et téléchargement du modèle nécessitent Internet et plusieurs Go disponibles.
La navigation web nécessite également Internet ; **local** signifie que l'inférence et la mémoire
ne quittent pas votre machine, pas que les sites peuvent être consultés hors ligne.

Commande manuelle pour le modèle :

```powershell
ollama pull qwen3:14b
ollama run qwen3:14b
```

Après installation, démarrage manuel (depuis ce dossier) :

```powershell
.venv\Scripts\python.exe -m interface.desktop_interface
```

Pas de `--reload`, pas de workers multiples : Playwright sous Windows exige une boucle
Proactor avec support des sous-processus. Le lanceur backend la configure explicitement.

### Installation source et fichier verrouillé (1.3.1)

`installer.bat` lance `launcher/install.py` avec le Python global sélectionné par `py`. L'installateur
lit les dépendances dans `pyproject.toml` et les installe dans `.venv`, sans `pip install -e .` : le
lanceur exécute déjà les modules directement depuis le dossier du projet. Il n'est pas nécessaire de
désinstaller le paquet `ai-browser-agent` d'une ancienne installation. Son ancien `dist-info` peut
rester présent sans être utilisé pour déterminer la version exécutée : fiez-vous à `/api/version` et
à la version source affichée, pas à `pip show ai-browser-agent`.

L'installateur affiche le chemin et la version du dossier, contrôle le port 8765, signale les processus
Windows visibles dont le chemin/commande utilise ce `.venv`, et prend un verrou d'installation local.
Aucun processus n'est tué et aucun environnement ni donnée n'est supprimé. La détection des processus
peut être indisponible selon les droits Windows ; elle ne détecte pas tous les verrous possibles
(antivirus, indexeur, éditeur, etc.). Le lanceur refuse une installation déjà en cours au moment de sa vérification.

Si vous voyez `WinError 32` et `ai-browser-agent==1.1.0` :

1. Arrêtez le backend avec **Ctrl+C dans sa console**, puis fermez ses fenêtres. Fermer l'onglet de
   l'interface ne suffit pas à arrêter Python. N'arrêtez pas tous les processus Python sans les identifier.
2. Téléchargez le ZIP **AI_BROWSER_AGENT-Windows-1.3.1.zip** et extrayez-le dans un **nouveau dossier**.
   Ne réutilisez pas le dossier de téléchargement `(1)` qui contient encore la version 1.1.
3. Lancez le nouvel `installer.bat` et vérifiez **Version source : 1.3.1**. Il crée un environnement neuf.
   Ne copiez pas l'ancien `.venv` dans ce nouveau dossier : les environnements virtuels ne sont pas portables.
4. Pour conserver l'historique, copiez seulement l'ancien `data` vers le nouveau dossier, avec toutes les
   instances de l'application et leurs navigateurs fermés. Les profils/cookies de `data` sont privés.
5. Lancez le nouveau `lancer.bat`, puis faites **Ctrl+F5** dans l'interface.

Si un verrou persiste malgré l'arrêt, redémarrez Windows avant de relancer l'installation. Le mode
administrateur n'est pas un remède général à un fichier utilisé par un autre processus. Ne désactivez
pas les protections de Windows ou l'antivirus pour installer l'application.

### Matériel et performances

Une RTX de portable ne garantit pas que 14 milliards de paramètres tiennent intégralement en VRAM.
Ollama peut répartir le modèle entre RAM et GPU ; cela augmente la latence. Prévoyez idéalement
32 Go de RAM et suffisamment d'espace disque, puis vérifiez l'utilisation réelle avec `ollama ps`.
La capacité VRAM exacte dépend de votre configuration ASUS TUF F16. Aucune vitesse en tokens/s
n'est garantie. Le contexte est limité à 16 384 tokens, la génération à 2 200 et le mode thinking
est désactivé pour les décisions JSON. Le modèle reste chargé dix minutes entre les appels.

## Utilisation

Exemple :

> Trouve-moi les meilleurs ordinateurs portables RTX 4070 à moins de 1500 euros.
> Compare les prix et indique les URL des sources, sans passer commande.

- L'agent crée un plan puis observe la page, décide d'une action et la soumet au validateur.
- Par défaut, en mode **Actions sensibles uniquement**, les navigations, recherches, clics ordinaires,
  saisies de brouillons et sélections se font sans
  confirmation systématique. Le modèle signale les actions sensibles via `impact` et le backend
  vérifie aussi les cibles, soumissions et touches pouvant engager une action finale.
- Dans ce mode par défaut, un envoi, un achat, une publication, une suppression ou un upload détecté exige
  confirmation. Les commandes ambiguës (ex. bouton de soumission inconnu ou Entrée hors recherche)
  peuvent aussi déclencher une confirmation par prudence.
- Si une connexion, un CAPTCHA ou une information manque, l'agent utilise **ask_user** et passe en
  **WAITING_USER**. Complétez l'étape dans la fenêtre Chromium, ou indiquez la précision demandée
  dans le panneau, puis cliquez sur **J’ai terminé — Reprendre**. L'agent relit alors la page.
  Aucun mot de passe, code 2FA ou cookie ne doit être fourni dans le chat.
- Les pages `accounts.google.com` et champs de mot de passe visibles déclenchent une pause automatique,
  indépendamment du modèle. Les sessions ne sont conservées après fermeture que si l’option de profil dédié est activée.
- Vérifiez la page Chromium avant chaque confirmation. **Refuser arrête la tâche**, sans permettre
  au modèle de reformuler pour contourner votre refus.
- « Arrêter » annule les appels en cours et ferme Chromium. Une action déjà envoyée à un site
  ne peut pas être annulée rétroactivement. L'arrêt de l'application laisse le service Ollama disponible.
- « Actualiser la capture » affiche une capture réelle de l'onglet actif. Pas de vidéo en continu.
- Les conversations précédentes et leurs événements sont accessibles dans la barre latérale.
- Les préférences sont enregistrées explicitement par l'utilisateur ; le modèle ne peut pas les modifier.
- Pour autoriser un fichier, placez-le dans `data\uploads`. Le modèle ne peut envoyer que les fichiers
  de ce dossier ; la confirmation dépend du mode de permission choisi. Aucun accès arbitraire au disque.

**Consentement sélectif, pas garantie universelle.** La classification du modèle et les heuristiques DOM
peuvent manquer une action sensible ou demander une confirmation inutile. Une visite, une saisie ou un lien
peut déjà déclencher un effet côté site. Gardez Chromium visible et utilisez des comptes de test.
Le modèle ne peut pas désactiver une confirmation imposée par le backend.

### Navigateur installé, connexion et onglet fermé

Dans le panneau de droite, choisissez **Chromium Playwright**, **Google Chrome installé** ou
**Microsoft Edge installé**, puis **Appliquer** et **Ouvrir le navigateur**. Chrome/Edge doit être
installé sur Windows ; l'application ne télécharge pas ces produits à votre place et ne bascule pas
silencieusement vers un autre navigateur. Les réglages ne peuvent pas changer pendant une tâche.

L'option **Conserver la session dans un profil dédié** conserve les cookies autorisés par les sites
entre les lancements, dans `data/browser_profiles/<navigateur>`. Elle est désactivée par défaut.
Ce n'est **pas votre profil Chrome/Edge personnel**, et aucun cookie n'est importé depuis celui-ci.
Connectez-vous manuellement dans cette fenêtre dédiée si le site l'accepte. Les paramètres sont
conservés ; les variables d'environnement ne remplacent pas un choix déjà enregistré dans l'interface.

**Google « Ce navigateur n'est peut-être pas sécurisé » :** ce message peut correspondre au refus
d'un navigateur automatisé, pas à un simple problème de marque ou de certificat. Chrome officiel
et un profil persistant ne garantissent pas que Google accepte l'automatisation. Les principaux messages
français/anglais de refus reconnus sur accounts.google.com arrêtent la tâche comme incomplète, avec
un diagnostic, au lieu de répéter la demande de connexion. Aucun drapeau de
camouflage, désactivation TLS, import de cookies ou contournement de CAPTCHA n'est utilisé. Si le
service refuse, effectuez l'opération dans votre navigateur normal, ou envisagez une intégration
via l'API officielle/OAuth du service (non implémentée ici).

Si le dernier onglet est fermé, une nouvelle observation crée un onglet vierge. Si le navigateur
est fermé/déconnecté, une relance bornée est tentée. Les cibles DOM précédentes ne sont pas réutilisées.
**Aucune URL ni commande n'est rejouée automatiquement par le récupérateur.** Si la fermeture survient
pendant un envoi ou juste après une action, une intervention demande de vérifier son résultat avant de
poursuivre, même en « Toujours accepter », afin d'éviter les doublons. L'application ne prétend pas
pouvoir reconstruire un résultat de transaction inconnu. Un navigateur non installé, profil verrouillé
ou crash persistant reste un blocage explicite, pas une boucle de relancement sans fin.

### Trois modes de permission

Les trois boutons au-dessus de la conversation prennent effet sur les **prochaines actions** et le
choix est conservé dans SQLite, y compris après redémarrage. Une demande déjà affichée reste à traiter.

| Bouton | Comportement |
|---|---|
| **Toujours demander** | Accord avant chaque action navigateur, y compris recherche/défilement/onglets ; observation, planification et réponse finale restent automatiques. |
| **Actions sensibles uniquement** | Mode par défaut : lecture/recherche/rédaction automatiques, confirmation des effets sensibles détectés et soumissions ambiguës. |
| **Toujours accepter** | Pas de confirmation d’action, **y compris envoi, paiement, suppression, publication et upload**. Avertissement et accord explicite à l’activation. |

Même en « Toujours accepter », les informations manquantes, CAPTCHA et connexions restent des pauses
humaines : ce mode ne donne pas de mot de passe à l’agent et ne peut pas deviner une année. Les restrictions
d’URL et de fichiers restent actives. N’utilisez ce mode qu’avec des comptes de test et sous surveillance.
Il n'est pas possible pour le modèle de changer ce réglage via ses commandes JSON.

### Dates, billets et progression

L'horloge de votre ordinateur (date locale et fuseau) est injectée dans chaque plan et décision.
Une demande de billets datée en français/anglais ou au format numérique mais sans année est clarifiée
**avant la recherche** ; le modèle reçoit ensuite votre précision. Exemple : « billet du 20 au 30 août
Paris Marrakech aller-retour » → « Pour quelle année, et quel moyen de transport ? ».
Une requête `search` qui invente une autre année ou remplace un vol explicitement demandé par un train
est refusée localement et corrigée via replanification. Ces contrôles couvrent ce cas courant, pas toutes
les façons d’écrire une date ni toutes les erreurs possibles d’un modèle. Les dates passées explicites
et les demandes complexes restent à clarifier par le modèle. Un tarif n’est jamais garanti sans source.

L'anti-boucle compare aussi les champs (empreinte locale sans valeur brute dans le prompt), le focus,
le défilement et les onglets. Une saisie peut donc être un progrès même si le texte du corps de page
ne change pas. Lors d'un blocage, deux replanifications sont tentées puis une intervention est demandée.
La limite totale d'étapes n'est pas supprimée : si elle est atteinte, le statut est `needs_attention`,
avec un message de tâche incomplète plutôt qu'une fausse réussite.

### Exemple Gmail

« Ouvre Gmail et prépare un message “Salut” pour ami@example.com. »

L'agent peut ouvrir le service, demander votre connexion manuelle, reprendre, préparer le brouillon,
puis appliquer le mode choisi avant **Envoyer** et vérifier le résultat. Si vous donnez seulement un prénom,
il doit demander le destinataire exact, pas inventer une adresse. Il n'utilise pas d'API Gmail ni OAuth
propre à l'application : il agit via la session du navigateur. Google peut refuser la connexion depuis
un navigateur automatisé : ce blocage réel doit être signalé, il n'est pas contourné.

### Mise à jour depuis une version précédente

Fermez le backend (Ctrl+C dans sa console). Sauvegardez votre dossier `data`, puis extrayez le nouveau
ZIP et copiez son contenu dans le dossier `AI_BROWSER_AGENT` existant en remplaçant les fichiers du
programme. **Ne supprimez pas `data` ni `.venv`**. Relancez `installer.bat`, puis `lancer.bat`, et faites
**Ctrl+F5** sur l'interface. Vérifiez **v1.3.1** en haut à gauche (API `/api/version`). Si elle
n’apparaît pas, une ancienne console ou un autre dossier est encore utilisé. Les anciens messages
d’erreur restent dans l’historique ; testez une nouvelle tâche. Les anciennes tâches ne sont pas rejouées : démarrez une nouvelle demande.

## Architecture

```text
launcher/    Installation, contrôles de démarrage, service Ollama, ouverture de l'interface
core/        Contrats Pydantic, gestionnaire de tâches, planificateur, décisions, boucle agent
llm/         Client Ollama asynchrone, schémas JSON, prompts, configuration Qwen3
browser/     Chromium, analyse DOM, références aux éléments, clics, saisie, navigation
vision/      Captures réelles et géométrie DOM — pas de faux modèle visuel
memory/      SQLite, historique durable, préférences, erreurs, contexte récent borné
tools/       Adaptateurs navigateur, recherche web, fichiers autorisés, sécurité URL
interface/   API FastAPI, interface HTML/CSS/JS locale
logs/        Emplacement réservé ; les journaux actifs résident dans data/logs
tests/      Tests de contrats, mémoire, orchestration, API et intégration Chromium
```

Détails des responsabilités et décisions : [ARCHITECTURE.md](ARCHITECTURE.md).

### Données et confidentialité

- `data/memory.sqlite3` : objectifs, réponses, états, événements, préférences et erreurs.
- `data/logs/agent.log` : journal technique tournant (2 Mo × 4 fichiers maximum).
- `data/uploads/` : seuls fichiers disponibles à l'envoi.
- Sessions **éphémères par défaut**, ou profil dédié persistant si vous cochez l'option. Le profil
  personnel n'est jamais réutilisé. Les tâches successives partagent la session courante.
  En mode persistant, fermer l'application ne déconnecte pas nécessairement les comptes : déconnectez-vous
  sur les sites ou fermez l'application puis supprimez le profil dédié pour effacer ces sessions.
  Désactiver l'option n'efface pas les données d'un ancien profil, réutilisées si vous la réactivez.
- Captures et observations complètes sont en mémoire, pas archivées automatiquement.
- Les valeurs saisies sont masquées dans les événements d'action persistés ; elles sont visibles
  dans la confirmation temporaire. Les URL journalisées omettent query string et fragment.
- Les objectifs, réponses, raisons et erreurs de page peuvent néanmoins contenir des données
  privées. **SQLite et les journaux ne sont pas chiffrés**. Ne soumettez pas de mots de passe
  dans le chat ; utilisez un compte de test et protégez votre session Windows.
- Pour effacer la mémoire, fermer l'application puis supprimer `data` (cela supprime aussi les
  fichiers d'envoi). Rien n'est repris automatiquement après un crash.

## Capacités et limites explicites

| Fonction | Implémentation |
|---|---|
| Navigation / retour / avance / rafraîchissement | Playwright réel |
| Plusieurs onglets | Identifiants stables `t1`, `t2`, etc. |
| Texte / HTML / formulaires / liens / boutons | Analyse du DOM rendu, éléments et texte du viewport |
| Clic / double clic / saisie / clavier / défilement / sélection | Commandes validées puis Playwright |
| Upload | Dossier autorisé + politique de permission choisie |
| Recherche | Navigation Google réelle ; pas d'API de recherche payante |
| Erreurs | Codes HTTP, exceptions Playwright, alertes et champs invalides du DOM |
| Vérification | Nouvelle observation après chaque action ; comparaison et correction du plan |
| Mémoire | Historique SQLite + préférences + réinjection des erreurs récentes |
| Vision | Captures et boîtes DOM ; **pas d'OCR ni de compréhension multimodale** |

Qwen3 14B est textuel. Il n'est pas présenté comme capable de lire une capture d'écran. Les canvas,
les iframes et les shadow DOM fermés ne sont pas analysés dans cette version. La détection DOM est
bornée à 80 éléments interactifs visibles dans le viewport et 12 000 caractères ; le défilement
permet d'en découvrir d'autres. Un site très dense peut dépasser ces limites. L'agent peut échouer
sur des widgets complexes, des authentifications, des paywalls ou des protections anti-bot.
Il ne contourne pas les CAPTCHA. Les téléchargements, WebSockets, service workers et boîtes de
dialogue JavaScript sont bloqués/annulés ; certains sites ne fonctionneront pas avec ces restrictions.

L'apprentissage des erreurs est une **mémoire de récupération**, pas un entraînement des poids.
La vérification est observationnelle et guidée par le LLM : un statut « completed » signifie que
le modèle a produit sa réponse finale, pas qu'un oracle externe a validé tous les faits.
Les instructions anti-injection et confirmations réduisent les risques sans les éliminer.
Voir [SECURITY.md](SECURITY.md).

## Configuration

Paramètres typés : `core/config.py`. Le modèle par défaut obligatoire est `qwen3:14b`.

| Variable d'environnement | Défaut | Usage |
|---|---|---|
| `AIBA_DATA_DIR` | `AI_BROWSER_AGENT/data` | Stockage local alternatif |
| `AIBA_OLLAMA_URL` | `http://127.0.0.1:11434` | Instance Ollama ; conserver une adresse locale |
| `AIBA_BROWSER_CHANNEL` | `chromium` | `chrome` ou `msedge` pour le navigateur installé, avant tout choix sauvegardé |
| `AIBA_REMEMBER_SESSION` | non défini | `1` pour conserver un profil dédié, avant tout choix sauvegardé |
| `AIBA_HEADLESS` | non défini | `1` pour les tests sans fenêtre |

Limites par défaut : 40 étapes, 15 minutes de temps actif par tâche, 180 s par appel LLM, 15 s par action
Playwright, 180 s pour une confirmation sensible. Une intervention utilisateur dispose de 15 minutes
(`human_timeout`) et suspend le budget de temps actif, mais pas le bouton Arrêter. Une réparation JSON maximum. Trois actions identiques
sur une page inchangée ou huit étapes sans progrès déclenchent une récupération (deux replanifications
maximum avant intervention). Trois erreurs consécutives demandent également une intervention.
Le budget de temps et les 40 étapes restent des limites fermes ; la récupération n’incrémente pas ces budgets.

## Développement et tests

```powershell
.venv\Scripts\python.exe -m pip install -e ".[dev]"
.venv\Scripts\python.exe -m pytest -q --ignore=tests/test_browser.py
.venv\Scripts\python.exe -m playwright install chromium
.venv\Scripts\python.exe -m pytest -q tests/test_browser.py
.venv\Scripts\python.exe -m ruff check .
```

Le test Chromium utilise de vraies interactions avec une page HTML locale chargée par Playwright,
sans réseau ni Ollama. Les doubles d'Ollama des tests unitaires servent seulement à tester
l'orchestration et ne sont jamais importés par l'application. Les dépendances ont des bornes de
versions ; pour un déploiement reproductible, figez celles validées sur votre Windows.

### Dépannage

- **Ollama inaccessible** : vérifier `ollama list`, puis `ollama serve` si le service n'est pas déjà actif.
- **Modèle absent** : `ollama pull qwen3:14b` ; utiliser une version récente d'Ollama acceptant les
  schémas JSON dans `/api/chat` et `think: false`.
- **Onglet fermé** : l’agent recrée une page à la prochaine observation ; utilisez aussi « Ouvrir le navigateur » hors tâche.
- **Chrome/Edge absent ou profil verrouillé** : installer le navigateur choisi ou revenir à Chromium ; fermer l’autre instance utilisant le profil dédié.
- **Chromium absent** : réexécuter `python -m playwright install chromium` avec le Python de `.venv`.
- **Erreur TLS au téléchargement** : vérifier proxy/pare-feu/certificats ; ne désactivez pas la validation TLS.
- **Latence / timeout** : vérifier RAM, VRAM et `ollama ps`, fermer les jeux/autres charges GPU ; ajuster
  les limites dans `core/config.py` si nécessaire, sans attendre des performances garanties.
- **Port 8765 occupé** : fermer l'ancienne instance, ne pas lancer un deuxième backend.
- **Élément périmé** : le DOM a changé ; l'agent doit observer à nouveau puis appliquer le mode de permission choisi.

Cette application est indépendante de SOPHENIC déjà présent dans le dépôt. Aucun fichier de
l'application existante ou de ses archives n'a été remplacé.
