import { execSync } from "node:child_process";
import { platform } from "node:os";

/**
 * Copies text to the system clipboard.
 * Returns true on success, false if no clipboard tool is available.
 */
export function copyToClipboard(text: string): boolean {
  const os = platform();

  try {
    if (os === "darwin") {
      execSync("pbcopy", { input: text, stdio: ["pipe", "pipe", "pipe"] });
      return true;
    }

    if (os === "linux") {
      // Try wayland first, then X11
      try {
        execSync("wl-copy", { input: text, stdio: ["pipe", "pipe", "pipe"] });
        return true;
      } catch {
        // wl-copy not available, try xclip
      }

      try {
        execSync("xclip -selection clipboard", {
          input: text,
          stdio: ["pipe", "pipe", "pipe"],
        });
        return true;
      } catch {
        // xclip not available either
      }
    }
  } catch {
    // Clipboard command failed
  }

  return false;
}
