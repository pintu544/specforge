# Notes API

Build a small TypeScript HTTP API for personal notes, using only the Node.js standard library (`node:http`) — no frameworks, no external runtime dependencies. Notes are kept in memory (no persistence required).

## Server

- Export `createServer(): http.Server` from the server module; the entry module starts it on `process.env.PORT` (default 3000) only when run directly.
- All responses are JSON with `Content-Type: application/json`.
- Unknown routes and malformed JSON bodies return `404` / `400` respectively, with a JSON body of the shape `{ "error": string }`.

## Data model

A note: `{ id: string, title: string, body: string, tags: string[], createdAt: string, updatedAt: string }` — ids are unique strings, timestamps are ISO strings.

## Endpoints

- `POST /notes` — body `{ title, body?, tags? }`. Title is required and must be a non-empty string, otherwise `400`. Creates a note, responds `201` with the note.
- `GET /notes` — responds `200` with `{ notes: [...] }` in creation order. Optional query `?tag=<tag>` filters to notes having that tag; `?q=<text>` filters to notes whose title or body contains the text (case-insensitive). Both filters may combine.
- `GET /notes/:id` — `200` with the note, or `404`.
- `PUT /notes/:id` — body may update `title`, `body`, `tags`; a present-but-empty title is `400`; unknown id is `404`. Updates `updatedAt`, responds `200` with the note.
- `DELETE /notes/:id` — `204` with no body, or `404`.
- `GET /stats` — `200` with `{ total: number, tags: number }` where `tags` is the count of distinct tags across all notes.

## Architecture expectations

- A store module holding the notes in memory with create/list/get/update/remove operations, independent of HTTP, unit-testable directly.
- A validation module for request payloads (title rules, tag normalisation: trim, lowercase, drop empties and duplicates).
- A router/server module mapping method+path to handlers and translating store results and validation errors into the status codes above.
- An entry module that starts the server when run directly.

## Acceptance criteria

- Creating a note returns 201 and the note can be fetched by id.
- Listing supports tag and text filters, separately and combined.
- Updating a note changes `updatedAt` and never `createdAt`.
- Deleting a note makes subsequent GETs for it return 404.
- Invalid create/update payloads return 400 and store nothing.
- Store and validation behaviour are covered by unit tests; the HTTP layer is covered by tests that start the server on an ephemeral port.
