import { NextRequest, NextResponse } from "next/server";
import { createJob, runPipeline } from "@/lib/pipeline/orchestrator";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const prompt = body?.prompt?.trim();

    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }

    const job = createJob(prompt);

    // Run pipeline in background (don't await)
    runPipeline(job.jobId).catch(console.error);

    return NextResponse.json({ jobId: job.jobId }, { status: 202 });
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}
