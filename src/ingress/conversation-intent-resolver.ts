import { z } from "zod";

export const CONVERSATION_INTENTS = [
  "action_request",
  "status_request",
  "information_request",
  "clarification",
  "cancel",
  "conversation",
] as const;

export type ConversationIntent = (typeof CONVERSATION_INTENTS)[number];
export type IngressDestination =
  | "ACTION_NORMALIZER"
  | "STATUS_HANDLER"
  | "INFORMATION_HANDLER"
  | "CLARIFICATION_HANDLER"
  | "CANCELLATION_HANDLER"
  | "CONVERSATION_HANDLER";

const ingressSchema = z.object({
  text: z.string().trim().min(1).max(500),
  source: z.enum(["voice", "typed"]),
  awaitingClarification: z.boolean().optional().default(false),
}).strict();

export type ConversationIngress = z.input<typeof ingressSchema>;

export interface ResolvedConversationIntent {
  readonly intent: ConversationIntent;
  readonly destination: IngressDestination;
  readonly normalizedText: string;
  readonly source: "voice" | "typed";
  readonly rule: string;
  readonly authority: "NONE";
}

const DESTINATIONS: Readonly<Record<ConversationIntent, IngressDestination>> = {
  action_request: "ACTION_NORMALIZER",
  status_request: "STATUS_HANDLER",
  information_request: "INFORMATION_HANDLER",
  clarification: "CLARIFICATION_HANDLER",
  cancel: "CANCELLATION_HANDLER",
  conversation: "CONVERSATION_HANDLER",
};

const CANCEL = /^(cancel|cancel that|never mind|nevermind|stop that|abort)(?:[.!?])?$/i;
const STATUS = /\b(status|battery|charge|authorized|authorization|where (?:are you|is the robot)|what(?:'s| is) happening)\b/i;
const INFORMATION = /^(what|who|when|where|why|how|can you tell me|explain)\b/i;
const ACTION = /^(please\s+)?(deliver|bring|move|go|drive|turn|navigate|return|pick up|carry|take)\b/i;

/**
 * Shared modality-independent ingress boundary. It routes requests and has no
 * authority: every result is explicitly marked authority=NONE.
 */
export class ConversationIntentResolver {
  resolve(input: unknown): ResolvedConversationIntent {
    const parsed = ingressSchema.parse(input);
    const text = parsed.text.replace(/\s+/g, " ");
    let intent: ConversationIntent;
    let rule: string;

    if (CANCEL.test(text)) {
      intent = "cancel";
      rule = "explicit_cancel";
    } else if (STATUS.test(text)) {
      intent = "status_request";
      rule = "status_query";
    } else if (INFORMATION.test(text)) {
      intent = "information_request";
      rule = "information_query";
    } else if (ACTION.test(text)) {
      intent = "action_request";
      rule = "physical_action_verb";
    } else if (parsed.awaitingClarification) {
      intent = "clarification";
      rule = "pending_clarification_context";
    } else {
      intent = "conversation";
      rule = "non_action_conversation";
    }

    return {
      intent,
      destination: DESTINATIONS[intent],
      normalizedText: text,
      source: parsed.source,
      rule,
      authority: "NONE",
    };
  }
}
