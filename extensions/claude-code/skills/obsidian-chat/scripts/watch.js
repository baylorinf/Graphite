// Watches the Graphite chat panel for new messages and prints one line per message, for Claude Code's
// Monitor tool (each stdout line wakes the Claude session). Also writes a heartbeat (status.json) so the
// panel can show "Claude is listening". No network, no API key: it only reads and writes files in the vault.
//
//   node watch.js [chatDir]
//
// Output lines:
//   MSG {"id":"m-…","text":"…","note":"path.md","selection":"…","study":"LA review"}   a message to answer
//   TASK {"id":"t-…","task":"ai-check"|"ai-questions","note":"path.md","title":"…","lang":"zh-CN"}   a job from Check / Quiz;
//        answer with replies/<id>.json
//   BUSY <pid>                                                                       another session is listening; exiting
// Chat messages that carry "via" are answered by an API model inside Graphite, so they are skipped here.
const fs = require("fs");
const path = require("path");

// Settings: ~/.claude/graphite.json (or the file GRAPHITE_CONFIG points to). Graphite writes it from
// Settings → Claude Code; graphite.example.json shows every field.
const graphite = (() => {
  const os = require('os');
  const file = process.env.GRAPHITE_CONFIG || require('path').join(os.homedir(), '.claude', 'graphite.json');
  try { return JSON.parse(require('fs').readFileSync(file, 'utf8')); } catch { return {}; }
})();

const DIR = process.argv[2] || process.env.OBSIDIAN_CHAT_DIR || (graphite.vault && path.join(graphite.vault, ".obsidian/plugins/claude-chat/chat"));
if (!DIR) { console.error("No vault set: fill in ~/.claude/graphite.json (Graphite → Settings → Claude Code)."); process.exit(1); }
const OUTBOX = path.join(DIR, "outbox.jsonl");
const REPLIES = path.join(DIR, "replies");
const STATUS = path.join(DIR, "status.json");
const TASKS = path.join(DIR, "tasks");
const FRESH_MS = 15000;

fs.mkdirSync(REPLIES, { recursive: true });

const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const readJson = p => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };

// Only one session answers at a time.
const prev = readJson(STATUS);
if (prev && prev.listening && prev.pid !== process.pid && Date.now() - prev.at < FRESH_MS && alive(prev.pid)) {
  console.log("BUSY " + prev.pid);
  process.exit(0);
}

function messages() {
  let lines = [];
  try { lines = fs.readFileSync(OUTBOX, "utf8").split(/\r?\n/).filter(Boolean); } catch { return []; }
  let out = [];
  for (const l of lines) {
    let m; try { m = JSON.parse(l); } catch { continue; }
    if (m.type === "new") out = []; // "New chat" marker: older messages don't need answers any more
    else if (m.type === "user" && m.id && !m.via) out.push(m);
  }
  return out;
}
const answered = id => fs.existsSync(path.join(REPLIES, id + ".md"));
// Jobs from Graphite's Check and Quiz (one JSON file each); the answer goes to replies/<id>.json.
function tasks() {
  let files = [];
  try { files = fs.readdirSync(TASKS).filter(f => f.endsWith(".json")); } catch { return []; }
  const out = [];
  for (const f of files) {
    const t = readJson(path.join(TASKS, f));
    if (t && t.id && !fs.existsSync(path.join(REPLIES, t.id + ".json"))) out.push(t);
  }
  return out;
}

const seen = new Set();
function beat() {
  const pending = messages().filter(m => !answered(m.id)).map(m => m.id);
  try {
    fs.writeFileSync(STATUS, JSON.stringify({ listening: true, pid: process.pid, at: Date.now(), seen: [...seen].filter(id => pending.includes(id)) }));
  } catch { /* vault busy; try again next beat */ }
}
function stop() {
  try { fs.writeFileSync(STATUS, JSON.stringify({ listening: false, pid: process.pid, at: Date.now(), seen: [] })); } catch { /* ignore */ }
  process.exit(0);
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
process.on("SIGHUP", stop);

function tick() {
  for (const m of messages()) {
    if (seen.has(m.id) || answered(m.id)) continue;
    seen.add(m.id);
    const ev = { id: m.id, text: m.text, note: m.note || "", selection: m.selection || "", study: m.study || "", at: m.at || "" };
    if (m.task) ev.task = m.task; // e.g. "import": the "Find new course files" button
    process.stdout.write("MSG " + JSON.stringify(ev) + "\n");
  }
  for (const t of tasks()) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    process.stdout.write("TASK " + JSON.stringify({ id: t.id, task: t.task, note: t.note || "", title: t.title || "", lang: t.lang || "en" }) + "\n");
  }
  beat();
}

tick();
setInterval(tick, 1000);
