# Exploration "portabilité" (idée 15, complément, 2026-09-29): philosophie Variant, aucune décision

## 1. L'idée en couches de portabilité
Principe: une sémantique commune, des adaptateurs par variante, un changement de variante = un diff, pas une réécriture. DataPass a déjà le mécanisme (variantes commutables 0.25.0, `status.selectedVariant`, modèle projet rôles/couches/segments, IaC OpenTofu + packs fournisseur). On l'étend de "variante de projet" à "variante d'architecture".

| Couche | Variantes | Portabilité aujourd'hui (docs officielles) |
|---|---|---|
| Format de table | Parquet nu, Delta, Iceberg (Hudi) | UniForm: Delta écrit, métadonnées Iceberg générées sans réécrire les données; lecture Iceberg seule, Unity Catalog + column mapping requis, deletion vectors incompatibles. XTable (incubation ASF): traduit Hudi/Delta/Iceberg, pas de MoR ni delete vectors |
| Catalogue | Unity Catalog (OSS Apache 2.0), Hive metastore, REST Iceberg | Spec REST Iceberg = contrat neutre; UC OSS l'expose avec la vue Delta/UniForm |
| Moteur | Spark, Databricks SQL, Fabric, Trino, DuckDB, Doris | Dialectes divergents: c'est le vrai verrou (fonctions, VARIANT `:` vs `[]`) |
| Plateforme | Databricks (AWS/GCP) ↔ Azure Databricks ↔ Fabric | Azure Databricks = même produit (Delta, UC, Lakeflow, bundles) sur ADLS/Entra; différences = identité, stockage, réseau, IaC provider, pas le code |
| IaC | OpenTofu, providers databricks/azurerm/fabric | Ressources non portables 1:1: c'est là que DataPass sait générer |

Constat: la portabilité des données est presque résolue par les métadonnées (UniForm/XTable/REST). Celle des moteurs, identités et IaC ne l'est pas: c'est le créneau d'un outil d'analyse statique.

## 2. Options
| Option | Ce que ferait DataPass | Sens? | Coût | Jalon |
|---|---|---|---|---|
| A. Modèle "profil d'architecture" (format+catalogue+moteur+plateforme) dans le projet, une variante = un profil | Modéliser la variante, l'afficher/sélectionner comme 0.25.0 | Oui: réutilise l'existant, base de tout le reste | M | V2 |
| B. Détecteur de verrouillage (lock-in) | Scanner SQL/PySpark/IaC: `USING DELTA`, `DESCRIBE HISTORY`, `MERGE`, deletion vectors, `dbutils`, chemins `abfss://`, Unity-only; score par couche | Oui: pur analyse statique, valeur immédiate | M | V2 |
| C. Rapport de préparation Delta→Iceberg (UniForm-ready) | Vérifier column mapping, protocole 2/7, deletion vectors, tables hors UC, MV/streaming | Oui: règles précises et vérifiables | S | V1.1/V2 |
| D. Plan de migration généré (Delta↔Iceberg↔Parquet) | Produire un plan et des commandes (UniForm, XTable config), sans exécuter | Partiellement: plan oui, exécution non (pas un moteur, pas d'accès aux données) | M | V2 |
| E. Diff IaC entre plateformes (Databricks ↔ Azure Databricks ↔ Fabric) | Mapper ressources équivalentes, générer le diff OpenTofu, lister les manques (identité, stockage, réseau) | Oui: cœur de métier IaC, mais mapping à maintenir par pack | L | V3 |
| F. Compatibilité de dialecte par moteur | Signaler les fonctions non portables (VARIANT, dates, MERGE) vers un moteur cible | Partiellement: dépend de la couverture de l'analyseur, déjà planifiée | M | V2 |
| G. Adaptateurs par moteur dans Observe (traces indépendantes du stockage) | Format de trace commun, stockage local SQLite/Parquet, export Iceberg/Delta ou cloud | Partiellement: utile si Observe vise le cloud | M | V2+ |
| H. Exécuter/convertir les données nous-mêmes (XTable embarqué, moteur) | Convertir les tables | Non: hors périmètre (pas un moteur), risque données client | L | non |
| I. Catalogue maison ou proxy REST | Servir un catalogue | Non: UC OSS et REST existent | L | non |

## 3. Place de Doris
- Directement: non (confirme le premier rapport: ni backend ni dialecte prioritaire).
- Indirectement, oui, comme référence: sa doctrine "sémantique unifiée + opérateurs communs + Scan/Sink par format" est exactement le patron de A/B/F. On l'écrit dans un ADR, sans code Doris.
- Comme moteur local optionnel: piste lointaine (lire Iceberg/Paimon en local pour tester une variante), mais lourd; DuckDB est un candidat plus léger, à comparer plus tard. Non vérifié: la doc lakehouse/multi-catalog de Doris n'a pas pu être lue (page vide via l'outil), à confirmer avant tout jalon.

## 4. Trois prochaines étapes
1. ADR court "profil d'architecture et couches de portabilité" (format/catalogue/moteur/plateforme/IaC), réutilisant variantes 0.25.0 et modèle projet; soumis au tech lead Codex.
2. Prototype S de C+B: 6 à 8 règles statiques (UniForm-ready, deletion vectors, column mapping, verrous Databricks-only, `abfss`/`s3` en dur) sur un projet FOIL de test, sortie = rapport de préparation.
3. Cartographie E: tableau Databricks ↔ Azure Databricks ↔ Fabric des ressources IaC (équivalences, manques), à valider contre les providers avant d'estimer le diff.

## 5. URLs ouvertes
- https://docs.databricks.com/aws/en/delta/uniform
- https://xtable.apache.org/
- https://iceberg.apache.org/rest-catalog-spec/
- https://github.com/unitycatalog/unitycatalog
- https://learn.microsoft.com/en-us/azure/databricks/introduction/
- (échec, page vide) https://doris.apache.org/docs/lakehouse/lakehouse-overview
- Locaux: julian-idea-2026-09-29-doris.md, go/doris-exploration.md, datapass-vscode/handoff/PLAN.md (§ 0.25.0). V4_VISION.md et V3_PRODUCT_VISION.md non relus.
