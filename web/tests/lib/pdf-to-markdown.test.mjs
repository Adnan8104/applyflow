import test from "node:test";
import assert from "node:assert/strict";
import { derivePdfCvSeed, pdfTextToMarkdown } from "../../src/lib/cv/pdf-to-markdown.mjs";

const SAMPLE = `Adnan Akbany
adnan@example.com | github.com/adnan
Experience
Data Engineer Intern May 2026 – Aug. 2026
Acme Austin, TX
• Built a Python data pipeline that processed 200+ documents and
reduced review time by 50%.
Technical Skills
Languages: Python, SQL
-- 1 of 1 --`;

test("selectable PDF text becomes structured, fact-preserving Markdown", () => {
  const markdown = pdfTextToMarkdown(SAMPLE);
  assert.match(markdown, /^# CV -- Adnan Akbany/m);
  assert.match(markdown, /^## Experience$/m);
  assert.match(markdown, /^### Data Engineer Intern May 2026 - Aug\. 2026$/m);
  assert.match(markdown, /^- Built a Python data pipeline that processed 200\+ documents and reduced review time by 50%\.$/m);
  assert.match(markdown, /^- \*\*Languages:\*\* Python, SQL$/m);
  assert.doesNotMatch(markdown, /1 of 1/);
});

test("PDF seed finds the leading role and US location", () => {
  const seed = derivePdfCvSeed(SAMPLE);
  assert.equal(seed.title, "Data Engineer Intern");
  assert.deepEqual(seed.roles, ["Data Engineer Intern"]);
  assert.equal(seed.location, "Acme Austin, TX");
});
