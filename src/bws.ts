import { decryptMaybeUtf8, decryptUtf8, parseAccessToken } from "./crypto.ts";
import type { Env } from "./env.ts";
import { BwsError, parseAllowedProjects, requireAllowedProject } from "./projects.ts";

const DEFAULT_IDENTITY_URL = "https://identity.bitwarden.com";
const DEFAULT_API_URL = "https://api.bitwarden.com";

export interface SecretSummary {
  id: string;
  name: string;
  project: string;
}

export interface SecretValue extends SecretSummary {
  value: string;
}

export interface BwsClient {
  listSecrets(project: string): Promise<SecretSummary[]>;
  getSecret(args: { name: string; project: string }): Promise<SecretValue>;
}

function jsonError(status: number): BwsError {
  return new BwsError(`BWS request failed (${status})`, status);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asList(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  const record = asRecord(value);
  if (record != null && Array.isArray(record.data)) {
    return record.data;
  }
  return [];
}

function asSecretList(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  const record = asRecord(value);
  if (record == null) {
    return [];
  }
  if (Array.isArray(record.secrets)) {
    return record.secrets;
  }
  if (Array.isArray(record.data)) {
    return record.data;
  }
  const nested = asRecord(record.data);
  if (nested != null && Array.isArray(nested.secrets)) {
    return nested.secrets;
  }
  return [];
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value !== "" ? value : null;
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length < 2 || parts[1] == null) {
    throw new BwsError("BWS identity response was invalid", 502);
  }
  const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  let json: string;
  try {
    json = atob(padded + pad);
  } catch {
    throw new BwsError("BWS identity response was invalid", 502);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new BwsError("BWS identity response was invalid", 502);
  }
  const record = asRecord(parsed);
  if (record == null) {
    throw new BwsError("BWS identity response was invalid", 502);
  }
  return record;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim() === "") {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new BwsError("BWS request failed (invalid JSON)", 502);
  }
}

async function login(
  token: Awaited<ReturnType<typeof parseAccessToken>>,
  identityUrl: string,
  fetchImpl: typeof fetch,
): Promise<{ bearer: string; organizationId: string; orgKey: Uint8Array }> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "api.secrets",
    client_id: token.accessTokenId,
    client_secret: token.clientSecret,
  });
  const response = await fetchImpl(`${identityUrl.replace(/\/$/, "")}/connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    throw jsonError(response.status);
  }
  const payload = asRecord(await readJson(response));
  if (payload == null) {
    throw new BwsError("BWS identity response was invalid", 502);
  }
  const bearer = stringField(payload, "access_token");
  const encryptedPayload = stringField(payload, "encrypted_payload");
  if (bearer == null || encryptedPayload == null) {
    throw new BwsError("BWS identity response was invalid", 502);
  }
  const jwt = decodeJwtPayload(bearer);
  const organizationId = stringField(jwt, "organization");
  if (organizationId == null) {
    throw new BwsError("BWS identity response was invalid", 502);
  }
  const decrypted = await decryptUtf8(encryptedPayload, token.encryptionKey);
  let inner: unknown;
  try {
    inner = JSON.parse(decrypted);
  } catch {
    throw new BwsError("BWS identity payload was invalid", 502);
  }
  const innerRecord = asRecord(inner);
  const encryptionKeyB64 = innerRecord == null ? null : stringField(innerRecord, "encryptionKey");
  if (encryptionKeyB64 == null) {
    throw new BwsError("BWS identity payload was invalid", 502);
  }
  const orgKeyBinary = atob(encryptionKeyB64);
  const orgKey = new Uint8Array(orgKeyBinary.length);
  for (let i = 0; i < orgKeyBinary.length; i++) {
    orgKey[i] = orgKeyBinary.charCodeAt(i);
  }
  if (orgKey.length !== 64) {
    throw new BwsError("BWS identity payload was invalid", 502);
  }
  return { bearer, organizationId, orgKey };
}

export function createHttpBwsClient(env: Env, fetchImpl: typeof fetch = fetch): BwsClient {
  const accessToken = env.BWS_ACCESS_TOKEN?.trim() ?? "";
  const identityUrl = env.BWS_IDENTITY_URL?.trim() || DEFAULT_IDENTITY_URL;
  const apiUrl = (env.BWS_API_URL?.trim() || DEFAULT_API_URL).replace(/\/$/, "");
  const allowed = parseAllowedProjects(env.BWS_ALLOWED_PROJECTS);

  async function session() {
    if (accessToken === "") {
      throw new BwsError("BWS is not configured", 503);
    }
    const parsed = await parseAccessToken(accessToken);
    return login(parsed, identityUrl, fetchImpl);
  }

  async function apiGet(path: string, bearer: string): Promise<unknown> {
    const response = await fetchImpl(`${apiUrl}${path}`, {
      headers: { authorization: `Bearer ${bearer}` },
    });
    if (!response.ok) {
      throw jsonError(response.status);
    }
    return readJson(response);
  }

  async function resolveProject(
    projectName: string,
    current: Awaited<ReturnType<typeof session>>,
  ): Promise<{ id: string; name: string }> {
    requireAllowedProject(projectName, allowed);
    const body = await apiGet(`/organizations/${current.organizationId}/projects`, current.bearer);
    for (const item of asList(body)) {
      const record = asRecord(item);
      if (record == null) {
        continue;
      }
      const id = stringField(record, "id");
      const rawName = stringField(record, "name");
      if (id == null || rawName == null) {
        continue;
      }
      const name = await decryptMaybeUtf8(rawName, current.orgKey);
      if (name === projectName) {
        return { id, name };
      }
    }
    throw new BwsError(`Project not found: ${projectName}`, 404);
  }

  async function listInProject(
    projectName: string,
    current: Awaited<ReturnType<typeof session>>,
  ): Promise<SecretSummary[]> {
    const project = await resolveProject(projectName, current);
    const body = await apiGet(`/projects/${project.id}/secrets`, current.bearer);
    const summaries: SecretSummary[] = [];
    for (const item of asSecretList(body)) {
      const record = asRecord(item);
      if (record == null) {
        continue;
      }
      const id = stringField(record, "id");
      const rawName = stringField(record, "key");
      if (id == null || rawName == null) {
        continue;
      }
      const name = await decryptMaybeUtf8(rawName, current.orgKey);
      summaries.push({ id, name, project: project.name });
    }
    return summaries;
  }

  return {
    async listSecrets(project) {
      const known = requireAllowedProject(project, allowed);
      const current = await session();
      return listInProject(known, current);
    },
    async getSecret(args) {
      const project = requireAllowedProject(args.project, allowed);
      const current = await session();
      const listed = await listInProject(project, current);
      const match = listed.find((secret) => secret.name === args.name);
      if (match == null) {
        throw new BwsError("Secret not found", 404);
      }
      const body = asRecord(await apiGet(`/secrets/${match.id}`, current.bearer));
      const rawValue = body == null ? null : stringField(body, "value");
      if (rawValue == null) {
        throw new BwsError("BWS secret response was invalid", 502);
      }
      const value = await decryptUtf8(rawValue, current.orgKey);
      return { id: match.id, name: match.name, project: match.project, value };
    },
  };
}
