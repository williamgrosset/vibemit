#!/usr/bin/env node

import { Command } from "commander";
import { select } from "@inquirer/prompts";
import { getStagedDiff, getStagedStat, commit } from "./git.js";
import { checkOllama, generateCommitMessages } from "./ollama.js";
import { getRules, addRule, clearRules, getRulesPath } from "./config.js";
import { buildSystemPrompt, buildUserPrompt } from "./prompts.js";
import { copyToClipboard } from "./clipboard.js";

const DEFAULT_MODEL = "qwen3:8b";

const program = new Command();

program
  .name("vibemit")
  .description("AI-generated Git commit messages using a local LLM via Ollama")
  .version("0.1.0")
  .option("--model <name>", "Ollama model to use", DEFAULT_MODEL)
  .option("--intent <text>", "high-priority commit intent guidance")
  .option("--conventional", "use Conventional Commit format")
  .option("--body", "include subject + body (1-3 bullets)")
  .option("-d, --dry-run", "print selected message without committing")
  .option("-c, --clipboard", "copy selected message to clipboard")
  .option("-y, --yes", "auto-select the first option (skip prompt)")
  .option("-r, --add-rule <text>", "add a persistent rule")
  .option("--rules", "print saved rules")
  .option("--clear-rules", "delete all saved rules");

program.action(async (opts) => {
  // Handle rule management commands first — these exit early.
  if (opts.rules) {
    const rules = getRules();
    if (rules.length === 0) {
      console.log("No rules saved.");
      console.log(`Rules file: ${getRulesPath()}`);
    } else {
      console.log("Saved rules:");
      for (const rule of rules) {
        console.log(`  - ${rule}`);
      }
      console.log(`\nRules file: ${getRulesPath()}`);
    }
    return;
  }

  if (opts.clearRules) {
    clearRules();
    console.log("All rules cleared.");
    return;
  }

  if (opts.addRule) {
    addRule(opts.addRule);
    console.log(`Rule added: "${opts.addRule}"`);
    console.log(`Rules file: ${getRulesPath()}`);
    return;
  }

  // Main flow: generate commit messages from staged changes.
  let diff: string;
  try {
    diff = getStagedDiff();
  } catch (err) {
    console.error(
      (err as Error).message || "No staged changes found."
    );
    process.exit(1);
  }

  await checkOllama();

  const model: string = opts.model;
  const intent: string | undefined = opts.intent;
  const conventional: boolean = opts.conventional ?? false;
  const body: boolean = opts.body ?? false;
  const dryRun: boolean = opts.dryRun ?? false;
  const clipboard: boolean = opts.clipboard ?? false;
  const autoYes: boolean = opts.yes ?? false;

  const rules = getRules();
  const stat = getStagedStat();
  const systemPrompt = buildSystemPrompt({ conventional, body, intent });
  const userPrompt = buildUserPrompt(diff, rules, body, intent, stat);

  console.log(`Using model: ${model}`);
  console.log("Generating commit messages...\n");

  const candidates = await generateCommitMessages(
    systemPrompt,
    userPrompt,
    model,
    body
  );

  let selected: string;

  if (autoYes) {
    selected = candidates[0];
    console.log(`Auto-selected: ${formatForDisplay(selected)}\n`);
  } else {
    selected = await select({
      message: "Select a commit message:",
      choices: candidates.map((c) => ({
        name: formatForDisplay(c),
        value: c,
      })),
    });
    console.log();
  }

  // Handle output based on flags
  if (dryRun && clipboard) {
    console.log(selected);
    const copied = copyToClipboard(selected);
    if (copied) {
      console.log("\nCopied to clipboard.");
    } else {
      console.error(
        "\nCould not copy to clipboard. No clipboard tool found (pbcopy, wl-copy, or xclip)."
      );
    }
    return;
  }

  if (dryRun) {
    console.log(selected);
    return;
  }

  if (clipboard) {
    const copied = copyToClipboard(selected);
    if (copied) {
      console.log("Copied to clipboard.");
    } else {
      console.error(
        "Could not copy to clipboard. No clipboard tool found (pbcopy, wl-copy, or xclip)."
      );
      process.exit(1);
    }
    return;
  }

  // Default: commit
  try {
    const output = commit(selected);
    console.log(output);
  } catch (err) {
    console.error("Failed to create commit:");
    console.error((err as Error).message);
    process.exit(1);
  }
});

program.parse();

/**
 * Formats a commit message for display in the selection prompt.
 * Truncates long body messages to show just the subject + indicator.
 */
function formatForDisplay(message: string): string {
  const lines = message.split("\n");
  if (lines.length === 1) {
    return message;
  }

  // Multi-line (body format): show subject + truncated indicator
  const subject = lines[0];
  const bodyLines = lines.slice(1).filter((l) => l.trim().length > 0);
  if (bodyLines.length > 0) {
    return `${subject} (+${bodyLines.length} line${bodyLines.length > 1 ? "s" : ""})`;
  }
  return subject;
}
