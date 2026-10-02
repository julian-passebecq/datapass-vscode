/**
 * V4-NAV NAVHIST1 `git-history` binding, self-registered (NAVWIRE1: out/gen/bindings.ts). The history itself
 * (`provideGitHistory`) is async and needs the host's Git runner and workspace trust, which `BindingContext`
 * does not carry yet: until NAVDATA1 extends the context, this provider answers with a hole naming the gap.
 */
import type { BindingProvider } from "./index";
import { GIT_HISTORY_SOURCE } from "./gitHistory";

export const GIT_HISTORY_UNWIRED = "Git history needs the host's Git runner, which the view context does not pass yet.";

export const gitHistoryProvider: BindingProvider = {
  source: GIT_HISTORY_SOURCE,
  provide: () => ({ holes: [{ reason: GIT_HISTORY_UNWIRED }], origin: "observed" })
};

export default gitHistoryProvider;
