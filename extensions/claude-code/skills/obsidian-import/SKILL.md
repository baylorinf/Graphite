---
name: obsidian-import
description: Find study files on this computer that aren't in the user's Graphite vault yet (slides, textbooks, homework, exam papers, essays, Markdown notes) and add them, with PDF copies of PowerPoint/Word files so they open inside Graphite. Use when the user presses the "Find new course files" button in Graphite (a chat message with "task":"import"), or says "check my folders", "add my new slides", "import my course files", "is anything missing from Graphite". No API key: you do it in this session.
---

# Import course files into Graphite

**Settings first.** Read `~/.claude/graphite.json` (Graphite writes it from Settings → Claude Code; `graphite.example.json` in the skills folder shows every field). Below, `<vault>` is its `vault`, `<studyRoot>` its `studyRoot`, the brain folder is `<vault>/<brainFolder>` (default `Claude Brain`), and `courses` maps course codes (folder names under `<studyRoot>`) to course names. `about`, `chatLanguage`, `readingLanguages` and `noteLanguage` describe the user. If the file is missing, ask the user to open Graphite → Settings → Claude Code and press Save.

The vault is `<vault>`. Course material lives in `<studyRoot>/<code>` (one folder per code in `courses`) and sometimes in Downloads. The user wants every study file openable inside Graphite, filed like the ones already there. Folders in `skipFolders` are left out on purpose; never import from them.

Scripts (in `~/.claude/skills/obsidian-import/scripts/`; they read the same settings file):
- `node scan.js`: lists candidates as JSON and changes nothing. It already skips files in the vault (same size and type, or a PDF copy with the same name), files recorded in the manifest, code/video/build folders, Office temp files and anything over 300 MB. Downloads/Desktop/Documents are only searched for files from the last 180 days, and PDFs there come with `firstPage` text.
- `node import.js plan.json`: copies files, makes PDF copies of PowerPoint/Word files with Office, never overwrites, and records everything in the manifest `<vault>/.obsidian/plugins/claude-chat/imports.json` (also the `ignore` list, so skipped files are not offered again).

## Steps

1. Run `node scan.js` (Bash) and read the candidates.
2. Decide for each one:
   - **Course folder files** (`course` set): import. Where to (dest is relative to the vault):

     | Source subfolder | Vault folder |
     |---|---|
     | `Slide`, `Slides`, lecture decks | `<Course>/课件 Slides/` |
     | textbooks (book-length PDFs, e.g. Rudin, Professional C++) | `<Course>/教材/` |
     | `HW`, homework, assignments, submissions | `<Course>/作业 Homework/` |
     | exams, mock papers, solutions, review manuals | `<Course>/复习资料/` |
     | `Essay` | `English/写作 Essays/` |
     | anything else | `<Course>/<same subfolder name>/` |

     Course names: from `courses` in the settings (code → name).
     PowerPoint/Word: give the dest a `.pdf` name (same base name). Markdown notes: keep `.md` (they become notes).
   - **Downloads/Desktop/Documents** (`course` null): use the name and `firstPage` to tell which course it belongs to. Import clear course material (homework sheets, assignments, exam papers) into the table above. Put `duplicateOf` entries in `ignore` with reason "same as <path>". Anything you're not sure about: don't import and don't ignore; ask about it in the reply.
3. Write the plan to a JSON file in the scratchpad and run `node import.js <plan>`.
4. Update the course's index note so the new files are one click away, in the user's note style (see the existing notes): the index note the course folder already has (for example `<Course>/课件目录 Slides Index.md` or `<Course>/复习资料 Study Resources.md`; look for a note that already lists the course's files). If there is none, create `<Course>/<Course> index.md`. Add links like `[[2026.10.15.pdf|10.15]]` under a numbered section for the folder (e.g. `2. 作业 Homework。`), creating the section if needed. Don't rewrite other parts of the note. Use the Edit tool. A new index note gets `graph: hide` in its frontmatter (index pages stay off the knowledge graph).
5. Report. If the request came from the chat button, write the reply file (see the obsidian-chat skill) in English, short:
   - what was added, grouped by course and folder, with `[[links]]` to the index notes;
   - what was skipped as duplicates (one line);
   - questions about uncertain files, each with its name and your guess.
   When the user answers ("yes, that course", "ignore it"), import it, or add it to `ignore`.
6. If nothing is new, say so in one line ("Everything is already in Graphite").

## Things to avoid

- Never move or change originals; only copy.
- Never import from `skipFolders`, Videos, code folders, or system folders.
- Don't import personal non-study files from Downloads (bank statements, IDs, tickets, CVs…): if one shows up, leave it out silently.
- Don't use an API key or any online service.
