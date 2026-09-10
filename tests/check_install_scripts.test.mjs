// Tests for the install-time lifecycle-script guard (Issue #22).
//
// Every test calls the real exported functions with real input and asserts on
// the returned value. The final two tests read this repository's actual
// workflow files, so a future workflow that reintroduces an unguarded install
// fails here rather than in production CI.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  extractRunCommands,
  findUnsafeInstalls,
  scanWorkflowDirectory,
} from "../tools/check_install_scripts.mjs";

const workflowsDir = new URL("../.github/workflows/", import.meta.url);

test("extractRunCommands reads an inline run scalar", () => {
  const yaml = [
    "jobs:",
    "  build:",
    "    steps:",
    "      - name: Install",
    "        run: npm install -g markdownlint-cli2@0.23.2",
  ].join("\n");

  assert.deepEqual(extractRunCommands(yaml), [
    "npm install -g markdownlint-cli2@0.23.2",
  ]);
});

test("extractRunCommands reads a block scalar and stops at the next key", () => {
  const yaml = [
    "jobs:",
    "  build:",
    "    steps:",
    "      - run: |",
    "          set -euo pipefail",
    "          npm install -g foo@1.0.0",
    "        env:",
    "          FOO: bar",
  ].join("\n");

  assert.deepEqual(extractRunCommands(yaml), [
    "set -euo pipefail\nnpm install -g foo@1.0.0",
  ]);
});

test("extractRunCommands returns nothing for a workflow with no run steps", () => {
  const yaml = "jobs:\n  build:\n    steps:\n      - uses: actions/checkout@v4\n";
  assert.deepEqual(extractRunCommands(yaml), []);
});

test("findUnsafeInstalls flags an unguarded global npm install", () => {
  const yaml = "    steps:\n      - run: npm install -g markdownlint-cli2@0.23.2\n";
  const findings = findUnsafeInstalls(yaml, "markdown-lint.yml");

  assert.equal(findings.length, 1);
  assert.equal(findings[0].file, "markdown-lint.yml");
  assert.match(findings[0].command, /npm install -g markdownlint-cli2/);
});

test("findUnsafeInstalls accepts an install carrying --ignore-scripts", () => {
  const yaml =
    "    steps:\n      - run: npm install -g --ignore-scripts markdownlint-cli2@0.23.2\n";
  assert.deepEqual(findUnsafeInstalls(yaml, "markdown-lint.yml"), []);
});

test("findUnsafeInstalls accepts the npm_config_ignore_scripts environment form", () => {
  const yaml =
    "    steps:\n      - run: NPM_CONFIG_IGNORE_SCRIPTS=true npm ci\n";
  assert.deepEqual(findUnsafeInstalls(yaml, "ci.yml"), []);
});

test("findUnsafeInstalls flags pnpm and yarn installs too", () => {
  const yaml = [
    "    steps:",
    "      - run: |",
    "          pnpm add --global foo@1.2.3",
    "          yarn add bar@2.0.0",
  ].join("\n");

  const findings = findUnsafeInstalls(yaml, "ci.yml");
  assert.equal(findings.length, 2);
});

test("findUnsafeInstalls ignores non-install package-manager commands", () => {
  const yaml = "    steps:\n      - run: npm run build && npm test\n";
  assert.deepEqual(findUnsafeInstalls(yaml, "ci.yml"), []);
});

test("findUnsafeInstalls ignores shell comments", () => {
  const yaml = "    steps:\n      - run: |\n          # npm install -g foo@1.0.0\n          echo hi\n";
  assert.deepEqual(findUnsafeInstalls(yaml, "ci.yml"), []);
});

test("findUnsafeInstalls follows a backslash line continuation", () => {
  const yaml = [
    "    steps:",
    "      - run: |",
    "          npm install -g \\",
    "            --ignore-scripts \\",
    "            markdownlint-cli2@0.23.2",
  ].join("\n");

  assert.deepEqual(findUnsafeInstalls(yaml, "markdown-lint.yml"), []);
});

test("findUnsafeInstalls returns nothing for empty input", () => {
  assert.deepEqual(findUnsafeInstalls("", "empty.yml"), []);
});

// Regression test for Issue #22: this fails against the unfixed
// `markdown-lint.yml` (which ran `npm install -g markdownlint-cli2@0.23.2`
// with lifecycle scripts enabled) and passes after `--ignore-scripts` is added.
test("markdown-lint.yml installs markdownlint-cli2 with lifecycle scripts disabled", async () => {
  const yaml = await readFile(new URL("markdown-lint.yml", workflowsDir), "utf8");

  assert.deepEqual(findUnsafeInstalls(yaml, "markdown-lint.yml"), []);
});

test("no workflow in this repository installs packages with lifecycle scripts enabled", async () => {
  const findings = await scanWorkflowDirectory(workflowsDir);

  assert.deepEqual(findings, []);
});
