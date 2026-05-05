import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Markdown skill text describing when and how the agent should call the
 * feedback tools. Inject this into your system prompt.
 *
 * Loaded from `skills/feedback.md` so it can be edited without recompiling.
 */
export const feedbackSkill: string = (() => {
  // dist/skill.js → ../skills/feedback.md
  const candidates = [
    path.join(__dirname, "..", "skills", "feedback.md"),
    path.join(__dirname, "..", "..", "skills", "feedback.md"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf-8");
  }
  // Fallback: empty string. Caller can supply their own instructions.
  return "";
})();
