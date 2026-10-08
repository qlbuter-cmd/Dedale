# Dédale

FPS en ligne dans un labyrinthe. Jusqu'à 5 joueurs par partie, qui se rejoignent avec un lien privé.

## Mettre le jeu en ligne sur Render (environ 10 minutes)

### 1. Envoyer le projet sur GitHub

1. Connecte-toi sur [github.com](https://github.com) et clique sur **New** (bouton vert) pour créer un dépôt.
2. Nom du dépôt : `dedale`. Choisis **Private** si tu veux que le code reste privé. Clique sur **Create repository**.
3. Sur la page du dépôt vide, clique sur le lien **uploading an existing file**.
4. Décompresse `dedale.zip`, ouvre le dossier `dedale`, sélectionne **tout son contenu** (fichiers et dossiers `public`, `shared`, `src`) et glisse-le dans la page.
5. Clique sur **Commit changes**.

Vérifie qu'à la racine du dépôt tu vois bien : `server.js`, `package.json`, `render.yaml` et les dossiers `public`, `shared` et `src`.

### 2. Créer le service sur Render

1. Connecte-toi sur [render.com](https://render.com) avec ton compte GitHub.
2. Clique sur **New +** puis **Web Service**.
3. Autorise Render à accéder à ton dépôt `dedale` et sélectionne-le.
4. Remplis les champs :
   - **Runtime** : Node
   - **Build Command** : `npm install`
   - **Start Command** : `npm start`
   - **Instance Type** : Free
5. Clique sur **Deploy Web Service**.

Au bout de 2 à 3 minutes, le journal affiche `Dédale prêt sur le port …` et Render te donne une adresse du type `https://dedale-xxxx.onrender.com`.

### 3. Jouer

1. Ouvre l'adresse : une partie privée est créée avec un code (par exemple `K7P2Q`).
2. Choisis ton pseudo, clique sur **Copier le lien d'invitation** et envoie-le à tes amis.
3. Chacun clique sur **Jouer** et arrive directement dans la partie.

## Comment ça marche

- Le premier joueur arrivé **héberge** la partie : son navigateur calcule les dégâts, les bonus, les projectiles et les scores. Les autres envoient leurs déplacements et leurs tirs.
- Si l'hôte quitte la partie, ou passe sur un autre onglet, le joueur suivant reprend la partie automatiquement, sans la couper.
- Le serveur Render ne fait que relayer les messages : il reste léger, même avec l'offre gratuite.
- Pas de bots en ligne : uniquement des joueurs humains.

## Bon à savoir avec l'offre gratuite de Render

- Le serveur se met en veille après 15 minutes sans joueur. Le premier qui arrive attend environ une minute. Si le message « Le serveur ne répond pas » apparaît, patiente un peu et réessaie.
- La page fait environ 2 Mo à télécharger (armes et personnage compris).

## Mettre à jour le jeu

Remplace les fichiers modifiés dans GitHub (**Add file** puis **Upload files**). Render redéploie tout seul en quelques minutes.

Les sources du jeu sont dans `src/` et `shared/`. La page `public/index.html` est générée à partir d'elles avec `node build.js`.

## Tester sur ton ordinateur (facultatif)

Installe [Node.js](https://nodejs.org) (version 18 ou plus), puis dans le dossier du projet :

```
npm start
```

Ouvre `http://localhost:3000` dans deux fenêtres pour jouer contre toi-même.

## Structure

- `server.js` : serveur web et relais temps réel (aucune dépendance)
- `public/index.html` : le jeu complet, prêt à servir
- `src/` : sources du jeu (interface, code, modèles 3D des armes et du personnage)
- `shared/maze.js` : génération du labyrinthe
- `build.js` : reconstruit `public/index.html`
