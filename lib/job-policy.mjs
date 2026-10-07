const LEGAL_SUFFIX = /\b(?:incorporated|corporation|corp|inc|llc|ltd|limited|plc|gmbh|company|co)\b\.?/gi;
const SPACE = /\s+/g;

export const DEFAULT_JOB_POLICY = Object.freeze({
  search: {
    countries: ["United States"],
    include_us_remote: true,
    graduation_date: "2027-05-15",
    max_years_experience: 2,
    keep_unknown_location_for_review: true,
  },
  immigration: {
    status: "F-1",
    initial_opt_months: 12,
    stem_extension_months: 24,
    future_sponsorship_likely: true,
    never_reject_for_sponsorship_language: true,
  },
  automation: {
    broad_apply: true,
    keep_all_decisions: true,
    block_unknown_referral_relationships: true,
  },
  referral_protection: {
    hard_block: [
      {
        family: "Amazon",
        names: [
          "amazon", "amazon.com", "amazon web services", "aws", "amazon ads",
          "amazon business", "amazon prime video", "amazon mgm studios", "imdb",
          "amazon music", "amazon games", "amazon lab126", "lab126", "amazon robotics",
          "amazon leo", "project kuiper", "ring", "blink", "amazon pharmacy",
        ],
        domains: ["amazon.jobs", "hiring.amazon.com", "jobs.amazon.com"],
      },
      {
        family: "Google",
        names: [
          "google", "google llc", "google cloud", "youtube", "google deepmind",
          "deepmind", "android", "chrome", "chromeos", "fitbit", "google nest",
          "google ai", "gemini",
        ],
        domains: ["careers.google.com", "google.com/about/careers", "deepmind.google"],
      },
      {
        family: "Meta",
        names: [
          "meta", "meta platforms", "facebook", "instagram", "whatsapp", "messenger",
          "threads", "meta ai", "meta superintelligence labs", "reality labs", "oculus",
          "meta quest", "meta horizon", "mapillary",
        ],
        domains: ["metacareers.com", "meta.com/careers"],
      },
      {
        family: "Intel",
        names: ["intel", "intel corporation", "intel foundry", "intel labs", "intel capital"],
        domains: ["jobs.intel.com", "intel.com/content/www/us/en/jobs"],
      },
      {
        family: "PepsiCo",
        names: ["pepsico", "pepsi co", "pepsico foods north america", "pepsico beverages north america"],
        domains: ["pepsicojobs.com"],
      },
      {
        family: "Phenom",
        names: ["phenom", "phenom people", "phenompeople"],
        // Do not block phenompeople.com: it hosts career sites for unrelated employers.
        domains: ["careers.phenom.com"],
      },
      {
        family: "Computer Aid, Inc.",
        names: ["computer aid", "computer aid inc", "cai"],
        domains: ["cai.io"],
      },
      {
        family: "Lutron",
        names: ["lutron", "lutron electronics", "lutron electronics co"],
        domains: ["careers.lutron.com"],
      },
      {
        family: "EY",
        names: [
          "ey", "ernst and young", "ernst young", "ey parthenon", "ey-parthenon",
          "parthenon ey", "the parthenon group", "parthenon group", "eyp",
        ],
        domains: ["careers.ey.com", "ey.com/en_us/careers"],
      },
    ],
    review: [
      {
        family: "Amazon",
        names: [
          "twitch", "twitch interactive", "audible", "whole foods market", "whole foods",
          "one medical", "zoox", "zappos", "woot", "goodreads", "abebooks", "wondery",
          "shopbop",
        ],
        domains: [
          "careers.twitch.com", "twitch.tv/jobs", "audiblecareers.com", "careers.wholefoodsmarket.com",
          "zoox.com/careers", "careers.onemedical.com",
        ],
      },
      {
        family: "Alphabet",
        names: ["waymo", "verily", "wing", "x the moonshot factory", "calico", "gfiber", "intrinsic", "isomorphic labs"],
        domains: ["waymo.com/careers", "verily.com/careers", "wing.com/careers", "x.company/careers"],
      },
      {
        family: "Intel",
        names: ["mobileye"],
        domains: ["careers.mobileye.com"],
      },
    ],
    allow: [
      { family: "Independent", names: ["altera"], domains: ["altera.com/careers"] },
    ],
  },
});

const US_STATE_CODES = new Set([
  "al", "ak", "az", "ar", "ca", "co", "ct", "de", "fl", "ga", "hi", "id", "il", "in", "ia",
  "ks", "ky", "la", "me", "md", "ma", "mi", "mn", "ms", "mo", "mt", "ne", "nv", "nh", "nj",
  "nm", "ny", "nc", "nd", "oh", "ok", "or", "pa", "ri", "sc", "sd", "tn", "tx", "ut", "vt",
  "va", "wa", "wv", "wi", "wy", "dc",
]);

const US_MARKERS = [
  /\bunited states\b/i,
  /\b(?:US|USA|U\.S\.|U\.S\.A\.)\b/,
  /\bremote\s*[-,()]?\s*(?:us|u\.s\.|usa|united states)\b/i,
];

const FOREIGN_MARKERS = [
  "canada", "united kingdom", "uk", "germany", "france", "spain", "india", "singapore",
  "australia", "mexico", "brazil", "japan", "china", "ireland", "netherlands", "poland",
];

const IMMIGRATION_PATTERNS = [
  // Negative lookbehind guards against "does not offer visa sponsorship" —
  // the bare "visa sponsorship" substring used to match here regardless of a
  // preceding negation (#found while verifying live 2026-09-21: this
  // misclassified an explicit non-sponsorship statement as an offer). Allows
  // up to 3 words between the negation and the phrase ("not currently able
  // to offer visa sponsorship"), so it also catches the padded phrasings
  // sponsorship_unavailable below is written to match.
  { code: "sponsorship_offered", level: "positive", rx: /(?<!\b(?:not|no|never|cannot|unable to|won'?t)\b(?:\s+\w+){0,3}\s+)\b(?:visa sponsorship|sponsorship (?:is )?available|will sponsor|immigration support|h-?1b sponsorship)\b/i },
  // Two directions of the same statement: "OPT/CPT {is/are} accepted/welcome"
  // and "we accept candidates on OPT/CPT". The first used to require the
  // level word directly before accepted/eligible/welcome with no copula, so
  // "OPT or CPT are welcome" (#found live 2026-09-21) fell through silently.
  { code: "opt_explicitly_accepted", level: "positive", rx: /\b(?:opt|cpt)(?:\s+(?:and|or)\s+(?:opt|cpt))?\s+(?:is\s+|are\s+)?(?:accepted|eligible|welcome)\b|\b(?:accept|welcome)(?:s|d|ed|ing)?\s+(?:candidates\s+)?(?:on\s+)?(?:opt|cpt)\b/i },
  { code: "everify_confirmed", level: "positive", rx: /\be-?verify\b/i },
  { code: "current_authorization_only", level: "positive", rx: /\b(?:must be|are you|legally)\s+(?:currently\s+)?authorized to work in (?:the )?(?:u\.?s\.?|united states)\b/i },
  { code: "future_sponsorship_restricted", level: "warning", rx: /\b(?:without|not require|do not need)\s+(?:company\s+)?sponsorship\s+(?:now\s+(?:or|and)\s+in the future|now or at any time in the future)\b/i },
  { code: "future_sponsorship_unavailable", level: "warning", rx: /\b(?:will not|cannot|unable to|do not)\s+(?:provide\s+)?sponsor(?:ship)?\s+(?:now\s+(?:or|and)\s+in the future|in the future)\b/i },
  // (?:offer|provide)?\s*(?:visa\s+)? lets this reach "does not OFFER VISA
  // sponsorship" — the plain "does not sponsor" case still matches with both
  // optional groups empty.
  { code: "sponsorship_unavailable", level: "warning", rx: /\b(?:no|without)\s+(?:visa\s+)?sponsorship\b|\bsponsorship (?:is )?not available\b|\b(?:cannot|unable to|do not|does not) (?:currently\s+)?(?:offer|provide)?\s*(?:visa\s+)?sponsor(?:ship)?\b/i },
  { code: "opt_not_accepted", level: "warning", rx: /\b(?:opt|cpt)\s+(?:is\s+)?not\s+(?:accepted|eligible)|\bno\s+(?:opt|cpt)\b/i },
  // Two shapes, because the requirement word can sit on either side of the
  // status. Trailing form: "U.S. citizens only", "green card required".
  // Leading form: "Must be a U.S. citizen or permanent resident" — the more
  // common phrasing, and the one the trailing-only pattern silently passed as
  // a clean `apply` (found live 2026-09-22). This is the highest-consequence
  // hard block for an F-1 candidate, so a miss here is the expensive kind.
  { code: "citizenship_or_pr_required", level: "warning", rx: /\b(?:u\.?s\.? citizen(?:ship)?|green card|permanent resident)(?:s)?\s+(?:only|required)\b|\b(?:must be|must have|require[sd]?)\s+(?:a\s+|an\s+)?(?:u\.?s\.?\s+citizen(?:ship)?|green card(?:\s+holder)?|permanent resident)/i },
  { code: "clearance_required", level: "warning", rx: /\b(?:active\s+)?(?:security|secret|top secret|ts\/sci) clearance\b/i },
];

const SENIOR_TITLE = /\b(?:senior|sr\.?|staff|principal|lead|manager|director|head|vp|vice president|architect)\b/i;
const EARLY_TITLE = /\b(?:new grad(?:uate)?|university grad(?:uate)?|entry[- ]level|junior|jr\.?|associate|intern(?:ship)?)\b/i;
const YEARS_RX = /\b(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?\+?\s+years?\b/gi;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function mergeJobPolicy(input = {}) {
  const base = clone(DEFAULT_JOB_POLICY);
  const source = input && typeof input === "object" ? input : {};
  return {
    ...base,
    ...source,
    search: { ...base.search, ...(source.search || {}) },
    immigration: { ...base.immigration, ...(source.immigration || {}) },
    automation: { ...base.automation, ...(source.automation || {}) },
    referral_protection: {
      ...base.referral_protection,
      ...(source.referral_protection || {}),
    },
  };
}

export function normalizeEmployer(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(LEGAL_SUFFIX, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(SPACE, " ")
    .trim();
}

function hostnameAndPath(rawUrl) {
  try {
    const u = new URL(String(rawUrl || ""));
    return `${u.hostname.toLowerCase().replace(/^www\./, "")}${u.pathname.toLowerCase()}`;
  } catch {
    return "";
  }
}

function employerMatches(company, url, entry) {
  const normalized = normalizeEmployer(company);
  const target = hostnameAndPath(url);
  const corporateTail = /^(?:services?|technologies|technology|web services|data services|development center|studios?|robotics|operations|logistics|digital|interactive)(?:\s|$)/;
  const nameMatch = (entry.names || []).some((name) => {
    const alias = normalizeEmployer(name);
    if (!alias || !normalized) return false;
    if (normalized === alias) return true;
    const remainder = normalized.startsWith(`${alias} `) ? normalized.slice(alias.length + 1) : "";
    return Boolean(remainder && corporateTail.test(remainder));
  });
  const domainMatch = (entry.domains || []).some((domain) => target === domain.toLowerCase() || target.startsWith(`${domain.toLowerCase()}/`) || target.includes(domain.toLowerCase()));
  return nameMatch || domainMatch;
}

export function classifyReferralProtection(job, inputPolicy = {}) {
  const policy = mergeJobPolicy(inputPolicy);
  const company = job?.company || "";
  const url = job?.url || "";
  for (const entry of policy.referral_protection.allow || []) {
    if (employerMatches(company, url, entry)) return { status: "clear", family: entry.family, reason: "explicitly outside the protected recruiting family" };
  }
  for (const entry of policy.referral_protection.hard_block || []) {
    if (employerMatches(company, url, entry)) return { status: "blocked", family: entry.family, reason: `protected ${entry.family} referral channel` };
  }
  for (const entry of policy.referral_protection.review || []) {
    if (employerMatches(company, url, entry)) return { status: "review", family: entry.family, reason: `separate subsidiary recruiting system; verify the exact job ID with the referrer` };
  }
  return { status: "clear", family: null, reason: "not in a protected company family" };
}

export function classifyUsLocation(location, inputPolicy = {}) {
  const policy = mergeJobPolicy(inputPolicy);
  const raw = String(location || "").trim();
  if (!raw) return { status: policy.search.keep_unknown_location_for_review ? "review" : "blocked", reason: "location is missing" };
  if (US_MARKERS.some((rx) => rx.test(raw))) return { status: "eligible", reason: "US location" };
  const stateCode = raw.toLowerCase().match(/(?:,|\s)\s*([a-z]{2})(?:\s|,|$)/)?.[1];
  if (stateCode && US_STATE_CODES.has(stateCode)) return { status: "eligible", reason: `US state (${stateCode.toUpperCase()})` };
  const lower = raw.toLowerCase();
  if (lower === "remote" && policy.search.include_us_remote) return { status: "review", reason: "remote location does not specify the hiring country" };
  if (FOREIGN_MARKERS.some((marker) => new RegExp(`\\b${marker.replace(/\s+/g, "\\s+")}\\b`, "i").test(raw))) {
    return { status: "blocked", reason: "outside the configured US search area" };
  }
  return { status: "review", reason: "US eligibility could not be confirmed from the location text" };
}

function evidenceSnippet(text, index, length) {
  const start = Math.max(0, index - 55);
  const end = Math.min(text.length, index + length + 75);
  return text.slice(start, end).replace(SPACE, " ").trim();
}

export function classifyImmigrationLanguage(description) {
  const text = String(description || "");
  const signals = [];
  for (const pattern of IMMIGRATION_PATTERNS) {
    const match = pattern.rx.exec(text);
    if (!match) continue;
    signals.push({
      code: pattern.code,
      level: pattern.level,
      evidence: evidenceSnippet(text, match.index, match[0].length),
    });
  }
  const codes = new Set(signals.map((signal) => signal.code));
  let workNow = "unknown";
  let stemExtension = "unknown";
  let futureSponsorship = "unknown";

  if (codes.has("current_authorization_only") || codes.has("opt_explicitly_accepted")) workNow = "likely";
  if (codes.has("opt_not_accepted") || codes.has("citizenship_or_pr_required")) workNow = "unlikely";
  if (codes.has("everify_confirmed")) stemExtension = "likely";
  if (codes.has("opt_not_accepted")) stemExtension = "unlikely";
  if (codes.has("sponsorship_offered")) futureSponsorship = "likely";
  if (codes.has("future_sponsorship_restricted") || codes.has("future_sponsorship_unavailable") || codes.has("sponsorship_unavailable")) futureSponsorship = "unlikely";

  const warning = signals.some((signal) => signal.level === "warning");
  return {
    status: warning ? "apply_with_caution" : "apply",
    work_now: workNow,
    stem_extension: stemExtension,
    future_sponsorship: futureSponsorship,
    signals,
    reason: signals.length ? "classified from explicit posting language" : "sponsorship is unstated; keep the role eligible",
  };
}

export function classifyEarlyCareer(title, description, inputPolicy = {}) {
  const policy = mergeJobPolicy(inputPolicy);
  const role = String(title || "");
  const body = String(description || "");
  if (EARLY_TITLE.test(role)) return { status: "eligible", reason: "explicit early-career title" };
  if (SENIOR_TITLE.test(role)) return { status: "review", reason: "title appears senior for a fresh graduate" };
  const years = [];
  for (const match of body.matchAll(YEARS_RX)) years.push(Number(match[2] || match[1]));
  if (years.length && Math.min(...years) > Number(policy.search.max_years_experience || 2)) {
    return { status: "review", reason: `posting asks for at least ${Math.min(...years)} years of experience` };
  }
  return { status: "eligible", reason: years.length ? "experience requirement is within the configured range" : "no seniority conflict detected" };
}

export function evaluateJobPolicy(job, inputPolicy = {}) {
  const policy = mergeJobPolicy(inputPolicy);
  const referral = classifyReferralProtection(job, policy);
  const location = classifyUsLocation(job?.location, policy);
  const immigration = classifyImmigrationLanguage(job?.description);
  const earlyCareer = classifyEarlyCareer(job?.title, job?.description, policy);
  const reasons = [];

  let decision = "apply";
  if (referral.status === "blocked" || location.status === "blocked") decision = "block";
  else if (referral.status === "review" || location.status === "review" || earlyCareer.status === "review") decision = "review";

  if (referral.status !== "clear") reasons.push(referral.reason);
  if (location.status !== "eligible") reasons.push(location.reason);
  if (earlyCareer.status !== "eligible") reasons.push(earlyCareer.reason);
  if (immigration.status === "apply_with_caution") reasons.push("immigration wording is unfavorable or ambiguous, but broad-apply mode keeps it eligible");

  return {
    decision,
    can_auto_apply: decision === "apply",
    referral,
    location,
    immigration,
    early_career: earlyCareer,
    reasons,
    policy_version: 1,
  };
}

export function formatPolicyNote(result) {
  const parts = [`policy=${result.decision}`];
  if (result.referral.status !== "clear") parts.push(`referral=${result.referral.status}:${result.referral.family || "unknown"}`);
  if (result.location.status !== "eligible") parts.push(`location=${result.location.status}`);
  if (result.early_career.status !== "eligible") parts.push(`career=${result.early_career.status}`);
  parts.push(`immigration=${result.immigration.status}`);
  return parts.join("; ");
}
