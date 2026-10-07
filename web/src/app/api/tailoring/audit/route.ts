import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { careerOpsRoot } from "@/lib/career-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AI_PHRASES = [
  "delve", "tapestry", "testament to", "leveraged cutting-edge", "dynamic landscape",
  "results-driven professional", "seasoned professional", "meticulous attention to detail",
  "passionate about leveraging", "proven track record", "synergy", "spearheaded",
];
const STOP = new Set("the a an and or to of in for with on at by from is are be as this that will you your our we they their role work team experience years preferred required qualifications skills about into using use who what how".split(" "));

type FactResult = {
  verdict: "pass" | "warn" | "block";
  invented: string[];
  unsupportedFacts: Array<{ kind: string; value: string }>;
  forbidden: string[];
  warnings: string[];
  coverage?: { reason?: string } | null;
};

function words(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z0-9+#.-]{2,}/g) || [])
    .map((word) => word.replace(/[.-]+$/g, ""))
    .filter((word) => word.length >= 3 && !STOP.has(word));
}

function keywordAudit(jobDescription: string, tailored: string) {
  const frequency = new Map<string, number>();
  for (const word of words(jobDescription)) frequency.set(word, (frequency.get(word) || 0) + 1);
  const important = [...frequency.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24).map(([word]) => word);
  const resume = new Set(words(tailored));
  const matched = important.filter((word) => resume.has(word));
  return { important, matched, missing: important.filter((word) => !resume.has(word)), coverage: important.length ? Math.round((matched.length / important.length) * 100) : 0 };
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as { tailored?: string; jobDescription?: string };
    const tailored = String(body.tailored || "").trim();
    if (!tailored) return Response.json({ error: "Tailored resume is required" }, { status: 400 });
    const root = careerOpsRoot();
    const source = path.join(root, "cv.md");
    if (!fs.existsSync(source)) return Response.json({ error: "Add your master resume in CV first" }, { status: 409 });
    const modulePath = pathToFileURL(path.join(root, "verify-cv-facts.mjs")).href;
    const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<{ verifyFacts: (text: string, options: object) => FactResult }>;
    const { verifyFacts } = await dynamicImport(modulePath);
    const facts = verifyFacts(tailored, { sourcePaths: [source], configPath: path.join(root, "config", "cv-facts.json"), cwd: root });
    const lower = tailored.toLowerCase();
    const styleFlags = AI_PHRASES.filter((phrase) => lower.includes(phrase));
    const sections = ["experience", "education", "skills"].map((name) => ({ name, present: new RegExp(`(^|\\n)#{0,3}\\s*${name}\\b`, "i").test(tailored) }));
    const keywords = keywordAudit(String(body.jobDescription || ""), tailored);
    const verdict = facts.verdict === "block" ? "block" : styleFlags.length || sections.some((section) => !section.present) ? "review" : "pass";
    return Response.json({ verdict, facts, styleFlags, sections, keywords });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "audit failed" }, { status: 500 });
  }
}
