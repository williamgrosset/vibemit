import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CLI_PATH = join(process.cwd(), "dist", "cli.js");

function createTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "vibemit-cli-test-"));
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: "pipe" });
  execSync('git config user.name "Test"', { cwd: dir, stdio: "pipe" });
  return dir;
}

function stageFile(dir: string, name: string, content: string): void {
  writeFileSync(join(dir, name), content);
  execSync(`git add ${name}`, { cwd: dir, stdio: "pipe" });
}

function cleanupTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runCLI(args: string, dir: string, env?: Record<string, string>): RunResult {
  try {
    const stdout = execSync(`node ${CLI_PATH} ${args}`, {
      cwd: dir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...env },
      timeout: 10_000,
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CLI", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempRepo();
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  describe("--help", () => {
    it("exits 0 and shows all flags", () => {
      const result = runCLI("--help", tempDir);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Usage:");
      expect(result.stdout).toContain("--model");
      expect(result.stdout).toContain("--intent");
      expect(result.stdout).toContain("--conventional");
      expect(result.stdout).toContain("--body");
      expect(result.stdout).toContain("--dry-run");
      expect(result.stdout).toContain("--clipboard");
      expect(result.stdout).toContain("--yes");
      expect(result.stdout).toContain("--add-rule");
      expect(result.stdout).toContain("--rules");
      expect(result.stdout).toContain("--clear-rules");
    });
  });

  describe("--version", () => {
    it("exits 0 and prints a semver string", () => {
      const result = runCLI("--version", tempDir);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe("no staged changes", () => {
    it("exits 1 with helpful error", () => {
      // Point OLLAMA_HOST somewhere unreachable — the staged check
      // happens before the Ollama check, so it should never matter.
      const result = runCLI("", tempDir, { OLLAMA_HOST: "http://127.0.0.1:1" });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("No staged changes found");
      expect(result.stderr).toContain("git add");
    });
  });

  describe("Ollama unreachable", () => {
    it("exits 1 with server-not-running error when there are staged changes", () => {
      stageFile(tempDir, "file.txt", "hello\n");

      const result = runCLI("--yes", tempDir, { OLLAMA_HOST: "http://127.0.0.1:19999" });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("not running");
    });
  });

  describe("rules management", () => {
    it("--rules shows no rules when none exist", () => {
      const result = runCLI("--rules", tempDir);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("No rules saved");
    });

    it("--add-rule persists a rule and --rules lists it", () => {
      const addResult = runCLI('--add-rule "Always mention ticket number"', tempDir);
      expect(addResult.exitCode).toBe(0);
      expect(addResult.stdout).toContain("Rule added");

      const listResult = runCLI("--rules", tempDir);
      expect(listResult.exitCode).toBe(0);
      expect(listResult.stdout).toContain("Always mention ticket number");
    });

    it("multiple --add-rule calls accumulate", () => {
      runCLI('--add-rule "Rule one"', tempDir);
      runCLI('--add-rule "Rule two"', tempDir);

      const result = runCLI("--rules", tempDir);
      expect(result.stdout).toContain("Rule one");
      expect(result.stdout).toContain("Rule two");
    });

    it("--clear-rules deletes all rules", () => {
      runCLI('--add-rule "Temporary rule"', tempDir);

      const clearResult = runCLI("--clear-rules", tempDir);
      expect(clearResult.exitCode).toBe(0);
      expect(clearResult.stdout).toContain("All rules cleared");

      const listResult = runCLI("--rules", tempDir);
      expect(listResult.stdout).toContain("No rules saved");
    });

    it("stores rules in .git/vibemit.json", () => {
      runCLI('--add-rule "Test rule"', tempDir);

      const configPath = join(tempDir, ".git", "vibemit.json");
      expect(existsSync(configPath)).toBe(true);

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.rules).toEqual(["Test rule"]);
    });

    it("--clear-rules is a no-op when no rules exist", () => {
      const result = runCLI("--clear-rules", tempDir);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("All rules cleared");
    });
  });
});
