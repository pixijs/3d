---
name: audit-docs
description: Audit the JSDoc and comments of a directory or files against CODING_STANDARDS.md, cutting docs for users and keeping internal guards. Use when asked to audit, trim or fact-check docs or comments.
---

# Audit a directory's docs

"Comments and JSDoc" in `CODING_STANDARDS.md` is the rule this audit applies: public docs pass the _user test_, internal docs keep only _guards_, tests carry no comments. Lint only says where a comment may sit, not whether it is true or useful, so the audit reads every block. When in doubt, cut: every line kept is one someone has to keep true.

`examples.md` beside this file shows each move as a short before/after pair. `reference.md` covers what the lint rules allow and how to write an `@example` or settle a tier; read it when lint reports a doc rule, or a `@standard` member needs an example or a tier call.

## 1. Pick the slice

Use the directory or files the user named. Keep a slice reviewable: one folder of `src/core` or `src/scene`, or a directory of similar size.

## 2. Audit every block

`node .claude/skills/audit-docs/scripts/long-docs.mjs <dir>` lists the longest blocks first. For each block, decide whether it is public (a user can call, set, receive or subclass it) or internal, then:

- **Internal: keep the guards.** Cut each to one line, delete every block that holds none, and leave `/** @internal */` alone where lint wants a block. Mechanism walkthroughs, lists of callers and design rationale go with the rest.
- **Public: apply the user test.** Keep the summary and whatever changes the user's code: defaults, units, limits, costs, gotchas. Rewrite internals as the effect the user sees.
- **Verify every claim you keep.** Search for every symbol a doc names. Check numbers against their source, and measure them where you can. For "X calls this", read X. For a dependency, read the installed version in `node_modules` and name it in the report. For a spec (glTF, WebGPU) or a paper, read the source and cite it. When docs disagree, the code decides. Claims you delete need no check.
- **Hunt for copies.** A false claim is often repeated. Search the repo for its wording, fix the copies in the slice, and report the rest.
- **One owner per fact.** Keep it on the declaration that owns it and `{@link}` there from elsewhere.
- **Guards that span files** get a line at each end, naming the other. When the other end is outside the slice, write your end and report the other.
- **Add only public gotchas**, one line each, and list every addition in the report so the user can veto it.

A comment outside a JSDoc block, which lint reports once a change brings one back, becomes a name, a line in the JSDoc of the declaration that owns the fact, or a test, or it goes. In a test file it becomes the `it` or `describe` title, an expect message, a name, or a scene's `skipReason`; what the test asserts stays as it is. A comment inside a shader string ships in the shader source: delete it, and if it is a guard, make it one line of the bit's JSDoc. The shader code stays as it is.

The pass changes docs only. A stale doc often sits on a real bug: a mechanism whose reason no longer holds, a conversion that disagrees with the spec, a path nothing calls. Report it with whether you ran code or only read it; the user files issues from these.

Done when every block in the slice is a public doc that passes the user test or an internal guard of at most two lines, and `long-docs.mjs` on the slice lists no internal block longer than that.

## 3. Verify

```bash
npm run test:lint
npm run test:types
npm run test:docs
npx vitest run --browser.headless src/<dir>
node .claude/skills/audit-docs/scripts/code-diff.mjs
```

A directory with no tests makes vitest exit 1 with "No test files found"; for a docs-only diff that is fine.

`code-diff.mjs` prints every change that survives stripping comments, and each one goes in the report's list of code changes. If you restructured code or edited a shader string, also run the tests of its callers and the scenes that draw through it (`tests/README.md`).

## 4. Report

Keep it short and grouped: what was false and is fixed, what was cut, merged or rewritten, and the additions. Then the changes `code-diff.mjs` shows, each with `file:line` and one line on why. Then the user's decisions (tier questions, anything you loosened in a rule), the bugs and smells you left alone, and the checks you ran with their results.

Run as a subagent, send the report to the lead with `SendMessage`, which arrives whole, then end with a one-line final reply; a final reply is cut off at about 4,000 characters.

## 5. Running several slices at once

- **One worktree per slice**, branched from the audit branch. Symlink `node_modules`, `scripts/typedoc/node_modules` and `examples/assets/mirror` from the main checkout.
- **Slices touch disjoint files.**
- **Each agent keeps its scratch files in its own subfolder.** A shared scratch folder lets agents overwrite each other's scripts.
- **Brief each agent** with this skill and `examples.md`, not whole audit commits to read; one commit costs an agent tens of thousands of characters.
- **Tell each agent** to run only its own slice's tests and only the scenes its changes draw through. A dozen browser runs at once overloads the machine.
- **Merge an approved slice**, then delete its worktree:
  1. Export it with `git diff HEAD --binary`; agents sometimes leave changes staged, which a plain `git diff` misses.
  2. Apply it to the audit branch.
  3. Confirm `git diff HEAD` matches file by file before deleting the worktree.
