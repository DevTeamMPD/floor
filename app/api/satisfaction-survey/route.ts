import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/staff-server";
import { fetchGoogleSurvey, GOOGLE_SURVEY_SOURCE_URL } from "@/lib/evaluations/google-survey";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const staff = await getCurrentStaff();
  const hostname = new URL(request.url).hostname;
  const localPreview = hostname === "localhost" || hostname === "127.0.0.1";
  if (!staff && !localPreview) return NextResponse.json({ error: "unauthorized", questions: [], responses: [] }, { status: 401 });
  try {
    const data = await fetchGoogleSurvey();
    return NextResponse.json({
      questions: data.questions.map((question) => ({ id: question.id, order: question.order, label: question.label, shortLabel: question.shortLabel })),
      responses: data.responses,
      updatedAt: new Date().toISOString(),
      sourceUrl: GOOGLE_SURVEY_SOURCE_URL,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error), questions: [], responses: [] }, { status: 502 });
  }
}
