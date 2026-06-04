import Anthropic from "@anthropic-ai/sdk";
import Groq from "groq-sdk";
import OpenAI from "openai";

export type Provider = "anthropic" | "groq" | "openai" | "openrouter" | "gemini";
export type Tier = "fast" | "capable";

export interface ModelConfig {
  provider: Provider;
  model: string;
  fallbackProvider: Provider;
  fallbackModel: string;
  tier: Tier;
}

// Cost per 1M tokens in USD
export const COST_TABLE: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5-20251001": { input: 0.25, output: 1.25 },
  "claude-sonnet-4-20250514": { input: 3.0, output: 15.0 },
  "llama-3.1-8b-instant": { input: 0.05, output: 0.08 },
  "llama-3.3-70b-versatile": { input: 0.59, output: 0.79 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 2.5, output: 10.0 },
  "openrouter/auto": { input: 1.0, output: 2.0 },
};

// Config-driven routing — not hardcoded in stage implementations
export const ROUTING_CONFIG: Record<string, ModelConfig> = {
  intent_extraction: {
    provider: "groq",
    model: "llama-3.1-8b-instant",
    fallbackProvider: "anthropic",
    fallbackModel: "claude-haiku-4-5-20251001",
    tier: "fast",
  },
  schema_generation: { provider: "groq", model: "llama-3.3-70b-versatile",
    fallbackProvider: "openrouter",
    fallbackModel: "openrouter/auto",
    tier: "capable",
  },
  app_spec_generation: { provider: "groq", model: "llama-3.3-70b-versatile",
    fallbackProvider: "openrouter",
    fallbackModel: "openrouter/auto",
    tier: "capable",
  },
  repair_fast: {
    provider: "groq",
    model: "llama-3.1-8b-instant",
    fallbackProvider: "anthropic",
    fallbackModel: "claude-haiku-4-5-20251001",
    tier: "fast",
  },
  repair_capable: {
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    fallbackProvider: "openrouter",
    fallbackModel: "openrouter/auto",
    tier: "capable",
  },
};

export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const rates = COST_TABLE[model] ?? { input: 1.0, output: 2.0 };
  return (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000;
}

async function callAnthropic(
  model: string,
  systemPrompt: string,
  userPrompt: string
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });
  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  return {
    text,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

async function callGroq(
  model: string,
  systemPrompt: string,
  userPrompt: string
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_tokens: 4096,
    temperature: 0.1,
  });
  const text = response.choices[0]?.message?.content ?? "";
  const inputTokens = response.usage?.prompt_tokens ?? 0;
  const outputTokens = response.usage?.completion_tokens ?? 0;
  return { text, inputTokens, outputTokens };
}

async function callOpenAI(
  model: string,
  systemPrompt: string,
  userPrompt: string,
  baseURL?: string,
  apiKey?: string
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const client = new OpenAI({
    apiKey: apiKey ?? process.env.OPENAI_API_KEY,
    ...(baseURL ? { baseURL } : {}),
  });
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_tokens: 4096,
    temperature: 0.1,
  });
  const text = response.choices[0]?.message?.content ?? "";
  const inputTokens = response.usage?.prompt_tokens ?? 0;
  const outputTokens = response.usage?.completion_tokens ?? 0;
  return { text, inputTokens, outputTokens };
}

export async function callModel(
  stage: string,
  systemPrompt: string,
  userPrompt: string,
  forceProvider?: Provider,
  forceModel?: string
): Promise<{
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  provider: Provider;
}> {
  const config = ROUTING_CONFIG[stage] ?? ROUTING_CONFIG.intent_extraction;
  const provider = forceProvider ?? config.provider;
  const model = forceModel ?? config.model;

  try {
    let result: { text: string; inputTokens: number; outputTokens: number };

    if (provider === "anthropic") {
      result = await callAnthropic(model, systemPrompt, userPrompt);
    } else if (provider === "groq") {
      result = await callGroq(model, systemPrompt, userPrompt);
    } else if (provider === "openai") {
      result = await callOpenAI(model, systemPrompt, userPrompt);
    } else if (provider === "openrouter") {
      result = await callOpenAI(
        model === "openrouter/auto" ? "openai/gpt-4o-mini" : model,
        systemPrompt,
        userPrompt,
        "https://openrouter.ai/api/v1",
        process.env.OPENROUTER_API_KEY
      );
    } else {
      result = await callGroq(
        "llama-3.1-8b-instant",
        systemPrompt,
        userPrompt
      );
    }

    return { ...result, model, provider };
  } catch (err: unknown) {
    const error = err as { status?: number; message?: string };
    // On 429 or 5xx, fallback to OpenRouter
    if (error?.status === 429 || (error?.status ?? 0) >= 500) {
      console.warn(`Provider ${provider} failed (${error?.status}), falling back to OpenRouter`);
      const fallbackResult = await callOpenAI(
        "openai/gpt-4o-mini",
        systemPrompt,
        userPrompt,
        "https://openrouter.ai/api/v1",
        process.env.OPENROUTER_API_KEY
      );
      return {
        ...fallbackResult,
        model: "openrouter/auto",
        provider: "openrouter",
      };
    }
    throw err;
  }
}

export function parseJsonFromLLM(text: string): unknown {
  const clean = text
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();

  // Try direct parse
  try {
    return JSON.parse(clean);
  } catch {
    // Try to extract JSON object
    const match = clean.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        // last resort
      }
    }
    throw new Error(`Cannot parse JSON from LLM output: ${text.slice(0, 200)}`);
  }
}




