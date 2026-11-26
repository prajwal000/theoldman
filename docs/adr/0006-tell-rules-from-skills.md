# 0006. Tell hooks read their rule text from the skills folder

Date: 2026-11-26
Status: Accepted

## Context

The SessionStart and UserPromptSubmit hooks give Claude short rule lines: a core summary once per session and a few lines per prompt. The skills in `plugin/skills/` are the only source of rules, so this text cannot live in the hook source. A skill's `SKILL.md` is too long to send on every prompt, and pulling lines out of its prose would break whenever the prose is edited.

## Decision

The short rule lines live in `plugin/skills/oldman-rules/tell.md`, under one `## <name>` heading per use (`core` for session start, one per prompt category). The hooks read the bullet lines under each heading when they run, from the `skills/` folder next to their own `scripts/` folder. The file is not bundled into the scripts.

## Consequences

- Rule text is edited in one place in the skills folder, and changing it does not need a rebuild.
- `tell.md` must stay next to `SKILL.md` and in line with it. Tests check its shape: every section the hooks use exists and stays short.
- Claude Code does not load `tell.md` as a skill. Only `SKILL.md` is loaded.
- If the file is missing, the hooks fail open (exit 1) and Claude gets no rule lines; the guards and checks are not affected.
