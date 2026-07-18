import { canonicalJson, sha256 } from "../canonical-json.js";
import { parseActionProposal } from "../medication-delivery.js";
import type { NormalizedAction } from "./types.js";

export function normalizeAction(input: unknown): NormalizedAction {
  return parseActionProposal(input) as NormalizedAction;
}

export function digestNormalizedAction(action: NormalizedAction): string {
  return sha256(canonicalJson(action));
}
