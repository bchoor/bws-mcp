import type { BwsClient, SecretDeleteResult, SecretSummary, SecretValue, SecretWriteResult } from "./bws.ts";
import { BwsError, requireAllowedProject } from "./projects.ts";

export type ToolOk<T> = { ok: true; data: T };
export type ToolFail = { ok: false; message: string };
export type ToolResult<T> = ToolOk<T> | ToolFail;

function fail(error: unknown): ToolFail {
  if (error instanceof BwsError) {
    return { ok: false, message: error.message };
  }
  return { ok: false, message: "BWS request failed" };
}

export async function listSecretsTool(
  client: BwsClient,
  project: string | undefined,
  allowed: string[],
): Promise<ToolResult<{ project: string; secrets: SecretSummary[] }>> {
  try {
    const known = requireAllowedProject(project, allowed);
    const secrets = await client.listSecrets(known);
    return { ok: true, data: { project: known, secrets } };
  } catch (error) {
    return fail(error);
  }
}

export async function getSecretTool(
  client: BwsClient,
  args: { name: string; project: string | undefined },
  allowed: string[],
): Promise<ToolResult<SecretValue>> {
  try {
    const project = requireAllowedProject(args.project, allowed);
    const secret = await client.getSecret({ name: args.name, project });
    return { ok: true, data: secret };
  } catch (error) {
    return fail(error);
  }
}

export async function putSecretTool(
  client: BwsClient,
  args: { name: string; value: string; project: string | undefined; note?: string },
  allowed: string[],
): Promise<ToolResult<SecretWriteResult>> {
  try {
    const project = requireAllowedProject(args.project, allowed);
    const secret = await client.putSecret({
      name: args.name,
      value: args.value,
      project,
      ...(args.note === undefined ? {} : { note: args.note }),
    });
    return { ok: true, data: secret };
  } catch (error) {
    return fail(error);
  }
}

export async function deleteSecretTool(
  client: BwsClient,
  args: { name: string; project: string | undefined },
  allowed: string[],
): Promise<ToolResult<SecretDeleteResult>> {
  try {
    const project = requireAllowedProject(args.project, allowed);
    const secret = await client.deleteSecret({ name: args.name, project });
    return { ok: true, data: secret };
  } catch (error) {
    return fail(error);
  }
}
