# ALU Gallery

Responsive gallery and collaboration application for ALU and partner institutions. The Node server serves the interface and a SQLite-backed API; the database and uploaded images remain on this machine in the ignored `data/` directory.

## Requirements

- Node.js 22.13 or later (`node:sqlite` is used; Node 24 is recommended).
- No npm packages are required.

## Run locally

In PowerShell, from this folder:

```powershell
node server.js 4185
```

Open <http://localhost:4185>. The server binds to loopback for local use. It does not publish the site to the internet.

## First gallery administrator

Set a one-time setup key before starting the server:

```powershell
$env:ALU_SETUP_KEY = 'replace-with-a-long-random-secret'
node server.js 4178
```

Open the app and choose **Set up admin**. Enter that key, a name, email, and a password of at least 12 characters. The endpoint stops accepting setup requests once an active gallery administrator exists. Keep the setup key private and unset it after the first administrator is created.

Artists can register through the app. Institution administrators can request accounts, which remain pending until a gallery administrator approves the institution. The server stores password hashes (scrypt), hashed session tokens, role-scoped records, audit events, and relational data in SQLite. Uploaded JPEG, PNG, and WebP artwork is limited to 2 MB and stored under a generated server-side filename; unpublished images require an authorized session to view. Gallery administrators can review artwork, manage account access, approve institutions, create and publish exhibitions and events, invite institutions to collaborations, and view reports. Artists and institution administrators can manage their profiles, artwork, submissions, events, and authorized conversations.

## Services still needed for a production deployment

- **Email provider credentials** for email verification, password recovery, and outbound notifications. Those flows are not active without an email integration.
- **Hosted runtime, HTTPS, and persistent storage** before partner users can access the same service online. The server currently binds to `127.0.0.1`.
- The report screen exports Excel-readable CSV; use the browser print dialog to save a PDF. Native XLSX/PDF generation is not configured.
- Artwork details can be edited and artwork can be removed by its owner or an administrator. Exhibition participant and curator assignment, event participant exports, file attachments, notification preferences, profile photos, and automated database backups are not implemented yet.

This repository contains the application code. Do not commit `.env` files, the local database, or uploaded artwork.
