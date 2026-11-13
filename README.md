# Tactyqal Builder Lab

A responsive homepage concept and a persistent blog CRUD API, prepared for the [Tactyqal full-stack internship challenge](https://devuty.com/hackathons/Fullstack-Intern).

**AI assistance disclosure:** This implementation, original visual design, sample editorial copy, tests and walkthrough were prepared with substantial OpenAI Codex assistance for Shubham Padkonde's application. The challenge explicitly permits AI assistance. This is not presented as independently written or as production work for Tactyqal.

**[Watch the captioned walkthrough](https://shubham-padkonde.github.io/tactyqal-builder-lab/).** It records the actual local interface and has no narration. The hosted page contains only the video; run the full app locally to use the persistent API.

## Run locally

Requires **Node.js 24.15 or later**. No packages, account, cloud database or build step are needed.

```sh
npm start
# Open http://127.0.0.1:4318
```

Open **Field notes → Open blog studio → Unlock studio**. The local demonstration key is prefilled as `local-demo-only`. Create a draft, publish it, open it from the journal, edit it, and delete it. Changes persist in `data/blog.sqlite` across server restarts.

```sh
npm test
```

Node's built-in SQLite module may print an experimental warning on Node 24. The application deliberately binds to loopback only. It is a reviewable local prototype, not a public multi-user CMS. No database, credentials, résumé or personal contact information is committed.

## Design choices

- A warm editorial homepage centered on the eight-week idea-to-launch journey, with an original CSS workbench illustration and clear links into program details.
- Responsive layouts, visible keyboard focus, a skip link, native dialogs, semantic headings, text labels and reduced-motion support.
- Project references from the [existing Tactyqal homepage](https://tactyqal.com/), with original explanatory copy. No invented testimonials, revenue claims, success rates or enrolment forms.
- Vanilla JavaScript keeps the exercise easy to inspect. The same Node server serves the frontend and the JSON API, eliminating CORS configuration and a separate build service.
- SQLite provides durable, transactional local storage with a unique slug constraint and a status/update index. Statements use bound parameters. User-entered content renders through `textContent`, never as raw HTML.
- Drafts are hidden from public reads. Editor endpoints require an editor key, reject cross-origin writes, validate input and bound request sizes. Writes return useful error codes rather than exposing database errors.

## Database

`posts`: `id` UUID primary key, `title`, unique `slug`, `category`, `excerpt`, `body`, `author`, `status` (`draft` / `published`), `created_at`, `updated_at` (UTC ISO timestamps).

`migrations` records the initial seed, so deleting every post does not cause deleted articles to reappear after restart. Three clearly labeled demo articles are inserted only on a new database.

## API

| Method | Endpoint | Behavior |
|---|---|---|
| GET | `/api/health` | Reports API availability and SQLite storage |
| GET | `/api/posts?limit=12&offset=0&q=idea` | Published posts, text search and pagination (limit 1–50) |
| GET | `/api/posts?all=1` | Editor-only list including drafts |
| GET | `/api/posts/:id` | Individual post; draft requires editor key |
| POST | `/api/posts` | Create; requires editor key and all editable fields |
| PATCH | `/api/posts/:id` | Partial update; requires editor key |
| DELETE | `/api/posts/:id` | Delete; requires editor key, returns 204 |

Editor requests use `X-Editor-Key`. POST/PATCH bodies require `application/json`. Example body:

```json
{
  "title": "A useful first idea",
  "slug": "a-useful-first-idea",
  "category": "Discovery",
  "excerpt": "Start by listening to someone with a real problem.",
  "body": "Ask how they solve it today. Then test a smaller, simpler approach.",
  "author": "Demo editor",
  "status": "draft"
}
```

Expected errors: 400 malformed input/pagination, 401 missing editor key, 403 cross-origin write, 404 missing/private post, 409 duplicate slug, 413 oversized body, 415 unsupported content type, 422 validation failure.

## Validation

The integration tests exercise the complete create/read/update/delete lifecycle, draft visibility, search/pagination, duplicate slugs, authorization, cross-origin rejection, malformed/oversized inputs, asset allowlisting, injection-like literal content and database persistence after restarting the server. UI checks cover the desktop and mobile homepage and the real editor workflow.

## Production follow-up

Before any public deployment: replace the demo editor key with proper user authentication and roles, use TLS with a trusted proxy/origin policy, add rate limiting and audit logs, introduce backups and migration versioning, handle concurrent edits, add editorial pagination, and migrate to a managed database if multiple server instances are needed. The current plain-text editor intentionally has no rich-HTML upload or media surface.

The website is a design exercise, not an official Tactyqal site. Names and source references belong to their respective owners.
