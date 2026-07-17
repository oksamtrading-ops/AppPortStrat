import { DISPOSITION_LABELS, FILTER_LABELS } from "./labels";
import type { Disposition, FilterFlags, FilterOutcome } from "./types";

/**
 * Filter cascade (inventory §5, verified — FCP col L). First match wins:
 *   1. not in scope                                  → Out of Scope
 *   2. in scope, not utilized                        → No Longer Utilized
 *   3. in scope, utilized, disposition = Terminate   → Terminate (even if replaced)
 *   4. …non-Terminate, replaced                      → Replaced
 *   5. …not replaced, in flight                      → In Flight
 *   6. nothing hit                                   → disposition pass-through,
 *                                                      Analysis Candidate = yes
 */
export function computeFilterOutcome(flags: FilterFlags, disposition: Disposition): FilterOutcome {
  if (!flags.inScope) return hit("OUT_OF_SCOPE");
  if (!flags.isUtilized) return hit("NO_LONGER_UTILIZED");
  if (disposition === "TERMINATE") return hit("TERMINATE");
  if (flags.isReplaced) return hit("REPLACED");
  if (flags.inFlight) return hit("IN_FLIGHT");
  return {
    hit: null,
    statusLabel: DISPOSITION_LABELS[disposition],
    analysisCandidate: true,
  };
}

function hit(filterHit: keyof typeof FILTER_LABELS): FilterOutcome {
  return { hit: filterHit, statusLabel: FILTER_LABELS[filterHit], analysisCandidate: false };
}
