# OneAtlas Pipeline

Multi-stage AI generation pipeline: Natural language → validated, executable AppSpec.

## Run Locally (< 5 minutes)

```bash
npm install
cp .env.example .env.local
# Fill in your API keys in .env.local
npm run dev
```

Open http://localhost:3000

## Required ENV Vars

| Variable | Where to get it |
|---|---|
| `GROQ_API_KEY` | console.groq.com → API Keys |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys |
| `OPENROUTER_API_KEY` | openrouter.ai → Keys |
| `OPENAI_API_KEY` | platform.openai.com (optional) |
| `GEMINI_API_KEY` | aistudio.google.com (optional) |

## Pipeline Architecture

Stage 1: Intent Extraction (Groq Llama — fast/cheap)
Stage 2: Schema Generation (Claude Sonnet — capable)  
Stage 3: AppSpec Generation (Claude Sonnet — capable)

Each stage: Validation → Repair → Pass downstream

## Repair Engine (3 Strategies)
1. Structural — malformed JSON, extract valid portion
2. Field — missing fields, supply typed defaults
3. Consistency — broken cross-layer refs, resolve deterministically

## Integrations (7 implemented, 2 stubbed)
Slack, Stripe, WhatsApp, Gmail, Jira, Webhook, Google Sheets — fully registered
Salesforce, HubSpot — registry defined, HTTP calls stubbed

## Stack
Next.js 15, TypeScript strict, TailwindCSS, Zod, Anthropic/Groq/OpenAI SDKs
