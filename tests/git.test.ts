import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { summarizeNoisyFiles } from "../src/git.js";

/**
 * Helper: creates a temporary git repo and returns its path.
 * All git/config functions use cwd, so we run them as child processes
 * in the temp directory to avoid contaminating the real repo.
 */
function createTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "vibemit-test-"));
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: "pipe" });
  execSync('git config user.name "Test"', { cwd: dir, stdio: "pipe" });
  return dir;
}

function cleanupTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

/**
 * Since git.ts functions use execSync without a cwd option, they operate
 * on process.cwd(). We can't easily change cwd per-test in the same
 * process, so we shell out to node to run the functions in the temp dir.
 */
function runInDir(dir: string, code: string): { stdout: string; stderr: string; exitCode: number } {
  const script = `
    import { getGitDir, isGitRepo, getStagedDiff, commit } from "${join(process.cwd(), "dist", "git.js").replace(/\\/g, "/")}";
    ${code}
  `;
  try {
    const stdout = execSync(`node --input-type=module -e '${script.replace(/'/g, "'\\''")}'`, {
      cwd: dir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { stdout: stdout.trim(), stderr: "", exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: (err.stdout || "").trim(),
      stderr: (err.stderr || "").trim(),
      exitCode: err.status ?? 1,
    };
  }
}

describe("git", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempRepo();
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  describe("getGitDir", () => {
    it("returns .git path inside a git repo", () => {
      const result = runInDir(tempDir, `
        const dir = getGitDir();
        process.stdout.write(dir ?? "NULL");
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe(".git");
    });

    it("returns null outside a git repo", () => {
      const noRepoDir = mkdtempSync(join(tmpdir(), "vibemit-norepo-"));
      try {
        const result = runInDir(noRepoDir, `
          const dir = getGitDir();
          process.stdout.write(dir ?? "NULL");
        `);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBe("NULL");
      } finally {
        cleanupTempDir(noRepoDir);
      }
    });
  });

  describe("isGitRepo", () => {
    it("returns true inside a git repo", () => {
      const result = runInDir(tempDir, `
        process.stdout.write(String(isGitRepo()));
      `);
      expect(result.stdout).toBe("true");
    });

    it("returns false outside a git repo", () => {
      const noRepoDir = mkdtempSync(join(tmpdir(), "vibemit-norepo-"));
      try {
        const result = runInDir(noRepoDir, `
          process.stdout.write(String(isGitRepo()));
        `);
        expect(result.stdout).toBe("false");
      } finally {
        cleanupTempDir(noRepoDir);
      }
    });
  });

  describe("getStagedDiff", () => {
    it("returns diff string when files are staged", () => {
      writeFileSync(join(tempDir, "hello.txt"), "hello world\n");
      execSync("git add hello.txt", { cwd: tempDir, stdio: "pipe" });

      const result = runInDir(tempDir, `
        const diff = getStagedDiff();
        process.stdout.write(diff);
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("hello world");
      expect(result.stdout).toContain("diff --git");
    });

    it("throws when nothing is staged", () => {
      const result = runInDir(tempDir, `
        try {
          getStagedDiff();
          process.stdout.write("NO_THROW");
        } catch (err) {
          process.stdout.write("THREW:" + err.message);
        }
      `);
      expect(result.stdout).toContain("THREW:");
      expect(result.stdout).toContain("No staged changes");
    });

    it("respects custom max diff line limits", () => {
      const lines = Array.from({ length: 30 }, (_, i) => `line-${i + 1}`).join("\n") + "\n";
      writeFileSync(join(tempDir, "large.txt"), lines);
      execSync("git add large.txt", { cwd: tempDir, stdio: "pipe" });

      const result = runInDir(tempDir, `
        const diff = getStagedDiff(10);
        process.stdout.write(diff);
      `);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("[Diff truncated: showing 10 of");
    });
  });

  describe("commit", () => {
    it("creates a commit with the exact message", () => {
      writeFileSync(join(tempDir, "file.txt"), "content\n");
      execSync("git add file.txt", { cwd: tempDir, stdio: "pipe" });

      const result = runInDir(tempDir, `
        const out = commit("Add file.txt for testing");
        process.stdout.write(out);
      `);
      expect(result.exitCode).toBe(0);

      // Verify the commit was created with the right message
      const log = execSync("git log -1 --format=%s", {
        cwd: tempDir,
        encoding: "utf-8",
      }).trim();
      expect(log).toBe("Add file.txt for testing");
    });

    it("handles messages with single quotes", () => {
      writeFileSync(join(tempDir, "file.txt"), "content\n");
      execSync("git add file.txt", { cwd: tempDir, stdio: "pipe" });

      const result = runInDir(tempDir, `
        const out = commit("Fix the user's profile page");
        process.stdout.write(out);
      `);
      expect(result.exitCode).toBe(0);

      const log = execSync("git log -1 --format=%s", {
        cwd: tempDir,
        encoding: "utf-8",
      }).trim();
      expect(log).toBe("Fix the user's profile page");
    });

    it("handles messages with double quotes", () => {
      writeFileSync(join(tempDir, "file.txt"), "content\n");
      execSync("git add file.txt", { cwd: tempDir, stdio: "pipe" });

      const result = runInDir(tempDir, `
        const out = commit('Add "hello" greeting to output');
        process.stdout.write(out);
      `);
      expect(result.exitCode).toBe(0);

      const log = execSync("git log -1 --format=%s", {
        cwd: tempDir,
        encoding: "utf-8",
      }).trim();
      expect(log).toBe('Add "hello" greeting to output');
    });

    it("handles messages with parentheses (conventional commits)", () => {
      writeFileSync(join(tempDir, "file.txt"), "content\n");
      execSync("git add file.txt", { cwd: tempDir, stdio: "pipe" });

      const result = runInDir(tempDir, `
        const out = commit("feat(auth): add login endpoint");
        process.stdout.write(out);
      `);
      expect(result.exitCode).toBe(0);

      const log = execSync("git log -1 --format=%s", {
        cwd: tempDir,
        encoding: "utf-8",
      }).trim();
      expect(log).toBe("feat(auth): add login endpoint");
    });
  });
});

describe("summarizeNoisyFiles", () => {
  it("replaces package-lock.json diff with placeholder", () => {
    const diff = [
      "diff --git a/package-lock.json b/package-lock.json",
      "index abc1234..def5678 100644",
      "--- a/package-lock.json",
      "+++ b/package-lock.json",
      "@@ -1,5 +1,5 @@",
      ' "name": "my-app",',
      '- "version": "1.0.0",',
      '+ "version": "1.1.0",',
    ].join("\n");

    const result = summarizeNoisyFiles(diff);
    expect(result).toBe("[package-lock.json changed]");
  });

  it("preserves source file diffs alongside lockfile placeholders", () => {
    const diff = [
      "diff --git a/src/index.ts b/src/index.ts",
      "index abc1234..def5678 100644",
      "--- a/src/index.ts",
      "+++ b/src/index.ts",
      "@@ -1,3 +1,4 @@",
      "+import { foo } from './foo';",
      " console.log('hello');",
      "diff --git a/yarn.lock b/yarn.lock",
      "index 1111111..2222222 100644",
      "--- a/yarn.lock",
      "+++ b/yarn.lock",
      "@@ -1,100 +1,100 @@",
      " resolved version changes...",
    ].join("\n");

    const result = summarizeNoisyFiles(diff);
    expect(result).toContain("diff --git a/src/index.ts b/src/index.ts");
    expect(result).toContain("import { foo }");
    expect(result).toContain("[yarn.lock changed]");
    expect(result).not.toContain("resolved version changes");
  });

  it("returns diff unchanged when no noisy files are present", () => {
    const diff = [
      "diff --git a/src/app.ts b/src/app.ts",
      "index abc1234..def5678 100644",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1,3 +1,4 @@",
      "+const x = 1;",
      " export default x;",
    ].join("\n");

    const result = summarizeNoisyFiles(diff);
    expect(result).toBe(diff);
  });

  it("handles nested path lockfiles", () => {
    const diff = [
      "diff --git a/packages/foo/pnpm-lock.yaml b/packages/foo/pnpm-lock.yaml",
      "index abc1234..def5678 100644",
      "--- a/packages/foo/pnpm-lock.yaml",
      "+++ b/packages/foo/pnpm-lock.yaml",
      "@@ -1,50 +1,50 @@",
      " lockfile content...",
    ].join("\n");

    const result = summarizeNoisyFiles(diff);
    expect(result).toBe("[packages/foo/pnpm-lock.yaml changed]");
  });

  it("handles multiple noisy files in a single diff", () => {
    const diff = [
      "diff --git a/package-lock.json b/package-lock.json",
      "index abc..def 100644",
      "--- a/package-lock.json",
      "+++ b/package-lock.json",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "diff --git a/Cargo.lock b/Cargo.lock",
      "index 111..222 100644",
      "--- a/Cargo.lock",
      "+++ b/Cargo.lock",
      "@@ -1 +1 @@",
      "-old",
      "+new",
    ].join("\n");

    const result = summarizeNoisyFiles(diff);
    expect(result).toContain("[package-lock.json changed]");
    expect(result).toContain("[Cargo.lock changed]");
    expect(result).not.toContain("diff --git");
  });
});
