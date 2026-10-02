/**
 * V4-NAV built-in view pack `erd` (NAVERD1): an 'ERD' view (layout `erd`, binding `schema-erd`) for SQL scripts,
 * dbt models and Power BI artifacts, and for the subproject level. Data, not code: users reorder, hide or retitle
 * it through `datapass.view-overrides/1`. Entry shape = view-spi `ViewCatalog["entries"]` (go/NAV-contract.md).
 */
export interface ErdPackEntry {
  readonly artifactKind: string; readonly level: "subproject" | "artifact";
  readonly views: readonly { readonly id: string; readonly title: string; readonly layout: "erd";
    readonly bindings: readonly { readonly source: "schema-erd"; readonly params?: Readonly<Record<string, unknown>> }[]; readonly description?: string }[];
}

const erdView = (artifactKind: string) => ({
  id: "erd", title: "ERD", layout: "erd" as const, bindings: [{ source: "schema-erd" as const, params: { artifactKind } }],
  description: "Tables, columns and keys. Declared keys solid, inferred joins dashed (theoretical)."
});

export const ERD_PACK: readonly ErdPackEntry[] = [
  { artifactKind: "sql-script", level: "artifact", views: [erdView("sql-script")] },
  { artifactKind: "dbt-model", level: "artifact", views: [erdView("dbt-model")] },
  { artifactKind: "powerbi", level: "artifact", views: [erdView("powerbi")] },
  { artifactKind: "subproject", level: "subproject", views: [erdView("subproject")] }
];
