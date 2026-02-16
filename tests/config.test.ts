import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function createTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "vibemit-config-test-"));
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: "pipe" });
  execSync('git config user.name "Test"', { cwd: dir, stdio: "pipe" });
  return dir;
}

function cleanupTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

/**
 * Run config functions in a temp directory via a child process so that
 * getGitDir() resolves relative to the temp repo.
 */
function runInDir(dir: string, code: string): { stdout: string; stderr: string; exitCode: number } {
  const configPath = join(process.cwd(), "dist", "config.js").replace(/\\/g, "/");
  const script = `
    import { getRulesPath, getRules, addRule, clearRules } from "${configPath}";
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

describe("config", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempRepo();
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  describe("getRulesPath", () => {
    it("returns .git/vibemit.json inside a git repo", () => {
      const result = runInDir(tempDir, `
        process.stdout.write(getRulesPath());
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe(".git/vibemit.json");
    });

    it("returns global config path outside a git repo", () => {
      const noRepoDir = mkdtempSync(join(tmpdir(), "vibemit-norepo-"));
      try {
        const result = runInDir(noRepoDir, `
          process.stdout.write(getRulesPath());
        `);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain(".config/vibemit/config.json");
      } finally {
        cleanupTempDir(noRepoDir);
      }
    });
  });

  describe("getRules", () => {
    it("returns empty array when no config file exists", () => {
      const result = runInDir(tempDir, `
        process.stdout.write(JSON.stringify(getRules()));
      `);
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual([]);
    });

    it("returns empty array for malformed JSON", () => {
      writeFileSync(join(tempDir, ".git", "vibemit.json"), "not valid json{{{");

      const result = runInDir(tempDir, `
        process.stdout.write(JSON.stringify(getRules()));
      `);
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual([]);
    });

    it("returns empty array when rules key is not an array", () => {
      writeFileSync(
        join(tempDir, ".git", "vibemit.json"),
        JSON.stringify({ rules: "not an array" })
      );

      const result = runInDir(tempDir, `
        process.stdout.write(JSON.stringify(getRules()));
      `);
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual([]);
    });
  });

  describe("addRule", () => {
    it("creates config file and persists the rule", () => {
      const result = runInDir(tempDir, `
        addRule("Always mention ticket number");
        process.stdout.write(JSON.stringify(getRules()));
      `);
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual(["Always mention ticket number"]);

      // Verify the file exists on disk
      const configPath = join(tempDir, ".git", "vibemit.json");
      expect(existsSync(configPath)).toBe(true);

      const raw = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(raw.rules).toEqual(["Always mention ticket number"]);
    });

    it("accumulates multiple rules", () => {
      const result = runInDir(tempDir, `
        addRule("Rule one");
        addRule("Rule two");
        addRule("Rule three");
        process.stdout.write(JSON.stringify(getRules()));
      `);
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual(["Rule one", "Rule two", "Rule three"]);
    });

    it("persists rules across separate invocations", () => {
      runInDir(tempDir, `addRule("First rule");`);
      runInDir(tempDir, `addRule("Second rule");`);

      const result = runInDir(tempDir, `
        process.stdout.write(JSON.stringify(getRules()));
      `);
      expect(JSON.parse(result.stdout)).toEqual(["First rule", "Second rule"]);
    });
  });

  describe("clearRules", () => {
    it("deletes the config file", () => {
      runInDir(tempDir, `addRule("Some rule");`);

      const configPath = join(tempDir, ".git", "vibemit.json");
      expect(existsSync(configPath)).toBe(true);

      runInDir(tempDir, `clearRules();`);
      expect(existsSync(configPath)).toBe(false);
    });

    it("is a no-op when no config file exists", () => {
      const result = runInDir(tempDir, `
        clearRules();
        process.stdout.write("OK");
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("OK");
    });

    it("returns empty rules after clearing", () => {
      runInDir(tempDir, `
        addRule("Rule to delete");
      `);
      runInDir(tempDir, `clearRules();`);

      const result = runInDir(tempDir, `
        process.stdout.write(JSON.stringify(getRules()));
      `);
      expect(JSON.parse(result.stdout)).toEqual([]);
    });
  });
});
