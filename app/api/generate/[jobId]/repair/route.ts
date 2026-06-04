import { NextRequest, NextResponse } from "next/server";
import { getJob, updateJob } from "@/lib/store";
import { llmRepair } from "@/lib/repair";
import { validateIntent, validateDataSchema, validateAppSpec } from "@/lib/validation";
import { getRegisteredIds } from "@/lib/integrations/registry";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  const job = getJob(jobId);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const body = await req.json();
  const { stage, errorHint } = body as { stage: string; errorHint?: string };

  const stageResult = job.stages.find((s) => s.stage === stage);
  if (!stageResult) return NextResponse.json({ error: "Stage not found" }, { status: 404 });

  // Validate current output
  let validation;
  const registeredIds = getRegisteredIds();

  if (stage === "intent_extraction") {
    validation = validateIntent(stageResult.output);
  } else if (stage === "schema_generation") {
    validation = validateDataSchema(stageResult.output);
  } else if (stage === "app_spec_generation" && job.dataSchema) {
    validation = validateAppSpec(stageResult.output, job.dataSchema, registeredIds);
  } else {
    return NextResponse.json({ error: "Cannot repair this stage" }, { status: 400 });
  }

  const errors = validation.valid
    ? [{ field: "hint", message: errorHint ?? "Manual repair requested", code: "manual" }]
    : validation.errors;

  const repairResult = await llmRepair(
    stage,
    job.prompt,
    JSON.stringify(stageResult.output),
    errors
  );

  // Update stage with repaired output
  const updatedStages = job.stages.map((s) =>
    s.stage === stage
      ? { ...s, output: repairResult.data, repairLogs: [...s.repairLogs, repairResult.log] }
      : s
  );

  updateJob(jobId, { stages: updatedStages });

  return NextResponse.json({
    repairLog: repairResult.log,
    repairedOutput: repairResult.data,
  });
}
