import { describe, expect, it } from "vitest";
import { parseCitationHref, processInlineCitations } from "./citations";

describe("processInlineCitations", () => {
  it("returns input unchanged when sourceCount is 0", () => {
    expect(processInlineCitations("answer with [1] and [2]", 0)).toBe("answer with [1] and [2]");
  });

  it("returns empty input unchanged", () => {
    expect(processInlineCitations("", 5)).toBe("");
  });

  it("rewrites [N] tokens into citation-anchored markdown links", () => {
    const out = processInlineCitations("HPFP failure is a known N54 issue [1].", 3);
    expect(out).toBe("HPFP failure is a known N54 issue [\\[1\\]](#cite-1).");
  });

  it("rewrites multiple distinct citations", () => {
    const out = processInlineCitations("See [1] and [2] for context.", 5);
    expect(out).toBe("See [\\[1\\]](#cite-1) and [\\[2\\]](#cite-2) for context.");
  });

  it("leaves citations whose number exceeds sourceCount untouched", () => {
    const out = processInlineCitations("Bogus reference [9] should stay raw.", 3);
    expect(out).toBe("Bogus reference [9] should stay raw.");
  });

  it("ignores [0] (non-1-indexed)", () => {
    const out = processInlineCitations("Edge case [0] should not link.", 3);
    expect(out).toBe("Edge case [0] should not link.");
  });

  it("does not touch [N] tokens inside fenced code blocks", () => {
    const input = "Outside [1].\n\n```\nconst arr = [1];\nconst other = [2];\n```\n\nAfter [2].";
    const out = processInlineCitations(input, 3);
    // Outside the fence: replaced. Inside: untouched.
    expect(out).toContain("Outside [\\[1\\]](#cite-1).");
    expect(out).toContain("```\nconst arr = [1];\nconst other = [2];\n```");
    expect(out).toContain("After [\\[2\\]](#cite-2).");
  });

  it("handles consecutive citations like [1][2]", () => {
    const out = processInlineCitations("Multi-cite [1][2]", 3);
    expect(out).toBe("Multi-cite [\\[1\\]](#cite-1)[\\[2\\]](#cite-2)");
  });
});

describe("parseCitationHref", () => {
  it("returns the 1-indexed number for #cite-N", () => {
    expect(parseCitationHref("#cite-1")).toBe(1);
    expect(parseCitationHref("#cite-42")).toBe(42);
  });

  it("returns null for unrelated hrefs", () => {
    expect(parseCitationHref("https://example.com")).toBeNull();
    expect(parseCitationHref("#section")).toBeNull();
    expect(parseCitationHref("#cite-")).toBeNull();
    expect(parseCitationHref("#cite-abc")).toBeNull();
  });

  it("returns null for null/undefined/empty", () => {
    expect(parseCitationHref(null)).toBeNull();
    expect(parseCitationHref(undefined)).toBeNull();
    expect(parseCitationHref("")).toBeNull();
  });

  it("returns null for non-positive numbers", () => {
    expect(parseCitationHref("#cite-0")).toBeNull();
  });
});
