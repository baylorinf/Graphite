---
name: obsidian-chat
description: Connect this Claude session to the chat panel in the user's Graphite app (the "Claude" tab in the right sidebar), then answer every message typed there and do the AI jobs Graphite sends to Claude Code (Check, Quiz, revision plans, exam analysis, Tidy format). Use it when the user says "connect to Graphite" (or the old "connect to MyObsidian"), "connect the chat", "listen to my Obsidian chat", "/obsidian-chat", when a hook says chat messages are waiting, or when a Monitor event starting with "MSG {" or "TASK {" arrives from the Graphite chat watcher. No API key: the panel and this session talk through files in the vault.
---

# Graphite chat

**Settings first.** Read `~/.claude/graphite.json`: Graphite fills it from **Settings → Study settings**, the one set of folders, courses and languages every AI uses (the full file is `~/.graphite/study.json`, named in `studySettings`; `graphite.example.json` in the skills folder shows every field). `studyRoots` lists every course folder (`studyRoot` is the first); `readOnlyFolders` are never written; `recentFolders` is empty when the user turned off "also look elsewhere". Below, `<vault>` is its `vault`, `<studyRoot>` its `studyRoot`, the brain folder is `<vault>/<brainFolder>` (default `Claude Brain`), and `courses` maps course codes (folder names under `<studyRoot>`) to course names. `about`, `chatLanguage`, `readingLanguages` and `noteLanguage` describe the user. If the file is missing, ask the user to open Graphite → Settings → Claude Code and press Save.

The user studies in **Graphite** (vault `<vault>`). Its right sidebar has a **Claude** tab: a chat box. Messages typed there are appended to a file; this session watches that file, answers, and writes each answer to a file the panel shows. The user keeps this Claude window open while they study.

Files (all in `<vault>/.obsidian/plugins/claude-chat/chat/`):

| File | Written by | Holds |
|---|---|---|
| `outbox.jsonl` | the panel | one JSON per line: `{"type":"user","id":"m-…","text":…,"note":…,"selection":…,"study":…}`, or `{"type":"new"}` when the user starts a new chat. Lines with `"via":"deepseek"` (or another provider) are answered by an API model inside Graphite; the watcher skips them, and you never answer them. (Some old lines carry `"engine":"gemini"` from a removed Gemini option; treat them like any other message.) |
| `replies/<id>.md` | **you** | your answer to message `<id>`, in Markdown |
| `tasks/<id>.json` | Graphite | a job for Claude Code from Check, Quiz, Plan, Exam analysis or Tidy format (see "Jobs from Graphite's AI features") |
| `replies/<id>.json` | **you** | your result for task `<id>`, as JSON |
| `status.json` | the watcher | heartbeat; the panel shows "Claude is listening" while it is fresh |

## Connect

1. Start the watcher with the **Monitor** tool (not Bash), at the longest timeout:
   - command: `node "$HOME/.claude/skills/obsidian-chat/scripts/watch.js"`
   - description: `Graphite chat messages`
   - timeout_ms: `1800000`
2. If its first line is `BUSY <pid>`, another Claude session is already listening. Tell the user in one line and stop.
3. Otherwise tell the user in one line that the chat is connected. Any messages that were waiting arrive right away as events.

**When the monitor expires** (you get a notice that it timed out), start it again the same way, silently, unless the user has said to stop listening. Re-arm it after every expiry so the chat stays connected for as long as this window is open. To disconnect, stop it with TaskStop.

## Buttons that send tasks

A message with `"task":"import"` comes from the **Find new course files** button above Graphite's file list. Follow the **obsidian-import** skill (scan, import, update the index notes), then write the summary as the reply to that message. It may take a few minutes; that's expected.

A message with `"task":"connect"` comes from the **Connect this note** button in the note's top bar; `note` is the vault path of the note. Do this:

1. Read the note, and list the vault's knowledge notes (skip the `readOnlyFolders`, the brain folder, `.obsidian/`, and anything with `graph: hide` in its frontmatter). Read the ones whose title, tags or headings look related.
2. **Links that really matter only.** Add a `相关 Related:` line (or extend the one there) with `[[links]]` to notes that share a concept, a definition it relies on, a theorem it uses, or a topic it continues. Add the matching back-link to each of those notes' Related lines. No links just for sharing a course name; usually 2–6 links.
3. **Tidy the format** to match the user's note format (the obsidian-inbox skill's `note-format.md`): frontmatter with `tags` and `created`, a `来源：` line linking the slide PDF when the course is clear (`[[LA10.pdf|LA10]]`, with `#page=N` if known), numbered key points, `$…$` maths. Keep the user's words and meaning; fix only structure, headings, obvious typos and broken maths. Don't delete content.
4. Use the Edit tool (never shell commands) for note text, so `$` and `\` survive. Never edit the `readOnlyFolders`.
5. Reply with a short list: which links were added (both ways) and what format changes were made.

## Jobs from Graphite's AI features

In **Settings → AI** the user chooses which AI does each job; "Claude Code" means you. Such a job arrives as a line `TASK {"id":"t-…","task":"ai-…","note":"…","title":"…","lang":"zh-CN"}`. Read the full job in `tasks/<id>.json` (it may hold more fields), do it, and write the result with the **Write** tool to `replies/<id>.json`. Graphite is waiting with a timer, so do these before chat messages, and keep them quick. The result must be **valid JSON**: escape `\` as `\\` and `"` as `\"` inside strings, so LaTeX like `\frac` is written `\\frac`. If you can't do the job, write `{"error":"one short sentence"}`. Don't edit notes for these jobs: Graphite applies the result itself, after the user confirms. `lang` is the app's interface language: write explanations and summaries in it.

| `task` | Do | Write to `replies/<id>.json` |
|---|---|---|
| `ai-check` | Proofread and fact-check the note at `note` (vault-relative). Find real mistakes only: wrong facts, spelling, grammar, unclear sentences, faulty logic. Leave `[[links]]`, `#tags`, `$maths$` and code alone unless they're actually wrong. | `{"summary":"one sentence","issues":[{"type":"fact\|spelling\|grammar\|clarity\|logic\|formatting\|links\|structure\|style","quote":"exact text copied from the note, short but unique","suggestion":"replacement text","explanation":"one short sentence"}]}` |
| `ai-questions` | Write 3–8 quiz questions on the most important ideas in the note, in the note's language, with 1–2 sentence answers. | `{"questions":[{"question":"…","answer":"…"}]}` |
| `ai-plan` | Make a day-by-day revision plan for an exam. The job has `exam`, `date` (exam date), `today`, `range` (what's examined, in the user's words), `notes` (the vault notes in range), `minutes` (time per day), and `memory` (per note: how well the user remembers it, from their quiz history). Read the brain folder (`<vault>/<brainFolder>/`) for known weak spots. Put weak and due topics first, leave the last day or two for a mock exam and review, and link notes as `[[Note name]]` and slides as `[[LA5.pdf\|LA5]]`. | `{"title":"…","markdown":"the plan note: frontmatter with tags and created, an overview, then one section per day with - [ ] tasks"}` |
| `ai-exam` | Analyse an exam paper or graded exam at `note` (a PDF or a note; read the PDF directly). The job may have `comment` (what the user wants) and `pages` ("all", or a range like "1–20, 25": analyse only those pages, read every one of them, and say in the note which pages were covered and which had no text). List every problem: topic, which note or slide it belongs to, and what it tests. If answers or marks are visible, say what went wrong and why. Then give suggestions and a short study plan. | `{"title":"…","markdown":"the analysis note: frontmatter, a summary, a table or list of problems, mistakes and why, suggestions, plan with - [ ] tasks","problems":[{"no":"3","page":2,"topic":"…","question":"the problem, maths in $…$","myAnswer":"the student's answer if visible, else \"\"","mistake":"what went wrong, else \"\""}]}` (`problems` feeds the mistake book; one entry per problem) |
| `ai-format` | Reformat the note at `note` to match the format of the example notes in `examples` (same folder): frontmatter, heading levels, numbering, `来源：` source line, Related line, maths style. Keep every piece of content and the user's wording; change only structure and format, and fix obvious typos and broken maths. | `{"markdown":"the whole reformatted note","changes":["short description of each change"]}` |
| `ai-mock` | Write a mock exam paper for `job.course`. Model it on the past papers in `job.papers` (read them directly: format, wording, difficulty, marks); test only topics from the notes in `job.notes`; aim new problems at weak spots (mistake book in the review file, the Claude Brain). `job.mix` is [past, adapted, new] counts, `job.minutes` the time, `job.comment` extra wishes. For past/adapted problems give the exact paper path and page; for new ones the note title. Full worked answers. | `{"title":"…","problems":[{"no":"1","marks":10,"kind":"past|variant|new","sourceFile":"LA/复习资料/2024 midterm.pdf or note title","sourcePage":2,"sourceLabel":"2024 midterm Q4","topic":"…","question":"…","answer":"…"}],"topics":[{"topic":"…","pastCount":3,"note":"why"}]}` (Graphite builds the note and its links) |
| `ai-summary` | Summarize the PDF at `note` (`job.pdf`), only the pages in `job.pages` (of `job.total`); read each of them in the PDF itself, including scanned pages. Follow the document's own sections in order. Write in `studySettings.noteLanguage` if set, else `lang`. Every `page` must be one of the pages asked for. | `{"title":"…","overview":"2–3 sentences","sections":[{"heading":"…","page":2,"points":[{"text":"…","page":2}]}],"concepts":[{"term":"…","meaning":"…","page":2}],"formulas":[{"latex":"\\\\det(A-\\\\lambda I)=0","meaning":"…","page":3}]}` (Graphite builds the note and its page links) |

Every task file also has `studySettings` (the parts of Study settings this job may use: courses, note language, read-only folders, …) and `studySettingsFile`. Use them; they are the same settings every other AI gets.

## Answer each message

In the panel the assistant is called **Graphie** (the chat's name in Graphite); answer as Graphie.

Each event is a line `MSG {json}`. For each:

1. Read the JSON: `text` is the question, `note` is the note open in Graphite (vault-relative path; empty when a study tab is in front), `selection` is text they had selected in what they're reading (may be empty), `study` is the 🎓 study tab in front with the section they're on, e.g. `Calculus review › Week 3`. The study pages are HTML files in each course's study pages folder in the vault (`<vault>/<Course>/<studyPagesFolder>/`); any `.html` file in the vault opens as a study tab, and a new study page goes in that folder. Grep the page for that lecture or topic to see exactly what they're reading.
2. Use that context. When the question says "this", "here" or "it", it means the selection, else the open note: read the note (`<vault>/<note>`) before answering. You can also read the brain folder (`<vault>/<brainFolder>/`) to pitch the answer at what they know.
3. Write the answer with the **Write** tool to `<vault>/.obsidian/plugins/claude-chat/chat/replies/<id>.md`. Never write it with a shell command (shells mangle `\\` in LaTeX).
4. In this window, write at most one short line (for example "Answered: eigenvalues of a projection"). The user reads the answer in Graphite, not here.

How to answer:
- **Language:** reply in the language the message is written in (the settings give the usual `chatLanguage` and the `noteLanguage` of their notes).
- **Format:** Markdown that Graphite renders: short paragraphs, `**bold**`, lists, `$…$` and `$$…$$` maths (KaTeX), `[[Note name]]` links to their notes. Keep it as short as the question allows; the panel is narrow (about 300–500 px). No tables wider than three columns.
- **Doing things:** if the message asks you to change their notes ("add this to my note", "make a note on X", "file my captures"), do it (following the obsidian-inbox skill's note format rules), then say in the reply what you changed, with a `[[link]]`.
- **Study evidence:** if the user answers a question you asked, or shows confusion, that is evidence for the brain; the update-brain skill records it later as usual.
- If a message is unclear, ask one short question in the reply file.

## Things to avoid

- Don't answer in this window instead of the reply file: the user won't see it.
- Don't ask for an API key or suggest one.
- Don't edit `outbox.jsonl` or `status.json`; they belong to the panel and the watcher.
