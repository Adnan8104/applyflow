import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("first-run home explains local PDF upload and the scanned-file fallback", () => {
  const src = readFileSync(join(root, "src/components/home/first-run-home.tsx"), "utf8");
  assert.doesNotMatch(src, /No setup/);
  assert.match(src, /Upload your resume PDF/);
  assert.match(src, /Selectable PDF text stays on this machine/);
  assert.match(src, /pasted text remains available for scanned files/);
});

test("pasted CV text can start without a CLI", () => {
  const src = readFileSync(join(root, "src/components/cv/cv-ingest.tsx"), "utf8");
  assert.match(src, /Pasted text is already readable/);
  assert.match(src, /setPhase\("review"\)/);
  assert.match(src, /setSeed\(null\)/);
});
