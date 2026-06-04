import { AppIntent, DataSchema, AppSpec, RepairLog } from "@/types";
import { callModel, parseJsonFromLLM, estimateCost } from "@/lib/gateway";
import { validateAppSpec } from "@/lib/validation";
import { structuralRepair, consistencyRepair, llmRepair } from "@/lib/repair";
import { getRegisteredIds, normalizeIntegrationName } from "@/lib/integrations/registry";

const SYSTEM_PROMPT = `You are an app specification generation engine.
Convert a DataSchema into a complete AppSpec with pages, API endpoints, auth rules, integration hooks, and workflow stubs.
Respond ONLY with valid JSON. No markdown, no explanation, no code fences.

Rules:
1. Every page MUST have at least one corresponding API endpoint (same boundEntity)
2. Every workflowStub MUST reference a valid entity from the DataSchema
3. Every integrationHook and workflowStub MUST reference a valid integration ID
4. Valid integration IDs: slack, stripe, whatsapp, gmail, jira, webhook, google_sheets, salesforce, hubspot
5. Auth rules must cover all entities

Output this exact structure:
{
  "pages": [{"name":"string","route":"/path","layout":"list|detail|dashboard|settings","boundEntity":"string","components":["table|form|chart|card"]}],
  "apiEndpoints": [{"path":"/api/path","method":"GET|POST|PUT|DELETE|PATCH","handlerDescription":"string","boundEntity":"string","authRequired":true,"rateLimitFlag":false}],
  "authRules": [{"role":"string","permissions":[{"entity":"string","read":true,"write":true,"delete":false}]}],
  "integrationHooks": [{"integrationId":"string","trigger":"string","action":"string"}],
  "workflowStubs": [{"name":"string","trigger":{"entity":"string","event":"created|updated|deleted|status_changed","condition":"optional string"},"integration":"string","action":"string","payload":{"key":"value"}}]
}`;

export async function generateAppSpec(
  intent: AppIntent,
  dataSchema: DataSchema
): Promise<{
  appSpec: AppSpec;
  tokensUsed: number;
  costUsd: number;
  model: string;
  repairLogs: RepairLog[];
}> {
  const repairLogs: RepairLog[] = [];
  const registeredIds = getRegisteredIds();

  const normalizedIntegrations = intent.integrationsRequested
    .map(normalizeIntegrationName)
    .filter((id) => registeredIds.has(id));

  const userPrompt = `Generate a complete AppSpec for this application:

App: ${intent.appName} (${intent.appType})
Features: ${intent.features.join(", ")}
Integrations requested: ${normalizedIntegrations.join(", ") || "none"}

DataSchema entities:
${dataSchema.entities
  .map(
    (e) =>
      `- ${e.name} (table: ${e.tableName}) fields: ${e.fields
        .map((f) => f.name)
        .join(", ")}`
  )
  .join("\n")}

Generate workflow stubs for each integration. Map entity fields to integration payloads.
Every page must have a corresponding API endpoint.`;

  const result = await callModel("app_spec_generation", SYSTEM_PROMPT, userPrompt);
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
      const llmFixed = await llmRepair(
        "app_spec_generation",
        JSON.stringify(intent),
        result.text,
        [{ field: "output", message: "Invalid JSON", code: "invalid_json" }]
      );
      repairLogs.push(llmFixed.log);
      if (!llmFixed.data) throw new Error("AppSpec generation failed after repair");
      parsed = llmFixed.data;
    }
  }

  // Validate
  let validation = validateAppSpec(parsed, dataSchema, registeredIds);

  if (!validation.valid) {
    // Strategy 3: Consistency repair
    const entityNames = dataSchema.entities.map((e) => e.name);
    const consistencyFixed = consistencyRepair(
      parsed as Record<string, unknown>,
      validation.errors,
      "app_spec_generation",
      { entityNames, integrationIds: Array.from(registeredIds) }
    );
    repairLogs.push(consistencyFixed.log);
    parsed = consistencyFixed.data;
    validation = validateAppSpec(parsed, dataSchema, registeredIds);

    if (!validation.valid) {
      const llmFixed = await llmRepair(
        "app_spec_generation",
        JSON.stringify({ intent, entities: dataSchema.entities.map((e) => e.name) }),
        JSON.stringify(parsed),
        validation.errors
      );
      repairLogs.push(llmFixed.log);
      if (llmFixed.data) {
        const finalFixed = consistencyRepair(
          llmFixed.data as Record<string, unknown>,
          validation.errors,
          "app_spec_generation",
          { entityNames, integrationIds: Array.from(registeredIds) }
        );
        parsed = finalFixed.data;
      }
    }
  }

  return {
    appSpec: parsed as AppSpec,
    tokensUsed: result.inputTokens + result.outputTokens,
    costUsd,
    model: result.model,
    repairLogs,
  };
}
