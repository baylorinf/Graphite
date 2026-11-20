---
name: obsidian-inbox
description: File the user's Graphite captures into their notes. The user marks things as "Not familiar" or "Interesting" with the ✦ Claude Capture button in Graphite; each capture waits as an unticked task in "Claude Inbox.md" at the root of their vault. Use this skill whenever a hook says captures are waiting, or the user says "check my inbox", "file my captures", "process my notes", "I pressed the button", "what did I capture", or mentions the ✦ button or Claude Inbox. Writes notes in the user's own note format, ticks each capture, and records confusions in the Claude Brain. No API key involved: you do the work in this session.
---

# Obsidian inbox

**Settings first.** Read `~/.claude/graphite.json` (Graphite writes it from Settings → Claude Code; `graphite.example.json` in the skills folder shows every field). Below, `<vault>` is its `vault`, `<studyRoot>` its `studyRoot`, the brain folder is `<vault>/<brainFolder>` (default `Claude Brain`), and `courses` maps course codes (folder names under `<studyRoot>`) to course names. `about`, `chatLanguage`, `readingLanguages` and `noteLanguage` describe the user. If the file is missing, ask the user to open Graphite → Settings → Claude Code and press Save.

The user studies in **Graphite** (an Obsidian-style app; vault at `<vault>`). While reading, they press the ✦ button (ribbon, `Ctrl+Shift+L`, or right-click → *Send to Claude*) and pick one of:

- **Not familiar**: "I don't understand this yet." They want it explained and kept in their notes.
- **Interesting**: "Worth keeping or exploring." They want it saved, expanded a little, and connected to what they already know.

The plugin appends each capture to `<vault>/Claude Inbox.md`:

```
- [ ] **Not familiar** · 2026-11-17 14:03 · [[Linear Algebra/Slide 10/投影 Projection#2. 投影矩阵|投影 Projection › 2. 投影矩阵]] %%cap-20261117-140312%%
    > the selected text, one quoted line per source line
    - Thought: the user's own question or remark (optional)
```

Your job is to turn every unticked `- [ ]` item into note content and tick it off. The user opens Claude while using Graphite and expects this to happen then, without being asked twice.

## Step by step

### 1. Read before writing

- Read `Claude Inbox.md`. Work only on `- [ ]` items, oldest first. Leave `- [x]` items alone.
- For each item, open the source note in the link (path before `#`, add `.md`) and read around the heading, so you explain the selection in its context and with the course's notation.
- Look in the same course folder for an existing note on the same concept (`Glob` for the folder, skim titles). Appending to an existing concept note beats making a near-duplicate.
- Read `Claude Brain/confusions.md` and the course file in `Claude Brain/courses/` so you know what the user already struggles with.

### 2. Decide where it goes

| Situation | Target |
|---|---|
| The concept has its own note already | Append a new numbered point to that note |
| The capture is about the source note's own topic | Append a numbered point to the source note itself |
| A new concept | New note in the **same folder as the source**, named `中文名 English.md` (e.g. `正交补 Orthogonal Complement.md`) |
| Source starts with 🎓 (captured in the study panel: a review page, quiz question or flashcard, e.g. `🎓 LA review › LA9 · … › Q3 (Linear Algebra)`) | The course is in brackets. Find the matching concept note in that course folder (LA topic n ↔ `Linear Algebra/Slide n/` when it exists) and append; otherwise make a new concept note in the closest `Slide`/`Chapter` folder. A captured quiz question includes "My answer / Correct answer / Why": explain why the user's answer is wrong, not only why the right one is right |
| No source link (captured with no note open) | Put it in the course folder it obviously belongs to; if no course fits, `Ideas/` |

Never write into the `readOnlyFolders` from the settings (other tools overwrite them). Never touch `.obsidian/`.

### 3. Write it in the user's format

Match the notes already in the target folder; read one first. Students' notes differ (numbered points, textbook-style `##`/`###` sections, …). `references/note-format.md` has a worked example of two styles and says how to append in either. The rules below describe the numbered style:

- Frontmatter for a new note:
  ```
  ---
  tags: [Linear Algebra]
  created: 2026.11.17
  ---
  ```
  Course tag as the folder's course name (from `courses`). Date as `YYYY.MM.DD`, today's date.
- Body: numbered points `1. One-sentence heading.` each followed by a blank line and short paragraphs. Sub-steps as `- ` bullets. Prose in the `noteLanguage` from the settings, keeping technical terms the way the course uses them, and all maths in `$…$` / `$$…$$` (Obsidian MathJax; `\R`, `\exist`, `\lVert` are fine).
- When appending, continue the note's numbering (if the last point is `3.`, add `4.`). Don't reformat what is already there.

What to write, by kind:

**Not familiar** (aim for 8–20 lines; they need to *get* it, not read a textbook):
1. 直观理解: one or two sentences of plain intuition, answering the user's Thought if they wrote one.
2. 准确表述: the precise definition or theorem statement.
3. 例子: one small worked example with actual numbers or a concrete set/function.
4. 常见误区 (only if there's a real trap).
5. End with `来源 Source: [[link from the capture]]`.

**Interesting** (aim for 4–12 lines):
1. Keep the user's selection as a quote (`> …`).
2. Say why it matters or what it connects to, linking existing notes with `[[…]]`.
3. If the Thought asks a question, answer it; if it opens something to explore, give one concrete next thing to try.
4. End with `来源 Source: [[link from the capture]]`.

Be mathematically careful: when the selection itself is wrong or garbled, say so in the note instead of explaining it as if correct.

### 4. Tick the item in the inbox

Change `- [ ]` to `- [x]` and append ` → [[target note path|shown name › point 2]] (2026-11-17)` at the end of that first line, keeping the `%%cap-…%%` id. Add `#heading` to the link only when you wrote under a real Markdown `#` heading (numbered points like `2. …` are list items, not headings, so an anchor to them doesn't resolve). Don't delete captures; the inbox is their history. If it grows past ~60 ticked items, move ticked ones older than a month under a `## Archive` heading at the bottom.

### 5. Update the Claude Brain

The brain lives in `<vault>/<brainFolder>/` and is kept by the `update-brain` skill; follow its labels.
- **Not familiar** → add the specific gap to `confusions.md` as a question, and mark the topic `confused` (or leave it if already lower) in the course table, evidence "flagged as not familiar in Graphite, YYYY-MM-DD".
- **Interesting** → no status change; mention it in the `log.md` entry.
- One `log.md` entry for the whole batch: date, "Graphite inbox", what was filed where.

### 6. Report briefly

In the user's `chatLanguage`, a few lines: how many captures were filed, and for each one the note it went to as a clickable link (`[Projection](<vault>/...)`) plus a one-line gist. Then offer one quick check question on a "Not familiar" item, since an answer to it is evidence for the brain.

If the inbox has no unticked items, say so in one line and do nothing else.

## Things to avoid

- Don't ask for an API key or suggest any setup that needs one. Everything here runs in this Claude session.
- Don't rewrite or "clean up" the user's existing notes beyond appending.
- Don't invent a source when the capture has none; say "captured with no note open" in the note instead.
- Don't paste long textbook material. Short and correct beats complete.
- Write note text with the Edit/Write tools, never a shell heredoc or `echo`: shells can collapse `\\` to `\`, which breaks every matrix row break. Put multi-line or matrix maths in a `$$` block with the `$$` delimiters on their own lines, as the user's notes do.
