import path from "node:path";
import { pathToFileURL } from "node:url";
import { careerOpsRoot } from "./career-ops";

async function core() {
  return import(/* webpackIgnore: true */ /* turbopackIgnore: true */ pathToFileURL(path.join(careerOpsRoot(), "lib/resume-pipeline/web.mjs")).href);
}
export async function managedResumePreview(report: string): Promise<{ path: string; status: string } | null> {
  return (await core()).previewReport(careerOpsRoot(), report);
}
export function runResume(input: string, allowModelCalls: boolean): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (value: object) => { try { controller.enqueue(encoder.encode(JSON.stringify(value) + "\n")); } catch { /* disconnected; core still records the result */ } };
      send({ type: "status", label: "Checking fact bank, master layout and model configuration" });
      try {
        const result = await (await core()).prepareReport(careerOpsRoot(), input, allowModelCalls);
        send({ type: "text", text: `Review packet: ${result.packet}\nApplication: ${result.application}\nRun: ${result.run}\nWinner: ${result.winner || "human review required"}\nNo uploads or submissions performed.\n` });
        if (result.status !== "awaiting_approval") send({ type: "error", msg: result.error || "Independent reviewers disagree; inspect the packet and select explicitly." });
        else { send({ type: "status", label: "Draft ready for review; explicit approval required before filling" }); send({ type: "done" }); }
      } catch (e) { send({ type: "error", msg: e instanceof Error ? e.message : "Resume preparation failed" }); }
      finally { try { controller.close(); } catch { /* disconnected */ } }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
