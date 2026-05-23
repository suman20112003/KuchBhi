# Smart Restaurant System

A full-stack restaurant web application built with Node.js, Express, MongoDB, and EJS, with static frontend pages for menu, booking, cart, testimonials, and more.

## Features

- User signup/login flow with session handling
- Admin panel rendered with EJS (`views/admin.ejs`)
- MongoDB integration for users and bookings
- Booking and cart-related frontend pages
- Razorpay payment gateway integration
- Email notifications via Nodemailer SMTP
- Responsive UI with Bootstrap and custom CSS

## Tech Stack

- Backend: Node.js, Express
- Database: MongoDB (Atlas/local fallback support)
- Templating: EJS
- Auth/session: express-session
- Payments: Razorpay
- Email: Nodemailer
- Frontend: HTML, CSS, JavaScript, Bootstrap

## Project Structure

- `server.js` - Main backend server and route definitions
- `.env` - Environment variables
- `views/admin.ejs` - Admin dashboard template
- `templates/kuchbhi-mail.html` - Email template
- `css/`, `js/`, `img/`, `lib/` - Frontend assets
- `*.html` - Static pages (home, menu, contact, cart, etc.)

## Prerequisites

- Node.js 18+ (recommended)
- npm
- MongoDB Atlas cluster (recommended) or local MongoDB

## Installation

1. Clone/download the project.
2. Open terminal in the project root.
3. Install dependencies:

```bash
npm install
```

## Environment Variables

Create/update `.env` in project root:

```env
RAZORPAY_KEY_ID="your_razorpay_key_id"
RAZORPAY_KEY_SECRET="your_razorpay_key_secret"

SMTP_HOST="smtp.gmail.com"
SMTP_PORT="587"
SMTP_SECURE="false"
SMTP_USER="your_email@gmail.com"
SMTP_PASS="your_app_password"
MAIL_FROM="support@kuchbhi.com"
ADMIN_NOTIFICATION_EMAIL="admin@example.com"

MONGODB_URI="mongodb+srv://username:password@cluster0.mongodb.net/DbName?retryWrites=true&w=majority&appName=Cluster0"
MONGODB_DB="DbName"
```

Notes:
- `MONGODB_URI` must not contain `<db_password>` placeholder at runtime.
- `MONGODB_DB` should match your target database name.
- If your DB password has special characters (like `@`, `#`, `/`, `:`), URL-encode it.

## Run the Application

```bash
node server.js
```

Server starts at:
- `http://localhost:3000`

## Important Routes

- `/` - Home page
- `/signup` - Signup page
- `/login` - Login page (served via `contact.html` in current code)
- `/menu` - Menu page
- `/cart` - Cart page (requires login/session)
- `/admin` - Admin dashboard (admin role required)

## MongoDB Behavior in Current Code

- `server.js` reads `MONGODB_URI` and `MONGODB_DB` from `.env`.
- If DB is not connected, protected routes using `ensureDbConnected` return HTTP 503.
- For local URI (`mongodb://127.0.0.1:27017` or `mongodb://localhost:27017`), the app attempts to auto-start local `mongod` from:
  - `C:\Program Files\MongoDB\Server\8.3\bin\mongod.exe`

## Security Recommendations

Current repository includes real-looking secrets in `.env` and fallback constants in `server.js`.
For production safety:

- Never commit real credentials to Git
- Rotate Razorpay, SMTP, and MongoDB credentials
- Remove hardcoded fallback secrets from `server.js`
- Use separate `.env` files per environment

## Troubleshooting

- MongoDB connection fails:
  - Verify Atlas IP access list
  - Verify DB username/password
  - Ensure URI is correct and password is URL-encoded
- SMTP email fails:
  - Use app password for Gmail
  - Check `SMTP_USER`, `SMTP_PASS`, and TLS settings
- Session issues:
  - Ensure cookies are enabled in browser

## License

This project currently does not declare a license. Add one if you plan to distribute it.
