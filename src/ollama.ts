import { execSync } from "node:child_process";

const DEFAULT_BASE_URL = "http://localhost:11434";

function getBaseUrl(): string {
  return process.env.OLLAMA_HOST || DEFAULT_BASE_URL;
}

interface GenerateRequest {
  model: string;
  prompt: string;
  system: string;
  format?: "json" | Record<string, unknown>;
  stream: false;
  think: false;
  options: {
    temperature: number;
    num_predict: number;
    repeat_penalty: number;
  };
}

interface GenerateResponse {
  response: string;
}

const COMMIT_MESSAGES_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    messages: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "string",
      },
    },
  },
  required: ["messages"],
  additionalProperties: false,
};

/**
 * Checks that Ollama is installed and the server is reachable.
 * Exits the process with instructions if either check fails.
 */
export async function checkOllama(): Promise<void> {
  // Check if ollama binary is installed
  try {
    execSync("which ollama", { stdio: ["pipe", "pipe", "pipe"] });
  } catch {
    console.error(
      [
        "Error: Ollama is not installed.",
        "",
        "Install Ollama:",
        "  macOS:  brew install ollama",
        "  Linux:  curl -fsSL https://ollama.com/install.sh | sh",
        "",
        "Then start the server:",
        "  ollama serve",
        "",
        "More info: https://ollama.com",
      ].join("\n")
    );
    process.exit(1);
  }

  // Check if the server is reachable
  try {
    const res = await fetch(`${getBaseUrl()}/api/tags`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
  } catch {
    console.error(
      [
        "Error: Ollama server is not running.",
        "",
        "Start the server:",
        "  ollama serve",
        "",
        "Then try again.",
      ].join("\n")
    );
    process.exit(1);
  }
}

/**
 * Generates commit message candidates via the Ollama REST API.
 */
export async function generateCommitMessages(
  systemPrompt: string,
  userPrompt: string,
  model: string,
  hasBody: boolean
): Promise<string[]> {
  const maxTokens = hasBody ? 400 : 300;
  const MAX_ATTEMPTS = 3;
  const BASE_TEMPERATURE = 0.2;
  const TEMPERATURE_STEP = 0.2;

  let candidates: string[] = [];

  for (let attempt = 0; attempt < MAX_ATTEMPTS && candidates.length < 3; attempt++) {
    const temperature = BASE_TEMPERATURE + attempt * TEMPERATURE_STEP;

    const body: GenerateRequest = {
      model,
      prompt: userPrompt,
      system: systemPrompt,
      format: COMMIT_MESSAGES_SCHEMA,
      stream: false,
      think: false,
      options: {
        temperature,
        num_predict: maxTokens,
        repeat_penalty: 1.1,
      },
    };

    const raw = await callOllama(body);
    const parsed = filterValidCommitMessages(parseResponse(raw, hasBody), hasBody);

    for (const c of parsed) {
      if (!candidates.includes(c)) {
        candidates.push(c);
      }
    }
  }

  candidates = candidates.slice(0, 3);

  if (candidates.length === 0) {
    console.error("Error: Failed to generate commit messages. The model returned an empty or invalid response.");
    process.exit(1);
  }

  // Validate subject line length (<=72 chars) for non-body messages
  if (!hasBody) {
    candidates = await Promise.all(
      candidates.map((c) => validateSubjectLength(c, model))
    );
  } else {
    // For body messages, validate just the first line
    candidates = await Promise.all(
      candidates.map((c) => validateBodySubjectLength(c, model))
    );
  }

  return candidates;
}

/**
 * Calls the Ollama /api/generate endpoint.
 */
async function callOllama(body: GenerateRequest): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${getBaseUrl()}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error("Error: Could not connect to Ollama server.");
    process.exit(1);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`Error: Ollama returned HTTP ${res.status}.`);
    if (text) {
      console.error(text);
    }
    process.exit(1);
  }

  const data = (await res.json()) as GenerateResponse;
  return data.response;
}

/**
 * Parses the raw model output into individual commit message candidates.
 */
export function parseResponse(raw: string, hasBody: boolean): string[] {
  if (!raw || !raw.trim()) {
    return [];
  }

  // qwen3 models may output <think>...</think> blocks before the actual
  // response. Strip the entire thinking block.
  let cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  if (!cleaned) {
    return [];
  }

  let candidates: string[];

  const structured = parseStructuredResponse(cleaned);
  if (structured) {
    candidates = structured
      .map((c) => cleanCandidate(c))
      .filter((c) => c.length > 0);

    return dedupeCandidates(candidates).slice(0, 3);
  }

  if (hasBody) {
    // Body messages are separated by double blank lines
    candidates = cleaned
      .split(/\n{3,}/)
      .map((c) => cleanCandidate(c))
      .filter((c) => c.length > 0);
  } else {
    // Single-line messages separated by newlines
    candidates = cleaned
      .split("\n")
      .map((c) => cleanCandidate(c))
      .filter((c) => c.length > 0);
  }

  return dedupeCandidates(candidates).slice(0, 3);
}

function parseStructuredResponse(raw: string): string[] | null {
  const attempts: string[] = [raw.trim()];

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    attempts.push(fenced[1].trim());
  }

  for (const candidate of attempts) {
    if (!candidate) {
      continue;
    }

    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((v): v is string => typeof v === "string");
      }

      if (
        parsed &&
        typeof parsed === "object" &&
        "messages" in parsed &&
        Array.isArray((parsed as { messages: unknown }).messages)
      ) {
        return (parsed as { messages: unknown[] }).messages.filter(
          (v): v is string => typeof v === "string"
        );
      }
    } catch {
      // Not structured output, continue with plain-text fallback.
    }
  }

  return null;
}

function dedupeCandidates(candidates: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const c of candidates) {
    const key = c.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(c);
    }
  }

  return unique;
}

/**
 * Cleans a single candidate: removes numbering, bullets, markdown,
 * quotes, and leading/trailing whitespace.
 */
export function cleanCandidate(text: string): string {
  let cleaned = text.trim();

  // Remove leading numbering: "1. ", "1) ", "1: "
  cleaned = cleaned.replace(/^\d+[\.\)\:]\s*/, "");

  // Remove leading bullets: "- ", "* ", "• "
  cleaned = cleaned.replace(/^[-\*\u2022]\s*/, "");

  // Remove wrapping quotes
  cleaned = cleaned.replace(/^["'`]+|["'`]+$/g, "");

  // Remove wrapping backticks or markdown bold/italic
  cleaned = cleaned.replace(/^[`*_]+|[`*_]+$/g, "");

  // Remove </think> tags (qwen3 thinking artifacts)
  cleaned = cleaned.replace(/<\/?think>/gi, "");

  // Trim again after cleaning
  cleaned = cleaned.trim();

  // Reject empty candidates
  if (cleaned.length === 0) {
    return "";
  }

  return cleaned;
}

function filterValidCommitMessages(messages: string[], hasBody: boolean): string[] {
  return messages.filter((message) => isValidCommitMessage(message, hasBody));
}

function isValidCommitMessage(message: string, hasBody: boolean): boolean {
  if (!message || message.trim().length === 0) {
    return false;
  }

  if (message.includes("```")) {
    return false;
  }

  const lines = message.split("\n");
  const subject = lines[0]?.trim() ?? "";
  if (!subject) {
    return false;
  }

  if (!hasBody && lines.length > 1) {
    return false;
  }

  if (!hasBody && /\s[-*\u2022]\s+/.test(subject)) {
    return false;
  }

  if (hasBody) {
    const bodyLines = lines.slice(1).filter((line) => line.trim().length > 0);
    if (bodyLines.length === 0) {
      return false;
    }
  }

  return true;
}

/**
 * If a single-line subject exceeds 72 characters, asks the model to
 * shorten it. Falls back to truncation.
 */
async function validateSubjectLength(
  message: string,
  model: string
): Promise<string> {
  if (message.length <= 72) {
    return message;
  }

  // Ask the model to shorten
  try {
    const body: GenerateRequest = {
      model,
      prompt: `Shorten the following Git commit message to <= 72 characters without losing meaning. Return ONLY the shortened message, nothing else.\n\n${message}`,
      system:
        "You shorten Git commit messages. Return only the shortened message. No commentary.",
      stream: false,
      think: false,
      options: {
        temperature: 0.1,
        num_predict: 80,
        repeat_penalty: 1.1,
      },
    };

    const raw = await callOllama(body);
    const shortened = cleanCandidate(raw);
    if (shortened && shortened.length <= 72) {
      return shortened;
    }
  } catch {
    // Shortening failed, fall through to truncation
  }

  // Last resort: truncate
  return message.slice(0, 69) + "...";
}

/**
 * For body-format messages, validates just the subject line (first line).
 */
async function validateBodySubjectLength(
  message: string,
  model: string
): Promise<string> {
  const lines = message.split("\n");
  const subject = lines[0];

  if (!subject || subject.length <= 72) {
    return message;
  }

  const shortened = await validateSubjectLength(subject, model);
  lines[0] = shortened;
  return lines.join("\n");
}
