#!/usr/bin/env node
// Guard against install-time lifecycle-script execution in CI (Issue #22).
//
// `npm install` runs `preinstall`/`install`/`postinstall` for the installed
// package and every transitive dependency by default, so a compromised
// package executes arbitrary code on the runner before anything else runs.
// Every package install in a GitHub Actions `run:` step must therefore
// disable lifecycle scripts explicitly.
//
// The check is deliberately conservative: it looks at the command line only,
// so an install that relies on an ambient `.npmrc` is still reported. Making
// the guarantee visible at the call site is the point.

import { readFile, readdir } from "node:fs/promises";

// Package managers and the sub-commands that resolve and install a dependency
// tree — the operations that run lifecycle scripts.
const INSTALL_COMMANDS = new Map([
  ["npm", ["install", "i", "add", "ci"]],
  ["pnpm", ["install", "i", "add"]],
  ["yarn", ["install", "add"]],
]);

// Forms that disable lifecycle scripts for the invocation.
const IGNORE_SCRIPTS = [
  /(^|\s)--ignore-scripts(=true)?(\s|$)/,
  /(^|\s)NPM_CONFIG_IGNORE_SCRIPTS=(true|1)(\s|$)/i,
  /(^|\s)YARN_ENABLE_SCRIPTS=(false|0)(\s|$)/i,
];

const BLOCK_SCALAR = /^[|>][+-]?\d*\s*(#.*)?$/;

/**
 * Extract every `run:` command from a workflow document.
 *
 * Handles both the inline form (`run: npm ci`) and block scalars
 * (`run: |`), which are the only two forms GitHub Actions accepts.
 *
 * @param {string} workflowYaml Raw workflow file contents.
 * @returns {string[]} One entry per `run:` step, in document order.
 */
export function extractRunCommands(workflowYaml) {
  if (typeof workflowYaml !== "string") {
    throw new TypeError("extractRunCommands expects the workflow YAML as a string");
  }

  const lines = workflowYaml.split("\n");
  const commands = [];

  for (let i = 0; i < lines.length; i++) {
    const match = /^(\s*(?:-\s+)?)run:\s*(.*)$/.exec(lines[i]);
    if (!match) continue;

    const keyIndent = match[1].length;
    const remainder = match[2].trim();

    if (!BLOCK_SCALAR.test(remainder)) {
      commands.push(stripQuotes(remainder));
      continue;
    }

    // Block scalar: consume the more-indented lines that follow.
    const body = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const line = lines[j];
      if (line.trim() === "") {
        body.push("");
        continue;
      }
      const indent = line.length - line.trimStart().length;
      if (indent <= keyIndent) break;
      body.push(line);
    }
    i = j - 1;

    const dedent = Math.min(
      ...body.filter((l) => l !== "").map((l) => l.length - l.trimStart().length),
    );
    commands.push(body.map((l) => l.slice(dedent)).join("\n").trim());
  }

  return commands;
}

/**
 * Report every package install in a workflow that leaves lifecycle scripts
 * enabled.
 *
 * @param {string} workflowYaml Raw workflow file contents.
 * @param {string} file Label used in the finding (usually the file name).
 * @returns {{file: string, command: string, reason: string}[]} Findings.
 */
export function findUnsafeInstalls(workflowYaml, file) {
  const findings = [];

  for (const command of extractRunCommands(workflowYaml)) {
    for (const statement of splitStatements(command)) {
      if (!isInstall(statement)) continue;
      if (IGNORE_SCRIPTS.some((pattern) => pattern.test(statement))) continue;
      findings.push({
        file,
        command: statement,
        reason: "package install runs lifecycle scripts; add --ignore-scripts",
      });
    }
  }

  return findings;
}

/**
 * Scan every workflow file in a directory.
 *
 * @param {string|URL} directory Directory holding the workflow files.
 * @returns {Promise<{file: string, command: string, reason: string}[]>}
 */
export async function scanWorkflowDirectory(directory) {
  const entries = await readdir(directory);
  const findings = [];

  for (const name of entries.sort()) {
    if (!/\.ya?ml$/.test(name)) continue;
    const yaml = await readFile(new URL(name, directory), "utf8");
    findings.push(...findUnsafeInstalls(yaml, name));
  }

  return findings;
}

/** Remove a wrapping pair of quotes from an inline YAML scalar. */
function stripQuotes(value) {
  const quoted = /^(['"])([\s\S]*)\1$/.exec(value);
  return quoted ? quoted[2] : value;
}

/**
 * Split a shell snippet into individual statements, joining backslash line
 * continuations first and dropping comment-only lines.
 */
function splitStatements(command) {
  const joined = command.replace(/\\\n\s*/g, " ");
  return joined
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .flatMap((line) => line.split(/&&|\|\||;/))
    .map((statement) => statement.trim())
    .filter((statement) => statement !== "");
}

/** True when the statement resolves and installs a dependency tree. */
function isInstall(statement) {
  // Skip any leading `VAR=value` assignments so the manager is the first word.
  const words = statement.split(/\s+/).filter(Boolean);
  let index = 0;
  while (index < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index])) {
    index++;
  }

  const manager = words[index];
  const subCommands = INSTALL_COMMANDS.get(manager);
  if (!subCommands) return false;

  // The sub-command is the first following word that is not a flag.
  const subCommand = words.slice(index + 1).find((word) => !word.startsWith("-"));
  return subCommand !== undefined && subCommands.includes(subCommand);
}

// CLI entry point: fail loud on any finding.
if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file://").href) {
  const directory = new URL("../.github/workflows/", import.meta.url);
  const findings = await scanWorkflowDirectory(directory);

  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(`${finding.file}: ${finding.reason}\n  ${finding.command}`);
    }
    console.error(`\n${findings.length} unguarded package install(s) found.`);
    process.exit(1);
  }

  console.log("No unguarded package installs found in .github/workflows.");
}
