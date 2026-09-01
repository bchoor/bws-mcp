import { describe, expect, it } from "vitest";
import {
  filterAllowedProjects,
  parseAllowedProjects,
  requireAllowedProject,
  requireConfiguredProjects,
  unknownProjectMessage,
} from "../src/projects.ts";

const allowed = parseAllowedProjects("prod,staging");
const all = parseAllowedProjects("*");

describe("BWS_ALLOWED_PROJECTS", () => {
  it("parses prod and staging from a comma list", () => {
    expect(allowed).toEqual({ allowAll: false, names: ["prod", "staging"] });
  });

  it("treats * as allow all", () => {
    expect(parseAllowedProjects("*")).toEqual({ allowAll: true });
    expect(parseAllowedProjects(" * ")).toEqual({ allowAll: true });
    expect(parseAllowedProjects("prod,*,staging")).toEqual({ allowAll: true });
  });

  it("treats empty as not configured, not allow all", () => {
    expect(parseAllowedProjects("")).toEqual({ allowAll: false, names: [] });
    expect(parseAllowedProjects(undefined)).toEqual({ allowAll: false, names: [] });
    expect(parseAllowedProjects("  ,  ")).toEqual({ allowAll: false, names: [] });
    expect(() => requireConfiguredProjects(parseAllowedProjects(""))).toThrow(
      "BWS_ALLOWED_PROJECTS is not configured",
    );
    expect(() => requireAllowedProject("prod", parseAllowedProjects(""))).toThrow(
      "BWS_ALLOWED_PROJECTS is not configured",
    );
  });

  it("requires project", () => {
    expect(() => requireAllowedProject("", allowed)).toThrow("project is required");
    expect(() => requireAllowedProject(undefined, allowed)).toThrow("project is required");
    expect(() => requireAllowedProject("", all)).toThrow("project is required");
    expect(() => requireAllowedProject(undefined, all)).toThrow("project is required");
  });

  it("rejects names outside the allowlist", () => {
    expect(() => requireAllowedProject("other", allowed)).toThrow(unknownProjectMessage("other", allowed));
  });

  it("accepts prod and staging", () => {
    expect(requireAllowedProject("prod", allowed)).toBe("prod");
    expect(requireAllowedProject("staging", allowed)).toBe("staging");
  });

  it("accepts any project name when allowlist is *", () => {
    expect(requireAllowedProject("prod", all)).toBe("prod");
    expect(requireAllowedProject("other", all)).toBe("other");
  });

  it("filters listed projects against the allowlist", () => {
    const projects = [
      { id: "1", name: "prod" },
      { id: "2", name: "staging" },
      { id: "3", name: "other" },
    ];
    expect(filterAllowedProjects(projects, allowed)).toEqual([
      { id: "1", name: "prod" },
      { id: "2", name: "staging" },
    ]);
    expect(filterAllowedProjects(projects, all)).toEqual(projects);
  });
});
