# Daily Photos

A tiny private site: upload photos from your phone throughout the day, then browse
them grouped by day. Photos older than 7 days are deleted automatically
(`RETENTION_DAYS` in `.env`).

## Run it locally

```
npm install
copy .env.example .env    # then edit PASSCODE and COOKIE_SECRET
npm start
```

Visit http://localhost:3000, enter the passcode from `.env`.

## Deploy online (Render free tier)

1. **Push this repo to GitHub**
   - Create a new empty repo at https://github.com/new (e.g. `daily-photos`, private is fine)
   - Then run:
     ```
     git remote add origin https://github.com/<your-username>/daily-photos.git
     git push -u origin master
     ```

2. **Create the Render service**
   - Go to https://render.com and sign up / log in (free, no card required for this)
   - Click **New +** → **Web Service** → connect your GitHub account → pick the `daily-photos` repo
   - Settings:
     - Build command: `npm install`
     - Start command: `npm start`
     - Instance type: **Free**
   - Under **Environment**, add:
     - `PASSCODE` — the passcode you'll type on your phone to log in
     - `COOKIE_SECRET` — any long random string
     - `NODE_ENV` = `production`
     - `RETENTION_DAYS` = `7` (optional, defaults to 7)
   - Click **Create Web Service**

3. Once deployed, open the `https://<your-app>.onrender.com` URL on your phone,
   add it to your home screen, and log in with your passcode.

### Note on the free tier
Render's free instances spin down after ~15 minutes of inactivity and spin back up
on the next visit (takes a few seconds), and the disk resets whenever you redeploy.
Since photos auto-delete after `RETENTION_DAYS` anyway, this app is built around that —
just don't expect photos to survive forever, and redeploy sparingly.
