# vibemit

AI-generated Git commit messages using a local LLM via [Ollama](https://ollama.com). Everything runs on your machine.

## Prerequisites

- [Node.js](https://nodejs.org) >= 18
- [Ollama](https://ollama.com) installed and running
- A pulled model (default: `qwen3:8b`)

```bash
# Install Ollama
brew install ollama        # macOS
curl -fsSL https://ollama.com/install.sh | sh  # Linux

# Start the server and pull the default model
ollama serve
ollama pull qwen3:8b
```

## Install

```bash
npm install -g vibemit
```

Or run directly:

```bash
npx vibemit
```

## Usage

Stage your changes, then run:

```bash
git add -p
vibemit
```

vibemit reads your staged diff, generates 3 commit message candidates using a local LLM, and lets you pick one interactively.

### Flags

| Flag | Short | Description |
|---|---|---|
| `--model <name>` | | Ollama model to use (default: `qwen3:8b`) |
| `--intent <text>` | | High-priority intent guidance for commit wording |
| `--conventional` | | Conventional Commit format (`type(scope): subject`) |
| `--body` | | Include subject + body (1-3 bullet points) |
| `--dry-run` | `-d` | Print selected message, do not commit |
| `--clipboard` | `-c` | Copy selected message to clipboard, do not commit |
| `--yes` | `-y` | Auto-select the first option (skip prompt) |
| `--add-rule <text>` | `-r` | Add a persistent rule |
| `--rules` | | Print saved rules |
| `--clear-rules` | | Delete all saved rules |

### Examples

```bash
# Basic usage
vibemit

# Conventional commits with a body
vibemit --conventional --body

# Dry run with clipboard copy
vibemit -d -c

# Auto-select first option (for scripting)
vibemit -y

# Use a different model
vibemit --model llama3.2:3b

# Provide explicit commit intent
vibemit --intent "Initial scaffold for vibemit CLI with Ollama integration"

# Add a custom rule
vibemit --add-rule "Use lowercase for subject line"
vibemit --add-rule "Always mention the affected component"

# View and clear rules
vibemit --rules
vibemit --clear-rules
```

### Flag Combinations

| Flags | Behavior |
|---|---|
| (none) | Select message, then `git commit` |
| `--dry-run` | Print only, no commit |
| `--clipboard` | Copy only, no commit |
| `--dry-run --clipboard` | Print and copy, no commit |
| `--yes` | Auto-select first, then commit |
| `--yes --dry-run` | Auto-select first, print only |

## Rules

vibemit supports persistent rules that are included in every prompt. Rules are stored per-repo when inside a Git repository, with a global fallback.

**Storage locations:**
- Per-repo: `.git/vibemit.json`
- Global fallback: `~/.config/vibemit/config.json`

```bash
# Add rules
vibemit -r "Use lowercase for subject line"
vibemit -r "Always mention the affected component"

# View rules
vibemit --rules

# Clear all rules
vibemit --clear-rules
```

## How It Works

1. Reads your staged diff via `git diff --staged`
2. Sends the diff to a local Ollama model with a carefully tuned prompt
3. Parses the response into 3 distinct commit message candidates
4. Presents an interactive selection menu
5. Commits with the selected message (or copies/prints based on flags)

The model runs locally — no data leaves your machine.

## Development

```bash
git clone https://github.com/williamgrosset/vibemit.git
cd vibemit
npm install
npm run build
node dist/cli.js
```

Watch mode:

```bash
npm run dev
```

## License

MIT
