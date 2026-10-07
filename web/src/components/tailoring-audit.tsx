"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, ScanText, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Audit = {
  verdict: "pass" | "review" | "block";
  facts: { verdict: string; invented: string[]; unsupportedFacts: Array<{ kind: string; value: string }>; forbidden: string[]; warnings: string[]; coverage?: { reason?: string } | null };
  styleFlags: string[];
  sections: Array<{ name: string; present: boolean }>;
  keywords: { coverage: number; matched: string[]; missing: string[] };
};

export function TailoringAudit() {
  const [master, setMaster] = useState("");
  const [jd, setJd] = useState("");
  const [tailored, setTailored] = useState("");
  const [audit, setAudit] = useState<Audit | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => { void fetch("/api/cv").then((r) => r.json()).then((d) => setMaster(d.content || "")); }, []);

  async function runAudit() {
    setLoading(true); setError(""); setAudit(null);
    try {
      const response = await fetch("/api/tailoring/audit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tailored, jobDescription: jd }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Audit failed");
      setAudit(data);
    } catch (e) { setError(e instanceof Error ? e.message : "Audit failed"); }
    finally { setLoading(false); }
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div><h1 className="font-display text-2xl text-landing">Resume Audit</h1><p className="mt-1 text-sm text-muted">Compare a tailored draft against your master resume and the target role.</p></div>
        <Button onClick={runAudit} disabled={loading || !tailored.trim()}>{loading ? <Loader2 className="size-4 animate-spin" /> : <ScanText className="size-4" />}Audit draft</Button>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section><label className="mb-2 block text-xs font-semibold uppercase text-muted">Job description</label><textarea value={jd} onChange={(e) => setJd(e.target.value)} className="min-h-72 w-full resize-y rounded-md border border-border bg-surface p-3 text-sm outline-none focus:ring-2 focus:ring-brand/40" placeholder="Paste the target job description" /></section>
        <section><label className="mb-2 block text-xs font-semibold uppercase text-muted">Tailored resume</label><textarea value={tailored} onChange={(e) => setTailored(e.target.value)} className="min-h-72 w-full resize-y rounded-md border border-border bg-surface p-3 font-mono text-sm outline-none focus:ring-2 focus:ring-brand/40" placeholder="Paste the tailored Markdown or text" /></section>
      </div>

      <details className="mt-5 border-y border-border py-3"><summary className="cursor-pointer text-sm font-medium">Master resume source ({master ? `${master.length.toLocaleString()} characters loaded` : "not loaded"})</summary><pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap bg-surface p-3 text-xs text-muted">{master || "Add your resume on the CV page."}</pre></details>
      {error && <p className="mt-5 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
      {audit && <AuditResults audit={audit} />}
    </main>
  );
}

function AuditResults({ audit }: { audit: Audit }) {
  const Icon = audit.verdict === "pass" ? CheckCircle2 : audit.verdict === "block" ? ShieldAlert : AlertTriangle;
  const tone = audit.verdict === "pass" ? "good" : audit.verdict === "block" ? "bad" : "warn";
  return (
    <section className="mt-7 border-t border-border pt-6">
      <div className="flex items-center gap-2"><Icon className="size-5" /><h2 className="text-lg font-semibold">Audit result</h2><Badge tone={tone}>{audit.verdict}</Badge></div>
      <div className="mt-5 grid gap-6 md:grid-cols-3">
        <div><h3 className="text-sm font-semibold">Factual integrity</h3><p className="mt-2 text-sm text-muted">Source check: {audit.facts.verdict}</p>{audit.facts.invented.map((item) => <p key={item} className="mt-1 text-xs text-red-600">Unsupported metric: {item}</p>)}{audit.facts.unsupportedFacts.map((item) => <p key={`${item.kind}-${item.value}`} className="mt-1 text-xs text-red-600">Unsupported {item.kind}: {item.value}</p>)}</div>
        <div><h3 className="text-sm font-semibold">Natural language</h3><p className="mt-2 text-sm text-muted">{audit.styleFlags.length ? `${audit.styleFlags.length} phrase${audit.styleFlags.length === 1 ? "" : "s"} to revise` : "No canned AI phrases found"}</p>{audit.styleFlags.map((item) => <Badge key={item} tone="warn" className="mr-1 mt-2">{item}</Badge>)}</div>
        <div><h3 className="text-sm font-semibold">Role keywords</h3><p className="mt-2 text-2xl font-semibold tabular-nums">{audit.keywords.coverage}%</p><p className="text-xs text-muted">Top-description keyword coverage</p><div className="mt-2 flex flex-wrap gap-1">{audit.keywords.missing.slice(0, 10).map((item) => <Badge key={item}>{item}</Badge>)}</div></div>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">{audit.sections.map((section) => <Badge key={section.name} tone={section.present ? "good" : "bad"}>{section.name}: {section.present ? "present" : "missing"}</Badge>)}</div>
    </section>
  );
}
