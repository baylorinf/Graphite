// Stop hook: nudges Claude to run the update-brain skill during study chats.
// Fires when the user has sent THRESHOLD new messages since the brain was last
// updated in this chat, or sooner when their latest message sounds like a wrap-up.
// Any error exits silently so a broken hook never blocks a chat.
const fs = require("fs");
const path = require("path");
const os = require("os");

// Settings: ~/.claude/graphite.json (Graphite → Settings → Claude Code writes it), or GRAPHITE_CONFIG.
const graphite = (() => {
  const file = process.env.GRAPHITE_CONFIG || path.join(os.homedir(), ".claude", "graphite.json");
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return {}; }
})();
const VAULT = (graphite.vault || "").replace(/\\/g, "/");
const low = p => String(p).replace(/\\/g, "/").toLowerCase();
const STUDY_ROOTS = [graphite.studyRoot, VAULT, VAULT && path.dirname(VAULT)].filter(Boolean).map(low);
const BRAIN_DIR = VAULT ? low(VAULT + "/" + (graphite.brainFolder || "Claude Brain")) : "\u0000";
const THRESHOLD = Number(process.env.BRAIN_UPDATE_THRESHOLD || 3);
const WRAP_UP = /\b(thanks|thank you|thx|bye|good ?night|that'?s (it|all)|done (for today|studying)|see you|gotta go)\b/i;

const norm = p => String(p || "").replace(/\\/g, "/").toLowerCase();

function userText(entry) {
  if (entry.type !== "user" || entry.isMeta) return null;
  const c = entry.message && entry.message.content;
  let text = null;
  if (typeof c === "string") text = c;
  else if (Array.isArray(c)) {
    if (c.some(b => b.type === "tool_result")) return null;
    const t = c.find(b => b.type === "text");
    text = t ? t.text : null;
  }
  // system-injected entries (command tags, reminders) start with "<"
  if (!text || text.trimStart().startsWith("<")) return null;
  return text;
}

function isBrainUpdate(entry) {
  if (entry.type !== "assistant") return false;
  const c = entry.message && entry.message.content;
  if (!Array.isArray(c)) return false;
  return c.some(b => b.type === "tool_use" && (
    (b.name === "Skill" && /update-brain/.test((b.input && b.input.skill) || "")) ||
    ((b.name === "Write" || b.name === "Edit") && norm(b.input && b.input.file_path).startsWith(BRAIN_DIR))
  ));
}

function main(input) {
  if (input.stop_hook_active) return;
  if (!STUDY_ROOTS.some(r => norm(input.cwd).startsWith(r))) return;
  if (!input.transcript_path || !fs.existsSync(input.transcript_path)) return;

  const entries = fs.readFileSync(input.transcript_path, "utf8").split("\n").filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

  let fresh = [];
  for (const e of entries) {
    if (isBrainUpdate(e)) { fresh = []; continue; }
    const t = userText(e);
    if (t !== null) fresh.push(t);
  }
  if (fresh.length === 0) return;
  const wrapping = WRAP_UP.test(fresh[fresh.length - 1]);
  if (fresh.length < THRESHOLD && !wrapping) return;

  process.stdout.write(JSON.stringify({
    decision: "block",
    reason: `Automatic brain update: the user has sent ${fresh.length} message(s) since the last brain update in this chat. ` +
      "Run the update-brain skill now for that part of the conversation only, without redoing anything already recorded. " +
      "Keep the report to two or three lines, then end your turn."
  }));
}

let raw = "";
process.stdin.on("data", d => raw += d);
process.stdin.on("end", () => {
  try { main(JSON.parse(raw || "{}")); } catch (e) { /* stay silent */ }
  process.exit(0);
});
