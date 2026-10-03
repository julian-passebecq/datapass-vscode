/**
 * V5HOLE11: the automatic landing (the Workbench tab opened when a project loads) never steals the
 * keyboard and never comes back on every activation. Creating a webview editor while the person is
 * already working (a file open, a Quick Pick half-way through) takes the focus and closes the
 * picker, so the landing is a first-run welcome: once per install, only onto an empty editor area,
 * and always with `preserveFocus`. An explicit request (a command, the test API) is not gated.
 */

/** globalState key set once the automatic landing has been shown on this install. */
export const LANDING_SHOWN_KEY = "datapass.landing.shown";

/** Every automatic open of a DataPass editor keeps the keyboard where it is. */
export const AUTO_OPEN = Object.freeze({ preserveFocus: true as const });

export interface LandingGate {
  /** The landing was already shown on this install. */
  alreadyShown: boolean;
  /** Editor tabs already open in the window (a file the person opened, a restored tab). */
  openTabs: number;
}

/** Whether the automatic landing may open the Workbench now. */
export function autoLandingAllowed(gate: LandingGate): boolean {
  return !gate.alreadyShown && gate.openTabs === 0;
}
