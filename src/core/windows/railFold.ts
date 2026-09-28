/**
 * V1.1.x-POLISH-3 (Julian's check of rc.1: "the rail on the right can't be properly collapsed").
 *
 * VS Code gives extensions no API to set a side bar's width. The only lever is its own
 * "Decrease / Increase Current View Size" commands, which resize the *focused* part by 60 px per step
 * and stop at the part's minimum width: 170 px for the secondary side bar. What went wrong in rc.1,
 * measured in a real VS Code window (Playwright, 1600 × 1000):
 * - the rail was a webview; with the keyboard in a webview, VS Code does not count the secondary side
 *   bar as focused, so "Current View Size" resized nothing;
 * - rc.1 used "Decrease Current View Width", which recent VS Code renamed "Decrease Editor Width": it
 *   always resizes the editor, and the width it takes or gives goes to the *left* side bar.
 * So the rail is now a native tree (the keyboard lands in the side bar itself) and folds with
 * "Decrease Current View Size" down to VS Code's minimum; "Expand" gives back a fixed width while the
 * rail still has the keyboard. What stays impossible from an extension: a rail thinner than 170 px,
 * reading the side bar's width, and restoring the exact width a person had dragged. Pure (no `vscode`).
 */

/** VS Code's minimum width of the secondary side bar, in px. */
export const AUX_BAR_MIN_WIDTH = 170;
/** One resize-command step, in px. */
export const RESIZE_STEP = 60;
/** Steps enough to fold a 1600 px side bar; VS Code stops at the minimum, extra steps change nothing. */
export const FOLD_STEPS = 24;
/** Steps "Expand" gives back: 170 + 5 × 60 = 470 px, a readable full panel (a person can drag it wider). */
export const EXPAND_STEPS = 5;

/** The commands that resize the focused part (the rail, which holds the keyboard). */
export const NARROW_FOCUSED = "workbench.action.decreaseViewSize";
export const WIDEN_FOCUSED = "workbench.action.increaseViewSize";

/** The width a side bar of `start` px has after `steps` narrowing steps (VS Code's clamp). */
export const widthAfterFold = (start: number, steps = FOLD_STEPS): number => Math.max(AUX_BAR_MIN_WIDTH, start - steps * RESIZE_STEP);
