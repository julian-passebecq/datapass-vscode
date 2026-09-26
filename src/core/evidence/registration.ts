/**
 * What DataPass reads of a workspace MCP registration file (.vscode/mcp.json): the server names,
 * nothing else. Commands, arguments, URLs, headers, env and inputs are not kept. A file that is not
 * plain JSON (comments, trailing commas) gives undefined: the "registered" link stays unknown.
 */
export const MAX_REGISTERED_SERVERS = 50;
const SERVER_NAME = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,79}$/;

export function mcpServerNames(text: string): string[] | undefined {
  let doc: unknown;
  try { doc = JSON.parse(text); } catch { return undefined; }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return undefined;
  const servers = (doc as Record<string, unknown>).servers;
  if (servers === undefined) return [];
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) return undefined;
  return Object.keys(servers).filter(n => SERVER_NAME.test(n)).slice(0, MAX_REGISTERED_SERVERS);
}
