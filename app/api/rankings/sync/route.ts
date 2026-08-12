import { NextRequest, NextResponse } from "next/server";
import { syncRankingsForDraft } from "@/lib/fantasypros/sync";

const bodySchemaKey = "draftId";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const draftId = body?.[bodySchemaKey];

  if (typeof draftId !== "string" || draftId.length === 0) {
    return NextResponse.json({ ok: false, message: "draftId is required" }, { status: 400 });
  }

  const result = await syncRankingsForDraft(draftId);

  if (!result.ok) {
    const status = result.reason === "not_found" ? 404 : 502;
    return NextResponse.json(result, { status });
  }

  return NextResponse.json(result);
}
