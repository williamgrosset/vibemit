import { describe, it, expect } from "vitest";
import { parseResponse, cleanCandidate } from "../src/ollama.js";

describe("cleanCandidate", () => {
  it("trims whitespace", () => {
    expect(cleanCandidate("  Add new feature  ")).toBe("Add new feature");
  });

  it("removes leading numbering with dot", () => {
    expect(cleanCandidate("1. Add new feature")).toBe("Add new feature");
  });

  it("removes leading numbering with parenthesis", () => {
    expect(cleanCandidate("2) Fix broken test")).toBe("Fix broken test");
  });

  it("removes leading numbering with colon", () => {
    expect(cleanCandidate("3: Refactor utils module")).toBe("Refactor utils module");
  });

  it("removes leading bullet dash", () => {
    expect(cleanCandidate("- Add new feature")).toBe("Add new feature");
  });

  it("removes leading bullet asterisk", () => {
    expect(cleanCandidate("* Fix broken test")).toBe("Fix broken test");
  });

  it("removes leading unicode bullet", () => {
    expect(cleanCandidate("\u2022 Update docs")).toBe("Update docs");
  });

  it("removes wrapping double quotes", () => {
    expect(cleanCandidate('"Add new feature"')).toBe("Add new feature");
  });

  it("removes wrapping single quotes", () => {
    expect(cleanCandidate("'Fix broken test'")).toBe("Fix broken test");
  });

  it("removes wrapping backticks", () => {
    expect(cleanCandidate("`Refactor code`")).toBe("Refactor code");
  });

  it("removes wrapping markdown bold", () => {
    expect(cleanCandidate("**Add new feature**")).toBe("Add new feature");
  });

  it("removes stray <think> and </think> tags", () => {
    // cleanCandidate strips individual tags, not full blocks.
    // Full <think>...</think> block removal is handled by parseResponse.
    expect(cleanCandidate("<think>Add feature")).toBe("Add feature");
    expect(cleanCandidate("Add feature</think>")).toBe("Add feature");
  });

  it("removes stray </think> tags", () => {
    expect(cleanCandidate("</think>Add feature")).toBe("Add feature");
  });

  it("returns empty string for empty input", () => {
    expect(cleanCandidate("")).toBe("");
    expect(cleanCandidate("   ")).toBe("");
  });

  it("preserves conversational text (no assistant heuristics)", () => {
    expect(cleanCandidate("Here are three commit messages")).toBe("Here are three commit messages");
    expect(cleanCandidate("Would you like me to generate different messages")).toBe("Would you like me to generate different messages");
  });

  it("preserves conventional commit format", () => {
    expect(cleanCandidate("feat(auth): add login endpoint")).toBe("feat(auth): add login endpoint");
  });

  it("handles combined numbering and quotes", () => {
    expect(cleanCandidate('1. "Add new feature"')).toBe("Add new feature");
  });
});

describe("parseResponse", () => {
  describe("single-line mode (hasBody=false)", () => {
    it("splits on newlines into separate candidates", () => {
      const raw = "Add user auth\nFix login bug\nRefactor session handler";
      const result = parseResponse(raw, false);
      expect(result).toEqual([
        "Add user auth",
        "Fix login bug",
        "Refactor session handler",
      ]);
    });

    it("caps at 3 candidates", () => {
      const raw = "One\nTwo\nThree\nFour\nFive";
      const result = parseResponse(raw, false);
      expect(result).toHaveLength(3);
    });

    it("deduplicates case-insensitively", () => {
      const raw = "Add feature\nadd feature\nADD FEATURE\nFix bug";
      const result = parseResponse(raw, false);
      expect(result).toEqual(["Add feature", "Fix bug"]);
    });

    it("strips numbering from each line", () => {
      const raw = "1. Add feature\n2. Fix bug\n3. Refactor code";
      const result = parseResponse(raw, false);
      expect(result).toEqual(["Add feature", "Fix bug", "Refactor code"]);
    });

    it("filters empty lines", () => {
      const raw = "Add feature\n\n\nFix bug\n\nRefactor code";
      const result = parseResponse(raw, false);
      expect(result).toEqual(["Add feature", "Fix bug", "Refactor code"]);
    });

    it("returns empty array for empty input", () => {
      expect(parseResponse("", false)).toEqual([]);
      expect(parseResponse("   ", false)).toEqual([]);
    });

    it("returns empty array for null/undefined input", () => {
      expect(parseResponse(null as unknown as string, false)).toEqual([]);
      expect(parseResponse(undefined as unknown as string, false)).toEqual([]);
    });

    it("strips <think> blocks before parsing", () => {
      const raw = "<think>\nI should generate commit messages.\nLet me think...\n</think>\nAdd feature\nFix bug\nRefactor code";
      const result = parseResponse(raw, false);
      expect(result).toEqual(["Add feature", "Fix bug", "Refactor code"]);
    });

    it("strips multiline <think> blocks", () => {
      const raw = "<think>\nline 1\nline 2\nline 3\n</think>\nAdd feature\nFix bug\nUpdate docs";
      const result = parseResponse(raw, false);
      expect(result).toEqual(["Add feature", "Fix bug", "Update docs"]);
    });

    it("returns empty array when only <think> block is present", () => {
      const raw = "<think>\nThinking about this...\n</think>";
      const result = parseResponse(raw, false);
      expect(result).toEqual([]);
    });

    it("preserves commentary lines", () => {
      const raw = "Here are three commit messages:\nAdd feature\nFix bug\nRefactor code";
      const result = parseResponse(raw, false);
      expect(result).toEqual([
        "Here are three commit messages:",
        "Add feature",
        "Fix bug",
      ]);
    });

    it("parses structured JSON object output", () => {
      const raw = JSON.stringify({
        messages: [
          "Add feature",
          "Fix bug",
          "Refactor code",
        ],
      });
      const result = parseResponse(raw, false);
      expect(result).toEqual(["Add feature", "Fix bug", "Refactor code"]);
    });

    it("parses structured JSON array output", () => {
      const raw = JSON.stringify([
        "Add feature",
        "Fix bug",
        "Refactor code",
      ]);
      const result = parseResponse(raw, false);
      expect(result).toEqual(["Add feature", "Fix bug", "Refactor code"]);
    });

    it("preserves chatty assistant JSON candidates", () => {
      const raw = JSON.stringify({
        messages: [
          "I've created the following files for your project:",
          "Add feature",
          "Fix bug",
          "Refactor code",
        ],
      });
      const result = parseResponse(raw, false);
      expect(result).toEqual([
        "I've created the following files for your project:",
        "Add feature",
        "Fix bug",
      ]);
    });
  });

  describe("body mode (hasBody=true)", () => {
    it("splits on double blank lines", () => {
      const raw = [
        "Add user authentication",
        "",
        "- Implement JWT token handling",
        "- Add login/logout endpoints",
        "",
        "",
        "",
        "Fix session management bug",
        "",
        "- Resolve timeout issue",
        "- Add session refresh logic",
        "",
        "",
        "",
        "Refactor auth middleware",
        "",
        "- Extract common auth logic",
        "- Improve error handling",
      ].join("\n");

      const result = parseResponse(raw, true);
      expect(result).toHaveLength(3);
      expect(result[0]).toContain("Add user authentication");
      expect(result[1]).toContain("Fix session management bug");
      expect(result[2]).toContain("Refactor auth middleware");
    });

    it("strips <think> blocks before splitting", () => {
      const raw = [
        "<think>Let me generate messages</think>",
        "Add feature",
        "",
        "- Detail one",
        "",
        "",
        "",
        "Fix bug",
        "",
        "- Detail two",
      ].join("\n");

      const result = parseResponse(raw, true);
      expect(result).toHaveLength(2);
      expect(result[0]).toContain("Add feature");
      expect(result[1]).toContain("Fix bug");
    });

    it("caps at 3 candidates in body mode", () => {
      const candidates = Array.from({ length: 5 }, (_, i) => `Message ${i + 1}\n\n- Detail`);
      const raw = candidates.join("\n\n\n\n");
      const result = parseResponse(raw, true);
      expect(result).toHaveLength(3);
    });
  });
});
