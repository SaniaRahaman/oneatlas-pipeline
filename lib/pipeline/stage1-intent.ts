import { AppIntent } from "@/types";
import { callModel, parseJsonFromLLM, estimateCost } from "@/lib/gateway";
import { validateIntent } from "@/lib/validation";
import { structuralRepair, fieldRepair, llmRepair } from "@/lib/repair";
import { normalizeIntegrationName } from "@/lib/integrations/registry";

const SYSTEM_PROMPT = `You are an intent extraction engine for an AI app generator.
Extract structured information from natural language app descriptions.
Respond ONLY with valid JSON. No markdown, no explanation, no code fences.

Output this exact structure:
{
  "appName": "string",
  "appType": "crm|project_management|ecommerce|hr_tool|inventory|content_platform|analytics|custom",
  "features": ["string"],
  "entities": ["string"],
  "integrationsRequested": ["string"],
  "assumptions": ["string"],
  "clarificationRequired": null
}

If prompt is vague (under 10 meaningful words), set clarificationRequired to:
{ "flag": true, "question": "one specific clarifying question" }`;

export async function extractIntent(
  prompt: string
): Promise<{
  intent: AppIntent;
  tokensUsed: number;
  costUsd: number;
  model: string;
  repairLogs: import("@/types").RepairLog[];
}> {
  const repairLogs: import("@/types").RepairLog[] = [];

  const userPrompt = `Extract the app intent from this description:\n\n"${prompt}"`;

  // Call model
  const result = await callModel("intent_extraction", SYSTEM_PROMPT, userPrompt);
  const costUsd = estimateCost(result.model, result.inputTokens, result.outputTokens);
  let parsed: unknown;

  // Parse JSON
  try {
    parsed = parseJsonFromLLM(result.text);
  } catch {
    // Strategy 1: Structural repair
    const repaired = structuralRepair(result.text);
    if (repaired) {
      parsed = repaired.data;
      repairLogs.push(repaired.log);
    } else {
      // LLM repair as escalation
      const llmFixed = await llmRepair("intent_extraction", prompt, result.text, [
        { field: "output", message: "Invalid JSON", code: "invalid_json" },
      ]);
      repairLogs.push(llmFixed.log);
      if (!llmFixed.data) throw new Error("Intent extraction failed after repair attempts");
      parsed = llmFixed.data;
    }
  }

  // Validate
  let validation = validateIntent(parsed);

  if (!validation.valid) {
    // Strategy 2: Field repair
    const fieldFixed = fieldRepair(parsed as Record<string, unknown>, validation.errors, "intent_extraction");
    repairLogs.push(fieldFixed.log);
    parsed = fieldFixed.data;
    validation = validateIntent(parsed);

    if (!validation.valid) {
      // Retry with LLM
      const llmFixed = await llmRepair("intent_extraction", prompt, JSON.stringify(parsed), validation.errors);
      repairLogs.push(llmFixed.log);
      if (llmFixed.data) {
        parsed = llmFixed.data;
        validation = validateIntent(parsed);
      }
    }
  }

  // Normalize integration names
  const intent = parsed as AppIntent;
  if (intent.integrationsRequested) {
    intent.integrationsRequested = intent.integrationsRequested.map(normalizeIntegrationName);
  }

  // Remove null clarificationRequired
  if (!intent.clarificationRequired) {
    delete intent.clarificationRequired;
  }

  return {
    intent,
    tokensUsed: result.inputTokens + result.outputTokens,
    costUsd,
    model: result.model,
    repairLogs,
  };
}
