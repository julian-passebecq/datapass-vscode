# Exploration Apache Doris pour DataPass (2026-09-29, idée de Julian, aucune décision)

## 1. Doris en 3 lignes
- Base analytique MPP temps réel (open source Apache), SQL compatible MySQL, tables internes colonnes + accès aux lakehouses (Iceberg, Paimon).
- Type VARIANT: JSON semi-structuré, chemins fréquents extraits en sous-colonnes typées, le reste en colonnes creuses (seuil par défaut 2048 sous-colonnes), mode DOC pour JSON très larges.
- Cibles annoncées: analytique client, entrepôt, observabilité, traces d'agents; 5.0 = lakehouse multimodal unifié.

## 2. Idées -> où dans DataPass

| Idée | Où dans DataPass | Valeur | Coût | Jalon |
|---|---|---|---|---|
| Doris comme dialecte SQL (parser, DDL, `payload['a']['b']`, CAST, VARIANT_TYPE, PARSE_TO_VARIANT) | Analyseur SQL (Common) | faible (peu de projets data clients sur Doris) | M | no (à revoir si demande client) |
| Lignage de sous-colonnes semi-structurées (chemin JSON = colonne virtuelle) | Modèle projet / lignage, SQL Spark/Databricks/Fabric (`:`, `variant_get`) | haute (Spark 4 et Delta ont aussi VARIANT) | M | V2 |
| Distinguer NULL SQL vs JSON null dans le lignage/lint | Règles d'analyse | faible | S | V2 (règle) |
| Stockage des traces/télémétrie Observe en VARIANT-like: schéma évolutif, chemins chauds typés | Observe (stockage local) | moyenne: s'inspirer du principe (sous-colonnes chaudes + reste brut), sans embarquer Doris | M | V2 |
| Schema Template (déclarer les chemins typés utiles, le reste libre) | Format de trace Observe + modèle de payloads API rejoués | moyenne | S | V1.1 (convention documentée) |
| Index inversé sur sous-colonnes (recherche texte dans traces) | Observe, recherche dans les traces | faible en local (SQLite FTS suffit) | M | no |
| Iceberg V3 / Paimon variant (lecture Plain/Shredded, écriture) | Modèle IaC/cloud: détecter tables lake avec colonnes variant, propriétés de format | moyenne | M | V2 |
| Architecture 3 couches (type+SQL unifiés / opérateurs / Scan-Sink par format) | Design interne de l'analyseur: une sémantique commune, adaptateurs par moteur | moyenne (inspiration) | S | V1.1 (note d'ADR) |
| Cas traces d'agents (MCP/A2A), event tracking | Observe: modèle d'événements pour agents IA, lien avec l'échange IA de R1A | moyenne | M | V2 |
| Guide de choix interne vs lake vs chaud/froid | Recommandations Observe/coût (CU) | faible | S | no |
| Doris comme backend Observe | Observe | faible: serveur lourd, contredit local/opt-in | L | no |

## 3. Top 3 recommandations
1. Ne pas intégrer Doris (ni comme backend, ni comme dialecte prioritaire): coût élevé, valeur faible pour un outil VS Code local et opt-in.
2. Prendre l'inspiration "sous-colonnes typées + reste brut" et Schema Template pour le format de traces Observe, et ajouter le lignage de chemins JSON/VARIANT pour Spark/Databricks/Fabric au modèle projet (jalon V2).
3. Noter dans un ADR l'idée de couches (sémantique commune + adaptateurs par moteur) et suivre Iceberg V3 variant côté IaC/cloud en V2.

## 4. Sources (ouvertes)
- https://doris.apache.org/docs/dev/sql-manual/basic-element/sql-data-types/semi-structured/VARIANT
- https://doris.apache.org/blog (liste seulement; l'article 5.0 Variant lui-même non retrouvé, s'appuyer sur le résumé de julian-idea-2026-09-29-doris.md)
- D:\PROJ\datapass\julian-idea-2026-09-29-doris.md ; D:\PROJ\datapass\datapass-vscode\handoff\V4_VISION.md (Observe opt-in)
- Limite: Iceberg V3/Paimon et cas agents non vérifiés dans la doc officielle (à confirmer avant tout jalon).
