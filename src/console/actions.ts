import { BUNDLED_FOUNDER_ACTIONS, loadJsonWithFallback } from "../model-json.js";
import { modelPath } from "../paths.js";
import { FOUNDER_ACTION_TITLES, REQUIRED_ACTION_FIELDS, type FounderActionCatalog, type FounderActionConfig } from "./types.js";

export function loadFounderActions(path?: string): FounderActionCatalog {
  return loadJsonWithFallback(path, BUNDLED_FOUNDER_ACTIONS, () => modelPath("founder-actions.json"));
}

export function assertActionCompleteness(catalog = loadFounderActions()): string[] {
  const errors: string[] = [];
  if (catalog.actions.length !== 17) {
    errors.push(`expected 17 actions, found ${catalog.actions.length}`);
  }
  const titles = catalog.actions.map((item) => item.title);
  for (const title of FOUNDER_ACTION_TITLES) {
    if (!titles.includes(title)) errors.push(`missing action title: ${title}`);
  }
  const ids = new Set<string>();
  for (const action of catalog.actions) {
    for (const field of REQUIRED_ACTION_FIELDS) {
      const value = action[field];
      if (value === undefined || value === null || value === "") {
        errors.push(`${action.id ?? "unknown"} missing ${field}`);
      }
      if (Array.isArray(value) && field !== "evidenceRequirements" && value.length === 0) {
        errors.push(`${action.id} ${field} must not be empty`);
      }
    }
    if (action.forbiddenActions.length === 0) {
      errors.push(`${action.id} missing forbiddenActions`);
    }
    if (ids.has(action.id)) errors.push(`duplicate action id ${action.id}`);
    ids.add(action.id);
  }
  return errors;
}

export function getAction(id: string, catalog = loadFounderActions()): FounderActionConfig | undefined {
  return catalog.actions.find((item) => item.id === id);
}

export function getActionByTitle(title: string, catalog = loadFounderActions()): FounderActionConfig | undefined {
  const needle = title.trim().toLowerCase();
  return catalog.actions.find((item) => item.title.toLowerCase() === needle);
}
