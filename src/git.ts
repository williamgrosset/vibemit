import { execSync } from "node:child_process";

export const DEFAULT_MAX_DIFF_LINES = 1500;

/**
 * File basenames whose diffs are replaced with a short summary placeholder.
 * These are generated files that add noise without useful context for
 * commit message generation.
 */
const NOISY_FILE_PATTERNS: RegExp[] = [
  /^package-lock\.json$/,
  /^yarn\.lock$/,
  /^pnpm-lock\.yaml$/,
  /^Cargo\.lock$/,
  /^Gemfile\.lock$/,
  /^composer\.lock$/,
  /^poetry\.lock$/,
  /^Pipfile\.lock$/,
  /^go\.sum$/,
  /^flake\.lock$/,
];

/**
 * Returns the path to the .git directory, or null if not in a git repo.
 */
export function getGitDir(): string | null {
  try {
    return execSync("git rev-parse --git-dir", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Returns true if the current directory is inside a git repository.
 */
export function isGitRepo(): boolean {
  return getGitDir() !== null;
}

/**
 * Returns the staged diff as a string.
 * Throws if there are no staged changes.
 */
export function getStagedDiff(maxDiffLines = DEFAULT_MAX_DIFF_LINES): string {
  const diff = execSync("git diff --staged", {
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024, // 10 MB
  }).trim();

  if (!diff) {
    throw new Error(
      "No staged changes found.\n\nStage your changes first:\n  git add <files>\n  git add -p"
    );
  }

  return truncateDiff(summarizeNoisyFiles(diff), maxDiffLines);
}

/**
 * Returns a short file-level summary of staged changes (git diff --staged --stat).
 * Provides high-level context (which files changed, insertions/deletions)
 * that helps the LLM understand the scope even when the full diff is truncated.
 */
export function getStagedStat(): string {
  return execSync("git diff --staged --stat", {
    encoding: "utf-8",
    maxBuffer: 1024 * 1024,
  }).trim();
}

/**
 * Commits with the given message. Returns the git output.
 */
export function commit(message: string): string {
  return execSync(`git commit -m ${escapeShellArg(message)}`, {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

/**
 * Replaces diff sections for noisy generated files (lockfiles, etc.)
 * with a short placeholder like "[package-lock.json changed]".
 * Keeps actual source code diffs intact.
 */
export function summarizeNoisyFiles(diff: string): string {
  // Split into per-file sections. Each starts with "diff --git a/... b/..."
  const sections = diff.split(/(?=^diff --git )/m);
  const result: string[] = [];

  for (const section of sections) {
    const headerMatch = section.match(/^diff --git a\/(.+?) b\/(.+)/);
    if (!headerMatch) {
      // Preamble or malformed section — keep as-is
      result.push(section);
      continue;
    }

    const filePath = headerMatch[2];
    const basename = filePath.split("/").pop() ?? filePath;

    if (NOISY_FILE_PATTERNS.some((pattern) => pattern.test(basename))) {
      result.push(`[${filePath} changed]\n`);
    } else {
      result.push(section);
    }
  }

  return result.join("").trim();
}

/**
 * Truncates a diff to maxDiffLines lines to prevent overwhelming the LLM.
 * Appends a notice when truncation occurs.
 */
function truncateDiff(diff: string, maxDiffLines: number): string {
  const safeMaxDiffLines = Math.max(1, Math.trunc(maxDiffLines));
  const lines = diff.split("\n");
  if (lines.length <= safeMaxDiffLines) {
    return diff;
  }

  return (
    lines.slice(0, safeMaxDiffLines).join("\n") +
    `\n\n[Diff truncated: showing ${safeMaxDiffLines} of ${lines.length} lines]`
  );
}

/**
 * Escapes a string for safe use as a shell argument.
 */
function escapeShellArg(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}
