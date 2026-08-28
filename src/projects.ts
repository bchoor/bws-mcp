export class BwsError extends Error {
  readonly status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "BwsError";
    this.status = status;
  }
}

export function parseAllowedProjects(raw: string | undefined): string[] {
  if (raw == null || raw.trim() === "") {
    return [];
  }
  const seen = new Set<string>();
  const projects: string[] = [];
  for (const part of raw.split(",")) {
    const name = part.trim();
    if (name === "" || seen.has(name)) {
      continue;
    }
    seen.add(name);
    projects.push(name);
  }
  return projects;
}

export function isAllowedProject(name: string, allowed: string[]): boolean {
  return allowed.includes(name);
}

export function unknownProjectMessage(project: string, allowed: string[]): string {
  const listed = allowed.length === 0 ? "(none configured)" : allowed.join(", ");
  return `Unknown project ${JSON.stringify(project)}. Allowed: ${listed}`;
}

export function requireAllowedProject(project: string | undefined, allowed: string[]): string {
  if (project == null || project.trim() === "") {
    throw new BwsError("project is required", 400);
  }
  if (allowed.length === 0) {
    throw new BwsError("BWS_ALLOWED_PROJECTS is not configured", 503);
  }
  if (!isAllowedProject(project, allowed)) {
    throw new BwsError(unknownProjectMessage(project, allowed), 400);
  }
  return project;
}
