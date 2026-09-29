# Audit Opus 5.5 vs Sonnet 5.5 — DataPass V4 (29 sept 2026)

Source : usage par message dans les transcripts `~/.claude/projects/D--PROJ-datapass*` (46 sessions démarrées le 29/09, V4). « Tokens » = input + cache read + cache write + output ; ~98 % sont des lectures de cache. Le modèle est celui **réellement utilisé** (majorité des messages), pas celui du titre.

| Groupe | Sessions | Total | Moyenne/session | Output | Pic de contexte moyen | Tours |
|---|---|---|---|---|---|---|
| Coders Opus | 34 | 745 M | 21,9 M | 5,2 M | 215 K | 4 425 |
| Coders Sonnet | 5 | 52 M | 10,4 M | 0,6 M | 166 K | 334 |
| Rôles Opus (PM 3/4/5) | 3 | 127 M | 42,3 M | 0,56 M | 249 K | 704 |
| Rôles Sonnet (COORD 5/6, ASSISTANT 6/7) | 4 | 82 M | 20,6 M | 0,25 M | 180 K | 583 |

**Titres faux** : FIXPRJ « (Sonnet) » a tourné en **Opus** (11,5 M cache read, 76 tours) ; IAC4 « (Opus) » a tourné en **Sonnet** (7 tours seulement, 0,6 M). Les vrais coders Sonnet : FAKE1 (17,8 M), FAKE2 (22,6 M), IACCORPUS (7,6 M), FIXAPI (3,1 M, en cours), IAC4 (0,6 M).

**Tokens par package terminé (estimation)** : Sonnet, packages livrés FAKE1 (MR !16), FAKE2 (!24), IACCORPUS ≈ **16 M/package** ; Opus, ~28 packages avec MR ≈ **22-26 M/package**. Les packages Sonnet sont des fixtures/données synthétiques (plus simples), donc la comparaison n'est pas à périmètre égal.

**Retouches / échecs visibles** (mots-clés dans les transcripts) : « pipeline failed » 1 fois (C5a, Opus) + 1 fois (COORD 5) ; aucun chez les coders Sonnet. Aucune hand-off à 180 K forcée côté Sonnet (pic 250 K pour FAKE2, 224 K pour FAKE1 : **au-dessus de la règle 180 K**, comme 24/34 coders Opus). Aucun redémarrage visible sauf IAC4 (session de 7 tours, probablement relancée).

**Qualité** : aucune différence démontrable. Les MR Sonnet sont citées comme livrées par PM 5 et réutilisées par OBS2/IACA0 (« use FAKE1/FAKE2 replays »). Pas de revue ni de taux de CI rouge par MR disponibles.

**Non mesurable ici** : coût en $ (tarifs Opus/Sonnet 5.5 non vérifiés), nombre de pipelines GitLab rouges par MR, lignes de code/tests par package, reprises faites par d'autres sessions, qualité du code revue.

## 3 recommandations
1. Garder Sonnet pour les packages de fixtures/données/corpus (≈ 2× moins de tokens par session, 0 échec visible) ; mais Julian a fixé « coders Opus, sans exception » (28 sept) : exception à lui demander, sinon repasser ces packages en Opus.
2. Poser le modèle via `set_session_model` au démarrage et le vérifier (`get_session`) : 2 titres sur 6 mentent sur le modèle réel.
3. Faire respecter la hand-off à 180 K : 26 coders sur 39 l'ont dépassée ; c'est le premier levier de coût, quel que soit le modèle.
