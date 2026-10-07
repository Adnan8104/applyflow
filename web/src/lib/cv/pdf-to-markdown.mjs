const SECTION_NAMES = new Set([
  "education",
  "experience",
  "work experience",
  "research experience",
  "entrepreneurial experience",
  "projects",
  "technical skills",
  "skills",
  "certifications",
  "publications",
  "leadership",
  "activities",
]);

const DATE_TAIL = /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?|Spring|Summer|Fall|Winter)\.?\s+\d{4}(?:\s*[-–—]\s*(?:(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+)?(?:\d{4}|Present))?\s*$/i;
const ROLE_WORD = /\b(?:intern|engineer|developer|analyst|researcher|scientist|designer|manager|consultant|specialist|co-founder|operator)\b/i;
const PAGE_MARKER = /^--\s*\d+\s+of\s+\d+\s*--$/i;

function normalizeLine(value) {
  return String(value || "")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function isSection(line) {
  return SECTION_NAMES.has(line.toLowerCase());
}

function isEntryHeading(line) {
  return DATE_TAIL.test(line);
}

export function pdfTextToMarkdown(text) {
  const raw = String(text || "")
    .split(/\r?\n/)
    .map(normalizeLine)
    .filter((line) => line && !PAGE_MARKER.test(line));
  if (!raw.length) return "";

  const out = [`# CV -- ${raw[0]}`];
  let index = 1;
  if (raw[index] && !isSection(raw[index])) {
    out.push(`**Contact:** ${raw[index]}`);
    index++;
  }

  let activeBullet = -1;
  for (; index < raw.length; index++) {
    const line = raw[index];
    if (isSection(line)) {
      out.push("", `## ${line}`);
      activeBullet = -1;
      continue;
    }
    if (/^[•●▪]\s*/.test(line)) {
      out.push(`- ${line.replace(/^[•●▪]\s*/, "")}`);
      activeBullet = out.length - 1;
      continue;
    }
    if (isEntryHeading(line)) {
      out.push("", `### ${line}`);
      activeBullet = -1;
      continue;
    }
    if (activeBullet >= 0) {
      out[activeBullet] += ` ${line}`;
      continue;
    }
    const skill = line.match(/^([^:]{2,40}):\s*(.+)$/);
    if (skill) out.push(`- **${skill[1]}:** ${skill[2]}`);
    else out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function derivePdfCvSeed(text) {
  const lines = String(text || "").split(/\r?\n/).map(normalizeLine).filter(Boolean);
  const roles = lines
    .filter((line) => ROLE_WORD.test(line) && DATE_TAIL.test(line))
    .map((line) => line.replace(DATE_TAIL, "").trim())
    .filter(Boolean)
    .filter((role, index, all) => all.indexOf(role) === index)
    .slice(0, 5);
  const location = lines.map((line) => line.match(/\b([A-Z][A-Za-z .'-]+,\s*[A-Z]{2})\b/)?.[1]).find(Boolean);
  return {
    title: roles[0] || undefined,
    roles: roles.length ? roles : undefined,
    location: location || undefined,
  };
}
