import { AppIntent, DataSchema, RepairLog } from "@/types";
import { callModel, parseJsonFromLLM, estimateCost } from "@/lib/gateway";
import { validateDataSchema } from "@/lib/validation";
import { structuralRepair, fieldRepair, consistencyRepair, llmRepair } from "@/lib/repair";

const SYSTEM_PROMPT = `You are a database schema generation engine.
Convert an AppIntent into a complete DataSchema with entities, fields, and relations.
Respond ONLY with valid JSON. No markdown, no explanation, no code fences.

Rules:
1. Every entity MUST have a tenantId field (uuid, not nullable)
2. Every entity MUST have an id field (uuid, isPrimary: true)
3. tableName must be snake_case (e.g. "user_profiles")
4. Relations must be bidirectionally consistent
5. All relation targets must be entity names that exist in the schema

Output this exact structure:
{
  "entities": [
    {
      "name": "string",
      "tableName": "snake_case_string",
      "fields": [
        {
          "name": "string",
          "type": "string|number|boolean|date|uuid|text|enum|json",
          "nullable": boolean,
          "isRelation": boolean,
          "isPrimary": boolean,
          "isUnique": boolean
        }
      ],
      "relations": [
        {
          "type": "hasMany|belongsTo|hasOne",
          "target": "EntityName",
          "foreignKey": "string",
          "onDelete": "cascade|set_null|restrict"
        }
      ]
    }
  ]
}`;

export async function generateSchema(intent: AppIntent): Promise<{
  dataSchema: DataSchema;
  tokensUsed: number;
  costUsd: number;
  model: string;
  repairLogs: RepairLog[];
}> {
  const repairLogs: RepairLog[] = [];

  const userPrompt = `Generate a complete DataSchema for this app:

App Name: ${intent.appName}
App Type: ${intent.appType}
Features: ${intent.features.join(", ")}
Entities needed: ${intent.entities.join(", ")}
Assumptions: ${intent.assumptions.join(", ")}

Ensure every entity has tenantId and id fields. Make all relations bidirectionally consistent.`;

  const result = await callModel("schema_generation", SYSTEM_PROMPT, userPrompt);
  const costUsd = estimateCost(result.model, result.inputTokens, result.outputTokens);
  let parsed: unknown;

  try {
    parsed = parseJsonFromLLM(result.text);
  } catch {
    const repaired = structuralRepair(result.text);
    if (repaired) {
      parsed = repaired.data;
      repairLogs.push(repaired.log);
    } else {
      const llmFixed = await llmRepair("schema_generation", JSON.stringify(intent), result.text, [
        { field: "output", message: "Invalid JSON", code: "invalid_json" },
      ]);
      repairLogs.push(llmFixed.log);
      if (!llmFixed.data) throw new Error("Schema generation failed after repair");
      parsed = llmFixed.data;
    }
  }

  // Validate
  let validation = validateDataSchema(parsed);

  if (!validation.valid) {
    // Strategy 2: Field repair (add missing tenantId etc)
    const fieldFixed = fieldRepair(parsed as Record<string, unknown>, validation.errors, "schema_generation");
    repairLogs.push(fieldFixed.log);
    parsed = fieldFixed.data;
    validation = validateDataSchema(parsed);

    if (!validation.valid) {
      // Strategy 3: Consistency repair (fix broken relation targets)
      const schema = parsed as DataSchema;
      const entityNames = schema.entities?.map((e) => e.name) ?? [];
      const consistencyFixed = consistencyRepair(
        parsed as Record<string, unknown>,
        validation.errors,
        "schema_generation",
        { entityNames }
      );
      repairLogs.push(consistencyFixed.log);
      parsed = consistencyFixed.data;
      validation = validateDataSchema(parsed);

      if (!validation.valid) {
        // LLM escalation
        const llmFixed = await llmRepair(
          "schema_generation",
          JSON.stringify(intent),
          JSON.stringify(parsed),
          validation.errors
        );
        repairLogs.push(llmFixed.log);
        if (llmFixed.data) {
          parsed = llmFixed.data;
        }
      }
    }
  }

  return {
    dataSchema: parsed as DataSchema,
    tokensUsed: result.inputTokens + result.outputTokens,
    costUsd,
    model: result.model,
    repairLogs,
  };
}
