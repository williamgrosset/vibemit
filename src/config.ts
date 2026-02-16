import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { getGitDir } from "./git.js";

interface Config {
  rules: string[];
}

const GLOBAL_CONFIG_DIR = join(homedir(), ".config", "vibemit");
const GLOBAL_CONFIG_PATH = join(GLOBAL_CONFIG_DIR, "config.json");

/**
 * Returns the path to the rules config file.
 * Prefers .git/vibemit.json if inside a git repo, otherwise falls back
 * to ~/.config/vibemit/config.json.
 */
export function getRulesPath(): string {
  const gitDir = getGitDir();
  if (gitDir) {
    return join(gitDir, "vibemit.json");
  }
  return GLOBAL_CONFIG_PATH;
}

/**
 * Loads the config from disk. Returns a default config if the file
 * doesn't exist or is malformed.
 */
function loadConfig(path: string): Config {
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<Config>;
    return {
      rules: Array.isArray(parsed.rules) ? parsed.rules : [],
    };
  } catch {
    return { rules: [] };
  }
}

/**
 * Saves the config to disk, creating parent directories as needed.
 */
function saveConfig(path: string, config: Config): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

/**
 * Returns all saved rules.
 */
export function getRules(): string[] {
  const path = getRulesPath();
  return loadConfig(path).rules;
}

/**
 * Adds a rule and persists it.
 */
export function addRule(rule: string): void {
  const path = getRulesPath();
  const config = loadConfig(path);
  config.rules.push(rule);
  saveConfig(path, config);
}

/**
 * Deletes the rules config file.
 */
export function clearRules(): void {
  const path = getRulesPath();
  try {
    unlinkSync(path);
  } catch {
    // File doesn't exist — nothing to clear.
  }
}
