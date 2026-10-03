# Stow — personal file library

**Role:** Full-stack developer

**Stack:** TypeScript, Express, Prisma, SQLite, Passport.js, Multer, EJS, Cloudinary

## Project description

Stow is a personal storage application for organizing documents and images. Users can manage nested folders, preview and download files, star favorites, and share collections through links with an expiration date. The interface combines a warm neutral palette, color-coded folders, and a responsive layout.

## Portfolio card

> A full-stack file library with private uploads, nested folders, and expiring share links. Built with Express, Prisma, and Passport.js, with local and Cloudinary storage, transactional quota checks, and desktop and mobile browser tests.

## Engineering highlights

- Implemented session-based authentication with database-backed sessions and per-user access controls.
- Separated storage adapters from library logic so local and cloud files follow the same authorization rules.
- Added server-side content validation and atomic quota reservation to protect upload flows.
- Built public sharing around folder descendants, server-checked expiry dates, and revocable access.
- Used a durable deletion queue to recover from storage failures without restoring deleted metadata.
- Created server-rendered views with progressive browser interactions and automated accessibility checks.

## Demonstration flow

1. Open the landing page, create an account, and enter the workspace.
2. Create a colored folder and a subfolder, then upload a document and an image.
3. Open the image preview, download a file, star it, and find it through search.
4. Share the parent folder for ten days and open the link in a separate browser session.
5. Revoke the link and show that the public page no longer grants access.

## Links

- [Source code](https://github.com/MiguelRcol/file-uploader)
- [Assignment](https://www.theodinproject.com/lessons/nodejs-file-uploader)
- [Workspace screenshot](images/workspace.png)
- [Deployment guide](deployment.md)

The repository is ready to feature in a portfolio. A public hosted demo requires deployment and persistent storage configuration; localhost is the local preview.
