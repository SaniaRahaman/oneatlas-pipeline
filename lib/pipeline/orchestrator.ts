import { v4 as uuidv4 } from "uuid";
import { Job, SSEEvent } from "@/types";
import { setJob, updateJob, getJob } from "@/lib/store";
import { extractIntent } from "./stage1-intent";
import { generateSchema } from "./stage2-schema";
import { generateAppSpec } from "./stage3-appspec";

export function createJob(prompt: string): Job {
  const job: Job = {
    jobId: uuidv4(),
    prompt,
    status: "pending",
    createdAt: new Date().toISOString(),
    stages: [],
    totalCostUsd: 0,
    totalLatencyMs: 0,
    events: [],
  };
  setJob(job);
  return job;
}

function pushEvent(jobId: string, event: SSEEvent) {
  const job = getJob(jobId);
  if (!job) return;
  updateJob(jobId, { events: [...job.events, event] });
}

export async function runPipeline(jobId: string): Promise<void> {
  updateJob(jobId, { status: "running" });
  const startTime = Date.now();

  // ── STAGE 1: Intent Extraction ──────────────────────────
  pushEvent(jobId, {
    type: "stage_start",
    stage: "intent_extraction",
    timestamp: new Date().toISOString(),
  });

  let intent;
  const s1Start = Date.now();
  try {
    const s1 = await extractIntent(getJob(jobId)!.prompt);
    const s1Latency = Date.now() - s1Start;
    intent = s1.intent;

    const stage1Result = {
      stage: "intent_extraction",
      status: "complete" as const,
      output: intent,
      latencyMs: s1Latency,
      tokensUsed: s1.tokensUsed,
      estimatedCostUsd: s1.costUsd,
      model: s1.model,
      repairLogs: s1.repairLogs,
    };

    const job = getJob(jobId)!;
    updateJob(jobId, {
      appIntent: intent,
      stages: [...job.stages, stage1Result],
      totalCostUsd: job.totalCostUsd + s1.costUsd,
    });

    pushEvent(jobId, {
      type: "stage_complete",
      stage: "intent_extraction",
      timestamp: new Date().toISOString(),
      data: intent,
      repairLog: s1.repairLogs,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    const job = getJob(jobId)!;
    updateJob(jobId, {
      status: "failed",
      stages: [
        ...job.stages,
        {
          stage: "intent_extraction",
          status: "failed",
          error: errMsg,
          latencyMs: Date.now() - s1Start,
          tokensUsed: 0,
          estimatedCostUsd: 0,
          model: "unknown",
          repairLogs: [],
        },
      ],
    });
    pushEvent(jobId, {
      type: "stage_failed",
      stage: "intent_extraction",
      timestamp: new Date().toISOString(),
      error: errMsg,
    });
    pushEvent(jobId, {
      type: "generation_failed",
      timestamp: new Date().toISOString(),
      error: errMsg,
    });
    return;
  }

  // ── STAGE 2: Schema Generation ──────────────────────────
  pushEvent(jobId, {
    type: "stage_start",
    stage: "schema_generation",
    timestamp: new Date().toISOString(),
  });

  let dataSchema;
  const s2Start = Date.now();
  try {
    const s2 = await generateSchema(intent);
    const s2Latency = Date.now() - s2Start;
    dataSchema = s2.dataSchema;

    const job = getJob(jobId)!;
    updateJob(jobId, {
      dataSchema,
      stages: [
        ...job.stages,
        {
          stage: "schema_generation",
          status: "complete",
          output: dataSchema,
          latencyMs: s2Latency,
          tokensUsed: s2.tokensUsed,
          estimatedCostUsd: s2.costUsd,
          model: s2.model,
          repairLogs: s2.repairLogs,
        },
      ],
      totalCostUsd: job.totalCostUsd + s2.costUsd,
    });

    pushEvent(jobId, {
      type: "stage_complete",
      stage: "schema_generation",
      timestamp: new Date().toISOString(),
      data: dataSchema,
      repairLog: s2.repairLogs,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    const job = getJob(jobId)!;
    updateJob(jobId, {
      status: "failed",
      stages: [
        ...job.stages,
        {
          stage: "schema_generation",
          status: "failed",
          error: errMsg,
          latencyMs: Date.now() - s2Start,
          tokensUsed: 0,
          estimatedCostUsd: 0,
          model: "unknown",
          repairLogs: [],
        },
      ],
    });
    pushEvent(jobId, { type: "stage_failed", stage: "schema_generation", timestamp: new Date().toISOString(), error: errMsg });
    pushEvent(jobId, { type: "generation_failed", timestamp: new Date().toISOString(), error: errMsg });
    return;
  }

  // ── STAGE 3: AppSpec Generation ─────────────────────────
  pushEvent(jobId, {
    type: "stage_start",
    stage: "app_spec_generation",
    timestamp: new Date().toISOString(),
  });

  const s3Start = Date.now();
  try {
    const s3 = await generateAppSpec(intent, dataSchema);
    const s3Latency = Date.now() - s3Start;

    const job = getJob(jobId)!;
    const totalLatency = Date.now() - startTime;

    updateJob(jobId, {
      appSpec: s3.appSpec,
      status: "complete",
      totalLatencyMs: totalLatency,
      stages: [
        ...job.stages,
        {
          stage: "app_spec_generation",
          status: "complete",
          output: s3.appSpec,
          latencyMs: s3Latency,
          tokensUsed: s3.tokensUsed,
          estimatedCostUsd: s3.costUsd,
          model: s3.model,
          repairLogs: s3.repairLogs,
        },
      ],
      totalCostUsd: job.totalCostUsd + s3.costUsd,
    });

    pushEvent(jobId, {
      type: "stage_complete",
      stage: "app_spec_generation",
      timestamp: new Date().toISOString(),
      data: s3.appSpec,
      repairLog: s3.repairLogs,
    });

    pushEvent(jobId, {
      type: "generation_complete",
      timestamp: new Date().toISOString(),
      data: { appIntent: intent, dataSchema, appSpec: s3.appSpec },
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    const job = getJob(jobId)!;
    updateJob(jobId, {
      status: "failed",
      stages: [
        ...job.stages,
        {
          stage: "app_spec_generation",
          status: "failed",
          error: errMsg,
          latencyMs: Date.now() - s3Start,
          tokensUsed: 0,
          estimatedCostUsd: 0,
          model: "unknown",
          repairLogs: [],
        },
      ],
    });
    pushEvent(jobId, { type: "stage_failed", stage: "app_spec_generation", timestamp: new Date().toISOString(), error: errMsg });
    pushEvent(jobId, { type: "generation_failed", timestamp: new Date().toISOString(), error: errMsg });
  }
}
