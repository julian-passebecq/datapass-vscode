/** Share empty searches while retaining the original per-category caps and exclusions. */
export const INVENTORY_PATTERNS = [
  "**/{*.ipynb,*.pbip,databricks.yml,databricks.yaml,bundle.yml,bundle.yaml,host.json,main.tf,*.bicep}",
  "**/*.py", "**/.platform", "**/pipeline/*.json"
] as const;
export const INVENTORY_LIMITS = [2000, 3000, 1000, 500] as const;
export const INVENTORY_COMBINED = "**/{*.ipynb,*.pbip,*.py,databricks.yml,databricks.yaml,bundle.yml,bundle.yaml,host.json,main.tf,*.bicep,.platform,pipeline/*.json}";

export async function searchInventory<T>(search: (glob: string, limit: number) => Promise<T[]>, pathname: (value: T) => string): Promise<T[][]> {
  const limit = INVENTORY_LIMITS.reduce((n, cap) => n + cap, 0);
  const all = await search(INVENTORY_COMBINED, limit);
  // An aggregate cap can conceal a category. Retain the original independent searches then.
  if (all.length >= limit) return Promise.all(INVENTORY_PATTERNS.map((glob, i) => search(glob, INVENTORY_LIMITS[i]!)));
  const groups: T[][] = [[], [], [], []];
  for (const value of all) {
    const p = pathname(value).replace(/\\/g, "/");
    const name = p.slice(p.lastIndexOf("/") + 1);
    const matches = [
      /\.(?:ipynb|pbip|bicep)$/i.test(name) || /^(?:databricks\.ya?ml|bundle\.ya?ml|host\.json|main\.tf)$/i.test(name),
      /\.py$/i.test(name), name.toLowerCase() === ".platform", /(?:^|\/)pipeline\/[^/]+\.json$/i.test(p)
    ];
    // A pipeline/host.json deliberately belongs to both of the original queries.
    for (let group = 0; group < matches.length; group++) {
      if (matches[group] && groups[group]!.length < INVENTORY_LIMITS[group]!) groups[group]!.push(value);
    }
  }
  return groups;
}

export async function searchMarkers<T>(search: (glob: string, limit: number) => Promise<T[]>, pathname: (value: T) => string): Promise<{ dbt: boolean; parameter: boolean }> {
  const all = await search("**/{dbt_project,parameter}.{yml,yaml}", 2);
  let dbt = all.some(value => /(?:^|[\/\\])dbt_project\.ya?ml$/i.test(pathname(value)));
  let parameter = all.some(value => /(?:^|[\/\\])parameter\.ya?ml$/i.test(pathname(value)));
  // Two dbt files do not prove parameter absence (and vice versa).
  if (all.length >= 2) {
    [dbt, parameter] = await Promise.all([
      dbt ? true : search("**/dbt_project.{yml,yaml}", 1).then(r => r.length > 0),
      parameter ? true : search("**/parameter.{yml,yaml}", 1).then(r => r.length > 0)
    ]);
  }
  return { dbt, parameter };
}
