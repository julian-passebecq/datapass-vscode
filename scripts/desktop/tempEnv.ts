/**
 * DESKHARD3: the temp folder a desktop fixture run sees. Node's os.tmpdir() reads TEMP/TMP on Windows
 * and TMPDIR elsewhere; VS Code and its extension host inherit them from the test runner. Each run
 * gets its own folder, so two desktop jobs on one runner never share %TEMP%\datapass-qa\<run id>.
 */
export function fixtureTempEnv(dir: string): Record<string, string> {
  return { TEMP: dir, TMP: dir, TMPDIR: dir };
}
