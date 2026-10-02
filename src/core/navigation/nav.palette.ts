/**
 * V4-NAV NAVSVC1: the arrows are used through keybindings (NAVKEYS1) and the Navigator, not the palette.
 * V5HOLE2: "Pick a View Here…" is listed wherever the Navigator is shown (every mode), not only in
 * Advanced: once a project's .datapass/project.json activates DataPass, `palette.full` is hidden in
 * the default modes, so gating it there dropped it from the palette on real projects (V5E2E1 hole 2).
 */
import type { PaletteEntry } from "../experience/palette";

export default {
  "view.navigator": ["nav.pickView"],
  "palette.full": ["nav.up", "nav.down", "nav.left", "nav.right", "nav.home", "nav.back", "nav.forward"]
} satisfies PaletteEntry;
