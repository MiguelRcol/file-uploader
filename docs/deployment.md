# Deployment and backups

Stow supports a single Node.js server with persistent disk. Use HTTPS through a trusted reverse proxy. This guide is provider-independent; it does not provision a hosting account or create a public deployment.

## Prepare the server

1. Install Node.js 24 and clone the repository.
2. Run `npm ci`.
3. Create `.env` from `.env.example`, or supply environment variables through your host.
4. Set `NODE_ENV=production`, `APP_URL=https://your-domain.example`, and a unique `SESSION_SECRET` of at least 32 characters. You can generate one with `node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"`.
5. Set `DATABASE_URL` to a SQLite file on a persistent volume, for example `file:/var/lib/stow/stow.db`. Relative paths resolve from the project root.
6. Set `UPLOAD_DIR` to a private directory on the same persistent volume when using local storage. The app’s operating-system user must own both directories.
7. Run `npm run setup` and `npm run build`, then `npm start` through your host’s process manager.

The current build and migration tooling uses development dependencies, so install them for build and migration stages. The production server runs the compiled JavaScript in `dist/`.

## Reverse proxy

Forward the application through HTTPS and set `TRUST_PROXY=true` only if there is exactly one trusted reverse proxy in front of Express. Forward the `X-Forwarded-Proto` header correctly; otherwise Secure cookies will not be issued and login will not persist.

Configure your proxy’s request-size limit above `MAX_FILE_SIZE_MB`, accounting for multipart overhead, and allow enough time for cloud uploads. The application enforces the actual upload limit independently. Route `/health` to the health checker; it verifies the database is reachable and returns HTTP 503 on failure.

## Cloud storage

Cloudinary needs three private credentials from your account. Set `STORAGE_PROVIDER=cloudinary`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`, then restart.

New uploads use authenticated raw storage. Verify a real upload and download in your account before sharing the hosted app. Cloudinary’s plan and account settings may restrict delivery of some formats. The automated suite verifies adapter behavior with mocks and does not claim a live cloud test.

Even with Cloudinary, the SQLite database must persist across deploys. Do not run this setup on an ephemeral filesystem or scale it to multiple instances. Keep credentials in your host’s secret manager and never place them in the repository.

## Back up and restore

For a simple consistent backup, stop Stow, copy the database and local upload directory together, then restart. Alternatively, use SQLite’s backup API and coordinate file writes while taking the snapshot. Store backups outside the application’s data directory.

To restore, stop the server, restore both directories to their configured paths, check filesystem permissions, and restart. Cloudinary users must also preserve their cloud assets and credentials. Database backups alone cannot recover deleted cloud objects.

After restoring, verify sign-in, file download, and share expiry. Pending storage deletions are stored in SQLite and resume when the server starts. Never restore a database while a cleanup worker is running against it.

## Updates

Back up data, stop the app, pull the new version, run `npm ci`, `npm run setup`, `npm run build`, then restart. The committed Prisma migrations are applied by setup. Run `npm test` before deploying an update.
