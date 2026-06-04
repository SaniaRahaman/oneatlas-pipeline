import { NextRequest } from "next/server";
import { getJob } from "@/lib/store";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (event: string, data: unknown) => {
        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(payload));
      };

      let lastEventIndex = 0;
      let attempts = 0;
      const maxAttempts = 120; // 2 minutes max

      const poll = async () => {
        attempts++;
        const job = getJob(jobId);

        if (!job) {
          sendEvent("error", { message: "Job not found" });
          controller.close();
          return;
        }

        // Replay any new events
        const newEvents = job.events.slice(lastEventIndex);
        for (const event of newEvents) {
          sendEvent(event.type, event);
          lastEventIndex++;
        }

        // Check if done
        if (job.status === "complete" || job.status === "failed" || attempts >= maxAttempts) {
          controller.close();
          return;
        }

        // Keep polling
        await new Promise((r) => setTimeout(r, 500));
        await poll();
      };

      await poll();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
