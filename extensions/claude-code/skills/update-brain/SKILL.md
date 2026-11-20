---
name: update-brain
description: Update the user's personal study knowledge base ("my brain", the Claude Brain folder in their Graphite vault) after a conversation, recording which topics they've fully understood, which they're still confused about, and what to study next. Use this whenever the user says "update my brain", "update my knowledge base", "/update-brain", "save what I learned", "remember what I'm weak at", or wraps up a study session ("that's it for today", "thanks, done studying"). Also use it to answer questions like "what have I understood so far?", "what am I still confused about?" or "what should I review next?", even if they don't mention the brain.
---

# Update brain

**Settings first.** Read `~/.claude/graphite.json` (Graphite writes it from Settings → Claude Code; `graphite.example.json` in the skills folder shows every field). Below, `<vault>` is its `vault`, `<studyRoot>` its `studyRoot`, the brain folder is `<vault>/<brainFolder>` (default `Claude Brain`), and `courses` maps course codes (folder names under `<studyRoot>`) to course names. `about`, `chatLanguage`, `readingLanguages` and `noteLanguage` describe the user. If the file is missing, ask the user to open Graphite → Settings → Claude Code and press Save.

The user is a student (`about` in the settings; courses in `courses`). They want one place that says what they have **really understood** and what they're **still confused about**, so each study session starts from their weak spots instead of from scratch. This skill keeps that place up to date.

The knowledge base is plain Markdown in `<vault>/<brainFolder>/` (a folder inside the user's Graphite vault, so it shows up in their notes app; links between brain files can use `[[Claude Brain/...]]`). Never touch the `readOnlyFolders` from the settings: other tools refresh them.

| File | Holds |
|---|---|
| `README.md` | What the brain is and how the status labels work. Rarely changes. |
| `profile.md` | Who the user is as a learner: courses, exam dates, language, how they like to study. |
| `courses/<course>.md` | One table per course: every topic with its status, evidence and the date it last changed. |
| `confusions.md` | Open confusions, each phrased as the question the user can't answer yet. Resolved ones move to the bottom. |
| `next.md` | A short, ordered list of what to study next and when to review. |
| `log.md` | One dated entry per session, newest first. |
| `resources.md` | Links to study pages, notes and quizzes Claude has made, grouped by course. |
| `quiz-results.md` | **Written by the Graphite 🎓 Quizzes plugin, not by you.** Per-topic quiz scores (with the date each last changed) and the level test result. Read it; never edit it, since the plugin rewrites it. |

If the folder or a file is missing, create it from the templates in `references/templates.md`.

**Keep the brain off the user's knowledge graph:** every brain file starts with the frontmatter `graph: hide` and `tags: [Claude Brain]`, and brain files never use `[[wikilinks]]` to notes outside `Claude Brain/`. Write note names in backticks instead (`Linear Algebra/Slide 14/斐波那契与对角化 Fibonacci and Diagonalization`). Links between brain files (`[[Claude Brain/next|next]]`) are fine.

## Two modes

**Update** (the usual case, at the end of a conversation): read the brain, extract what this conversation shows, write the changes, and report them.

**Ask** (the user wants to know where they stand): read the brain and answer from it. Lead with confusions and what to do next. Don't write anything unless the conversation also contains new evidence.

## Update: step by step

### 1. Read the current brain first

Read every file before changing anything, so you update rows instead of duplicating them and you can see how a topic's status has moved over time.

### 2. Extract evidence from this conversation

Look for these, in the user's messages above all, and in `quiz-results.md` for any rows whose "Last changed" date is after the newest `log.md` entry:

- **Quiz scores from the app**: a topic quiz with all 5 answered counts like a reported score (4/5 or 5/5 = demonstrated, 3/5 = shaky, 0–2/5 = confused). A partly answered quiz is weaker evidence; note it but don't move a status on fewer than 3 answers. A level test unit marked weak points at its topics.

- **Demonstrated understanding**: they answered a question correctly with a reason, explained a concept in their own words, caught a mistake, or reported a quiz score of 4/5 or better.
- **Confusion**: they said they don't get something, answered incorrectly, asked the same thing twice, or asked a "why" question that shows a gap. Record the *specific* gap ("doesn't see why det(A − λI) = 0 gives the eigenvalues"), not just the topic name.
- **Self-reports**: "I think I've got X now", "Y still makes no sense". Record these, but mark them as self-reported. They count for less than a demonstration.
- **Coverage**: topics Claude explained or materials Claude produced. This is not understanding. Reading an explanation doesn't mean the user can do it.
- **Facts about the learner**: exam dates, which topics are in scope, how they like to learn, language.
- **Resources**: links to artifacts or files made for them.

The reason for this split: the whole point of the brain is telling "I've seen it" apart from "I can do it". If you mark something solid because Claude explained it well, the brain stops being useful. When unsure, use the weaker status.

### 3. Decide each topic's status

Use exactly these labels so the tables stay comparable:

| Status | Use when |
|---|---|
| `solid` | The user demonstrated it at least once in a way that needed real understanding (correct answer with reasoning, a proof idea, a correct worked example). |
| `shaky` | Partly right, right only with hints, or self-reported as understood without a demonstration. |
| `confused` | The user said they don't understand it, or got it wrong and the gap wasn't closed in this conversation. |
| `covered` | Claude explained it or made material for it, but there's no evidence either way about the user. |
| `untested` | Known to be in the course, nothing has happened with it yet. |

Moving a topic down is as important as moving it up. If something marked `solid` comes back wrong, change it to `shaky` and say why in the evidence column.

### 4. Write the changes

- **Course tables**: update the row's status, put a short evidence note in the user's terms ("explained why swaps flip the sign of det", "2/5 on LA14 quiz"), and set the date. Add rows for new topics in the course's own order, using the course's own numbering (LA12, §6 Stolz). Keep evidence notes to one line. The history goes in `log.md`.
- **confusions.md**: add each new specific gap as a question. When one is resolved in this conversation, move it to "Resolved" with the date and one line on what made it click. That line is worth keeping: it shows which explanations work for this user.
- **next.md**: rewrite it as at most 7 items, ordered by priority: confused topics before an upcoming exam, then shaky ones, then spaced review of solid ones (review roughly 1, 3, 7 and 14 days after a topic first became solid). Each item names one concrete action and the resource to use, if there is one.
- **log.md**: add one entry at the top: date, course, what was done, what changed in status, open questions.
- **profile.md** and **resources.md**: only when there's something new.

Use absolute dates (`2026-11-03`), not "today" or "yesterday", because the brain is read in later sessions. Get today's date from the environment.

Write in plain language the user reads (`readingLanguages` in the settings).

### 5. Report back briefly

Tell the user, in a few lines:

- what moved up, what moved down, and anything new
- their top 1–3 next steps from `next.md`
- one sentence on anything you weren't sure how to classify, so they can correct it

If the conversation gave no evidence about their understanding (for example, Claude only built materials), say so plainly, and offer a 3-question check on the topics covered. Its answers become evidence for the next update.

## Things to avoid

- Don't copy whole explanations or notes into the brain. It records *the user's state*. Link to the material in `resources.md` instead.
- Don't invent exam dates, scores or topics. If a fact is uncertain, note it as unconfirmed.
- Don't delete history. Change statuses, and keep the past in `log.md`.
- Keep each file short enough to read in under a minute. If a course table grows past about 60 rows, group finished units into one summary row.
