# Graphite extensions

Everything here ships inside Graphite. You don't install it by hand.

## `obsidian-plugins/`: built into every vault

| Plugin | What it does |
|---|---|
| `claude-chat` (Graphie) | Chat in the right sidebar, answered by a Claude Code window or an API model. Also the "Find new course files" and "Connect this note" buttons. |
| `claude-quizzes` | 🎓 study pages: any `.html` file in the vault opens as a tab, with a selection bar and progress. |
| `claude-capture` | ✦ button: mark text as "Not familiar" or "Interesting"; it waits in `Claude Inbox.md`. |

When Graphite opens a vault it installs any of these the vault has never had and turns them on once (so turning one off, or deleting it, sticks). When the app has a newer version it updates the code and keeps the plugin's settings and data. They run in restricted mode too.

Study pages with quiz scores are listed in `claude-quizzes/data.json` under `"pages"`:

```json
{ "pages": [ { "id": "calc-review", "path": "Calculus/Study Pages/Calc review.html", "short": "Calc review",
               "title": "Calculus review", "course": "Calculus", "key": "calc-review-v1", "prefix": "W", "labelPrefix": "Week " } ] }
```

## `claude-code/`: for a Claude Code window

| Part | What it does |
|---|---|
| `skills/obsidian-chat` | Say "connect to Graphite": answers Graphie and does Graphite's AI jobs (Check, Quiz, plans, exam analysis). |
| `skills/obsidian-inbox` | Files ✦ captures into your notes in your own format. |
| `skills/obsidian-import` | Copies new course files (slides, homework, exams) into the vault, with PDF copies of Office files. |
| `skills/update-brain` | Keeps the Claude Brain: what you understand, what confuses you, what to study next. |
| `hooks/obsidian-inbox.js` | Session start / each prompt: tells Claude when captures or chat messages are waiting. |
| `hooks/brain-autoupdate.js` | After a few study messages: reminds Claude to update the Brain. |

Install them from **Graphite → Settings → Claude Code**. Fill in your course folder, courses and languages, then press **Save and install**. That:

1. writes `~/.claude/graphite.json` (your paths; `graphite.example.json` shows every field);
2. copies the skills to `~/.claude/skills/` and the hooks to `~/.claude/hooks/graphite/`;
3. registers the hooks in `~/.claude/settings.json`, replacing only Graphite's own entries (a backup is saved as `settings.json.before-graphite`).

Nothing personal lives in this folder: every path, course and language comes from `graphite.json`.
