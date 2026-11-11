# ALU Gallery

Responsive prototype for the public gallery and Phase 1 / Phase 2 workflows.

## Run locally

Run `node server.js` in this folder, then open <http://localhost:4173>. If that port is busy, run `node server.js 4175` and open <http://localhost:4175>.

Records and changes are stored in this browser's local storage. The role selector previews visitor, artist, institution administrator, and gallery administrator views. It is not real authentication or an access control boundary. Email verification, secure accounts, shared database and file storage, cross-user messaging, and public deployment need a backend and service credentials. Artwork images load from Unsplash. Local uploaded artwork is limited to 2 MB per image.
