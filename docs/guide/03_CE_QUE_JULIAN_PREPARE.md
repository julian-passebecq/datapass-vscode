# 3. Ce que Julian prépare (la personne, pas l'IA)

L'IA du client écrit les fichiers dans Git ([02](02_WHAT_THE_AI_PREPARES.md)). Tout ce qui touche
**ta machine, tes comptes et tes mots de passe**, c'est toi : DataPass ne se connecte jamais à ta
place, n'installe rien et ne lit aucun secret. Cette page est la liste, dans l'ordre.

## 3.1 Comptes et accès (avant tout le reste)

| Quoi | Pourquoi | Comment vérifier |
|---|---|---|
| Un compte chez l'hébergeur Git du client (GitHub, Azure DevOps ou GitLab) avec accès aux dépôts | Cloner, relire et fusionner les PR | Tu vois les dépôts dans le navigateur |
| Accès Azure au **tenant** et à l'**abonnement dev** du client (rôle Contributeur sur le groupe de ressources dev suffit pour commencer) | `az`, l'extension Azure Functions, Storage, Cosmos | `az account show` affiche le bon tenant |
| Accès au **workspace Databricks** dev (si le projet en a un) | CLI et extension Databricks | `databricks auth profiles` montre le profil « valid » |
| Accès **Fabric / Power BI** (si le projet en a) | CLI `fab`, extensions Fabric | `fab auth status` |
| Accès MongoDB Atlas (utilisateur de base de données **dev**) | Extension MongoDB | La connexion s'ouvre dans l'extension |
| Pour chaque VM : l'adresse, l'utilisateur, la clé SSH (le client te les donne) | Remote - SSH | `ssh <alias>` fonctionne dans un terminal |

Les secrets (mots de passe, chaînes de connexion, clés) vont dans ton coffre local (Power Ops) ou
dans les fichiers locaux ignorés par Git (`.env`, `local.settings.json`) — **jamais** dans un
fichier que l'IA prépare, jamais dans un chat.

## 3.2 Outils à installer

Installe seulement ce que la `toolchain` du projet demande (DataPass affiche la liste dans
**Tools & versions** et te donne la commande à copier). Les plus courants sous Windows :

| Outil | Id DataPass | Installation (Windows) |
|---|---|---|
| Git | `cli.git` | `winget install Git.Git` |
| Azure CLI | `cli.az` | `winget install Microsoft.AzureCLI` |
| Azure Functions Core Tools | `cli.func` | `winget install Microsoft.Azure.FunctionsCoreTools` |
| Databricks CLI | `cli.databricks` | `winget install Databricks.DatabricksCLI` |
| Fabric CLI | `cli.fab` | `pip install ms-fabric-cli` |
| Python | `cli.python` | `winget install Python.Python.3.11` (la version que demande le projet) |
| GitHub CLI (pour les PR et la CI dans la vue Git) | — | `winget install GitHub.cli`, puis `gh auth login` |
| Extensions VS Code | `ext.*` | Quand tu ouvres le dépôt de coordination : **Show Recommended Extensions** (lu dans `.vscode/extensions.json`), puis Installer |

Après une installation, ferme et rouvre VS Code (le PATH n'est relu qu'au démarrage).

## 3.3 Se connecter (toi, dans un terminal)

DataPass te propose la commande exacte (bouton **Check connections** puis « copier ») ; tu la
lances toi-même :

```bash
az login --tenant <id du tenant>
```

```bash
databricks auth login --profile <nom du profil déclaré>
```

```bash
fab auth login
```

Puis **Check connections** dans DataPass : chaque ligne doit passer à « ok ». DataPass lance
seulement les commandes de lecture (`az account show`, `databricks auth profiles`,
`fab auth status`) et ne garde que « connecté / pas connecté » et les ids à comparer.

## 3.4 SSH pour les VM

Pour chaque VM, le manifeste donne un **alias** (par exemple `invoice-api-dev`). Tu écris le vrai
hôte, l'utilisateur et la clé dans `C:\Users\julia\.ssh\config` :

```text
Host invoice-api-dev
    HostName 20.50.10.4
    User azureuser
    IdentityFile ~/.ssh/client_api_dev_ed25519
```

La clé privée reste dans `~/.ssh`, jamais dans un dépôt. Teste avec `ssh invoice-api-dev`, puis
dans DataPass le composant VM → *Open over SSH* ouvre une fenêtre Remote - SSH sur le bon dossier.

## 3.5 Cloner les dépôts sous D:\PROJ

1. Clone le **dépôt de coordination** du client dans `D:\PROJ\<client>-coordination` et ouvre ce
   dossier dans VS Code.
2. Accepte **Workspace Trust** (« Yes, I trust the authors ») pour ce dossier : en mode restreint,
   DataPass lit les fichiers mais ne lance ni Git ni aucun programme (pas de Check for updates, pas
   de clone).
3. Dans la vue **Project**, section Repositories : **Clone** pour chaque dépôt « not cloned » (il
   se place à côté, dans `D:\PROJ`), ou **Locate** si tu l'as déjà cloné ailleurs (DataPass vérifie
   son origine Git). Un dépôt « planned » n'existe pas encore : rien à faire.

## 3.6 Réglages VS Code (ta machine)

Ouvre les réglages (Ctrl+,), onglet **User**, cherche `datapass`. Ce sont des réglages de ta
machine : un dépôt ne peut pas les changer.

| Réglage | Valeur conseillée | Pourquoi |
|---|---|---|
| `datapass.projectsFolders` | `["D:\\PROJ"]` | Où DataPass cherche les clones et les « Other repositories » de la vue Git |
| `datapass.ai.workOrders.enabled` | `true` seulement si tu veux des ordres de travail pour agents | Sans lui, aucun ordre, même si le projet les autorise |
| `datapass.ai.projectTypes` | `{ "<id du projet>": "work" }` | Force le type sur ta machine (gagne sur `project.type`) |
| `datapass.git.ghPath` | vide (gh dans le PATH) ou le chemin complet de `gh.exe` | PR et CI dans la vue Git |
| `datapass.catalogs` | le chemin d'un `catalog.json` de hub, si tu en as un | *Switch Project* entre clients |
| `datapass.ai.claude.path`, `datapass.ai.codex.path` | vide sauf besoin | Lancement dans un terminal |
| `datapass.ai.workLog.privateRepository` | un clone privé, optionnel | Copie des résumés d'ordres |

Pour un projet **work** (client), les ordres de travail demandent **les deux** : ton réglage
`datapass.ai.workOrders.enabled: true` **et** `"modules": { "workOrders": true }` dans le manifeste.
Tu fusionnes toi-même les PR.

## 3.7 L'espace de travail de l'entreprise (une fenêtre par client)

Quand les dépôts sont clonés : barre d'état DataPass (`💼 <Entreprise> ▾`) → *Create the Company
Workspace File (one window per company)…*. DataPass écrit un fichier `.code-workspace` sur **ta**
machine (jamais dans un dépôt) avec le dépôt de coordination, les dépôts trouvés, une couleur de
barre de titre et le nom de l'entreprise (`datapass.company`). Rouvre VS Code par ce fichier ;
accepte Workspace Trust pour ses dossiers. Ensuite, *Save Work View…* pour retrouver ta disposition.

## 3.8 Ta check-list avant de dire « le client est prêt »

- [ ] Comptes : Git, Azure (tenant + abonnement dev), Databricks/Fabric si utilisés, Atlas dev.
- [ ] Outils de la toolchain installés ; **Tools & versions** sans « missing » (hors optionnels).
- [ ] `az login`, `databricks auth login`, `fab auth login` faits ; **Check connections** tout « ok ».
- [ ] `~/.ssh/config` rempli pour chaque alias de VM ; `ssh <alias>` fonctionne.
- [ ] Dépôt de coordination cloné sous `D:\PROJ`, dossier approuvé (Workspace Trust).
- [ ] Tous les dépôts non « planned » clonés ou localisés.
- [ ] Réglages : `projectsFolders`, et si tu veux des agents `ai.workOrders.enabled` + le type.
- [ ] Fichiers `.env` créés à partir des **noms** listés (Local environment : tout « set »).
- [ ] Fichier d'espace de travail de l'entreprise créé et ouvert.
- [ ] **Problems in project files** vide (ou seulement des avertissements compris).
