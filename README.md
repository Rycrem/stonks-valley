# Stonks Valley

Jeu de plateau économique sur le thème de la tech, jouable à plusieurs dans le navigateur.

## Développement

```sh
corepack enable
pnpm install
pnpm test
pnpm typecheck
```

Documentation du projet : `docs/` (sur la branche du plan).

## En ligne

```sh
pnpm build
pnpm --filter @stonks/server start   # http://localhost:3000
```

## Déploiement sur le NAS

Guide pas à pas : [docs/04-deploiement.md](docs/04-deploiement.md).

Chaque merge sur `main` publie l'image `ghcr.io/rycrem/stonks-valley:latest` (amd64 et arm64). Au démarrage, le conteneur récupère aussi la dernière version de `main` depuis GitHub et la construit (`AUTO_UPDATE=1`, voir `scripts/start.sh`) : un `docker compose restart stonks-valley` suffit pour mettre à jour.

### Variables d'environnement

| Variable | Rôle |
|---|---|
| `ADMIN_PASSWORD` | Mot de passe du compte admin. Le pseudo admin (`ADMIN_USER`, par défaut `Rycrem`) ne peut être créé qu'avec ce mot de passe. Sans cette variable, le pseudo reste réservé. |
| `PUBLIC_URL` | Adresse du site, utilisée dans les liens de réinitialisation (`https://jeu.tortuebox.fr`) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Envoi des e-mails "mot de passe oublié". Facultatif : sans SMTP, l'admin réinitialise les mots de passe à la main. |
| `AUTO_UPDATE` | `1` (défaut) : mise à jour depuis git au démarrage ; `0` : version de l'image |
| `SAVE_GAMES` | `1` (défaut) : les parties en cours sont sauvegardées dans `DATA_DIR/games.json` et reprennent après un redémarrage ou une pause (24 h max) ; `0` : désactivé |
| `GIT_REPO`, `GIT_BRANCH` | Source de la mise à jour (défaut : ce dépôt, `main`) |
| `DATA_DIR` | Dossier des profils et des parties sauvegardées (`/data` dans l'image) |
