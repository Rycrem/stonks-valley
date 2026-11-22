# Stonks Valley : game design

## Pourquoi une version originale

Les mécaniques suivent le livret de "Richesses du Monde" fourni par Emeric (redevance tirée au hasard par case, cases de choix régional et mondial, enchères forcées, Joker, faillite), adaptées à ses choix : pas de cartes, on achète directement des pourcentages ; le plus gros détenteur encaisse ; seul le joueur actif achète. On ne recopie pas "Richesses du Monde" : ni son nom, ni son plateau, ni ses illustrations, ni le texte de ses cartes, ni ses montants.

- **Thème** : la tech. Les ressources sont des parts d'entreprises technologiques.
- **Nom** : "Stonks Valley".
- **Visuels** : illustrations, pions, icônes, billets et logos parodiques dessinés pour le projet (SVG maison, ou banques libres CC0 avec la licence notée dans `assets/LICENSES.md`).
- **Chiffres** : prix et paiements équilibrés par nos propres tests.

## Les entreprises (ressources)

16 entreprises tech, affichées sous leur nom parodique avec un logo parodique (voir "Noms et logos" plus bas). La colonne "Nom réel" sert seulement de référence. Toutes les valeurs sont dans un fichier JSON.

| Secteur | Nom réel | Nom parodique |
|---|---|---|
| Cartes graphiques / IA | Nvidia | Nvidio |
| Processeurs | AMD | AMB |
| Processeurs | Intel | Intol |
| Fonderie de puces | TSMC | TSMB |
| Smartphones | Apple | Appel |
| Smartphones | Samsung | Samsong |
| Cloud / e-commerce | Amazon | Amazone |
| Logiciels / cloud | Microsoft | Macrosoft |
| Recherche / pub | Google | Gogol |
| Réseaux sociaux | Meta | Méto |
| Voitures électriques | Tesla | Tesler |
| Consoles / électronique | Sony | Sonyx |
| Streaming vidéo | Netflix | Netflox |
| Bases de données / cloud | Oracle | Oracul |
| Smartphones / objets connectés | Xiaomi | Xiaomy |
| Streaming musical | Spotify | Spotifaille |

## Parts en pourcentage (pas de cartes)

- Chaque entreprise vaut **100 %**. Il n'y a pas de cartes : un joueur détient simplement un pourcentage de chaque entreprise (ex. 35 % d'AMB, 10 % de Nvidio).
- Les 100 % de chaque entreprise sont **répartis entre les régions, puis entre les villes** de ces régions.
  - Exemple : chaque ville vend 4 entreprises différentes, par blocs de 4 à 15 %, et chaque entreprise est répartie sur 12 villes. Paris vend Xiaomy 7 %, Intol 9 %, Gogol 9 % et Tesler 7 %.
- Chaque ville a donc un **stock** : la liste des entreprises qu'on peut y acheter, avec le pourcentage restant de chacune. Le stock baisse au fil des achats.
- Prix = cours de l'entreprise (prix pour 1 %) x pourcentage acheté. Les entreprises chères (Nvidio, Appel) rapportent plus mais coûtent plus.
- Achat par tranches de 1 %.

## Plateau (80 cases en spirale)

Le plateau a deux anneaux : un anneau extérieur de 48 cases (les 6 régions du monde) et un anneau intérieur surélevé de 32 cases (les hubs tech). Le chemin est une seule spirale :
- on part du Départ et on fait le tour de l'anneau extérieur ;
- après Sydney, on monte automatiquement dans l'anneau intérieur par le passage vert "Vers les hubs" (première case : Introduction en Bourse) ;
- à la fin de l'anneau intérieur (Cupertino), le passage doré "Retour au Départ" ramène au Départ, ce qui compte un tour complet.

| Case | Nombre | Effet |
|---|---|---|
| Départ | 1 | Chaque passage par le Départ (fin de la spirale) rapporte une prime de 2 000 k$ |
| Ville tech | 30 (5 par région, anneau extérieur) | Paiement + achat (voir "Tour de jeu") |
| Hub tech | 18 (anneau intérieur) | Comme une ville (4 entreprises, 4 à 15 % chacune) |
| Choix régional | 8 (1 par région, 2 pour les hubs) | Achat dans le stock de toutes les villes de la région, n'importe quelle entreprise, dès le premier tour |
| Choix mondial | 1 | Pareil, dans le monde entier, dès le premier tour |
| Enchères | 3 | Mise aux enchères forcée (voir "Enchères"). Valable seulement après un premier tour complet |
| Atout | 4 | Une carte Atout tirée au hasard est offerte (voir "Atouts") |
| Actu Tech | 7 | On pioche une carte événement : on reçoit ou on paie une somme |
| Levée de fonds | 4 | On reçoit de la banque (total des dés x un montant fixe) |
| Introduction en Bourse | 2 | On reçoit une prime de 1 000 k$ |
| Krach | 2 | On perd 10 % de sa trésorerie |

**Villes tech** (villes réelles : Seattle, Austin, Londres, Paris, Tokyo, Bangalore...) et **hubs tech** (Palo Alto, Cupertino, Shenzhen, Hsinchu, Munich...). Chaque ville affiche :
- son **stock** : les entreprises disponibles et le % restant de chacune ;
- son **entreprise de redevance**, visible sur le plateau (logo + couleur du bâtiment). Ces jetons (3 par entreprise, 48 au total) sont **placés au hasard en début de partie**, donc chaque partie a un plateau différent ;
- un **bâtiment qui grandit** avec le % détenu par le plus gros détenteur de cette entreprise (une alliance compte comme un seul détenteur) : terrain à vendre à 0 %, puis 5 paliers (1-9 %, 10-29 %, 30-59 %, 60-99 %, 100 %). Les villes ont des gratte-ciel (étages, flèche, puis couronne dorée), les hubs des campus (garage, bureaux, siège en verre, campus, puis siège en anneau). À 100 %, un anneau et une étoile dorés marquent le monopole.

Toute la répartition (quelle région et quelle ville détient combien de % de chaque entreprise) est dans un fichier JSON, facile à rééquilibrer.

## Tour de jeu

En début de partie, chaque joueur lance 2 dés : le plus haut total commence, puis l'ordre suit les totaux (égalités départagées au hasard). Une carte montre les lancers à tout le monde.

1. **Dés** : le joueur actif lance 2 dés et avance. Un double rapporte 100 k$.
2. **Paiement** (ville) : il paie le plus gros détenteur de l'entreprise de redevance de la case (voir "Paiements").
3. **Achats** : le joueur actif, et **lui seul** :
   - voit le stock de la case (ex. "Paris : Xiaomy 7 %, Intol 9 %, Gogol 9 %, Tesler 7 %") et choisit combien de % il achète de chaque entreprise, **au maximum 30 % cumulés** par achat (ex. 9 % d'Intol + 9 % de Gogol + 7 % de Tesler). Au-delà de 50 % détenus d'une entreprise, chaque % acheté à la banque coûte 5 % de plus que le précédent ;
   - peut proposer de racheter un pourcentage à **n'importe quel autre joueur** (ex. 10 % de ses Nvidio pour 3 M). Le propriétaire accepte, refuse ou fait une contre-offre (délai de 15 s). Les autres joueurs ne peuvent ni acheter ni lancer de transaction pendant ce tour.
4. **Fin du tour** : une carte récapitule pour tout le monde les achats, les ventes à la banque et les échanges entre joueurs du tour, puis on passe au joueur suivant.

## Solo contre des bots

- Onglet "Solo contre des bots" : un joueur humain contre 1 à 5 bots, sur le même écran.
- Les bots jouent un coup à la fois, avec un délai pour suivre les dés, le pion et les cartes. Ils achètent les entreprises les plus chères en gardant une réserve, enchérissent jusqu'au prix d'achat, utilisent leur Atout contre une enchère, acceptent les alliances et les offres au moins au prix d'achat.

## Options, sons et musique

- Bouton engrenage en haut à gauche, sur tous les écrans : volume de la musique, volume des effets, couper le son (réglages gardés dans le navigateur).
- Tous les sons sont synthétisés dans le navigateur (aucun fichier) : dés, pas du pion, cartes, gains, pertes, achats, enchères, faillite, victoire.
- Musique lofi générative : progressions d'accords jazz tirées au hasard, batterie douce avec swing, mélodie pentatonique improvisée et craquements de vinyle. Elle ne se répète jamais à l'identique.

## Paiements

- **Pas de seuil** : dès 1 %, on peut être payé.
- Seul **le plus gros détenteur** est payé. Égalité : le paiement est divisé à parts égales (arrondi à l'unité inférieure, le reste va à la banque).
- **Plus on détient de %, plus on est payé** : montant = tarif de l'entreprise x % détenu par le plus gros détenteur.
  - Exemple : tarif 0,1 M par %, détenteur à 40 % : le visiteur paie 4 M.
- **Au-delà de 50 %**, chaque % rapporte 5 % de plus que le précédent (croissance exponentielle).
- Bonus monopole : à **100 %**, le montant est doublé.
- Égalité : un joueur (ou son alliance) qui détient autant que le plus gros détenteur ne paie rien en tombant sur la case.
- Le paiement est automatique.

## Enchères

- Le joueur qui tombe sur Enchères choisit **un adversaire et une de ses entreprises** : il choisit combien de % partent aux enchères, **jusqu'à dé x 5 %** de ces parts, plafonné à **15 %** (ex. dé à 2 : de 1 à 10 % ; dé à 3 ou plus : de 1 à 15 %). Si l'adversaire en a moins, tout ce qu'il a de cette entreprise part. Si aucun adversaire n'a de parts, il ne se passe rien.
- Un écran spécial s'ouvre pour tout le monde. Mise à prix : **75 % du prix d'achat**, surenchère minimum fixe.
- Tout le monde sauf le vendeur peut enchérir pendant **30 secondes**. La meilleure offre gagne et l'argent va au vendeur.
- Aucune offre : la banque rachète à 75 % du prix, et les % retournent dans le stock des villes.
- Le vendeur peut annuler la vente avec un **Bouclier anti-OPA** (carte Atout).

## Atouts

Sur une case Atout, une carte est tirée au hasard et le joueur peut la prendre gratuitement. Les cartes ne se vendent pas et ne s'échangent pas.

- **Bouclier anti-OPA** : annule la prochaine enchère forcée sur ses actions.
- **Exonération** : la prochaine redevance à payer est offerte (utilisée automatiquement).
- **Dividende exceptionnel** : la prochaine redevance touchée est doublée par la banque (automatique).
- **Rachat express** : se déclenche automatiquement quand son détenteur achète plus de 30 % dans un tour : +15 % d'achat autorisé ce tour-ci. En dessous de 30 %, la carte est gardée.

## Argent

- Chaque joueur commence avec la même somme (valeurs à équilibrer, toutes dans le JSON).
- Un joueur peut revendre à la banque n'importe quel % à 75 % du prix d'achat. Les % retournent dans le stock des villes d'origine de l'entreprise.
- Un paiement plus grand que la trésorerie laisse le joueur en dette. Avant de finir son tour, il revend des parts à la banque (ou laisse la vente automatique vendre les moins chères), propose des actions au joueur qu'il n'a pas pu payer, emprunte, ou déclare faillite.
- **Accord de dette** : le débiteur propose des actions de son choix au créancier, sans qu'elles aient à valoir la somme. S'il accepte, il reçoit les actions et la dette de cette redevance est effacée.
- **Prêts** : à tout moment, un joueur propose de prêter une somme à un autre. L'emprunteur reverse 15 % de tous ses revenus (redevances, bonus, levées de fonds) au prêteur jusqu'à lui avoir rendu 120 % de la somme. Le bouton Prêter est sur la ligne de chaque joueur. Un prêteur qui tombe sur une ville de son emprunteur ne paie pas : la redevance est déduite de ce qui lui reste dû.

## Tour de la Bourse (centre du plateau)

- **Cours vivants** : les 16 entreprises sont réparties en 4 marchés (Puces & IA, Cloud & logiciels, Appareils, Médias & mobilité). Tous les marchés restent à 0 % tant que personne n'a bouclé le premier tour de plateau. Ensuite, chaque fois que le joueur le plus avancé (le plus de tours complets) repasse par le Départ, chaque marché tire une nouvelle tendance entre -30 et +30 % (jamais entre -10 et +10). Les redevances des entreprises du marché sont augmentées ou baissées d'autant.
- Le bandeau de la tour affiche les tendances et la cagnotte ; la tour brille en vert quand les marchés montent en moyenne, en rouge quand ils baissent.
- **Cagnotte** : les pertes des cartes Actu et du Krach s'accumulent au centre. Seule la carte Actu « Délit d'initié » permet de la rafler en entier.

## Alliances

- Un joueur propose une alliance à un autre, qui accepte ou refuse. On peut s'allier à plusieurs, mais il doit toujours rester au moins un adversaire hors de l'alliance. Les deux joueurs les plus riches ne peuvent pas s'allier.
- Les alliés additionnent leurs % d'une même entreprise pour être le plus gros détenteur. La redevance est partagée entre eux selon leurs %.
- Les alliés ne se paient pas de redevance entre eux.
- On quitte l'alliance quand on veut ; elle disparaît quand il reste moins de 2 membres, ou quand elle contient tous les joueurs encore en jeu. Un joueur en faillite la quitte.

## Chat en partie

- Trois onglets : Public (tout le monde), Privé (à un joueur), Groupe.
- N'importe qui peut créer un groupe avec les joueurs de son choix ; un groupe disparaît quand il reste moins de 2 membres.
- Chaque alliance a son groupe, créé avec elle et supprimé (avec ses messages) quand elle se termine.

## Faillite et victoire

- Un joueur qui ne peut pas payer une dette est en faillite : la banque couvre la dette, ses parts retournent dans le stock des villes, il est éliminé.
- Un joueur peut aussi déclarer faillite lui-même, à tout moment (lien en bas du panneau) : il choisit à qui donner ses parts, et ce qu'il n'attribue pas est réparti 1 % à la fois entre les joueurs encore en jeu, dans l'ordre du tour.
- **Classique** (par défaut) : le dernier joueur en jeu gagne. Les autres sont classés par ordre d'élimination.
- **Chrono** (option, 45 à 60 min) : à la fin du temps, le plus grand patrimoine (argent + valeur des parts) gagne.

## Pas repris du livret

- Les cartes / titres d'exploitation : remplacés par des pourcentages directs.
- Le seuil de 30 % pour toucher des redevances.
- Payer la banque sur un double.
- Le délai de 7 secondes pour réclamer ses redevances : remplacé par un paiement automatique.

## Noms et logos des entreprises

Choix retenu : **noms modifiés** (colonne "Nom parodique" ci-dessus) et **logos parodiques**.

- Les logos sont **redessinés de zéro en SVG** pour le projet : ils reprennent l'esprit de l'original (couleur dominante, forme générale) avec un détournement visible, mais aucun fichier officiel n'est importé ni retouché. Un logo officiel modifié reste une oeuvre dérivée du dessin d'origine, ce que le dessin maison évite.
- Le style vise la parodie évidente (comme les marques détournées des jeux vidéo) pour qu'aucun joueur ne pense à un partenariat officiel.
- Logos et noms vivent dans les données (`engine/data/companies.json` + `assets/logos/*.svg`) : on peut les retoucher sans toucher au code.

## Pions personnalisables et points

- Chaque joueur a un profil léger (pas de compte) : un jeton gardé dans son navigateur, le profil (points, objets possédés, pion équipé) est sauvegardé sur le serveur (`DATA_DIR/profiles.json`).
- Écran "Mon pion" : 4 catégories (Chapeau, Tête, Corps, Jambes), aperçu en grand, flèches pour faire défiler, vignettes de tous les objets (grisées si non possédés), achat et équipement.
- 5 objets gratuits par catégorie (dont des variantes de couleur), objets payants de 120 à 350 points (`packages/shared/src/cosmetics.ts`). Les nouveaux objets gratuits sont ajoutés aux profils existants au démarrage du serveur.
- Fin de partie en ligne : points selon le classement, 120 / 60 / 40 / 30 / 20 / 15. Tout le monde gagne des points, seul le 1er en gagne assez pour s'offrir un objet tout de suite (le moins cher coûte 120).
- Les parties "sur cet écran" ne rapportent pas de points.

## Comptes

- Pas d'inscription : pseudo + mot de passe. Au premier passage le pseudo est réservé avec ce mot de passe (et garde les points déjà gagnés dans ce navigateur). Ensuite, le bon mot de passe ramène les points et les objets depuis n'importe quel appareil ; un mauvais affiche "Mauvais mot de passe".
- Mots de passe hachés (scrypt) côté serveur.
- E-mail facultatif : il permet de recevoir un lien de réinitialisation valable 1 h (si le serveur a un SMTP).
- Compte admin `Rycrem` (créable seulement avec `ADMIN_PASSWORD`) : liste des comptes, nouveau mot de passe à la main, modification des points.

## Cartes et animations

Tout ce qui change l'argent ou les parts s'affiche à tous les joueurs sous forme de carte animée, dans l'ordre où ça s'est passé (le moteur garde un flux d'événements numérotés) :
- dés en grand, puis le pion avance case par case et la caméra le suit ;
- cartes Actu Tech, Levée de fonds (avec les dés), Introduction en Bourse, Krach, Tour complet, Atout : montant en gros et trésorerie avant / après ;
- redevance payée, faillite ;
- en fin de tour, les actions achetées : une carte par entreprise, à sa couleur, logo en haut et % détenu en dessous ;
- écran de victoire avec confettis.

Rien n'apparaît ni ne disparaît d'un coup : les cartes entrent et sortent en animation, les bâtiments grandissent, les montants du panneau défilent jusqu'à leur nouvelle valeur.

## Mobile et application installable

- Sur téléphone, le plateau occupe le haut de l'écran et le panneau de jeu devient un tiroir en bas, qu'on agrandit en touchant la poignée. En paysage, le panneau repasse sur le côté.
- Le plateau se manipule au doigt (glisser pour tourner, pincer pour zoomer, toucher une case pour ses détails). Un bouton en haut à droite recentre la vue. En portrait, la caméra prend une vue plus plongeante pour que le plateau tienne dans l'écran.
- Le jeu est une PWA : manifeste, icônes, service worker. Il s'installe sur l'écran d'accueil (bouton "Installer l'application" sur Android et ordinateur, explication pour iPhone). Les pages viennent du réseau en priorité, le cache sert de secours ; les parties "sur cet écran" et en solo marchent hors ligne une fois le jeu chargé.
