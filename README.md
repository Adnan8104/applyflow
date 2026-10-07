# career-command-center

My fork of [career-ops](https://github.com/career-ops-hq/career-ops) (MIT), adapted for a US new-grad software engineering search. I use it to evaluate postings, track applications, and produce tailored one-page resumes, with checks that stop the tailoring step from inventing anything.

## What I added

- **Fact-locked tailoring.** Tailored resumes can only use bullets from an approved list. A checker blocks rewording, repeated facts, unlisted skills, layout edits and anything over one page, and runs automatically after every edit (`resume-tex/`).
- **Reviewed resume pipeline.** Drafts are checked against a fact bank where numbers, tools and verbs are locked, and compared with the unchanged resume. Nothing is uploaded without an approval tied to the exact PDF (`lib/resume-pipeline/`).
- **Fixes found by using it:** CV template CSS that scrambled PDF text order for ATS parsers, a job filter that misread citizenship and OPT wording, and false positives in the ATS and fact checkers.

## Stack

Node.js · Playwright · LaTeX (tectonic) · Python (pdfplumber)

## Run

```
npm install
node doctor.mjs
npm run test:resume
```

Built on career-ops by Santiago Fernández de Valderrama and contributors. See [LICENSE](LICENSE).
