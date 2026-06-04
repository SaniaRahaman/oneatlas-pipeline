import { NextRequest, NextResponse } from "next/server";
import { getJob } from "@/lib/store";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  const job = getJob(jobId);

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({
    jobId: job.jobId,
    status: job.status,
    prompt: job.prompt,
    createdAt: job.createdAt,
    appIntent: job.appIntent,
    dataSchema: job.dataSchema,
    appSpec: job.appSpec,
    stages: job.stages.map((s) => ({
      stage: s.stage,
      status: s.status,
      latencyMs: s.latencyMs,
      tokensUsed: s.tokensUsed,
      estimatedCostUsd: s.estimatedCostUsd,
      model: s.model,
      repairLogs: s.repairLogs,
      error: s.error,
    })),
    totalCostUsd: job.totalCostUsd,
    totalLatencyMs: job.totalLatencyMs,
  });
}
