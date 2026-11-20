// SessionStart / UserPromptSubmit hook: tells Claude when the Graphite ✦ button
// has left captures waiting in "Claude Inbox.md", so they get filed into notes.
// Reminds once per session start, then only when new captures appear.
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
if (!VAULT && !process.env.CLAUDE_INBOX_PATH) process.exit(0); // not set up yet
const INBOX = process.env.CLAUDE_INBOX_PATH || VAULT + "/Claude Inbox.md";
const BRAIN = process.env.CLAUDE_BRAIN_PATH || VAULT + "/" + (graphite.brainFolder || "Claude Brain");
const QUIZ = BRAIN + "/quiz-results.md";
const BRAIN_LOG = BRAIN + "/log.md";
const STATE =path.join(os.homedir(), ".claude", "hooks", ".obsidian-inbox-state.json");

function pendingIds(text) {
  const ids = [];
  for (const line of text.split(/\r?\n/)) {
    if (!/^- \[ \] /.test(line)) continue;
    const m = line.match(/%%(cap-[\w-]+)%%/);
    ids.push(m ? m[1] : line.slice(6, 80));
  }
  return ids;
}

const mtime = p => { try { return fs.statSync(p).mtimeMs; } catch { return 0; } };

// Graphite chat panel (claude-chat plugin): unanswered messages, and whether a session is listening.
const CHAT = process.env.CLAUDE_CHAT_DIR || VAULT + "/.obsidian/plugins/claude-chat/chat";
// Claude sessions started in these folders are study sessions (the chat connects by itself there).
const STUDY_ROOTS = [graphite.studyRoot, VAULT, VAULT && path.dirname(VAULT)].filter(Boolean).map(p => String(p).replace(/\\/g, "/").toLowerCase());
function chatState() {
  let lines = [];
  try { lines = fs.readFileSync(CHAT + "/outbox.jsonl", "utf8").split(/\r?\n/).filter(Boolean); } catch { return { unanswered: 0, listening: false }; }
  let msgs = [];
  for (const l of lines) { let m; try { m = JSON.parse(l); } catch { continue; } if (m.type === "new") msgs = []; else if (m.type === "user") msgs.push(m.id); }
  const unanswered = msgs.filter(id => !fs.existsSync(CHAT + "/replies/" + id + ".md")).length;
  let st = null; try { st = JSON.parse(fs.readFileSync(CHAT + "/status.json", "utf8")); } catch { /* none */ }
  return { unanswered, listening: !!(st && st.listening && Date.now() - st.at < 15000) };
}

function main(input) {
  const ids = fs.existsSync(INBOX) ? pendingIds(fs.readFileSync(INBOX, "utf8")) : [];
  const event = input.hook_event_name || "SessionStart";
  const sid = input.session_id || "none";

  let state = {};
  try { state = JSON.parse(fs.readFileSync(STATE, "utf8")); } catch { /* first run */ }
  const prev = Array.isArray(state[sid]) ? { ids: state[sid] } : (state[sid] || {});
  const start = event === "SessionStart";
  const seen = new Set(start ? [] : (prev.ids || []));
  const fresh = ids.filter(id => !seen.has(id));

  // Quiz scores from the 🎓 button: mention them when they changed after the brain was last updated
  // (at session start) or since the last notice (during the session).
  const quizAt = mtime(QUIZ);
  const quizBaseline = start ? mtime(BRAIN_LOG) : (prev.quizAt || mtime(BRAIN_LOG));
  const quizNew = quizAt > quizBaseline + 1000;

  state[sid] = { ids, quizAt: Math.max(quizAt, prev.quizAt || 0) };
  const keys = Object.keys(state);
  if (keys.length > 30) for (const k of keys.slice(0, keys.length - 30)) delete state[k];
  try { fs.writeFileSync(STATE, JSON.stringify(state)); } catch { /* ignore */ }

  const parts = [];
  if (fresh.length) parts.push(
    `Graphite: ${ids.length} capture(s) from the user's ✦ button are waiting in ${INBOX}` +
    (start ? "" : ` (${fresh.length} new since the last notice)`) + ". " +
    "Use the obsidian-inbox skill to file them into the user's notes in their own format, tick them, and update the Claude Brain. " +
    "Do it in this turn along with whatever the user asked, and report it in a few lines. " +
    "If the user is clearly in the middle of unrelated work, mention the waiting captures in one line and offer to file them instead.");
  if (quizNew) parts.push(
    `Graphite: the user's quiz scores changed (${QUIZ}, written by the 🎓 Quizzes button). ` +
    "Read it and record the new scores as evidence with the update-brain skill (quiz 4/5 or better = demonstrated; below 3/5 = confused or shaky), " +
    "then tell the user in one or two lines what moved and what to review. Skip this if the user is busy with unrelated work.");

  // Chat panel: connect automatically when a study session starts; otherwise speak up when messages wait.
  const chat = chatState();
  const cwd = String(input.cwd || "").replace(/\\/g, "/").toLowerCase();
  const studySession = STUDY_ROOTS.some(r => cwd.startsWith(r));
  if (!chat.listening && (chat.unanswered || (start && studySession && fs.existsSync(CHAT)))) parts.push(
    "Graphite chat: " + (chat.unanswered ? `${chat.unanswered} message(s) typed in the Claude chat panel are waiting for an answer. ` : "the user keeps this Claude window open while studying in Graphite, whose right sidebar has a Claude chat panel. ") +
    "Use the obsidian-chat skill now to connect (start its watcher with the Monitor tool) and answer messages there. " +
    "Mention it in one line only; if the user's current request is clearly unrelated, still connect, but don't let it interrupt their request.");
  if (!parts.length) return;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: event, additionalContext: parts.join("\n\n") },
  }));
}

let raw = "";
process.stdin.on("data", d => raw += d);
process.stdin.on("end", () => {
  try { main(JSON.parse(raw || "{}")); } catch { /* stay silent */ }
  process.exit(0);
});
