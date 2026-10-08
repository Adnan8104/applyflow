# applyflow

Automated job-search pipeline. It scores postings with A-H evaluation reports, tracks applications, and tailors a one-page resume for each role without letting the AI invent anything.

## How tailoring works

1. Three drafts are generated in parallel, each with a different strategy.
2. Every bullet is checked against a locked fact bank. Numbers, tools and verbs must match the source, or the bullet reverts.
3. Two independent reviewers score the drafts against the unchanged resume. A draft has to beat it in both to win.
4. Approval is tied to the PDF's SHA-256, so any later change invalidates it. Submitting stays manual.

A checker also runs after every resume edit and blocks reworded bullets, repeated facts, layout changes and anything over one page.

| Rule | |
|---|---|
| **Human-in-the-Loop** | The system never submits an application -- you always have the final call <!-- hitl: absolute guarantee. Do not add "automatically", "by itself", "without your permission" or any other hedge when translating this row. --> |

## Stack

Node.js · Playwright · LaTeX · Python

```
npm install && npm run test:resume
```

Runs inside Claude Code or Codex: describe the task in plain language, or headless with `codex exec "prompt"` (see [CODEX.md](CODEX.md)).

Based on [career-ops](https://github.com/career-ops-hq/career-ops) (MIT) by Santiago Fernández de Valderrama.
