# Essai 1.0.0-rc.1 sur ton vrai écran (≈ 20 min)

Pour **PM ASSISTANT DataPass 1**, qui le propose à Julian en une seule fois (une ligne dans todo.md, pointant ici).
Tout le reste (tests, desktop Windows + Ubuntu, performance, installation, mise à jour depuis 0.27.0) est déjà
fait par l'IA : voir [RC_QUALIFICATION.md](RC_QUALIFICATION.md). Cet essai remplace aussi les vérifications
0.26.0 et 0.27.0 reportées.

**Le fichier à installer** : `datapass-vscode-1.0.0-rc.1.vsix`, construit une seule fois par `npm run qa:rc` sur
le commit de `main` après le merge de V1-RC. L'assistant donne son chemin exact et son empreinte SHA-256
(dans `out/rc/1.0.0-rc.1/manifest.json`). Ne pas en reconstruire un autre.

Pour chaque étape : si ce que tu vois ne correspond pas, fais une capture et note le numéro de l'étape.
Rien d'autre à faire, l'IA corrige.

## 1. Installer par-dessus 0.27.0 (2 min)
1. VS Code → Extensions (Ctrl+Shift+X) → `…` en haut → **Install from VSIX…** → choisir le fichier ci-dessus.
2. Recharger la fenêtre si VS Code le demande.
3. **Tu dois voir** : dans Extensions, *DataPass Control Plane* en version **1.0.0-rc.1**, et aucune fenêtre
   de connexion (Azure, Microsoft, GitHub) ne s'ouvre toute seule.

## 2. Mode restreint (3 min)
1. Copier le dossier `examples/v3/doc-pipeline` du dépôt datapass-vscode dans un **nouveau** dossier
   (par ex. `%TEMP%\dp-restreint`), puis File → Open Folder… sur ce nouveau dossier.
2. À la question « Do you trust the authors… ? », cliquer **No, I don't trust the authors**.
3. **Tu dois voir** : « Restricted Mode » en bas à gauche ; la vue Architecture montre quand même le schéma ;
   la vue **Git** de DataPass affiche « Restricted Mode: DataPass does not run Git ».
4. Palette (Ctrl+Shift+P) → **DataPass: Run Component Test…** sur *PDF processing* : **un message refuse** (« Restricted
   Mode… »), rien ne se lance.
5. Cliquer « Restricted Mode » en bas → **Trust** : le message « Restricted Mode » disparaît de la vue Git.

## 3. Un vrai projet à plusieurs dépôts (5 min) — reprend la vérification 0.27.0
1. Ouvrir ton vrai projet (le bridge FOIL, ou le testlab 10).
2. **Tu dois voir** : l'arbre et l'architecture en ~2 s, puis les lignes d'outils qui se remplissent ; une heure
   « à jour à … » visible ; changer de variante puis revenir à « current » ne mélange pas les états.
3. Cliquer un composant : Détails montre ses fichiers et son dépôt ; si un fichier du projet est cassé, il est
   signalé en erreur (Problems), pas « absent ».

## 4. Ouvrir un projet client et palette (4 min) — reprend la vérification 0.26.0
1. Palette → **DataPass: Open a Client Project…** avec l'adresse Git d'un bridge (ou le testlab 10) : la fenêtre
   du projet s'ouvre.
2. Palette → taper `DataPass` : une liste courte et lisible, **aucune** commande « FOIL » ni « Mongoku » ;
   Réglages → chercher `mongoku` : rien.

## 5. Tes connexions (4 min, seulement ce que toi seul peux faire)
1. Palette → **DataPass: Check Connections** (lecture seule : `az account show`, `databricks auth profiles`,
   `fab auth status`), puis la section *Tools & versions* de Readiness.
2. **Tu dois voir** : « installé », « connecté » et « vérifié » séparés ; un outil non connecté le dit ; rien
   n'est marqué « vérifié » sans vérification ; aucune connexion lancée sans ton clic.
3. Si tu as un deuxième écran : glisser la vue Architecture dessus, elle reste lisible.

## 6. Codex (2 min, facultatif) — reprend l'essai QA-0
Si tu as le temps : refaire l'essai Codex Computer Use (ligne « test Codex, QA-0 » de todo.md) avec ce VSIX.
S'il ne voit toujours aucune fenêtre, le noter : le PM décidera (le chemin automatisé Playwright n'en tient pas lieu).

## À renvoyer à l'assistant
« RC OK » ou la liste des numéros d'étape qui ne vont pas, avec les captures.
