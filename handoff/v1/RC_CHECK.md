# Essai 1.0.0-rc.1 : ta part (≈ 5 min)

Pour **PM ASSISTANT DataPass 1**, qui le propose à Julian en une seule fois (une ligne dans todo.md, pointant ici).
Décision produit de Julian (27 sept., V1-AUTO) : tout ce qui s'automatise passe par **Codex Computer Use**
(mode auto) ; Julian garde seulement les approbations et ce qui demande ses propres comptes.
Le reste (tests, desktop Windows + Ubuntu, performance, installation, mise à jour depuis 0.27.0) est déjà fait par
l'IA : [RC_QUALIFICATION.md](RC_QUALIFICATION.md). Cet essai remplace aussi les vérifications 0.26.0 et 0.27.0 reportées.

## Avant Julian (l'IA, pas lui)

Une session IA (debug ou tester) prépare le dossier de l'essai, sans lancer VS Code :

```
npx tsx scripts/qa/prepare.ts --auto <clone de datapass-vscode-codex-auto> --root %TEMP%\datapass-qa\rc1 \
  --vsix %TEMP%\datapass-qa\rc1\datapass-vscode-1.0.0-rc.1.vsix \
  --sha256 8850b1274c369fb11f1d2c5e776afda30a13a6fd33d0178099023e941d0ac5bd \
  --datapass-version 1.0.0-rc.1 --commit 5a4f8d9 --rc --clone
```

- Le VSIX est celui de la prerelease GitHub `v1.0.0-rc.1` (empreinte ci-dessus, aussi dans
  `out/rc/1.0.0-rc.1/manifest.json`). Ne pas en reconstruire un autre : `--sha256` refuse tout autre fichier.
- `--rc` ajoute les 5 parcours DataPass de [qa/rc/journeys/](../../qa/rc/journeys/) aux 12 parcours du client
  fictif (J01–J12) : R01 installation, R02 mode restreint, R03 projet à plusieurs dépôts, R04 « Open a Client
  Project » depuis l'adresse du bridge + palette sans FOIL ni Mongoku, R05 fichier de projet cassé.
- Sortie : `%TEMP%\datapass-qa\rc1\CODEX_PROMPT.md`, **le seul texte à coller**. L'assistant donne son chemin à Julian.

## 1. Lancer Codex (≈ 2 min, puis laisser le PC)
1. Ouvrir l'app **Codex** (bureau), nouveau fil, Computer Use activé.
2. Ouvrir `CODEX_PROMPT.md` (chemin donné par l'assistant), tout copier, coller dans le fil, Entrée.
3. Quand Codex demande : **Always allow** pour `Code.exe`, et **autoriser** ses commandes de lancement de VS Code
   (choisir « pour ce fil » si proposé).
4. Laisser le PC allumé, écran **déverrouillé et visible**, sans y toucher, jusqu'au message
   « DataPass run done: … » (≈ 1 à 2 h). Codex ouvre lui-même une pull request de rapport ; l'IA la lit.

## 2. Tes connexions (≈ 3 min, seulement ce que toi seul peux faire)
À faire quand Codex a fini (ou avant de le lancer), dans ton VS Code habituel :
1. Extensions (Ctrl+Shift+X) → `…` → **Install from VSIX…** → le même fichier `datapass-vscode-1.0.0-rc.1.vsix`.
2. Palette (Ctrl+Shift+P) → **DataPass: Check Connections** (lecture seule : `az account show`,
   `databricks auth profiles`, `fab auth status`), puis la section *Tools & versions* de Readiness.
3. **Tu dois voir** : « installé », « connecté » et « vérifié » séparés ; un outil non connecté le dit ; rien
   n'est marqué « vérifié » sans vérification ; aucune connexion lancée sans ton clic.

## 3. Deuxième écran (≈ 1 min, facultatif)
Si tu en as un : glisser la vue Architecture dessus, elle reste lisible.

## À renvoyer à l'assistant
« RC OK » ou les numéros d'étape (2 ou 3) qui ne vont pas, avec une capture. Le résultat de Codex, l'IA le lit
dans la pull request de rapport (`datapass-codex-test`, dossier `reports/client/<run>`).
