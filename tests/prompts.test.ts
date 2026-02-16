import { describe, it, expect } from "vitest";
import { buildSystemPrompt, buildUserPrompt } from "../src/prompts.js";

describe("prompts", () => {
  describe("buildSystemPrompt", () => {
    it("includes intent guidance rule", () => {
      const prompt = buildSystemPrompt({ conventional: false, body: false });
      expect(prompt).toContain("If an intent is provided, follow it strictly");
    });

    it("includes intent in system prompt when provided", () => {
      const prompt = buildSystemPrompt({
        conventional: false,
        body: false,
        intent: "Initial project setup",
      });
      expect(prompt).toContain("Initial project setup");
      expect(prompt).toContain("MUST reflect this intent");
    });

    it("does not include intent in system prompt when omitted", () => {
      const prompt = buildSystemPrompt({ conventional: false, body: false });
      expect(prompt).not.toContain("MUST reflect this intent");
    });
  });

  describe("buildUserPrompt", () => {
    it("includes intent block when provided", () => {
      const prompt = buildUserPrompt(
        "diff --git a/file b/file",
        [],
        false,
        "This is an initial project scaffold commit."
      );

      expect(prompt).toContain("Intent (highest priority");
      expect(prompt).toContain("This is an initial project scaffold commit.");
    });

    it("does not include intent block when omitted", () => {
      const prompt = buildUserPrompt("diff --git a/file b/file", [], false);
      expect(prompt).not.toContain("Intent (highest priority");
    });
  });
});
