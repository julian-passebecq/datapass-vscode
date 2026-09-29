# Julian's directions, 29 Sept 2026 (verbatim, French, typos kept)

## 1. IaC (17:43)
pas hesite a rajouter des fausses données iac pour le client foil, fabric databricks la vm oracle etc, on doit etre bien sur iac car cest tres important pour les job maintenant, mettre du kubernetes si l faut open tofu etc, avoir une grosse partie iac, jai totalement neglige ca javais oublie, a vous de me faire une partie iac complete utile complemntaire avec ce quon a deja dans le cloud et egalement pas oublie la partie monitoring fabric cu etc avec des fausses données et on testera quand lappli sera fini en grandeur nature, mais votre v1 doit avoir tout quitte a augmenter le rythme jusqua apres jeudi quand on a le reset a 14h. mais peu  importe faites autant que vous pouvez sans quon aille trop vite et que ca devienne un inconvenient probleme de merge etc

## 2. Toolboxes, Grafana, fake logs, observation vs monitoring (18:05)
on doit aussi integrer les toolbox fabric power bi etc recuprer les infos les afficher etc, on a supprime grafana, sil faut en remettre pourquoi pas  je sais pas, peut etre etendre a grafana mais pourvoir visuualiser ailleurs je ovulais pas quon se restreigne trop avec grafana car on utilisera pas tjrs grafana. faire des faux log foil quon recevra via api fabric power bi databricks (databricks par azure daabricks notre dab est dabricks) comme ca vous pouvez completement integre une fois quon pousse sur le cloud ce quil se passe, et comment gerer les observations dans nos modules existants, sil faut tout mettre dans un module observation un autre monitoring etc, pour moi observatoin cest analyser les fichiers spakr leur jointure reelelemnt, faire leur lineage reel , alors que cloud on fait rien de reel que theoriqye, donc on doit pa oublier cette partie de traiter le projet une fois quil est sur fabric, notre observation doit etre super complete et peut etre reutiliser bcp de chsoes de cloud mais cette fois avec les infos reel, voir aussi un peu de lineage statique je sais pas ce qui est le meiux a vous de voir bon courage

## 3. Addendum (18:20)
et aussi analyser les spark cu etc, et peut etre faire fausse donnes azure databricks avec gros cluster spark car notre databricks dab cest du free, donc pas sur on soit relevant

## 4. Also asked (18:30)
lancer un pm bis pour reflechir a ce quon aurait pu oublier globalement, mieux voir reflechir maintenant que ensuite ce quon aurait pu zappe ou sous traite mal integre etc
