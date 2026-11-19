# Graphite guide

Graphite is a note-taking app for linked thinking. Every note is a plain Markdown (`.md`) file on your computer, so your notes never get locked in.

> [!tip] Open this guide any time with **F1**, the **?** button in the left ribbon, or the command palette (`Ctrl+P`, then type "help").

## Your vault
- The **vault** is the folder that holds your notes. Its location is shown under **Settings → General**.
- To use a different folder, such as an existing Obsidian vault, start the app with `node server.js "D:\path\to\vault"`.
- Deleted notes are moved to the vault's `.trash` folder, so you can get them back.
- Files you change in other programs show up in the app straight away.
- Note titles can contain any character. Characters Windows doesn't allow in file names, such as `: ? / " < > * | \ # ^ [ ]`, are saved as lookalikes (for example `:` becomes `꞉`). Links typed with the normal characters still find the note.
- In the desktop app, an **Update** button appears in the left ribbon and the status bar when a newer version is available. Click it to install. Your notes are saved first, and the app reopens by itself.

## Writing
- Switch between **Edit**, **Split** (editor and preview side by side) and **Read** with the buttons at the top right, or press `Ctrl+E`.
- Notes save automatically. `Ctrl+S` saves immediately.
- Rename a note by editing its title. Every link to it is updated for you.
- Paste or drop an image into the editor to save it in `attachments/` and embed it.

| Formatting | Type this |
| --- | --- |
| Bold / italic | `**bold**` / `*italic*` (or `Ctrl+B` / `Ctrl+I`) |
| Highlight | `==highlight==` |
| Strikethrough | `~~text~~` |
| Heading | `# Heading`, `## Subheading` |
| Task | `- [ ] to do`, `- [x] done` |
| Code | `` `inline` `` or a block fenced with ```` ``` ```` |
| Hidden comment | `%%only visible while editing%%` |

Every piece of syntax, with examples you can copy, is in the <a href="#" data-help-page="markdown">Markdown cheatsheet</a>.

## Linking notes
- `[[Note name]]` links to a note. Type `[[` to get suggestions.
- `[[Note name|shown text]]` changes the link text, and `[[Note name#Heading]]` jumps to a heading.
- `![[Note name]]` embeds a whole note. `![[image.png]]` shows an image, and `![[image.png|300]]` sets its width.
- Links to notes that don't exist yet look faded. Click one to create the note.
- The right sidebar shows **backlinks** (notes that link here), **unlinked mentions**, **outgoing links**, **tags** and the **outline**.

## Organizing
- **Folders:** drag notes and folders to move them, and right-click for more options.
- **Tags:** write `#tag` anywhere, or `tags: [a, b]` in the properties block at the top of a note.
- **Properties:** start a note with a `---` block of `key: value` lines.
- **Daily notes:** press `Alt+D` to open today's note in `Daily Notes/`.

> [!example] Properties example
> ```
> ---
> tags: [project, ideas]
> status: active
> ---
> ```

## Finding things
- **Quick switcher** (`Ctrl+O`): type part of a name to open a note. If nothing matches, `Shift+Enter` creates it.
- **Search** (`Ctrl+Shift+F`): searches every note. You can combine filters:

| Search | Finds |
| --- | --- |
| `meeting notes` | notes containing both words |
| `"exact phrase"` | that exact phrase |
| `#project` | notes with the tag (including `#project/sub`) |
| `path:Ideas` | notes inside a folder |
| `file:draft` | notes whose name contains "draft" |

- **Graph view** (`Ctrl+G`): a map of your notes that works a bit like memory in a brain. Drag to move, scroll to zoom. **Local graph** shows only the current note's neighbours.
  - **Regions:** closely connected notes gather into coloured areas, named after their shared tag or their most connected note.
  - **Associations:** dashed lines join notes about similar ideas that you haven't linked yet. They are found by comparing the words in your notes.
  - **Memory:** notes you remember well (from your quiz results) glow, notes you are forgetting fade, and notes due for review have a pulsing orange ring.
  - **Click a note** to "think about it": a pulse spreads along its connections, and a card lists what it **brings to mind**, strongest first, with its memory state and **Open**, **Quiz me** and **Wander from here** buttons. **Double-click** opens the note.
  - **Let my mind wander** drifts from thought to thought along your strongest connections, sometimes jumping to an unrelated idea (⤳), and leaves a **train of thought** at the bottom that you can click.

## Callouts
Start a quote with `[!type]` to make a colored box. Types include `note`, `tip`, `warning`, `danger`, `success`, `question`, `example` and `quote`. Add `-` after the type to make it folded, or `+` for foldable but open.

```
> [!warning]- Click to expand
> Hidden until opened.
```

## Math (LaTeX)
Write formulas in LaTeX, the same way as in Obsidian:
- **Inline:** `$E = mc^2$` shows $E = mc^2$ inside the sentence.
- **Display:** put `$$` on the line before and after a formula to show it centred on its own line:

```
$$
\int_0^1 x^2\,dx = \frac{1}{3}
$$
```

$$
\int_0^1 x^2\,dx = \frac{1}{3}
$$

- **Chemistry:** `$\ce{2H2 + O2 -> 2H2O}$` shows $\ce{2H2 + O2 -> 2H2O}$
- **Amounts of money are safe:** a `$` followed by a space or a digit isn't treated as math. To show a dollar sign anywhere, type `\$`.
- **Command:** **Insert math block** in the command palette adds an empty `$$` block.
- **Mistakes:** a formula with an error is shown in red, so you can see what to fix.
- **Full list:** the <a href="#" data-help-page="latex">LaTeX cheatsheet</a> shows about 160 commands with their results. It's also in the command palette as **Open LaTeX cheatsheet**.

## Keyboard shortcuts
| Action | Keys |
| --- | --- |
| Command palette | `Ctrl+P` |
| Quick switcher | `Ctrl+O` |
| New note | `Alt+N` |
| Today's daily note | `Alt+D` |
| Edit / Read | `Ctrl+E` |
| Graph view | `Ctrl+G` |
| Search | `Ctrl+Shift+F` |
| Rename note | `F2` |
| Back / Forward | `Alt+←` / `Alt+→` |
| Bold / Italic / Link | `Ctrl+B` / `Ctrl+I` / `Ctrl+K` |
| Indent / Outdent | `Tab` / `Shift+Tab` |
| Settings | `Ctrl+,` |
| This guide | `F1` |

## Review and memory
Graphite helps you remember what you write. Your notes turn into questions automatically:

- `==highlighted==` or **bold** words in a sentence become fill-in-the-blank questions, and `- **Term**: definition` becomes “What is Term?”.
- `Question :: answer` on one line (or a question, a line with only `?`, then the answer) becomes a flashcard.
- Every section with a heading becomes “What do you remember about …?”.

**Check for mistakes:** the magnifier button at the top (`Ctrl+Shift+E`) checks the open note. Each problem is shown as old text → corrected text with a short reason. Click **Apply** to fix it (`Ctrl+Z` undoes it), **Show in note** to jump there, or **Ignore**. Without AI, a basic check finds repeated words, missing spaces, broken `[[links]]` (with the closest note suggested), unclosed `**`/`==` and skipped heading levels. With AI turned on, the AI also checks facts, spelling, grammar and unclear sentences.

**Quiz:** the graduation cap at the top (`Ctrl+Shift+K`) quizzes you on the open note. With AI turned on, the AI adds its own questions about the note; they are written once per version of the note. When you leave a note you just wrote in, a small card offers **Check** or **Quiz me**. Both are also in the right-click menu.

**Choosing the AI:** in **Settings → AI**, each job (Check, Quiz questions, Chat panel, Revision plans, Exam analysis, Tidy format) has its own choice. **Claude Code** uses the Claude window on this computer and needs no key, but only works while that window is connected (say "connect to Graphite" in it). **API models** work any time with your own key: Anthropic (Claude), OpenAI, Google Gemini, DeepSeek, Qwen, Kimi, GLM, or any OpenAI-compatible service. Paste a key under **API keys** and press **Test the key**, which also loads that provider's current models. Keys stay on this computer, and only the note or paper for a job is sent, to that provider only. Check and the chat panel also have a menu to switch AI right where you use them.

**Revision plan:** on the Review page (or the command palette), **Make a revision plan**. Enter the exam, its date, what is examined, tick the folders in range and set minutes per day. The AI plans every day up to the exam, weakest and due topics first, and saves the plan with checkboxes in `<Course>/复习计划 Review Plans`.

**Exam paper analysis:** **Analyse an exam paper** on the Review page, or right-click a PDF or note in the file list. The AI lists every problem with its topic and your matching note, explains what went wrong if your answers or marks are on the paper, and adds suggestions and a plan, saved in `<Course>/考试分析 Exam Analysis`. For scanned PDFs, choose Claude Code.

**Tidy format:** the 🪄 button at the top (`Ctrl+Shift+Y`) makes the open note follow the format of the other notes in its folder: frontmatter, headings, numbering, source and Related lines. Your content stays the same; you see a before/after preview first, and `Ctrl+Z` undoes it.

**Study pages:** the interactive review pages are in each course's `学习页面 Study Pages` folder. Click one in the file list (or a link to it) to open it as a 🎓 tab.

**Word and PowerPoint:** `.docx` files open as a readable page (press **Exact layout** to see them exactly as Word prints them). `.doc`, `.ppt` and `.pptx` files open as a PDF made by your installed Word or PowerPoint, with page numbers, zoom, search and "Link to a page…"; the first time takes a few seconds, after that they open instantly. **Save PDF copy** puts a PDF next to the original.

**Daily review:** the brain button in the left ribbon (`Alt+R`) shows how many questions are due. Rate each answer **Again**, **Hard**, **Good** or **Easy**. The app then schedules the next review just before you would forget (spaced repetition).

**Related notes:** the right sidebar suggests notes on similar topics that aren’t linked yet. Click **Link** to connect them.

## Syncing across devices
Graphite syncs through a cloud folder. Put your vault inside OneDrive (built into Windows), Dropbox, Google Drive or iCloud Drive, and open the same folder on each computer. **Settings → Sync** shows whether your vault is synced and where your cloud folders are.

- **Editing on two devices at once:** if the changes are in different parts of a note, they are combined automatically. If the same lines changed, your version stays in the note and the other one is saved beside it as a "(conflict …)" copy, so nothing is lost.
- **Conflict copies**, whether from Graphite or your cloud app, are listed under **Settings → Sync**. A ⚠ warning in the status bar tells you when there are any.
- **On your phone:** use the free official Obsidian app on the same folder. On iPhone and iPad, keep the vault in iCloud Drive. On Android, copy the folder to your phone with an app such as FolderSync or Syncthing.

## Plugins
Graphite can run many **Obsidian community plugins**.

1. Open **Settings** (gear icon or `Ctrl+,`), then **Community plugins**.
2. Click **Turn on community plugins**. Plugins are code written by other people and can change your notes, so only use ones you trust.
3. Click **Browse**, search, and click **Install**. You can also copy a plugin folder into `.obsidian/plugins/` inside your vault.
4. Turn the plugin on with its switch. If it has options, a gear icon appears next to it.

> [!info] What works
> Plugin commands, ribbon icons, status bar items, settings pages, Markdown and code-block renderers, editor suggestions, file menus, pop-up windows and notices all work. Plugins that open their own side panels or change the editor itself (CodeMirror extensions) won't fully work. If a plugin fails to load, the reason appears under its name.

Plugins use the same folder layout as Obsidian. If you point Graphite at an Obsidian vault, plugins that are already installed there appear automatically.

### Managing plugins
- **Uninstall:** the trash icon next to a plugin removes it. Its folder is moved to the vault's `.trash`, so you can restore it.
- **Reload plugins** (the circular arrow next to "Installed plugins") loads every plugin again. Use it after you copy in or edit a plugin folder. It's also in the command palette.
- **Open plugins folder** (the folder icon) shows `.obsidian/plugins/` in File Explorer.

### Example plugin: Note Stats
Graphite comes with a small example plugin, **Note Stats**. Turn it on to get:
- the reading time in the status bar
- a statistics window (the chart icon in the ribbon, or the command "Note Stats: Show statistics for this note")
- a ```` ```stats ```` code block that shows how many notes, links and tags your vault has
- date suggestions when you type `@today`, `@tomorrow` or `@yesterday`
- **Copy wikilink** when you right-click a file

Its code, in `.obsidian/plugins/note-stats/main.js`, is a short example of how to write your own plugin.

### Dataview
Dataview queries (```` ```dataview ```` blocks) show their results in **Read** and **Split** view. Dataview's live preview inside the editor doesn't work, because it needs editor features Graphite doesn't have.

## Language and appearance
- Change the language with the 🌐 button or under **Settings → General**. The app starts in your system language.
- Switch between light and dark with the moon button.
- Change the text font, code font and text size under **Settings → Appearance**. You can also write in a monospace font while editing.
- Drag the edges of the sidebars to resize them, and use the buttons at the top to hide them.
