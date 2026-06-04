import { NextResponse } from "next/server";
import { INTEGRATION_REGISTRY } from "@/lib/integrations/registry";

export async function GET() {
  return NextResponse.json({ integrations: INTEGRATION_REGISTRY });
}
