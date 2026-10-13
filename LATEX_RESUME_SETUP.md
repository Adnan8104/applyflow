# Use applyflow with your own master resume

One master is enough. Optional masters let you choose different project mixes
for different roles. Claude Code or Codex can populate the starter files from
the resumes you provide; you do not need to invent a file structure yourself.

## Install locally

Download this repository's ZIP from GitHub, extract it, and open the extracted
folder as a local project in Claude Code or Codex. Use the applyflow checkout
rather than the upstream `npx @santifer/career-ops init` installer.

Use Node.js 22 or later, Python 3 with `pdfplumber`, and Tectonic on your PATH.
Install the application dependencies and run the resume checks:

```sh
npm install
npm run test:resume
```

Install `pdfplumber` in the Python environment used for checking. By default
the checker uses `python3`; if using a virtual environment, copy
`config/resume-pipeline.example.yml` to `config/resume-pipeline.yml` if absent
and set `render.extraction_python` to that environment's Python executable.
Keep `models.enabled: false`. The separate multi-model pipeline is optional
and does not need to be configured for this LaTeX flow.

The web app has its own dependencies. In a second terminal:

```sh
cd web
npm ci
npm run dev -- --port 3001
```

The core installation installs the Playwright browser. If that step fails,
follow its error and install the required browser with
`npx playwright install chromium` from the repository root. The local apply
page is `http://127.0.0.1:3001/apply`; final submission is always manual.

## Editable starter files

| Starter shipped in the ZIP | Your private working copy | Purpose |
|---|---|---|
| `config/profile.latex.example.yml` | `config/profile.yml` | Your details and standing application answers |
| `modes/_custom.latex.template.md` | `modes/_custom.md` | The full tailoring, approval and filling rules |
| `resume-tex/variants.template.md` | `data/resume-variants.md` | Your exact approved bullets, fact groups and skills |
| Your supplied LaTeX resume | `resume.tex` | Default master and frozen layout |
| Optional supplied alternatives | `resume-<name>.tex` | Other project mixes using the same layout |

The working copies are gitignored. Keep the shipped starters reusable and
put your own information only in the private working copies. If copies already
exist, preserve them and merge missing settings; never overwrite them to reset
setup. A GitHub source ZIP omits private files; a ZIP made from your entire
working folder can include your resumes, answers and application history.

The checker supports Jake-style LaTeX commands: `\resumeItem`,
`\resumeSubheading`, `\resumeProjectHeading`, and a `Technical Skills` section
with `\textbf{Category}{: skill, skill}` entries. A different LaTeX format may
need an adaptation you review first. For a PDF or Word master, provide its
LaTeX source or have the agent prepare a LaTeX master for your approval first.
All optional masters must preserve the default master's preamble and contact
block. Review the unchanged master before tailoring any job.

## First message to Claude Code or Codex

```text
Set up the approved LaTeX resume workflow in this applyflow project.
Read AGENTS.md and LATEX_RESUME_SETUP.md. Copy the three starter files
listed there to their private working paths only if those paths are absent;
otherwise preserve and merge the existing settings.

I will supply my own master resume, or several master resumes. Use one as
resume.tex and optional alternatives as resume-<name>.tex. Explain which
roles each master fits. Preserve the supplied layout. If my format is not
supported by the checker, explain what needs adapting and let me approve
the adapted master before starting.

Populate data/resume-variants.md by copying my existing bullet text exactly,
grouping alternate statements of the same fact together, and extracting my
existing skills. Show me ambiguous grouping decisions. No invented wording,
numbers or skills. Fill profile fields only from my resume and answers; leave
unknowns blank and ask me only for missing details needed for the current job.
If cv.md is absent, also create it from my supplied resumes with the same
factual wording so other job-search modes can read it. If it already exists,
preserve it and propose any factual updates before editing it. Keep LaTeX
tailoring tied to my masters and approved library.

Read modes/_custom.md and use its workflow: choose a master, copy it fresh,
reorder or drop approved content, run the checker manually, compile and show
the one-page PDF and diff. Wait for my exact PDF approval before using the
local apply page. Never fill legal, authorization, sponsorship, consent or
demographic fields, and never submit. Record submission only when I tell you
I submitted. Do not enable model-provider API calls for this workflow.
```

After setup, give the agent a job URL. Approve a reviewed PDF with the exact
command it presents. Some ATS dropdowns, radios, checkboxes and embedded file
uploads may need manual completion; review the real form before submitting.
