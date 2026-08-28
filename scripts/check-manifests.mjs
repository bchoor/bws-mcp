#!/usr/bin/env node
/**
 * Fail if plugin/marketplace metadata drifts from package.json, or if
 * official SchemaStore validation fails.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];

const SCHEMA_URLS = {
  claudePlugin:
    "https://www.schemastore.org/claude-code-plugin-manifest.json",
  claudeMarketplace:
    "https://www.schemastore.org/claude-code-marketplace.json",
  codexPlugin: "https://www.schemastore.org/codex-plugin-manifest.json",
};

function fail(message) {
  errors.push(message);
}

async function readJson(rel) {
  const abs = path.join(root, rel);
  try {
    return JSON.parse(await readFile(abs, "utf8"));
  } catch (err) {
    fail(`${rel}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

function asString(value) {
  return typeof value === "string" ? value : null;
}

function checkFields(rel, doc, expected) {
  if (!doc) return;
  for (const key of ["name", "version", "license", "homepage"]) {
    const got = asString(doc[key]);
    if (got === null) {
      fail(`${rel}: missing ${key}`);
      continue;
    }
    if (got !== expected[key]) {
      fail(`${rel}: ${key} is ${JSON.stringify(got)}, expected ${JSON.stringify(expected[key])}`);
    }
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function fetchSchema(url) {
  const res = await fetch(url, {
    headers: { Accept: "application/schema+json, application/json" },
  });
  if (!res.ok) {
    throw new Error(`${url} HTTP ${res.status}`);
  }
  return res.json();
}

function validateAjv(rel, schema, data) {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  if (!validate(data)) {
    for (const err of validate.errors ?? []) {
      fail(`${rel}: schema ${err.instancePath || "/"} ${err.message}`);
    }
  }
}

const pkg = await readJson("package.json");
if (!pkg) {
  console.error(errors.join("\n"));
  process.exit(1);
}

const expected = {
  name: asString(pkg.name),
  version: asString(pkg.version),
  license: asString(pkg.license),
  homepage: asString(pkg.homepage),
};

if (!expected.name || !expected.version || !expected.license || !expected.homepage) {
  fail("package.json must set name, version, license, and homepage");
}

const cursorPlugin = await readJson(".cursor-plugin/plugin.json");
const claudePlugin = await readJson(".claude-plugin/plugin.json");
const claudeMarket = await readJson(".claude-plugin/marketplace.json");
const codexPlugin = await readJson(".codex-plugin/plugin.json");
const codexMarket = await readJson(".agents/plugins/marketplace.json");
const cursorMcp = await readJson(".cursor-plugin/mcp.json");
const codexMcp = await readJson(".mcp.json");

checkFields(".cursor-plugin/plugin.json", cursorPlugin, expected);
checkFields(".claude-plugin/plugin.json", claudePlugin, expected);
checkFields(".codex-plugin/plugin.json", codexPlugin, expected);

if (claudeMarket) {
  if (asString(claudeMarket.version) !== expected.version) {
    fail(
      `.claude-plugin/marketplace.json: version is ${JSON.stringify(claudeMarket.version)}, expected ${JSON.stringify(expected.version)}`,
    );
  }
  const plugins = Array.isArray(claudeMarket.plugins) ? claudeMarket.plugins : [];
  const entry = plugins.find((p) => isRecord(p) && p.name === expected.name);
  if (!entry) {
    fail(`.claude-plugin/marketplace.json: missing plugins[] entry named ${expected.name}`);
  } else {
    if (!entry.source) fail(".claude-plugin/marketplace.json: plugin entry missing source");
    if (asString(entry.version) !== expected.version) {
      fail(
        `.claude-plugin/marketplace.json: plugin version is ${JSON.stringify(entry.version)}, expected ${JSON.stringify(expected.version)}`,
      );
    }
    if (asString(entry.license) !== expected.license) {
      fail(
        `.claude-plugin/marketplace.json: plugin license is ${JSON.stringify(entry.license)}, expected ${JSON.stringify(expected.license)}`,
      );
    }
    if (asString(entry.homepage) !== expected.homepage) {
      fail(
        `.claude-plugin/marketplace.json: plugin homepage is ${JSON.stringify(entry.homepage)}, expected ${JSON.stringify(expected.homepage)}`,
      );
    }
    if (entry.source !== "./") {
      fail(
        `.claude-plugin/marketplace.json: source must be "./" (this repo is the plugin), got ${JSON.stringify(entry.source)}`,
      );
    }
  }
}

if (codexMarket) {
  const plugins = Array.isArray(codexMarket.plugins) ? codexMarket.plugins : [];
  const entry = plugins.find((p) => isRecord(p) && p.name === expected.name);
  if (!entry) {
    fail(`.agents/plugins/marketplace.json: missing plugins[] entry named ${expected.name}`);
  } else {
    const source = isRecord(entry.source) ? entry.source : null;
    if (!source || source.source !== "local" || source.path !== "./") {
      fail(
        `.agents/plugins/marketplace.json: source must be { "source": "local", "path": "./" }, got ${JSON.stringify(entry.source)}`,
      );
    }
    const policy = isRecord(entry.policy) ? entry.policy : null;
    if (!policy || !asString(policy.installation) || !asString(policy.authentication)) {
      fail(".agents/plugins/marketplace.json: plugin entry needs policy.installation and policy.authentication");
    }
    if (!asString(entry.category)) {
      fail(".agents/plugins/marketplace.json: plugin entry needs category");
    }
    if ("version" in entry && asString(entry.version) !== expected.version) {
      fail(
        `.agents/plugins/marketplace.json: plugin version is ${JSON.stringify(entry.version)}, expected ${JSON.stringify(expected.version)}`,
      );
    }
  }
}

if (claudePlugin) {
  const userConfig = isRecord(claudePlugin.userConfig) ? claudePlugin.userConfig : null;
  const worker = userConfig && isRecord(userConfig.WORKER_URL) ? userConfig.WORKER_URL : null;
  if (!worker || worker.type !== "string" || worker.required !== true) {
    fail(".claude-plugin/plugin.json: userConfig.WORKER_URL must be a required string setup field");
  }
  const servers = isRecord(claudePlugin.mcpServers) ? claudePlugin.mcpServers : null;
  const mcp = servers && isRecord(servers["bws-mcp"]) ? servers["bws-mcp"] : null;
  if (!mcp || mcp.type !== "http" || mcp.url !== "${user_config.WORKER_URL}/mcp") {
    fail(
      '.claude-plugin/plugin.json: mcpServers.bws-mcp must be type http with url "${user_config.WORKER_URL}/mcp"',
    );
  }
}

if (codexPlugin && codexPlugin.mcpServers !== "./.mcp.json") {
  fail('.codex-plugin/plugin.json: mcpServers must be "./.mcp.json"');
}

if (codexMcp) {
  const wrapped = isRecord(codexMcp.mcpServers) ? codexMcp.mcpServers : null;
  const server = wrapped && isRecord(wrapped["bws-mcp"]) ? wrapped["bws-mcp"] : null;
  if (!server || server.type !== "http" || typeof server.url !== "string") {
    fail(".mcp.json: mcpServers.bws-mcp must be a type http server with url");
  } else {
    let parsed;
    try {
      parsed = new URL(server.url);
    } catch {
      fail(`.mcp.json: url is not a URL: ${server.url}`);
      parsed = null;
    }
    if (parsed && parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
      fail(
        `.mcp.json: url host must be loopback until Codex documents a Worker URL setup field (got ${parsed.hostname})`,
      );
    }
  }
}

if (cursorMcp) {
  const servers = isRecord(cursorMcp.mcpServers) ? cursorMcp.mcpServers : null;
  const mcp = servers && isRecord(servers["bws-mcp"]) ? servers["bws-mcp"] : null;
  if (!mcp || mcp.url !== "${WORKER_URL}/mcp") {
    fail('.cursor-plugin/mcp.json: bws-mcp url must be "${WORKER_URL}/mcp"');
  }
}

let schemas;
try {
  schemas = {
    claudePlugin: await fetchSchema(SCHEMA_URLS.claudePlugin),
    claudeMarketplace: await fetchSchema(SCHEMA_URLS.claudeMarketplace),
    codexPlugin: await fetchSchema(SCHEMA_URLS.codexPlugin),
  };
} catch (err) {
  fail(`schema fetch failed: ${err instanceof Error ? err.message : String(err)}`);
}

if (schemas && claudePlugin) {
  validateAjv(".claude-plugin/plugin.json", schemas.claudePlugin, claudePlugin);
}
if (schemas && claudeMarket) {
  validateAjv(".claude-plugin/marketplace.json", schemas.claudeMarketplace, claudeMarket);
}
if (schemas && codexPlugin) {
  validateAjv(".codex-plugin/plugin.json", schemas.codexPlugin, codexPlugin);
}

if (errors.length) {
  console.error("check-manifests failed:\n" + errors.map((e) => ` - ${e}`).join("\n"));
  process.exit(1);
}

console.log(
  `check-manifests ok: ${expected.name}@${expected.version} (${expected.license}) ${expected.homepage}`,
);
