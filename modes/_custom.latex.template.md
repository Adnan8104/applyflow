# Custom Instructions -- approved LaTeX resume tailoring

Copy this file to `modes/_custom.md` to opt into this workflow. If that file
already exists, merge this section while preserving the user's existing rules.
Personal facts and answers belong in `config/profile.yml`, not here.

## Resume sources

- Use the user's own `resume.tex` as the default master. One master is enough.
  Optional alternatives are named `resume-<name>.tex`; describe when each is
  useful from its actual content. Do not assume any particular projects or roles.
- Masters must use the checker's supported commands: `\resumeItem`,
  `\resumeSubheading`, `\resumeProjectHeading`, and the `Technical Skills`
  section with `\textbf{Category}{: skill, skill}` entries. All masters must have
  the same preamble and contact block as `resume.tex`.
- If a supplied resume uses another format, explain the compatibility gap and
  obtain approval for an adapted master before using this workflow. A passing
  checker alone does not establish that it understood an unsupported template.
- Create `data/resume-variants.md` from the user's supplied masters: copy each
  bullet exactly, with a stable `[GROUP]` identifier for each underlying fact.
  Put alternate wordings of the same fact in the same group. Review ambiguous
  grouping with the user; do not turn one fact into several independent claims.
- Skills come only from the user's masters or explicit statements. Populate the
  library's skills allowlist with those exact skill names. No invented skills.
- The supplied wording is the initial library; any newly written alternative
  must be proposed in chat and approved before entering the approved library.
  No fictional example content may enter the user's resume or form answers.

## Per-job workflow

1. Read the live posting and check the tracker for an existing application.
   Select a master and say why. Copy it fresh to
   `output/<company-role>/resume.tex`; never copy another tailored resume.
2. Before editing, list each planned change in one line. Reorder or drop whole
   bullets, projects and sections according to the posting. Reorder skills
   from the allowlist. Preserve headings, dates, locations and project stacks.
3. Bullet text comes ONLY from `data/resume-variants.md`, copied exactly. Use
   at most one bullet per `[GROUP]`. A bullet marked `covers: X` cannot appear
   alongside another bullet stating group X. Pending wording is unusable.
4. For new wording, first show `PROPOSED BULLET [GROUP]: ... (changed: ...)`.
   Only after the user approves the exact text may it enter the approved
   library and then a tailored resume. Never invent numbers, scope or tools.
5. Never change anything before `\begin{document}`. Never edit a master unless
   the user explicitly requests it. If the unchanged master exceeds one page,
   explain the issue and agree on content cuts; do not silently change layout.
6. Run `node resume-tex/check.mjs <file>` manually after EVERY `.tex` edit and
   resolve every failure. The Claude Edit/Write hook is additional protection;
   do not rely on it in Codex or when editing through a shell.
7. Compile with `tectonic -X compile <file>`. Inspect the actual PDF, show it
   with the diff and page count, and wait for the user's approval. One page is
   required. If the checker skips PDF text extraction, fix the Python setup
   before treating the ATS text check as verified.
8. On explicit user approval, run `node resume-tex/approve.mjs --url <exact
   page URL> --company <company> --role <role> --pdf <pdf>`. Approval permits
   filling that job and attaching that exact PDF; it never permits submission.
9. Fill via `http://127.0.0.1:3001/apply` using the user's saved answers.
   NEVER fill work authorization, sponsorship, legal, consent or demographic
   fields. Leave unknown answers blank. Verify what landed on the real form;
   hand unsupported controls to the user. Never click Submit.
10. Only after the user confirms submission, add a headed TSV in
    `batch/tracker-additions/` and run `node merge-tracker.mjs`. For an existing
    tracker row, use `node set-status.mjs` instead of adding a duplicate. Then
    run `node resume-pipeline.mjs record-submitted --application <id>
    --pdf-hash <approved hash> --confirm-submitted`, using the exact application
    ID and hash from the approval record. Never infer submission from filling.

## Standing preferences

- Truthfulness first, then relevance. Lead each role with its most relevant
  evidence; place quantified evidence near the top when it supports that job.
- Record deliberate drops in the diff. An unchanged master is a valid result
  when its content already fits; do not rewrite merely to look tailored.
- This flow needs no model-provider API configuration. Do not enable API calls
  or a separate multi-model comparison without explicit user consent.
- These procedural rules supersede legacy CV rewording, similarity and layout
  rules for this LaTeX workflow. They do not authorize changes to `cv.md`.
- Preserve this fork's resume and web approval changes when considering an
  upstream update. Never apply an upstream update over them without reviewing
  the merge and obtaining the user's approval.
