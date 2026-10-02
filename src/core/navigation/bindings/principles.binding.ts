/**
 * V4-NAV NAVPRIN1 `principles` binding provider (NAVWIRE1 self-registration): a thin adapter over the pure
 * `principleCards`. The guidance cards always show (origin "datapass-guidance"); their checks need principle
 * facts (layers, lineage, writes, quality, partitions) that the BindingContext does not carry yet, so until
 * NAVDATA1 adds `principleFacts` every check is `unknown` with a typed hole, never guessed.
 */
import type { PrincipleFacts } from "../principles/checks";
import { sameLocation, type NavLocation } from "../navTypes";
import { projectLadder } from "../projectLadder";
import type { BindingCard, BindingContext, BindingProvider, BindingResult } from "./index";
import { principleCards, PRINCIPLES_SOURCE } from "./principles";

/** The context a principles-aware host passes (NAVDATA1 adds `principleFacts` to BindingContext). */
export type PrinciplesBindingContext = BindingContext & { readonly principleFacts?: PrincipleFacts };

const NO_FACTS: PrincipleFacts = { artifacts: [], families: {} };

export const principlesProvider: BindingProvider = {
  source: PRINCIPLES_SOURCE,
  provide(ctx: PrinciplesBindingContext): BindingResult {
    const { location, projectMap } = ctx;
    const ladder = projectMap ? projectLadder(() => projectMap) : undefined;
    const within = location.level === "project" ? undefined : (l: NavLocation): boolean => {
      for (let cur: NavLocation | null = l, guard = 0; cur && guard < 20; cur = ladder?.parent(cur) ?? null, guard++)
        if (sameLocation(cur, location)) return true;
      return false;
    };
    const r = principleCards({ facts: ctx.principleFacts ?? NO_FACTS, ...(within ? { within } : {}) });
    const cards: BindingCard[] = r.cards.map(c => ({
      title: c.title,
      fields: [
        { label: c.label, value: c.text, origin: c.origin },
        { label: "Status", value: c.status, origin: c.origin },
        ...c.breaks.map(b => ({ label: `Breaks at ${b.location.nodeId}`, value: b.why, origin: c.origin }))
      ]
    }));
    const holes = [
      ...(ctx.principleFacts ? [] : [{ reason: "Principle facts are not in the binding context yet: checks stay unknown." }]),
      ...r.holes
    ];
    return { cards, holes, origin: r.origin };
  }
};

export default principlesProvider;
