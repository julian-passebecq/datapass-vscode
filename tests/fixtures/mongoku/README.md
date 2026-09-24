# Mongoku fixtures

`portfolio-context.synthetic.json` was produced by Mongoku's own exporter,
`buildProjectContext()` in `julian-passebecq/Mongoku-datapass` `src/lib/datapass/aiContext.ts`
(repository HEAD `7d204f56e876b1d61f5021cc297bcae6dc377cc9`, file blob
`d673d4b439e9f5c39a9c3961cfd4678b6a537d49`), called with **synthetic, non-FOIL input**
(`retail_bi`, `demo_org`) and a fixed `generatedAt`. It is the JSON that Mongoku's
"Developer context → JSON → Copy" button yields for such a project.

It proves the DataPass consumer (`parseMongokuContext`) accepts what the real producer emits,
not a hand-written approximation. Regenerate it when Mongoku changes the
`mongoku.portfolio-context` shape, and keep the input synthetic: no real portfolio data here.
