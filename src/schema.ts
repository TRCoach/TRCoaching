import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ErrorObject, ValidateFunction } from "ajv";
import { fixturePath, schemaPath } from "./paths.js";

const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020") as new (options: {
  allErrors: boolean;
  strict: boolean;
  validateSchema: boolean;
}) => {
  addSchema(schema: object): unknown;
  compile(schema: object): ValidateFunction;
  getSchema(id: string): ValidateFunction | undefined;
};
const addFormats = require("ajv-formats") as (instance: unknown) => void;

const ajv = new Ajv2020({ allErrors: true, strict: false, validateSchema: false });
addFormats(ajv);

function loadSchema(name: string) {
  return JSON.parse(readFileSync(schemaPath(name), "utf8")) as object;
}

export const schemas = {
  businessEvent: loadSchema("business-event.schema.json"),
  evidence: loadSchema("state-transition-evidence.schema.json"),
  handoff: loadSchema("handoff.schema.json"),
  socialQa: loadSchema("social-qa.schema.json"),
  benchmark: loadSchema("benchmark-report.schema.json"),
};

ajv.addSchema(schemas.socialQa);

const validators = {
  businessEvent: ajv.compile(schemas.businessEvent),
  evidence: ajv.compile(schemas.evidence),
  handoff: ajv.compile(schemas.handoff),
  socialQa: ajv.getSchema("https://trcoach.local/schemas/social-qa.schema.json")!,
  benchmark: ajv.compile(schemas.benchmark),
};

export function validateAgainst(
  kind: keyof typeof validators,
  value: unknown,
): { ok: boolean; errors: string[] } {
  const validate = validators[kind];
  const ok = validate(value) as boolean;
  const errors = ((validate.errors ?? []) as ErrorObject[]).map(
    (err) => `${err.instancePath || "/"} ${err.message}`,
  );
  return { ok, errors };
}

export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function fixtureFiles(dir: string): string[] {
  const root = fixturePath(dir);
  return readdirSync(root)
    .filter((name) => name.endsWith(".json"))
    .map((name) => join(root, name));
}
