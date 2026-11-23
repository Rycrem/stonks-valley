# Déployer Stonks Valley sur le NAS

Résultat : le jeu tourne dans Docker sur le NAS, est accessible sur `https://jeu.tortuebox.fr` via le tunnel Cloudflare `nas-maison`, et se met à jour tout seul depuis GitHub à chaque redémarrage du conteneur.

## 1. Ajouter le service

Dans `/volume1/docker/docker-compose.yml`, sous `services:` :

```yaml
  stonks-valley:
    image: ghcr.io/rycrem/stonks-valley:latest
    restart: unless-stopped
    ports:
      - "8090:3000"
    environment:
      ADMIN_PASSWORD: ${STONKS_ADMIN_PASSWORD}
      PUBLIC_URL: https://jeu.tortuebox.fr
      AUTO_UPDATE: "1"
      SMTP_HOST: ${SMTP_HOST:-}
      SMTP_PORT: ${SMTP_PORT:-587}
      SMTP_USER: ${SMTP_USER:-}
      SMTP_PASS: ${SMTP_PASS:-}
      MAIL_FROM: ${MAIL_FROM:-}
    volumes:
      - ./stonks-valley:/data
```

- `8090` : port côté NAS, à changer s'il est déjà pris.
- `./stonks-valley` : dossier des comptes, points et objets (`profiles.json`) et des parties en cours (`games.json`, gardées 24 h quand tout le monde est parti ou pendant un redémarrage). C'est le seul dossier à sauvegarder.

## 2. Remplir le `.env`

Dans `/volume1/docker/.env`, ajouter :

```sh
STONKS_ADMIN_PASSWORD=un-mot-de-passe-solide
```

C'est le mot de passe du compte admin `Rycrem`. Tant qu'il n'est pas défini, personne ne peut créer ce compte.

Facultatif, pour que "Mot de passe oublié" envoie un e-mail (exemple avec Gmail et un [mot de passe d'application](https://myaccount.google.com/apppasswords)) :

```sh
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=ton.adresse@gmail.com
SMTP_PASS=mot-de-passe-d-application
MAIL_FROM="Stonks Valley <ton.adresse@gmail.com>"
```

Sans SMTP, le jeu indique aux joueurs de demander à l'admin, qui change le mot de passe dans le panneau Admin.

## 3. Lancer

```sh
cd /volume1/docker
docker compose pull stonks-valley
docker compose up -d stonks-valley
docker compose logs -f stonks-valley
```

Les logs doivent finir par `Stonks Valley sur http://localhost:3000`. Test sur le réseau local : `http://IP-DU-NAS:8090`.

Si `pull` répond `denied` : sur GitHub, Packages > `stonks-valley` > Package settings > Change visibility > Public.

## 4. Publier sur jeu.tortuebox.fr

Dans Cloudflare Zero Trust, tunnel `nas-maison`, onglet Routes > Add route > Published application :

- Subdomain : `jeu`
- Domain : `tortuebox.fr`
- Service : `http://localhost:8090`

Le temps réel (WebSocket) passe sans réglage supplémentaire.

## 5. Créer le compte admin

Sur `https://jeu.tortuebox.fr`, se connecter avec le pseudo `Rycrem` et le mot de passe `STONKS_ADMIN_PASSWORD`. Le bouton "Admin" apparaît : liste des comptes, nouveau mot de passe, points.

## Mises à jour

À chaque démarrage, le conteneur regarde la dernière version de `main` sur GitHub :

- même version : il démarre tout de suite ;
- nouvelle version : il la télécharge et la construit (1 à 3 min sur le NAS, le jeu est indisponible pendant ce temps), puis démarre dessus ;
- GitHub injoignable ou construction en échec : il démarre sur la version précédente.

Pour mettre à jour :

```sh
docker compose restart stonks-valley
```

Un redémarrage du NAS fait la même chose. Les comptes ne sont jamais touchés (ils sont dans `./stonks-valley`).

Si une mise à jour change le `Dockerfile` (rare, ce sera dit dans la PR), il faut aussi récupérer la nouvelle image :

```sh
docker compose pull stonks-valley && docker compose up -d stonks-valley
```

Pour figer la version actuelle : `AUTO_UPDATE: "0"`, puis `docker compose up -d stonks-valley`.

## Dépannage

| Symptôme | Piste |
|---|---|
| Page inaccessible juste après un redémarrage | Mise à jour en cours : `docker compose logs -f stonks-valley`, attendre `[maj] version ... installée` |
| `[maj] échec, on garde la version actuelle` | Le jeu tourne sur l'ancienne version ; regarder les lignes au-dessus et me les envoyer |
| "Ce pseudo est réservé" en se connectant en Rycrem | `STONKS_ADMIN_PASSWORD` absent ou différent : vérifier le `.env` puis `docker compose up -d stonks-valley` |
| Erreur 502 Cloudflare | Le conteneur est arrêté ou le port de la route ne correspond pas à `8090` |
