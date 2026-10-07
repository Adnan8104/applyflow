import { openSession } from "@/lib/apply/session";
import { evaluatePolicy, referralGate } from "@/lib/job-policy-server";
import { readInbox } from "@/lib/career-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // the agentic drive + interpretation fallbacks spawn a planner

// Open a persistent apply session: headed-but-off-screen Chrome opens the real
// form, we extract + tag its fields. The session stays open for fill + handoff.
// cliId enables the agentic fallback (the AI interprets the live form) when
// deterministic extraction is low-confidence.
export async function POST(req: Request) {
  let body: { url?: string; company?: string; cliId?: string; agent?: boolean; _noApplyBtn?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const url = (body.url ?? "").trim();
  if (!/^https?:\/\//i.test(url)) return Response.json({ error: "A valid application URL (https://…) is required" }, { status: 400 });
  try {
    const referral = await referralGate({ url, company: body.company || "" });
    if (referral.status !== "clear") {
      const action = referral.status === "blocked" ? "Use your referral before opening this application." : "Confirm this exact job ID with your referrer first.";
      return Response.json({ error: `${referral.family || "Protected company"}: ${action}`, policy: { referral } }, { status: 409 });
    }
    const queued = readInbox().find((job) => job.url === url);
    if (queued) {
      const policy = await evaluatePolicy({ url, company: queued.company, title: queued.role, location: queued.location || "", description: "" });
      if (policy.decision !== "apply") {
        return Response.json({ error: `Application paused for review: ${policy.reasons.join("; ")}`, policy }, { status: 409 });
      }
    }
    const session = await openSession(url, body.cliId, body.agent, body._noApplyBtn);
    return Response.json(session);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message.slice(0, 200) : "could not open the form" }, { status: 500 });
  }
}
