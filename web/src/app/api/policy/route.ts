import { evaluatePolicy, readJobPolicy } from "@/lib/job-policy-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json({ policy: await readJobPolicy() });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "could not read policy" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    return Response.json({ result: await evaluatePolicy(body?.job || {}) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "could not evaluate job" }, { status: 400 });
  }
}
