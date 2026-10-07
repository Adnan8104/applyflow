import { fillSession, handoffSession, getSession } from "@/lib/apply/session";
import { approvedResume } from "@/lib/resume-approval";
import type { ApplyField } from "@/lib/apply/extract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Fill the real form behind the scenes (headed-but-off-screen), screenshotting
// each step for the "behind the scenes" strip, then bring the window to the front
// so the HUMAN reviews and submits. NEVER submits — there is no submit path here.
export async function POST(req: Request) {
  let body: { sessionId?: string; answers?: Record<string, string>; fields?: ApplyField[]; handoff?: boolean; company?: string; application?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const { sessionId, answers = {}, fields = [], handoff, company, application } = body;
  if (!sessionId) return Response.json({ error: "sessionId required" }, { status: 400 });
  if (company !== undefined && typeof company !== "string") {
    return Response.json({ error: "company must be a string" }, { status: 400 });
  }
  if (application !== undefined && typeof application !== "string") {
    return Response.json({ error: "application must be a string" }, { status: 400 });
  }

  const session = getSession(sessionId);
  try {
    if (!session) return Response.json({ error: "apply session not found" }, { status: 404 });
    const { path: cvPath } = await approvedResume(session.page.url(), session.url);
    const result = await fillSession(sessionId, answers, fields, cvPath);
    if (handoff) await handoffSession(sessionId).catch(() => {});
    return Response.json({ ...result, handedOff: !!handoff, cvAttached: result.steps.some(step => step.ok && step.label.includes("(CV attached)")) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message.slice(0, 200) : "fill failed" }, { status: 409 });
  }
}
