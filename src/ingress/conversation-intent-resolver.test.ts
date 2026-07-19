import { describe, expect, it } from "vitest";

import { ConversationIntentResolver } from "./conversation-intent-resolver.js";

const resolver = new ConversationIntentResolver();

describe("ConversationIntentResolver", () => {
  it.each([
    ["Deliver medication to Room 312.", "action_request", "ACTION_NORMALIZER"],
    ["How much battery is left?", "status_request", "STATUS_HANDLER"],
    ["What medication is scheduled?", "information_request", "INFORMATION_HANDLER"],
    ["Cancel that.", "cancel", "CANCELLATION_HANDLER"],
    ["Hello there", "conversation", "CONVERSATION_HANDLER"],
  ] as const)("routes %s without granting authority", (text, intent, destination) => {
    expect(resolver.resolve({ text, source: "voice" })).toMatchObject({
      intent, destination, source: "voice", authority: "NONE",
    });
  });

  it("routes an answer through clarification context without treating it as an action", () => {
    expect(resolver.resolve({
      text: "Room 312",
      source: "typed",
      awaitingClarification: true,
    })).toMatchObject({
      intent: "clarification",
      destination: "CLARIFICATION_HANDLER",
      authority: "NONE",
    });
  });

  it("uses identical rules for voice and typed modalities", () => {
    const voice = resolver.resolve({ text: "Move forward", source: "voice" });
    const typed = resolver.resolve({ text: "Move forward", source: "typed" });
    expect({ ...voice, source: "typed" }).toEqual(typed);
  });

  it("rejects untyped, empty, oversized, and extra-field input", () => {
    expect(() => resolver.resolve("move forward")).toThrow();
    expect(() => resolver.resolve({ text: " ", source: "voice" })).toThrow();
    expect(() => resolver.resolve({ text: "x".repeat(501), source: "voice" })).toThrow();
    expect(() => resolver.resolve({ text: "move", source: "voice", authorized: true })).toThrow();
  });

  it("never returns an authorization decision, grant, or dispatch instruction", () => {
    const result = resolver.resolve({ text: "Deliver medication", source: "voice" });
    expect(result).not.toHaveProperty("grant");
    expect(result).not.toHaveProperty("authorized");
    expect(result).not.toHaveProperty("dispatch");
    expect(result.authority).toBe("NONE");
  });
});
