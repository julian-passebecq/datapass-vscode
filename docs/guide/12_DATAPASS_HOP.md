# 12. DataPass Hop: explaining a file (V3)

For the client's AI. Next to the code it writes, the AI can write a small JSON that explains **one
file** visually: the steps of the file from top to bottom, the lines each step covers, how the steps
connect and, for SQL, the joins. DataPass draws it beside the code (V3) and keeps the two in sync;
it never runs the file and never parses it as code. Full field list, states and the PySpark example:
[PREPARING_A_PROJECT.md §17](../PREPARING_A_PROJECT.md). Worked examples (PySpark, SQL with two
joins, Airflow): [`examples/v3/hop`](../../examples/v3/hop/).

**Where it goes.** In the bridge, `.datapass/understanding/<repository key>/<path in that
repository>.json`. The repository key is one of the manifest's `repositories`:

<!-- example: hop project -->
```json
{
  "schemaVersion": 3,
  "project": { "id": "hop-demo", "title": "DataPass Hop demo" },
  "repositories": {
    "bridge": { "path": "." },
    "pipelines": { "path": "../pipelines" }
  }
}
```

**A small explanation** — `sql/top_customers.sql` in `pipelines`, explained by
`.datapass/understanding/pipelines/sql/top_customers.sql.json`:

<!-- example: hop understanding -->
```json
{
  "format": "datapass.understanding",
  "version": 1,
  "target": {
    "repository": "pipelines",
    "path": "sql/top_customers.sql",
    "sha256": "0000000000000000000000000000000000000000000000000000000000000000",
    "language": "sql"
  },
  "title": "Top customers",
  "summary": "Revenue per customer over the last 30 days, best first.",
  "steps": [
    { "id": "orders", "title": "Orders of the last 30 days", "kind": "source", "lines": [1, 3], "inputs": ["sales.orders"], "provenance": "declared" },
    { "id": "customers", "title": "Join the customer", "kind": "join", "lines": [4, 5], "inputs": ["sales.customers"], "provenance": "declared" },
    { "id": "total", "title": "Revenue per customer", "kind": "aggregate", "lines": [6, 8], "outputs": ["customer_id", "revenue"], "provenance": "declared" }
  ],
  "links": [
    { "from": "orders", "to": "customers", "kind": "data" },
    { "from": "customers", "to": "total", "kind": "data" }
  ],
  "joins": [
    { "id": "orders-customers", "step": "customers", "left": "sales.orders o", "right": "sales.customers c", "type": "inner", "keys": [["o.customer_id", "c.customer_id"]], "provenance": "declared" }
  ]
}
```

`sha256` is the hash of the SQL file's text with line endings turned into LF; with the placeholder
above, DataPass would show the explanation as **stale** (code changed since it was written) until
the AI writes the real hash. When the AI changes the code, it updates the explanation's lines and
hash in the bridge pull request of the same coordinated change set.

**Refused** — a link to a step that does not exist:

<!-- refused: understanding -->
```json
{
  "format": "datapass.understanding",
  "version": 1,
  "target": { "repository": "pipelines", "path": "sql/top_customers.sql", "sha256": "0000000000000000000000000000000000000000000000000000000000000000", "language": "sql" },
  "title": "Top customers",
  "summary": "Revenue per customer.",
  "steps": [{ "id": "orders", "title": "Orders", "kind": "source", "lines": [1, 3], "provenance": "declared" }],
  "links": [{ "from": "orders", "to": "total", "kind": "data" }]
}
```

Rules to remember: one JSON per native file; step ids lowercase and unique; `lines` 1-based and
inclusive, inside the file; every `provenance` honest (`declared` only when the code says it,
`inferred` for what you deduced, `estimated` / `illustrative` otherwise); no credentials, even as
examples.
