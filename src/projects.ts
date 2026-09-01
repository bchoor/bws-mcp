export class BwsError extends Error {
  readonly status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "BwsError";
    this.status = status;
  }
}

export type AllowedProjects = { allowAll: true } | { allowAll: false; names: string[] };

export function parseAllowedProjects(raw: string | undefined): AllowedProjects {
  if (raw == null || raw.trim() === "") {
    return { allowAll: false, names: [] };
  }
  const seen = new Set<string>();
  const names: string[] = [];
  let allowAll = false;
  for (const part of raw.split(",")) {
    const name = part.trim();
    if (name === "") {
      continue;
    }
    if (name === "*") {
      allowAll = true;
      continue;
    }
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);
    names.push(name);
  }
  if (allowAll) {
    return { allowAll: true };
  }
  return { allowAll: false, names };
}

export function isAllowedProject(name: string, allowed: AllowedProjects): boolean {
  if (allowed.allowAll) {
    return true;
  }
  return allowed.names.includes(name);
}

export function unknownProjectMessage(project: string, allowed: AllowedProjects): string {
  if (allowed.allowAll) {
    return `Unknown project ${JSON.stringify(project)}. Allowed: *`;
  }
  const listed = allowed.names.length === 0 ? "(none configured)" : allowed.names.join(", ");
  return `Unknown project ${JSON.stringify(project)}. Allowed: ${listed}`;
}

export function requireAllowedProject(project: string | undefined, allowed: AllowedProjects): string {
  if (project == null || project.trim() === "") {
    throw new BwsError("project is required", 400);
  }
  if (!allowed.allowAll && allowed.names.length === 0) {
    throw new BwsError("BWS_ALLOWED_PROJECTS is not configured", 503);
  }
  if (!isAllowedProject(project, allowed)) {
    throw new BwsError(unknownProjectMessage(project, allowed), 400);
  }
  return project;
}

export function requireConfiguredProjects(allowed: AllowedProjects): void {
  if (!allowed.allowAll && allowed.names.length === 0) {
    throw new BwsError("BWS_ALLOWED_PROJECTS is not configured", 503);
  }
}

export function filterAllowedProjects<T extends { name: string }>(
  projects: T[],
  allowed: AllowedProjects,
): T[] {
  if (allowed.allowAll) {
    return projects;
  }
  return projects.filter((project) => allowed.names.includes(project.name));
}
