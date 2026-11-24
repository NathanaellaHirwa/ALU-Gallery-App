# ALU Gallery — Art in Conversation

A responsive web gallery and collaboration platform for African Leadership University (ALU) and partner institutions. Artists upload work, institutions and the gallery team review and curate it, and visitors explore published artwork, artists, exhibitions and events.

## Mission & Problem

Student and emerging artists across African universities and cultural institutions have no single, trusted place to show work, join curated exhibitions or collaborate across institutions. Galleries, in turn, need a controlled way to review submissions before anything becomes public.

ALU Gallery solves both sides: a public showcase of **approved** work, and a role-based workspace where artists, institution administrators and gallery administrators move artwork from upload to review to publication.

## Quick Facts

| | |
|---|---|
| Runtime | Node.js 22.13+ (Node 24 recommended). `node:sqlite` is used. |
| Dependencies | None. No `npm install` is needed. |
| Database | SQLite, stored locally in `data/` (git-ignored) |
| Frontend | Single-page app, plain HTML/CSS/JavaScript |
| Default port | `4185` (any port can be passed as an argument) |
| Binding | `127.0.0.1` (local machine only) |

## Repo Structure

```
ALU Gallery App/
├── server.js              # HTTP server, JSON API, SQLite schema, auth, uploads
├── index.html             # Base interface: layout, styling, pages
├── enhancements.js        # API-connected behaviour layered on index.html
├── seed-sample-data.js    # Optional, clearly labelled preview content
├── README.md
├── .gitignore             # Excludes data/ (database + uploaded images) and .env
└── data/                  # Created at first run (not committed)
    ├── alu-gallery.sqlite
    └── uploads/           # Uploaded artwork images
```

## How It Works

```
Browser  ──►  index.html + enhancements.js  ──►  /api/*  ──►  server.js  ──►  SQLite + data/uploads
```

- `server.js` serves the page and the API. For the first paint it injects the current user's data into the page as `window.__ALU_BOOTSTRAP__`, so the site renders without waiting on extra requests.
- `index.html` contains the original screens. `enhancements.js` replaces their behaviour with real, API-backed versions (sign-in, uploads, reviews, messaging, reports).
- Every API request is permission-checked on the server by role, regardless of what the interface shows.

### Artwork lifecycle

1. An artist (or institution administrator) uploads or submits artwork — it starts as **pending** and is visible only to its owner, their institution and gallery administrators.
2. The artwork is submitted to an exhibition that is **open for submissions**.
3. A gallery administrator reviews the submission: *under review*, *changes requested*, *approved* or *rejected*.
4. **Approved** artwork becomes **published** and appears in the public gallery. Gallery administrators can also publish or unpublish artwork directly.
5. If an owner edits published artwork, it returns to **pending** and the administrators are notified for re-review.

## Roles & Features

| Role | What they can do |
|---|---|
| **Public visitor** | Browse the gallery with discipline / artist / institution filters, view artwork details, meet artists, see exhibitions, institutions and events. |
| **Artist** | Register, manage a profile (biography, country, discipline, portfolio, contact), upload artwork (JPEG/PNG/WebP, max 2 MB), edit or remove their work, submit up to 3 artworks at a time to an open exhibition, register for events, message gallery administrators. |
| **Institution administrator** | Register an institution (activated after approval), manage the institution profile, submit institutional artwork, create and cancel their own events, invite partner institutions to collaborate, manage users at their institution, view institution-scoped reports. |
| **Gallery administrator** | Review submissions, publish/unpublish artwork, approve or reject institutions, suspend or reactivate accounts, create exhibitions and events, manage collaborations, view platform-wide reports. |

### Main pages

Home · Explore gallery · Artists · Exhibitions · Institutions · Events · Dashboard · Submissions · Collaborations · Messages · Reports · Users (workspace pages depend on role).

## Getting Started

### 1. Run the app

In PowerShell, from the project folder:

```powershell
node server.js 4185
```

Open <http://localhost:4185>. The server binds to loopback and does not publish the site to the internet.

### 2. Create the first gallery administrator

Set a one-time setup key before starting the server:

```powershell
$env:ALU_SETUP_KEY = 'replace-with-a-long-random-secret'
node server.js 4185
```

In the app choose **Set up admin**, then enter the key, a name, an email and a password of at least 12 characters. The endpoint stops accepting requests once an active gallery administrator exists. Keep the key private and unset it afterwards.

### 3. (Optional) Add sample content

Start the server once so it creates the schema, stop it, then run:

```powershell
node seed-sample-data.js
```

The seed is idempotent and adds 10 sample works, 6 sample artists, 3 sample events (2027), 3 sample exhibitions, the ALU directory entry and 3 sample partner institutions. Sample accounts are non-login demo records and are excluded from account management and user totals. Every sample item is labelled as a preview — replace it with approved ALU and artist content before presenting the site as an official collection.

### 4. Register and sign in

- **Artists** register directly and can sign in immediately.
- **Institutions** register and stay *pending* until a gallery administrator approves the institution.

### Environment variables

| Variable | Purpose |
|---|---|
| `ALU_SETUP_KEY` | Enables the one-time first-administrator setup. |
| `ALU_DATA_DIR` | Overrides the data folder (database and uploads). Defaults to `./data`. |
| `ALU_TRUST_PROXY` | When set, the login rate limit uses `X-Forwarded-For` (only use behind a trusted proxy). |

## API Reference

All routes are under `/api` and return JSON. Write requests must come from the same origin.

| Area | Endpoints |
|---|---|
| Session | `GET /bootstrap`, `GET /health`, `GET /me`, `POST /register`, `POST /login`, `POST /logout`, `POST /setup-admin` |
| Profile | `GET /profile`, `PATCH /profile` |
| Artwork | `POST /artworks`, `PATCH /artworks/:id`, `DELETE /artworks/:id`, `GET /artworks/:id/image` |
| Exhibitions | `POST /exhibitions`, `PATCH /exhibitions/:id` |
| Submissions | `POST /submissions`, `PATCH /submissions/:id` |
| Institutions | `POST /institutions`, `PATCH /institutions/:id` |
| Events | `POST /events`, `PATCH /events/:id`, `POST` / `DELETE /events/:id/register` |
| Collaborations | `POST /collaborations`, `PATCH /collaborations/:id` |
| Messaging | `GET /messages`, `POST /messages`, `GET /messages/:id`, `GET /contacts` |
| Notifications | `POST /notifications/read`, `DELETE /notifications` |
| Admin | `GET /users`, `PATCH /users/:id`, `GET /reports` |

## Data Model

SQLite tables: `institutions`, `users`, `artist_profiles`, `sessions`, `artworks`, `exhibitions`, `submissions`, `collaborations`, `events`, `event_registrations`, `conversations`, `conversation_members`, `messages`, `notifications`, `activity_logs`.

## Security

- Passwords hashed with **scrypt** (per-user salt); minimum 12 characters.
- Session tokens are random, stored **hashed**, sent in an `HttpOnly`, `SameSite=Strict` cookie and expire after 7 days.
- Login attempts are rate-limited (10 per minute per address).
- Role checks on every route; users only see and change what their role and institution allow.
- Uploads are limited to JPEG/PNG/WebP, 2 MB, verified by file signature and saved under a random server-side name. Unpublished images require an authorized session.
- Static files are allow-listed; the database and uploads are never served directly.
- Same-origin check on write requests, `X-Content-Type-Options`, `X-Frame-Options` and `Referrer-Policy` headers.
- Audit log records key actions.

## Reports

Gallery and institution administrators can filter activity by date and export an Excel-readable **CSV**, or use the browser's print dialog to save a PDF.

## Not Yet Included (Needed for Production)

- **Email provider** for email verification, password recovery and outbound notifications.
- **Hosted runtime, HTTPS and persistent storage** so partners can reach one shared online service. The server currently binds to `127.0.0.1`.
- Native XLSX/PDF report generation.
- Exhibition curator/participant assignment, event participant exports, file attachments, notification preferences, profile photos and automated database backups.

## Notes

Do not commit `.env` files, the local database or uploaded artwork. The `data/` folder is already git-ignored.
