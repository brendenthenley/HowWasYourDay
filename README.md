# Daily Photos

A tiny private site: upload photos from your phone throughout the day, then browse
them grouped by day. Photos are stored on Cloudinary (not the app server, which is
on a free host with no reliable local storage). Photos older than 7 days are deleted
automatically (`RETENTION_DAYS` in `.env`).

## Run it locally

```
npm install
copy .env.example .env    # then fill in PASSCODE, COOKIE_SECRET, CLOUDINARY_URL
npm start
```

Visit http://localhost:3000, enter the passcode from `.env`.

### Cloudinary setup (one-time)
1. Sign up free at https://cloudinary.com
2. On your Dashboard, find **Cloud name**, **API Key**, and **API Secret**
   (click "reveal" if the secret is hidden).
3. Set them as `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and
   `CLOUDINARY_API_SECRET` in `.env` (locally) and in Render's environment
   variables (for the deployed site).

## Deploy online (Render free tier)

1. **Push this repo to GitHub**
   - Create a new empty repo at https://github.com/new (e.g. `daily-photos`, private is fine)
   - Then run:
     ```
     git remote add origin https://github.com/<your-username>/daily-photos.git
     git push -u origin main
     ```

2. **Create the Render service**
   - Go to https://render.com and sign up / log in (free, no card required for this)
   - Click **New +** → **Web Service** → connect your GitHub account → pick the repo
   - Settings:
     - Build command: `npm install`
     - Start command: `npm start`
     - Instance type: **Free**
   - Under **Environment**, add:
     - `PASSCODE` — the passcode you'll type on your phone to log in
     - `COOKIE_SECRET` — any long random string
     - `NODE_ENV` = `production`
     - `RETENTION_DAYS` = `7` (optional, defaults to 7)
     - `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` — from the Cloudinary setup above
   - Click **Create Web Service**

3. Once deployed, open the `https://<your-app>.onrender.com` URL on your phone,
   add it to your home screen, and log in with your passcode.

### Notes
- Render's free instances spin down after ~15 minutes of inactivity and spin back
  up on the next visit (takes a few seconds) — this no longer matters for your
  photos since they live on Cloudinary, not the app's local disk.
- Photo URLs served from Cloudinary are reachable by anyone with the exact link
  (they're not behind the app's passcode), though the links themselves are
  unguessable random IDs. Fine for a private day-journal; not a hard privacy
  guarantee if a link ever leaks.
