import { describe, expect, it } from "vitest";
import { parseAllowedProjects, requireAllowedProject, unknownProjectMessage } from "../src/projects.ts";

const allowed = parseAllowedProjects("prod,staging");

describe("BWS_ALLOWED_PROJECTS", () => {
  it("parses prod and staging from a comma list", () => {
    expect(allowed).toEqual(["prod", "staging"]);
  });

  it("requires project", () => {
    expect(() => requireAllowedProject("", allowed)).toThrow("project is required");
    expect(() => requireAllowedProject(undefined, allowed)).toThrow("project is required");
  });

  it("rejects names outside the allowlist", () => {
    expect(() => requireAllowedProject("other", allowed)).toThrow(unknownProjectMessage("other", allowed));
  });

  it("accepts prod and staging", () => {
    expect(requireAllowedProject("prod", allowed)).toBe("prod");
    expect(requireAllowedProject("staging", allowed)).toBe("staging");
  });
});
