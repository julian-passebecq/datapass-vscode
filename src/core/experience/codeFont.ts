/**
 * V3-THEME: the code font size preset ("DataPass: Set Code Font Size…"). Pure (no `vscode`): the command
 * writes VS Code's own `editor.fontSize`, in the workspace's settings, after a confirmation — nothing hidden.
 */
export const CODE_FONT_SIZES = [11, 12, 13, 14, 16] as const;
export const CODE_FONT_MIN = 6;
export const CODE_FONT_MAX = 40;

/** A size typed by the person: a whole or half number between 6 and 40, else an error message. */
export function parseCodeFontSize(text: string): { size: number } | { error: string } {
  const t = text.trim().replace(",", ".");
  const n = Number(t);
  if (t === "" || !Number.isFinite(n)) return { error: "Type a number, for example 12." };
  if (n < CODE_FONT_MIN || n > CODE_FONT_MAX) return { error: `Choose a size between ${CODE_FONT_MIN} and ${CODE_FONT_MAX}.` };
  if (Math.round(n * 2) !== n * 2) return { error: "Use a whole or half size (12 or 12.5)." };
  return { size: n };
}

/** The quick-pick label of a size ("12 px — smaller (current)"). */
export function codeFontLabel(size: number, current: number | undefined): string {
  const hint = size < 14 ? "smaller" : size === 14 ? "VS Code's default" : "larger";
  return `${size} px — ${hint}${current === size ? " (current)" : ""}`;
}
