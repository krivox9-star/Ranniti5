## Payment and entry workflow

The application stores registrations, payments, invoices, entry passes, email logs, and check-ins in MongoDB. Admins authenticate through JWT and confirm payments from `/admin`.

Copy `.env.example` to `.env` and configure `MONGODB_URI` and `MONGODB_DB`. Set `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` for real Razorpay checkout orders. Set `BREVO_API_KEY`, `BREVO_SENDER_NAME`, and `BREVO_SENDER_EMAIL` for password reset and confirmation email delivery. Resend variables remain supported as a fallback for password reset emails. Manual UPI/UTR submissions are stored as `Received` for admin review.

Run locally:

```bash
npm install
npm start
```

The admin account must be created through `/api/auth/register` using the exact email configured as `ADMIN_EMAIL`, then used at `/admin`. Confirmation creates sequential `RN5-INV-001` invoices and `RN5-001` entry passes using MongoDB atomic counters, stores a unique QR token, sends both PDFs through Brevo, and makes QR/manual check-in idempotent.
# Ranniti Backend

A lightweight Express backend with JWT authentication and file-based user storage.

## Setup

1. Install dependencies:
   npm install
2. Configure MongoDB:
   - Copy `.env.example` to `.env`.
   - For a local MongoDB server, keep `MONGODB_URI=mongodb://127.0.0.1:27017`.
   - For MongoDB Atlas, set `MONGODB_URI` to the connection string from Atlas and set `MONGODB_DB` to `ranniti5` (or another database name).
   - In Atlas, add the machine running this app under **Network Access** and create a database user under **Database Access**.
3. Start the app:
   npm start
4. For development auto-reload:
   npm run dev

The server connects to MongoDB during startup, creates the required collections' indexes, and then serves the website. A failed connection means the configured MongoDB URI is unreachable or invalid; check `.env`, the Atlas network allowlist, and the database user's credentials.

## Deploy

Upload or connect the project root (the folder containing `package.json`) to Vercel or Netlify.

### Vercel

Vercel uses the included `vercel.json`. No build command is required; the project runs through `server.js`.

For password reset emails, add these Brevo Environment Variables in the Vercel
project settings for the Production environment, then redeploy:
`BREVO_RESET_PASSWORD_API_KEY` (a private Brevo v3 API key),
`BREVO_RESET_PASSWORD_SENDER_NAME`, `BREVO_RESET_PASSWORD_SENDER_EMAIL`, and
`APP_URL` (the deployed site URL, without a trailing slash). The shared
`BREVO_API_KEY`, `BREVO_SENDER_NAME`, and `BREVO_SENDER_EMAIL` remain supported
as fallbacks and are used for confirmation emails. Resend can be used instead
by setting `RESEND_API_KEY` and `RESEND_FROM_EMAIL`.

Keep the Brevo variables configured as well if confirmation emails are enabled.

### Netlify

Netlify uses the included `netlify.toml` and `netlify/functions/server.js`. No publish directory is required.

The registration, payment, and confirmation pages are available at `/register`, `/payment`, and `/confirmation`.

## Render

Deploy branch `arena/01a0c8ee-ranniti5` (or `main` after that branch is merged). Leave the root directory empty and set the start command to `npm start`.

Sign-in and registration need a MongoDB database. In the Render service environment, set `MONGODB_URI` to the Atlas connection string and `MONGODB_DB` to `ranniti5`. In Atlas Network Access, allow `0.0.0.0/0` so Render can connect. If the database password contains `@`, `:`, `/` or `#`, URL-encode it in the connection string.

`/api/health` reports `database: connected` when sign-in can work. A missing or unreachable database is shown on the sign-in and registration forms.

## Environment

Copy `.env.example` to `.env` and update the values if needed.

## API endpoints

- `GET /api`
- `GET /api/health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/users`
- `GET /api/users/me`

## Example request

Register:

```bash
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Jane","email":"jane@example.com","password":"secret123"}'
```

Login:

```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"jane@example.com","password":"secret123"}'
```
