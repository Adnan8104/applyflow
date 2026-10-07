# applyflow

Automated job-search pipeline. It scores postings, tracks applications, and tailors a one-page resume for each role without letting the AI invent anything.

## How tailoring works

1. Three drafts are generated in parallel, each with a different strategy.
2. Every bullet is checked against a locked fact bank. Numbers, tools and verbs must match the source, or the bullet reverts.
3. Two independent reviewers score the drafts against the unchanged resume. A draft has to beat it in both to win.
4. Approval is tied to the PDF's SHA-256, so any later change invalidates it. Submitting stays manual.

A checker also runs after every resume edit and blocks reworded bullets, repeated facts, layout changes and anything over one page.

## Stack

Node.js · Playwright · LaTeX · Python

```
npm install && npm run test:resume
```

Based on [career-ops](https://github.com/career-ops-hq/career-ops) (MIT) by Santiago Fernández de Valderrama.
