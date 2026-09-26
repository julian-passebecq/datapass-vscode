# Démarrer avec DataPass

Une page pour commencer. DataPass est une extension VS Code qui montre l'architecture d'un projet
préparé par une IA (ChatGPT, Claude), les fichiers que chaque étape attend dans chaque dépôt, ce qui
manque, et qui ouvre le bon fichier ou le bon outil officiel. **DataPass ne déploie rien, ne pousse
rien et n'exécute jamais le code du projet.**

## 1. Installer

1. Récupérer le fichier `datapass-vscode-<version>.vsix` (ou le produire : `npm run package` dans ce dépôt).
2. VS Code → **Extensions** → `…` → **Install from VSIX…**, ou en terminal :

   ```bash
   code --install-extension datapass-vscode-<version>.vsix --force
   ```

3. Recharger la fenêtre. La barre d'état affiche **DataPass: Standard**.

## 2. Ouvrir un projet client

**À partir de 0.27** : commande **DataPass: Open a Client Project…** (aussi sur la page d'accueil).

1. Coller l'URL Git du **dépôt pont** du client (GitHub, Azure DevOps ou GitLab, https ou SSH).
2. Choisir un dossier parent.
3. DataPass clone le dépôt pont, lit son manifeste et liste les dépôts natifs déclarés avec leur
   rôle. Cocher ceux à cloner (par défaut : tous sauf les dépôts *planned*). Un clone déjà présent
   sur la machine est retrouvé au lieu d'être recloné.
4. DataPass écrit le fichier d'espace de travail de l'entreprise et l'ouvre ; en mode Standard, le
   panneau **Architecture** s'affiche.

Relancer la commande ne reclone rien (« tout est présent »). Si l'authentification échoue, DataPass
s'arrête avec le message de l'hébergeur et propose *Retry*.

**Avant 0.27** : cloner le dépôt pont à la main, puis **File → Open Folder…** sur ce clone ; les
dépôts natifs manquants apparaissent dans la vue Project avec **Clone** et **Locate** (*DataPass: Clone a Project Repository…*, *DataPass: Locate an Existing Clone…*).

## 3. La boucle quotidienne

1. **DataPass: Check for Updates** (`git fetch`, rien n'est fusionné), puis **DataPass: Get Updates** (avance rapide
   seulement, après la liste des commits). DataPass ne tire jamais en silence et ne pousse jamais.
2. Regarder l'**Architecture** : cliquer un composant, lire **Details** (fichiers trouvés ou
   manquants, ce que chaque étape demande par environnement).
3. Donner du contexte à l'IA : clic droit sur un fichier → **DataPass: Copy Context for My AI…**, ou
   **DataPass: Prepare AI Context for the Selection…** pour un paquet borné (dépôt, dossier et fichiers exacts).
4. L'IA répond :
   - pour un fichier `.datapass/*.json` : coller sa réponse dans la vue **AI** (onglet
     *DataPass-guided*), relire le diff, écrire. DataPass ne commite pas : vous commitez ;
   - pour du code natif : l'IA ouvre une **pull request** par dépôt ; vous relisez et fusionnez sur
     l'hébergeur Git, puis **Get updates**.
5. La vue **Git** liste ce qui attend une action (*Needs you*), les worktrees, les PR et leur CI.

Détail des quatre façons de travailler avec l'IA : [guide/05_THE_LOOPS.md](guide/05_THE_LOOPS.md).

## 4. Les quatre modes

Un mode ne change que ce qui est **affiché** : mêmes fichiers, commandes toujours dans la palette,
alertes de sécurité visibles partout. Changer avec l'élément **DataPass: Standard** de la barre
d'état ou **DataPass: Switch Mode** ; affiner avec **DataPass: Customize DataPass Mode**.

| Mode | Ce qu'il montre (chacun ajoute au précédent) |
|---|---|
| **Vanilla** | l'Explorer de VS Code, la vue Git de DataPass, la vue AI (onglet DataPass-guided) |
| **Standard** (par défaut) | + le panneau Architecture, Details, les composants qui ont des alternatives |
| **DataPass** | + l'arbre Project (options, fiche projet, readiness), onglets Agent et Manual, vues Options, Project sheet, Work orders |
| **Advanced** | tout : + le board, les vues Work et Galaxy, l'état des outils |

## 5. Où sont les choses

| Quoi | Où |
|---|---|
| Arbre du projet, dépôts, readiness | vue **Project** (barre latérale gauche) |
| Diagramme | panneau **Architecture** (en bas) |
| Échange avec l'IA, Details | barre latérale **secondaire** (à droite) |
| Git, PR, CI | vue **Git** |
| Vue d'ensemble de tous les sous-projets | onglet **Workbench** |
| Variantes d'architecture (A/B/C…) | barre d'état *Variant: … · preview* (0.25+) ([guide/10_SWITCHING_VARIANTS.md](guide/10_SWITCHING_VARIANTS.md)) |
| Description du projet | `.datapass/project.json` et `.datapass/graph.json` dans le dépôt pont |
| Fichiers propres à la machine (sauvegardes, ordres de travail) | `.datapass/local/` (jamais commité) |
| Réglages DataPass | réglages VS Code `datapass.*` (machine, rien dans les dépôts) |

Pour aller plus loin : le guide pas à pas [guide/README.md](guide/README.md) (préparer un projet
client), ce que vous préparez vous-même [guide/03_CE_QUE_JULIAN_PREPARE.md](guide/03_CE_QUE_JULIAN_PREPARE.md),
les limites connues [guide/07_KNOWN_LIMITS.md](guide/07_KNOWN_LIMITS.md).
