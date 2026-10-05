/** Keep bounded host failure codes; never expose source, paths, stderr or arbitrary exception messages. */
export function parserIssueCode(error: unknown): string {
  const item = error as { code?: unknown; message?: unknown } | null;
  const value = item?.code ?? item?.message;
  return typeof value === 'string' && /^[a-z][a-z0-9-]{1,79}$/.test(value) ? value : 'qualified-parser-unavailable';
}
