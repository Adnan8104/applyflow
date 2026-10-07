# Third-Party Notices

Career Command Center is a modified distribution of
[Career Ops](https://github.com/career-ops-hq/career-ops), Copyright (c) 2026
Santiago Fernandez de Valderrama, used under the MIT License included in
`LICENSE`. The original Career Ops trademark policy remains in `TRADEMARK.md`;
this fork uses a different product name and does not claim upstream endorsement.

The design review also considered these open-source projects:

- [Resume Matcher](https://github.com/srbhr/Resume-Matcher), Apache License 2.0.
  Its master-resume-first workflow and explicit review experience informed the
  resume audit design. No source files were copied into this fork.
- [AI Job Search](https://github.com/MadsLorentzen/ai-job-search), MIT License,
  Copyright (c) 2026 Mads Lorentzen. Its drafter/reviewer workflow informed the
  separation between tailoring and integrity review. No source files were copied.
- [Hiring Agent](https://github.com/interviewstreet/hiring-agent), MIT License,
  Copyright (c) 2025 HackerRank. Its explainable scoring approach informed the
  preference for visible policy reasons. No source files were copied.

The policy rules in `lib/job-policy.mjs`, the referral preflight gate, and the
Resume Audit UI are original additions in this fork.

PDF text extraction uses
[pdf-parse](https://github.com/mehmet-kozan/pdf-parse), version 2.4.5,
Copyright (c) Mehmet Kozan, under the Apache License 2.0.
