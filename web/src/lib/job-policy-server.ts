import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as yaml from "js-yaml";
import { careerOpsRoot } from "@/lib/career-ops";

export type PolicyResult = {
  decision: "apply" | "review" | "block";
  can_auto_apply: boolean;
  referral: { status: "clear" | "review" | "blocked"; family: string | null; reason: string };
  location: { status: string; reason: string };
  immigration: { status: string; work_now: string; stem_extension: string; future_sponsorship: string; signals: Array<{ code: string; level: string; evidence: string }>; reason: string };
  early_career: { status: string; reason: string };
  reasons: string[];
  policy_version: number;
};

type PolicyModule = {
  mergeJobPolicy: (input?: unknown) => Record<string, unknown>;
  evaluateJobPolicy: (job: Record<string, unknown>, policy?: unknown) => PolicyResult;
  classifyReferralProtection: (job: Record<string, unknown>, policy?: unknown) => PolicyResult["referral"];
};

async function policyModule(): Promise<PolicyModule> {
  const file = path.join(careerOpsRoot(), "lib", "job-policy.mjs");
  // Keep the selected Career Command Center root runtime-configurable. The
  // indirection prevents Next from bundling a user-selected checkout.
  const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<PolicyModule>;
  return dynamicImport(pathToFileURL(file).href);
}

export async function readJobPolicy(): Promise<Record<string, unknown>> {
  const mod = await policyModule();
  const file = path.join(careerOpsRoot(), "config", "job-policy.yml");
  let configured: unknown = {};
  try {
    configured = yaml.load(fs.readFileSync(file, "utf8")) || {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return mod.mergeJobPolicy(configured);
}

export async function evaluatePolicy(job: Record<string, unknown>): Promise<PolicyResult> {
  const [mod, policy] = await Promise.all([policyModule(), readJobPolicy()]);
  return mod.evaluateJobPolicy(job, policy);
}

export async function referralGate(job: Record<string, unknown>): Promise<PolicyResult["referral"]> {
  const [mod, policy] = await Promise.all([policyModule(), readJobPolicy()]);
  return mod.classifyReferralProtection(job, policy);
}
