import { RepairLog, RepairStrategy, ValidationResult } from "@/types";
import { callModel, parseJsonFromLLM } from "@/lib/gateway";

function makeLog(
  stage: string,
  strategy: RepairStrategy,
  errorInput: string,
  outcome: RepairLog["outcome"]
): RepairLog {
  return { stage, strategy, errorInput, outcome, timestamp: new Date().toISOString() };
}

// Strategy 1: Structural repair — malformed/truncated JSON
export function structuralRepair(raw: string): { data: unknown; log: RepairLog } | null {
  const stage = "structural";
  try {
    // Remove markdown fences
    let clean = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();

    // Try direct parse
    try {
      const data = JSON.parse(clean);
      return { data, log: makeLog(stage, "structural", raw.slice(0, 100), "repaired") };
    } catch {
      // Try to extract outermost JSON object
      const objMatch = clean.match(/\{[\s\S]*\}/);
      if (objMatch) {
        const data = JSON.parse(objMatch[0]);
        return { data, log: makeLog(stage, "structural", raw.slice(0, 100), "repaired") };
      }

      // Try to extract outermost JSON array
      const arrMatch = clean.match(/\[[\s\S]*\]/);
      if (arrMatch) {
        const data = JSON.parse(arrMatch[0]);
        return { data, log: makeLog(stage, "structural", raw.slice(0, 100), "repaired") };
      }

      // Try to fix truncated JSON by appending closing braces
      const openBraces = (clean.match(/\{/g) || []).length;
      const closeBraces = (clean.match(/\}/g) || []).length;
      if (openBraces > closeBraces) {
        clean += "}".repeat(openBraces - closeBraces);
        const data = JSON.parse(clean);
        return { data, log: makeLog(stage, "structural", raw.slice(0, 100), "repaired") };
      }

      return null;
    }
  } catch {
    return null;
  }
}

// Strategy 2: Field repair — missing/wrong typed fields
export function fieldRepair(
  data: Record<string, unknown>,
  errors: ValidationResult["errors"],
  stage: string
): { data: unknown; log: RepairLog } {
  const repaired = { ...data };

  for (const err of errors) {
    const field = err.field;

    if (err.code === "missing_tenant_id" && field.includes("fields")) {
      // Add tenantId to entity fields
      const entityMatch = field.match(/entities\.(\w+)/);
      if (entityMatch) {
        const entities = repaired.entities as Array<{ name: string; fields: unknown[] }>;
        const entity = entities?.find((e) => e.name === entityMatch[1]);
        if (entity) {
          entity.fields.push({
            name: "tenantId",
            type: "uuid",
            nullable: false,
            isRelation: false,
            isPrimary: false,
            isUnique: false,
          });
        }
      }
    }

    if (err.code === "invalid_input" && field === "appType") {
      repaired.appType = "custom";
    }

    if (err.code === "too_small" && field === "features") {
      if (!repaired.features || (repaired.features as unknown[]).length === 0) {
        repaired.features = ["core functionality"];
      }
    }

    if (err.code === "too_small" && field === "entities") {
      if (!repaired.entities || (repaired.entities as unknown[]).length === 0) {
        repaired.entities = ["User"];
      }
    }
  }

  return {
    data: repaired,
    log: makeLog(stage, "field", JSON.stringify(errors.slice(0, 3)), "repaired"),
  };
}

// Strategy 3: Consistency repair — broken cross-layer references
export function consistencyRepair(
  data: Record<string, unknown>,
  errors: ValidationResult["errors"],
  stage: string,
  context?: { entityNames?: string[]; integrationIds?: string[] }
): { data: unknown; log: RepairLog } {
  const repaired = JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
  const entityNames = new Set(context?.entityNames ?? []);
  const integrationIds = new Set(context?.integrationIds ?? []);

  // Fix invalid relation targets
  const entities = repaired.entities as Array<{
    name: string;
    relations: Array<{ target: string }>;
  }> | undefined;

  if (entities) {
    for (const entity of entities) {
      entity.relations = entity.relations.filter((r) => entityNames.has(r.target));
    }
  }

  // Fix workflow stubs referencing invalid entities or integrations
  const stubs = repaired.workflowStubs as Array<{
    trigger: { entity: string };
    integration: string;
  }> | undefined;

  if (stubs) {
    repaired.workflowStubs = stubs.filter(
      (s) =>
        entityNames.has(s.trigger.entity) && integrationIds.has(s.integration)
    );
  }

  // Fix integration hooks
  const hooks = repaired.integrationHooks as Array<{ integrationId: string }> | undefined;
  if (hooks) {
    repaired.integrationHooks = hooks.filter((h) =>
      integrationIds.has(h.integrationId)
    );
  }

  // Add missing API endpoints for pages
  const pages = repaired.pages as Array<{ boundEntity: string; name: string; route: string }> | undefined;
  const endpoints = repaired.apiEndpoints as Array<{ boundEntity: string; path: string; method: string; handlerDescription: string; authRequired: boolean; rateLimitFlag: boolean }> | undefined;

  if (pages && endpoints) {
    for (const page of pages) {
      const hasEndpoint = endpoints.some((ep) => ep.boundEntity === page.boundEntity);
      if (!hasEndpoint) {
        endpoints.push({
          path: `/api/${page.boundEntity.toLowerCase()}`,
          method: "GET",
          handlerDescription: `List all ${page.boundEntity} records`,
          boundEntity: page.boundEntity,
          authRequired: true,
          rateLimitFlag: false,
        });
      }
    }
  }

  return {
    data: repaired,
    log: makeLog(stage, "consistency", JSON.stringify(errors.slice(0, 3)), "repaired"),
  };
}

// LLM-based repair for cases that can't be fixed deterministically
export async function llmRepair(
  stage: string,
  originalPrompt: string,
  failedOutput: string,
  errors: ValidationResult["errors"]
): Promise<{ data: unknown; log: RepairLog }> {
  const systemPrompt = `You are a JSON repair engine. Fix the provided JSON to match the required schema.
Return ONLY valid JSON with no explanation, no markdown, no code fences.`;

  const userPrompt = `The following JSON failed validation for stage "${stage}".

Validation errors:
${errors.slice(0, 5).map((e) => `- ${e.field}: ${e.message}`).join("\n")}

Original prompt context: ${originalPrompt}

Failed JSON output:
${failedOutput.slice(0, 2000)}

Return the corrected JSON only.`;

  try {
    const result = await callModel(
      stage.includes("intent") ? "repair_fast" : "repair_capable",
      systemPrompt,
      userPrompt
    );
    const data = parseJsonFromLLM(result.text);
    return {
      data,
      log: makeLog(stage, "field", failedOutput.slice(0, 100), "repaired"),
    };
  } catch {
    return {
      data: null,
      log: makeLog(stage, "field", failedOutput.slice(0, 100), "failed"),
    };
  }
}
