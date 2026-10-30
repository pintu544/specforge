# TaskLedger CLI

Build a small TypeScript command-line tool for tracking personal tasks, stored in a local JSON file.

## Behaviour

- The tool is run as `node dist/cli.js <command> [options]` after `npm run build`.
- Tasks are stored in a JSON file. The path comes from the `TASKLEDGER_FILE` environment variable, defaulting to `./tasks.json` in the current directory.
- A task has: `id` (string, unique), `title` (string), `done` (boolean), `tags` (string array), `createdAt` (ISO timestamp string).

## Commands

- `add <title> [--tag <tag>]...` — create a task, print `Added <id>`. Title is required; an empty title is an error (exit code 1, message to stderr).
- `list [--done | --open] [--tag <tag>]` — print one line per task: `<id>  [x| ]  <title>` plus ` (tags: a, b)` when it has tags. Default lists all tasks in creation order.
- `done <id>` — mark a task done, print `Done <id>`. Unknown id is an error (exit 1).
- `remove <id>` — delete a task, print `Removed <id>`. Unknown id is an error (exit 1).
- `stats` — print exactly three lines: `total: <n>`, `done: <n>`, `open: <n>`.
- Unknown command — print usage to stderr and exit 1.

## Architecture expectations

- A storage module that loads/saves the JSON file (a missing file means an empty list; malformed JSON is an error, not silent data loss).
- A task-service module with the domain operations (add/list/complete/remove/stats) independent of argv parsing, so it can be unit-tested directly.
- A stats module computing the counts.
- A CLI module that parses argv, calls the service, prints results, and returns an exit code from an exported `main(argv: string[]): Promise<number>` function (the process entry point just calls it), so the CLI itself is testable without spawning a process.

## Acceptance criteria

- Adding a task persists it: a second process invocation lists it.
- `list --open` shows only unfinished tasks; `list --tag work` shows only tasks with that tag.
- `done` on an unknown id exits 1 and changes nothing.
- `stats` counts match the stored tasks.
- All domain operations are covered by unit tests.
