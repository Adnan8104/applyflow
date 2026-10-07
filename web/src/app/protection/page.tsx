import { ShieldCheck, ShieldAlert, Clock3, BriefcaseBusiness } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { readJobPolicy } from "@/lib/job-policy-server";

export const dynamic = "force-dynamic";

type Group = { family: string; names: string[]; domains: string[] };

export default async function ProtectionPage() {
  const policy = await readJobPolicy() as unknown as {
    search: { countries: string[]; graduation_date: string; max_years_experience: number };
    immigration: { status: string; initial_opt_months: number; stem_extension_months: number; never_reject_for_sponsorship_language: boolean };
    referral_protection: { hard_block: Group[]; review: Group[]; allow: Group[] };
  };
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-7"><div className="flex items-center gap-2"><ShieldCheck className="size-6 text-emerald-600" /><h1 className="font-display text-2xl text-landing">Protection</h1></div><p className="mt-1 text-sm text-muted">Rules enforced during discovery and again before an application opens.</p></div>
      <section className="grid gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-4">
        <Status label="Search market" value={policy.search.countries.join(", ")} icon={<BriefcaseBusiness className="size-4" />} />
        <Status label="Graduation" value="May 2027" icon={<Clock3 className="size-4" />} />
        <Status label="Work status" value={policy.immigration.status} icon={<ShieldCheck className="size-4" />} />
        <Status label="OPT window" value={`${policy.immigration.initial_opt_months + policy.immigration.stem_extension_months} months`} icon={<Clock3 className="size-4" />} />
      </section>
      <section className="mt-8"><h2 className="text-lg font-semibold">Decision rules</h2><div className="mt-3 divide-y divide-border border-y border-border text-sm"><Rule tone="good" label="Apply" text="US roles with missing or ambiguous sponsorship language, including authorization wording that does not say now or in the future." /><Rule tone="warn" label="Review" text="Unknown locations, senior roles, and separately operated subsidiaries where referral coverage may depend on the exact requisition." /><Rule tone="bad" label="Block" text="Roles outside the US and direct applications in protected Amazon, Google, Meta, and Intel recruiting systems." /></div></section>
      <CompanySection title="Hard block" tone="bad" groups={policy.referral_protection.hard_block} />
      <CompanySection title="Referral review" tone="warn" groups={policy.referral_protection.review} />
      <CompanySection title="Explicitly clear" tone="good" groups={policy.referral_protection.allow} />
      <p className="mt-8 flex items-start gap-2 border-t border-border pt-4 text-xs text-muted"><ShieldAlert className="mt-0.5 size-4 shrink-0" />Application answers must remain truthful. This policy changes routing, not your legal status or an employer&apos;s eligibility decision.</p>
    </main>
  );
}

function Status({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) { return <div className="bg-surface p-4"><div className="flex items-center gap-2 text-xs text-muted">{icon}{label}</div><p className="mt-1 text-sm font-semibold">{value}</p></div>; }
function Rule({ tone, label, text }: { tone: "good" | "warn" | "bad"; label: string; text: string }) { return <div className="flex gap-3 py-3"><Badge tone={tone} className="h-fit">{label}</Badge><p className="text-muted">{text}</p></div>; }
function CompanySection({ title, tone, groups }: { title: string; tone: "good" | "warn" | "bad"; groups: Group[] }) { return <section className="mt-8"><h2 className="text-lg font-semibold">{title}</h2><div className="mt-3 grid gap-3 md:grid-cols-2">{groups.map((group) => <div key={`${title}-${group.family}`} className="rounded-md border border-border bg-surface p-4"><div className="flex items-center justify-between"><h3 className="font-semibold">{group.family}</h3><Badge tone={tone}>{title}</Badge></div><p className="mt-2 text-xs leading-5 text-muted">{group.names.join(" · ")}</p></div>)}</div></section>; }
