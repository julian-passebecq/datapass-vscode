/**
 * V4-NAVCODE1 surface: the code link (location → source opened beside the view, cursor → innermost
 * step/operation), fed by the NavHost's NavigationService and ladder. Settings datapass.nav.codeLink.*.
 */
import type { NavSurface } from "./register";
import { ladderSpanProvider, type CodeLinkLadder } from "./codeLink";
import { registerCodeLink } from "./codeLinkHost";

export default ((context, host) => {
  const provider = ladderSpanProvider({
    ladder: () => host.nav.ladder as unknown as CodeLinkLadder,
    repoFolder: (key) => host.session.repoFolder?.(key)?.fsPath,
    repoKeys: () => host.projectMap().repositories.map((r) => r.key)
  });
  registerCodeLink(context, host.nav, { providers: () => [provider] });
}) satisfies NavSurface;
