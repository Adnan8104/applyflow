import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyImmigrationLanguage,
  classifyReferralProtection,
  classifyUsLocation,
  evaluateJobPolicy,
} from "../lib/job-policy.mjs";

test("current US authorization wording remains eligible", () => {
  const result = classifyImmigrationLanguage("Candidates must be authorized to work in the United States.");
  assert.equal(result.status, "apply");
  assert.equal(result.work_now, "likely");
  assert.equal(result.future_sponsorship, "unknown");
});

test("future sponsorship restriction warns but does not reject", () => {
  const result = classifyImmigrationLanguage("Applicants must not require sponsorship now or in the future.");
  assert.equal(result.status, "apply_with_caution");
  assert.equal(result.future_sponsorship, "unlikely");
});

test("unstated sponsorship stays eligible", () => {
  const result = classifyImmigrationLanguage("Build reliable services with Python and PostgreSQL.");
  assert.equal(result.status, "apply");
  assert.equal(result.future_sponsorship, "unknown");
});

// Found while live-verifying this classifier 2026-09-21: "does not offer visa
// sponsorship" contains the bare substring "visa sponsorship", which used to
// match the POSITIVE sponsorship_offered pattern with no regard for the
// negation three words earlier — the exact opposite of what the sentence
// says. sponsorship_offered now carries a negative lookbehind for a nearby
// negation word; sponsorship_unavailable was widened to reach through
// "offer"/"provide" and "visa" so it fires here instead.
test("a negated 'offer visa sponsorship' is read as unavailable, not offered", () => {
  const result = classifyImmigrationLanguage("This role does not offer visa sponsorship.");
  assert.deepEqual(result.signals.map((s) => s.code), ["sponsorship_unavailable"]);
  assert.equal(result.status, "apply_with_caution");
  assert.equal(result.future_sponsorship, "unlikely");
});

test("a genuine sponsorship offer still matches positively", () => {
  const result = classifyImmigrationLanguage("Sponsorship is available for this role.");
  assert.deepEqual(result.signals.map((s) => s.code), ["sponsorship_offered"]);
  assert.equal(result.future_sponsorship, "likely");
});

// Also found live 2026-09-21: opt_explicitly_accepted required the level word
// directly before accepted/eligible/welcome with no copula, so "OPT or CPT
// ARE welcome" (a very ordinary phrasing) fell through silently. Widened to
// allow an optional is/are, and added the reversed "we accept ... OPT/CPT"
// direction of the same statement.
test("OPT/CPT acceptance is recognized with a copula or in the reversed 'we accept' phrasing", () => {
  const withCopula = classifyImmigrationLanguage("Candidates on OPT or CPT are welcome to apply.");
  assert.deepEqual(withCopula.signals.map((s) => s.code), ["opt_explicitly_accepted"]);

  const reversed = classifyImmigrationLanguage("We accept candidates on OPT or CPT.");
  assert.deepEqual(reversed.signals.map((s) => s.code), ["opt_explicitly_accepted"]);

  // Found live 2026-09-22: the reversed branch covered accept/accepts/accepted
  // but not "welcome", so "We welcome candidates on OPT and CPT" — the warmest
  // possible phrasing of this signal — scored as no signal at all.
  const welcomes = classifyImmigrationLanguage("We welcome candidates on OPT and CPT.");
  assert.deepEqual(welcomes.signals.map((s) => s.code), ["opt_explicitly_accepted"]);
  assert.equal(welcomes.work_now, "likely");
});

// Found live 2026-09-22: citizenship_or_pr_required matched only the trailing
// form ("U.S. citizens only", "green card required"), so the far more common
// leading form — "Must be a U.S. citizen or permanent resident" — produced NO
// signal and a clean `apply` status. For an F-1 candidate that is the single
// most consequential hard block on a posting, so silence there is the
// expensive failure direction.
test("citizenship/PR requirements are caught with the requirement word on either side", () => {
  for (const text of [
    "Must be a U.S. citizen or permanent resident.",
    "Must be a US citizen.",
    "Applicants must have a green card holder status.",
    "This role requires a permanent resident.",
  ]) {
    const r = classifyImmigrationLanguage(text);
    assert.ok(
      r.signals.some((s) => s.code === "citizenship_or_pr_required"),
      `leading-form citizenship requirement not detected: ${text}`,
    );
    assert.equal(r.work_now, "unlikely", `work_now should be unlikely for: ${text}`);
  }

  // The original trailing form must keep working.
  for (const text of ["U.S. citizens only.", "Green card required."]) {
    assert.ok(
      classifyImmigrationLanguage(text).signals.some((s) => s.code === "citizenship_or_pr_required"),
      `trailing-form citizenship requirement regressed: ${text}`,
    );
  }

  // Must not fire on an ordinary work-authorization line, which is a different
  // (and for this candidate, survivable) statement.
  const authOnly = classifyImmigrationLanguage("Must be authorized to work in the United States.");
  assert.ok(!authOnly.signals.some((s) => s.code === "citizenship_or_pr_required"));
});

test("Amazon Jobs and DeepMind are referral hard blocks", () => {
  assert.equal(classifyReferralProtection({ company: "Amazon.com Services LLC", url: "https://amazon.jobs/en/jobs/123" }).status, "blocked");
  assert.equal(classifyReferralProtection({ company: "Amazon Web Services, Inc.", url: "https://example.com/job/123" }).status, "blocked");
  assert.equal(classifyReferralProtection({ company: "Google DeepMind", url: "https://deepmind.google/careers/123" }).status, "blocked");
});

test("personal employer exclusions are referral hard blocks", () => {
  const blocked = [
    { company: "PepsiCo, Inc.", url: "https://www.pepsicojobs.com/main/jobs/123" },
    { company: "Phenom People", url: "https://careers.phenom.com/us/en/job/123" },
    { company: "Computer Aid, Inc.", url: "https://www.cai.io/careers/job/123" },
    { company: "CAI", url: "https://example.com/jobs/123" },
    { company: "Lutron Electronics Co., Inc.", url: "https://careers.lutron.com/job/123" },
    { company: "EY", url: "https://careers.ey.com/job/123" },
    { company: "EY-Parthenon", url: "https://example.com/jobs/123" },
    { company: "The Parthenon Group", url: "https://example.com/jobs/456" },
  ];

  for (const job of blocked) {
    assert.equal(classifyReferralProtection(job).status, "blocked", `${job.company} should be blocked`);
  }
});

test("a third-party career site hosted by Phenom is not blocked by its URL alone", () => {
  const result = classifyReferralProtection({
    company: "Unrelated Manufacturing Company",
    url: "https://jobs.phenompeople.com/unrelated/job/123",
  });
  assert.equal(result.status, "clear");
});

test("unrelated names containing a protected brand are not blocked", () => {
  assert.equal(classifyReferralProtection({ company: "Amazon Conservation Association", url: "https://example.org/jobs/123" }).status, "clear");
});

test("Twitch and Mobileye require referral review", () => {
  assert.equal(classifyReferralProtection({ company: "Twitch Interactive, Inc.", url: "https://careers.twitch.com/jobs/123" }).status, "review");
  assert.equal(classifyReferralProtection({ company: "Mobileye", url: "https://careers.mobileye.com/jobs/123" }).status, "review");
});

test("Altera is explicitly outside Intel referral protection", () => {
  assert.equal(classifyReferralProtection({ company: "Altera Corporation", url: "https://www.altera.com/careers/123" }).status, "clear");
});

test("US state and US remote locations pass", () => {
  assert.equal(classifyUsLocation("New York, NY").status, "eligible");
  assert.equal(classifyUsLocation("Remote, United States").status, "eligible");
  assert.equal(classifyUsLocation("Toronto, Canada").status, "blocked");
});

test("ordinary lowercase us is not interpreted as the United States", () => {
  assert.equal(classifyUsLocation("Join us remotely from Europe").status, "review");
});

test("foreign location remains blocked even for a senior title", () => {
  const result = evaluateJobPolicy({ company: "Acme", title: "Senior Engineer", location: "Toronto, Canada", description: "" });
  assert.equal(result.decision, "block");
});

test("referral protection outranks broad apply", () => {
  const result = evaluateJobPolicy({
    company: "IMDb",
    title: "Software Engineer I",
    location: "Seattle, WA",
    url: "https://amazon.jobs/en/jobs/123",
    description: "Must be authorized to work in the United States.",
  });
  assert.equal(result.decision, "block");
  assert.equal(result.can_auto_apply, false);
});

test("visa warning remains auto-apply eligible for an ordinary US employer", () => {
  const result = evaluateJobPolicy({
    company: "Acme Analytics",
    title: "New Grad Software Engineer",
    location: "Austin, TX",
    url: "https://boards.greenhouse.io/acme/jobs/123",
    description: "We cannot sponsor now or in the future.",
  });
  assert.equal(result.decision, "apply");
  assert.equal(result.can_auto_apply, true);
  assert.equal(result.immigration.status, "apply_with_caution");
});
