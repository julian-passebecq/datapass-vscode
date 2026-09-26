/**
 * Unknown-field detection driven by a committed JSON Schema document. Pure.
 *
 * The editor validates .datapass/project.json with schemas/datapass-project.schema.json, where
 * every object is closed (`additionalProperties: false`). The runtime validator used to accept
 * any extra field, so an AI-prepared manifest could carry `flows` or `platforms.bigquery` that
 * the editor flagged but DataPass silently ignored. Reading the allowed keys from the same schema
 * file makes both reject the same unknown fields.
 */

type JsonSchemaNode = {
  type?: string | string[];
  properties?: Record<string, JsonSchemaNode>;
  additionalProperties?: boolean | JsonSchemaNode;
  items?: JsonSchemaNode;
  anyOf?: JsonSchemaNode[];
  oneOf?: JsonSchemaNode[];
};

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function label(path: string, key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? (path ? `${path}.${key}` : key) : `${path}[${JSON.stringify(key)}]`;
}

/**
 * Paths of fields the schema does not allow. Only structure is checked here (closed objects,
 * arrays of closed objects); values are validated by the typed runtime checks.
 */
export function unknownFields(schema: unknown, value: unknown, path = "", out: string[] = [], max = 50): string[] {
  const node = schema as JsonSchemaNode | undefined;
  if (!node || out.length >= max) return out;
  if (Array.isArray(value)) {
    if (node.items) value.forEach((v, i) => unknownFields(node.items, v, `${path}[${i}]`, out, max));
    return out;
  }
  if (!isPlainObject(value)) return out;
  // Alternatives: a key is known when any branch knows it.
  const branches = [node, ...(node.anyOf ?? []), ...(node.oneOf ?? [])].filter(b => b.properties || b.additionalProperties !== undefined);
  if (!branches.length) return out;
  for (const [key, child] of Object.entries(value)) {
    if (out.length >= max) break;
    const known = branches.find(b => b.properties && Object.prototype.hasOwnProperty.call(b.properties, key));
    if (known) { unknownFields(known.properties![key], child, label(path, key), out, max); continue; }
    const open = branches.find(b => b.additionalProperties !== undefined && b.additionalProperties !== false);
    if (open) {
      if (typeof open.additionalProperties === "object") unknownFields(open.additionalProperties, child, label(path, key), out, max);
      continue;
    }
    if (branches.some(b => b.additionalProperties === false)) out.push(label(path, key));
  }
  return out;
}
