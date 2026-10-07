import path from "node:path";
import { pathToFileURL } from "node:url";
import { careerOpsRoot } from "./career-ops";

type ApprovedResume = {
  path: string;
  record: { pdf_sha256: string; application: { url: string }; run: string };
  upload: { name: string; mimeType: string; buffer: Buffer };
};

export async function approvedResume(url: string, expectedUrl?: string): Promise<ApprovedResume> {
  const root = careerOpsRoot();
  // Core runs from the local checkout, not a bundled copy with a different hash.
  const core = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ pathToFileURL(path.join(root, "lib/resume-pipeline/approval.mjs")).href);
  const approved = core.requireApproval(root, url) as ApprovedResume;
  if (expectedUrl) {
    const expected = core.requireApproval(root, expectedUrl) as ApprovedResume;
    if (expected.record.pdf_sha256 !== approved.record.pdf_sha256 || expected.record.application.url !== approved.record.application.url || expected.record.run !== approved.record.run) {
      throw new Error("The browser is no longer on the approved job. Stop and review the destination.");
    }
  }
  return approved;
}
