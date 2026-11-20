# Brain file templates

Use these when a file in `D:\MyObsidian\vault\Claude Brain\` doesn't exist yet. Replace the bracketed parts.

## README.md

```markdown
# My brain

A record of what I've really understood and what I'm still confused about, kept up to date by Claude with the `update-brain` skill. Say "update my brain" at the end of a study chat, or ask "what am I confused about?".

## Status labels

- **solid**: I've shown I can do it (correct answer with reasons, a proof idea, a worked example).
- **shaky**: partly there, needs hints, or I said I get it without showing it.
- **confused**: I don't get it yet.
- **covered**: Claude explained it or made material, but I haven't been tested.
- **untested**: in the course, not touched yet.

## Files

- `profile.md`: me as a learner
- `courses/`: one topic table per course
- `confusions.md`: the questions I can't answer yet
- `next.md`: what to study next
- `log.md`: what happened in each session
- `resources.md`: study pages and notes
```

## profile.md

```markdown
# Learner profile

- Languages: [ ]
- Courses: [ ]
- Upcoming exams: [course, date or "date not confirmed", scope]
- How I like to study: [ ]
- Other notes: [ ]

_Last updated: [YYYY-MM-DD]_
```

## courses/<course>.md

File name: a short kebab-case course name, such as `linear-algebra.md`.

```markdown
# [Course name]

[One line: textbook or instructor, exam scope if known.]

| Topic | Status | Evidence | Updated |
|---|---|---|---|
| [LA1 Vectors, dot products] | untested | | |
```

## confusions.md

```markdown
# Open confusions

Each one is a question I can't answer yet.

- [ ] **[Course · topic]**: [the specific question]. _(since YYYY-MM-DD)_

## Resolved

- [x] **[Course · topic]**: [question]. Clicked on [YYYY-MM-DD] when [what helped].
```

## next.md

```markdown
# Next steps

_Updated [YYYY-MM-DD]_

1. [Concrete action] · [resource link]
```

## log.md

```markdown
# Session log

## [YYYY-MM-DD] · [course]

- Did: [ ]
- Status changes: [topic: old → new, why]
- Still open: [ ]
```

## resources.md

```markdown
# Resources

## [Course]

- [Name](link): [what it is]
```
