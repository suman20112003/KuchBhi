const express = require('express');
require('dotenv').config();
const app = express();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns');
const https = require('https');
const { spawn } = require('child_process');
const session = require("express-session");
const cookie = require('cookie-parser');
const e = require('express');
const multer = require('multer')
const Razorpay = require('razorpay');
const mongodb = require('mongodb');
const nodemailer = require('nodemailer');
const brevo = require('@getbrevo/brevo');
const { name } = require('ejs');
const { ObjectId } = require('mongodb');
const { MongoClient } = mongodb;
let dbinstance;
const MONGODB_URI = process.env.MONGODB_URI ;
const DB_NAME = process.env.MONGODB_DB ;
let client = null;
let connectionPromise = null;
let localMongoStartupPromise = null;

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID ;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET ;
const razorpay = (RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET)
    ? new Razorpay({ key_id: RAZORPAY_KEY_ID, key_secret: RAZORPAY_KEY_SECRET })
    : null;

const SMTP_HOST = process.env.SMTP_HOST ||'';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';
const SMTP_USER = process.env.SMTP_USER || 'sumanpingla20@gmail.com';
const SMTP_PASS_RAW = String(process.env.SMTP_PASS || process.env.SMTP_APP_PASSWORD || '').trim();
const SMTP_PASS = SMTP_HOST.includes('gmail.com') ? SMTP_PASS_RAW.replace(/\s+/g, '') : SMTP_PASS_RAW;
const SMTP_REQUIRE_TLS = String(process.env.SMTP_REQUIRE_TLS || (!SMTP_SECURE)).toLowerCase() === 'true';
const SMTP_CONNECTION_TIMEOUT = Number(process.env.SMTP_CONNECTION_TIMEOUT || 10000);
const SMTP_GREETING_TIMEOUT = Number(process.env.SMTP_GREETING_TIMEOUT || 10000);
const SMTP_SOCKET_TIMEOUT = Number(process.env.SMTP_SOCKET_TIMEOUT || 20000);
const SMTP_VERIFY_ON_START = String(process.env.SMTP_VERIFY_ON_START || 'false').toLowerCase() === 'true';
const SMTP_IP_FAMILY = Number(process.env.SMTP_IP_FAMILY || 4);
const DNS_RESULT_ORDER = process.env.DNS_RESULT_ORDER || 'ipv4first';
const BREVO_API_KEY = String(process.env.BREVO_API_KEY || '').trim();
const MAIL_FROM = process.env.MAIL_FROM || 'support@kuchbhi.com';
const ADMIN_NOTIFICATION_EMAIL = process.env.ADMIN_NOTIFICATION_EMAIL || 'sumanpingla20@gmail.com';
const EFFECTIVE_MAIL_FROM = SMTP_USER ? `KuchBhi Support <${SMTP_USER}>` : (MAIL_FROM || 'no-reply@kuchbhi.com');
const MAIL_HEADER_LOGO_URL = 'https://crm.onetechsoftware.com/img/logo2.png';
const MAIL_SUPPORT_NAME = process.env.MAIL_SUPPORT_NAME || 'Soumyajit Bhattyachrya';
const MAIL_SUPPORT_EMAIL = SMTP_USER || 'support@kuchbhi.com';
const MAIL_SUPPORT_PHONE = process.env.MAIL_SUPPORT_PHONE || '+91 6289 279 707';
const APP_BASE_URL = (process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, '');
const FIREBASE_API_KEY = String(process.env.FIREBASE_API_KEY || '').trim();
const FIREBASE_AUTH_BASE_URL = 'https://identitytoolkit.googleapis.com/v1';
const FIREBASE_AUTH_DOMAIN = String(process.env.FIREBASE_AUTH_DOMAIN || '').trim();
const FIREBASE_PROJECT_ID = String(process.env.FIREBASE_PROJECT_ID || '').trim();
const FIREBASE_APP_ID = String(process.env.FIREBASE_APP_ID || '').trim();
const MAIL_TEMPLATE_PATH = path.join(__dirname, 'templates', 'kuchbhi-mail.html');
const MAIL_LOGO_PATH = process.env.MAIL_LOGO_PATH || path.join(__dirname, 'img', 'hero.png');
const MAIL_LOGO_CID = 'kuchbhi-logo@kuchbhi';
const MAIL_LOGO_EXISTS = fs.existsSync(MAIL_LOGO_PATH);
// Compute Brevo usage flag early so MAIL_LOGO_SRC can use the right URL
const USE_BREVO = BREVO_API_KEY.startsWith('xkeysib-');
// Brevo API does not support CID inline attachments — always use external URL for that path
const MAIL_LOGO_SRC = (MAIL_LOGO_EXISTS && !USE_BREVO) ? `cid:${MAIL_LOGO_CID}` : MAIL_HEADER_LOGO_URL;
const MAIL_LOGO_ATTACHMENTS = MAIL_LOGO_EXISTS
    ? [{ filename: path.basename(MAIL_LOGO_PATH), path: MAIL_LOGO_PATH, cid: MAIL_LOGO_CID }]
    : [];
// Pre-read logo as base64 for Brevo inline attachment (only if file exists)
const MAIL_LOGO_BASE64 = (USE_BREVO && MAIL_LOGO_EXISTS)
    ? fs.readFileSync(MAIL_LOGO_PATH).toString('base64')
    : null;
const MAIL_LOGO_MIME = (MAIL_LOGO_PATH.endsWith('.png') ? 'image/png' : 'image/jpeg');

function buildAppUrl(routePath = '/') {
    const safePath = routePath.startsWith('/') ? routePath : `/${routePath}`;
    return `${APP_BASE_URL}${safePath}`;
}

function hasFirebaseAuthConfig() {
    return Boolean(FIREBASE_API_KEY);
}

function hasFirebaseWebConfig() {
    return Boolean(FIREBASE_API_KEY && FIREBASE_AUTH_DOMAIN && FIREBASE_PROJECT_ID && FIREBASE_APP_ID);
}

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function isValidEmail(email) {
    const normalized = normalizeEmail(email);
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
}

function isFirebaseEmailInputError(code) {
    return code === 'INVALID_EMAIL' || code === 'MISSING_EMAIL';
}

async function firebaseAuthRequest(endpoint, payload) {
    if (!hasFirebaseAuthConfig()) {
        return { ok: false, code: 'FIREBASE_NOT_CONFIGURED' };
    }

    try {
        const url = new URL(`${FIREBASE_AUTH_BASE_URL}/${endpoint}?key=${encodeURIComponent(FIREBASE_API_KEY)}`);
        const body = JSON.stringify(payload);

        const result = await new Promise((resolve, reject) => {
            const req = https.request({
                protocol: url.protocol,
                hostname: url.hostname,
                path: `${url.pathname}${url.search}`,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body)
                },
                timeout: 15000
            }, (res) => {
                let raw = '';
                res.setEncoding('utf8');
                res.on('data', (chunk) => {
                    raw += chunk;
                });
                res.on('end', () => {
                    let data = {};
                    try {
                        data = raw ? JSON.parse(raw) : {};
                    } catch (parseErr) {
                        return resolve({ ok: false, code: 'FIREBASE_BAD_JSON_RESPONSE' });
                    }

                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        return resolve({ ok: true, data });
                    }

                    const message = data && data.error && data.error.message ? data.error.message : `FIREBASE_HTTP_${res.statusCode}`;
                    return resolve({ ok: false, code: message });
                });
            });

            req.on('timeout', () => {
                req.destroy(new Error('FIREBASE_TIMEOUT'));
            });

            req.on('error', (err) => {
                reject(err);
            });

            req.write(body);
            req.end();
        });

        return result;
    } catch (err) {
        return { ok: false, code: err.message || 'FIREBASE_REQUEST_FAILED' };
    }
}

async function firebaseSignUpWithEmailPassword({ email, password, name }) {
    const result = await firebaseAuthRequest('accounts:signUp', {
        email,
        password,
        returnSecureToken: true
    });

    if (!result.ok) {
        return result;
    }

    if (name && result.data && result.data.idToken) {
        // Best effort: set Firebase display name after account creation.
        await firebaseAuthRequest('accounts:update', {
            idToken: result.data.idToken,
            displayName: name,
            returnSecureToken: false
        });
    }

    return result;
}

async function firebaseSignInWithEmailPassword({ email, password }) {
    return firebaseAuthRequest('accounts:signInWithPassword', {
        email,
        password,
        returnSecureToken: true
    });
}

async function firebaseLookupByIdToken(idToken) {
    return firebaseAuthRequest('accounts:lookup', { idToken });
}

console.log(`Effective mail sender: ${EFFECTIVE_MAIL_FROM}`);
if (hasFirebaseAuthConfig()) {
    console.log('Firebase Email/Password auth bridge enabled.');
} else {
    console.warn('Firebase auth bridge disabled. Set FIREBASE_API_KEY to enable Firebase login/signup fallback.');
}

if (typeof dns.setDefaultResultOrder === 'function') {
    try {
        dns.setDefaultResultOrder(DNS_RESULT_ORDER);
        console.log(`DNS result order set to ${DNS_RESULT_ORDER}`);
    } catch (err) {
        console.warn(`Unable to set DNS result order (${DNS_RESULT_ORDER}):`, err.message || err);
    }
}

const mailTransporter = (SMTP_HOST && SMTP_USER && SMTP_PASS)
    ? nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        family: SMTP_IP_FAMILY,
        secure: SMTP_SECURE,
        requireTLS: SMTP_REQUIRE_TLS,
        connectionTimeout: SMTP_CONNECTION_TIMEOUT,
        greetingTimeout: SMTP_GREETING_TIMEOUT,
        socketTimeout: SMTP_SOCKET_TIMEOUT,
        auth: {
            user: SMTP_USER,
            pass: SMTP_PASS
        }
    })
    : null;

if (mailTransporter && SMTP_VERIFY_ON_START) {
    mailTransporter.verify()
        .then(() => {
            console.log(`SMTP ready: ${SMTP_HOST}:${SMTP_PORT} as ${SMTP_USER}`);
        })
        .catch((err) => {
            console.error('SMTP verification failed:', err.message || err);
        });
} else if (mailTransporter) {
    console.log('SMTP transporter created. Startup verification is disabled (SMTP_VERIFY_ON_START=false).');
} else {
    const missingVars = [];
    if (!SMTP_USER) missingVars.push('SMTP_USER');
    if (!SMTP_PASS) missingVars.push('SMTP_PASS or SMTP_APP_PASSWORD');
    console.warn(`SMTP is not configured. Email notifications are disabled. Missing: ${missingVars.join(', ') || 'unknown'}`);
}

// --- Brevo (Sendinblue) transactional email ---
const BREVO_SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || 'sumanpingla20@gmail.com';
const BREVO_SENDER_NAME  = process.env.BREVO_SENDER_NAME  || 'KuchBhi Restaurant';
const brevoClient = USE_BREVO
    ? new brevo.BrevoClient({ apiKey: BREVO_API_KEY })
    : null;

if (BREVO_API_KEY && !USE_BREVO) {
    console.warn('BREVO_API_KEY is present but does not look like a Brevo API key (expected prefix: xkeysib-). Falling back to SMTP.');
}

async function sendMailSafe(mailOptions) {
    // --- Brevo path ---
    if (USE_BREVO && brevoClient) {
        try {
            const toAddr = Array.isArray(mailOptions.to)
                ? mailOptions.to.map(t => (typeof t === 'string' ? { email: t } : t))
                : [{ email: mailOptions.to }];
            const brevoPayload = {
                subject:     mailOptions.subject,
                htmlContent: mailOptions.html || mailOptions.htmlContent || '',
                sender:      { name: BREVO_SENDER_NAME, email: BREVO_SENDER_EMAIL },
                to:          toAddr
            };
            // Attach logo inline so it renders in the email template
            if (MAIL_LOGO_BASE64) {
                brevoPayload.attachment = [{
                    name:    path.basename(MAIL_LOGO_PATH),
                    content: MAIL_LOGO_BASE64
                }];
            }
            const result = await brevoClient.transactionalEmails.sendTransacEmail(brevoPayload);
            console.log(`[Brevo] Email sent to ${mailOptions.to}:`, result?.body?.messageId || result);
            return true;
        } catch (err) {
            console.error('[Brevo] Email send failed. Falling back to SMTP:', err?.response?.body || err.message || err);
        }
    }

    // --- Nodemailer fallback ---
    if (!mailTransporter) {
        console.warn('Email skipped: neither Brevo nor SMTP transporter is configured.');
        return false;
    }
    try {
        const info = await mailTransporter.sendMail({
            ...mailOptions,
            attachments: [...(mailOptions.attachments || []), ...MAIL_LOGO_ATTACHMENTS]
        });
        console.log(`[SMTP] Email sent to ${mailOptions.to}. MessageId: ${info.messageId}`);
        return true;
    } catch (err) {
        console.error(`[SMTP] Email send failed for ${mailOptions.to}:`, err.message || err);
        return false;
    }
}

function escapeHtml(value) {
        return String(value || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
}

function buildKuchBhiMailHtml(config) {
    let template = '';
    try {
        template = fs.readFileSync(MAIL_TEMPLATE_PATH, 'utf8');
    } catch (err) {
        console.error('Unable to load mail template file:', err.message || err);
        return `<div><h2>${escapeHtml(config.title)}</h2><p>${escapeHtml(config.message)}</p></div>`;
    }

    const rows = (config.rows || []).map((row) => (
        `<tr><td style="padding:10px 0;color:#333;font-size:16px;"><strong>${escapeHtml(row.label)}:</strong> ${escapeHtml(row.value).replace(/\n/g, '<br/>')}</td></tr>`
    )).join('');

    const actionButton = config.actionUrl
        ? `<div style="text-align:center;margin:28px 0;">
                <a href="${escapeHtml(config.actionUrl)}" style="background:#d9534f;color:#ffffff;padding:14px 28px;text-decoration:none;border-radius:5px;display:inline-block;font-weight:bold;">${escapeHtml(config.actionText || 'Open')}</a>
           </div>`
        : '';

    return template
        .replace(/\{\{TITLE\}\}/g, escapeHtml(config.title))
        .replace(/\{\{GREETING\}\}/g, escapeHtml(config.greeting))
        .replace(/\{\{MESSAGE\}\}/g, escapeHtml(config.message))
        .replace(/\{\{DETAIL_ROWS\}\}/g, rows)
        .replace(/\{\{ACTION_BLOCK\}\}/g, actionButton)
        .replace(/\{\{FOOTER\}\}/g, escapeHtml(config.footer))
        .replace(/\{\{LOGO_URL\}\}/g, MAIL_LOGO_SRC)
        .replace(/\{\{SUPPORT_NAME\}\}/g, escapeHtml(MAIL_SUPPORT_NAME))
        .replace(/\{\{SUPPORT_EMAIL\}\}/g, escapeHtml(MAIL_SUPPORT_EMAIL))
        .replace(/\{\{SUPPORT_PHONE\}\}/g, escapeHtml(MAIL_SUPPORT_PHONE));
}

app.set('view engine', 'ejs');

function isLocalMongoUri(uri) {
    return uri.startsWith('mongodb://127.0.0.1:27017') || uri.startsWith('mongodb://localhost:27017');
}

function ensureDirectory(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function startLocalMongo() {
    if (localMongoStartupPromise) {
        return localMongoStartupPromise;
    }

    localMongoStartupPromise = new Promise((resolve, reject) => {
        const mongodPath = 'C:\\Program Files\\MongoDB\\Server\\8.3\\bin\\mongod.exe';
        const mongoRoot = path.join(__dirname, '.mongodb');
        const dataDir = path.join(mongoRoot, 'data');
        const logDir = path.join(mongoRoot, 'log');
        const logPath = path.join(logDir, 'mongod.log');

        if (!fs.existsSync(mongodPath)) {
            localMongoStartupPromise = null;
            return reject(new Error('mongod.exe was not found.'));
        }

        ensureDirectory(dataDir);
        ensureDirectory(logDir);

        const mongodProcess = spawn(mongodPath, [
            '--dbpath', dataDir,
            '--logpath', logPath,
            '--bind_ip', '127.0.0.1',
            '--port', '27017',
            '--setParameter', 'diagnosticDataCollectionEnabled=false'
        ], {
            cwd: __dirname,
            detached: true,
            stdio: 'ignore'
        });

        mongodProcess.on('error', (err) => {
            localMongoStartupPromise = null;
            reject(err);
        });

        mongodProcess.unref();

        setTimeout(() => {
            resolve();
        }, 3000);
    });

    return localMongoStartupPromise;
}

function connectToDatabase() {
    if (dbinstance) {
        return Promise.resolve(dbinstance);
    }

    if (MONGODB_URI.includes('<db_password>')) {
        return Promise.reject(new Error('MongoDB URI still contains <db_password>. Update MONGODB_URI in .env with your real Atlas password.'));
    }

    if (!connectionPromise) {
        client = new MongoClient(MONGODB_URI, {
            serverSelectionTimeoutMS: 5000,
            family: 4
        });

        connectionPromise = client.connect()
            .then((connection) => {
                dbinstance = connection.db(DB_NAME);
                console.log('Database Connected');
                return dbinstance;
            })
            .catch(async (err) => {
                client = null;
                connectionPromise = null;
                if (isLocalMongoUri(MONGODB_URI) && err.message && err.message.includes('ECONNREFUSED 127.0.0.1:27017')) {
                    try {
                        await startLocalMongo();
                        return connectToDatabase();
                    } catch (startupErr) {
                        console.error('Local MongoDB startup failed:', startupErr.message || startupErr);
                    }
                }
                console.error('MongoDB connection failed:', err.message || err);
                throw err;
            });
    }

    return connectionPromise;
}

connectToDatabase().catch(() => {
    // Requests can trigger a reconnect later if MongoDB starts after the app.
});

app.use(express.static(__dirname));
app.use(express.urlencoded({ extended: true })); // middleware for handling form data
app.use(express.json());  // middleware for parsing
app.use(session({ 
    saveUninitialized: true,
    resave: false,
    secret: "abc",
    cookie: {
        maxAge: undefined
    }
}))


function check2(req, res, next) {
    if (!req.session.user) {
        res.redirect('/login')
    }
    else {
        next();
    }
}
function check(req, res, next) {
    if (req.session.user) {
        res.redirect("/home");
    } else {
        next();
    }
}
function auth(req, res, next) {
    if (!req.session.user)
        res.redirect('/login');
    else if (req.session.user.role == 'admin')
        next();
    else
        res.redirect('/home');
}

async function ensureDbConnected(req, res, next) {
    try {
        await connectToDatabase();
        next();
    } catch (err) {
        return res.status(503).send('Database is not connected. Start MongoDB or update MONGODB_URI.');
    }
}

app.get('/cart', check2, (req, res) => {
    res.sendFile(__dirname + "/cart.html")
})

app.get('/', (req, res) => {
    res.sendFile(__dirname + "/index.html")
})

app.get('/signup', check, (req, res) => {
    res.sendFile(__dirname + "/signup.html")
})

app.get('/admin', auth, ensureDbConnected, async (req, res) => {
    try {
        const [users, bookings, orders] = await Promise.all([
            dbinstance.collection('user').find().toArray(),
            dbinstance.collection('booking').find().toArray(),
            dbinstance.collection('order').find().toArray()
        ]);

        res.render('admin', { users, bookings, orders });
    } catch (err) {
        console.error('Failed to load admin dashboard:', err.message || err);
        res.status(500).send('Failed to load admin dashboard.');
    }
})          
app.get('/login', check, (req, res) => {
    res.sendFile(__dirname + "/contact.html");
})
app.get('/home', (req, res) => {
    res.sendFile(__dirname + "/index.html");

})

app.get('/menu', (req, res) => {
    res.sendFile(__dirname + "/menu.html")
})

app.get('/auth/firebase-config', (req, res) => {
    if (!hasFirebaseWebConfig()) {
        return res.status(503).json({ message: 'Firebase web config is missing on server.' });
    }

    res.json({
        apiKey: FIREBASE_API_KEY,
        authDomain: FIREBASE_AUTH_DOMAIN,
        projectId: FIREBASE_PROJECT_ID,
        appId: FIREBASE_APP_ID
    });
});

app.post('/auth/firebase-google', ensureDbConnected, async (req, res) => {
    try {
        if (!hasFirebaseAuthConfig()) {
            return res.status(503).json({ success: false, message: 'Firebase auth is not configured.' });
        }

        const idToken = String(req.body.idToken || '').trim();
        if (!idToken) {
            return res.status(400).json({ success: false, message: 'Missing Google ID token.' });
        }

        const lookupResult = await firebaseLookupByIdToken(idToken);
        if (!lookupResult.ok) {
            return res.status(401).json({ success: false, message: 'Invalid Firebase token.', code: lookupResult.code });
        }

        const firebaseUser = lookupResult.data && Array.isArray(lookupResult.data.users)
            ? lookupResult.data.users[0]
            : null;

        if (!firebaseUser) {
            return res.status(401).json({ success: false, message: 'Firebase user not found for token.' });
        }

        const email = normalizeEmail(firebaseUser.email || '');
        if (!isValidEmail(email)) {
            return res.status(400).json({ success: false, message: 'Google account email is missing or invalid.' });
        }

        const firebaseUid = String(firebaseUser.localId || '');
        const fallbackName = String(firebaseUser.displayName || email.split('@')[0] || 'User').trim();

        let user = await dbinstance.collection('user').findOne({ email });
        if (!user) {
            const newUser = {
                name: fallbackName,
                email,
                password: '__firebase_google__',
                role: 'user',
                firebaseUid,
                authProvider: 'google'
            };
            const insertResult = await dbinstance.collection('user').insertOne(newUser);
            user = { ...newUser, _id: insertResult.insertedId };
        } else {
            const updates = {};
            if (!user.firebaseUid && firebaseUid) updates.firebaseUid = firebaseUid;
            if (!user.authProvider) updates.authProvider = 'google';
            if (!user.name && fallbackName) updates.name = fallbackName;

            if (Object.keys(updates).length) {
                await dbinstance.collection('user').updateOne({ _id: user._id }, { $set: updates });
                user = { ...user, ...updates };
            }
        }

        req.session.user = user;
        const redirect = req.session.user.role == 'admin' ? '/admin' : '/home';
        return res.json({ success: true, redirect });
    } catch (err) {
        console.error('Firebase Google auth failed:', err.message || err);
        return res.status(500).json({ success: false, message: 'Unable to complete Google sign-in.' });
    }
});

app.get("/test-mail", async (req, res) => {
    try {
        const info = await mailTransporter.sendMail({
            from: process.env.SMTP_USER,
            to: "sumanpingla20@gmail.com",
            subject: "Test Email",
            text: "Brevo SMTP working successfully"
        });

        console.log(info);

        res.send("Mail Sent Successfully");
    } catch (err) {
        console.error(err);
        res.send(err.message);
    }
});

app.get('/contact', check, (req, res) => {
    res.redirect('/login');
})

app.get('/index', (req, res) => {
    res.sendFile(__dirname + "/index.html")
})

// app.get('/restaurant website/Restaurant Website Free/css/cart.css', (req, res) => {
//     res.sendFile(__dirname + '/path/to/cart.css', {
//         headers: {
//             'Content-Type': 'text/css'
//         }
//     });
// });


app.get('/service', (req, res) => {
    res.sendFile(__dirname + "/service.html");
})
app.get('/about', (req, res) => {
    res.sendFile(__dirname + "/about.html");
})

app.get('/testimonial', (req, res) => {
    res.sendFile(__dirname + "/testimonial.html");
})

app.get('/booking', (req, res) => {
    res.sendFile(__dirname + "/booking.html");
})

app.get('/cartcheck', check2, (req, res) => {
    res.send();
})
app.post('/login', ensureDbConnected, (req, res) => {
    const userData = req.body;
    const email = normalizeEmail(userData.email);
    const password = String(userData.password || '');
    const authMode = String(userData.authMode || 'local').toLowerCase();
    const preferFirebase = authMode === 'firebase';

    if (!isValidEmail(email)) {
        return res.redirect('/login?error=invalid_email');
    }

    if (preferFirebase && !hasFirebaseAuthConfig()) {
        return res.redirect('/login?error=firebase_not_configured');
    }

    dbinstance.collection('user').findOne({ email, password }).then(async (localUser) => {
        if (!preferFirebase) {
            if (!localUser) {
                return req.session.destroy(() => {
                    res.clearCookie('connect.sid');
                    return res.redirect('/login?error=invalid');
                });
            }

            req.session.user = localUser;
            if (req.session.user.role == 'admin') {
                return res.redirect('/admin');
            }
            return res.redirect('/home');
        }

        let firebaseAuthenticated = false;
        let firebaseAuthData = null;
        const firebaseSignInResult = await firebaseSignInWithEmailPassword({ email, password });
        if (firebaseSignInResult.ok) {
            firebaseAuthenticated = true;
            firebaseAuthData = firebaseSignInResult.data || null;
        } else if (localUser) {
            // If user exists locally but not in Firebase yet, provision on-demand.
            const firebaseSignUpResult = await firebaseSignUpWithEmailPassword({
                email,
                password,
                name: localUser.name || ''
            });

            if (firebaseSignUpResult.ok) {
                firebaseAuthenticated = true;
                const createdUid = firebaseSignUpResult.data && firebaseSignUpResult.data.localId ? firebaseSignUpResult.data.localId : '';
                if (createdUid && !localUser.firebaseUid) {
                    await dbinstance.collection('user').updateOne({ _id: localUser._id }, { $set: { firebaseUid: createdUid } });
                    localUser.firebaseUid = createdUid;
                }
            } else if (firebaseSignUpResult.code === 'EMAIL_EXISTS') {
                const secondSignInResult = await firebaseSignInWithEmailPassword({ email, password });
                if (secondSignInResult.ok) {
                    firebaseAuthenticated = true;
                    firebaseAuthData = secondSignInResult.data || null;
                }
            }
        }

        if (!firebaseAuthenticated) {
            return req.session.destroy(() => {
                res.clearCookie('connect.sid');
                if (isFirebaseEmailInputError(firebaseSignInResult.code)) {
                    return res.redirect('/login?error=invalid_email');
                }
                const code = encodeURIComponent(firebaseSignInResult.code || 'UNKNOWN_FIREBASE_ERROR');
                return res.redirect(`/login?error=firebase&code=${code}`);
            });
        }

        let user = await dbinstance.collection('user').findOne({ email });
        if (!user) {
            const firebaseUserData = firebaseAuthData || {};
            const firebaseUid = firebaseUserData.localId || '';
            const fallbackName = firebaseUserData.displayName || email.split('@')[0] || 'User';
            const newUser = {
                name: fallbackName,
                email,
                password,
                role: 'user',
                firebaseUid
            };
            const insertResult = await dbinstance.collection('user').insertOne(newUser);
            user = { ...newUser, _id: insertResult.insertedId };
        }

        req.session.user = user;
        if (req.session.user.role == 'admin') {
            return res.redirect('/admin');
        }

        return res.redirect('/home');
    }).catch((err) => {
        console.log(err);
        res.redirect('/login?error=server');
    });
});

app.post('/signup', ensureDbConnected, (req, res) => {
    const userData = req.body;
    const email = normalizeEmail(userData.email);
    const password = String(userData.password || '');
    const name = String(userData.name || '').trim();
    const authMode = String(userData.authMode || 'local').toLowerCase();
    const preferFirebase = authMode === 'firebase';

    if (!isValidEmail(email)) {
        return res.redirect('/signup?error=invalid_email');
    }

    if (preferFirebase && !hasFirebaseAuthConfig()) {
        return res.redirect('/signup?error=firebase_not_configured');
    }

    dbinstance.collection('user').findOne({ email }).then(async (existingUser) => {
        if (existingUser) {
            res.redirect('/login');
        } else {
            let firebaseUid = '';
            if (preferFirebase && hasFirebaseAuthConfig()) {
                const firebaseSignUpResult = await firebaseSignUpWithEmailPassword({ email, password, name });
                if (firebaseSignUpResult.ok) {
                    firebaseUid = firebaseSignUpResult.data && firebaseSignUpResult.data.localId ? firebaseSignUpResult.data.localId : '';
                } else if (firebaseSignUpResult.code === 'EMAIL_EXISTS') {
                    return res.redirect('/login?error=firebase_exists');
                } else if (isFirebaseEmailInputError(firebaseSignUpResult.code)) {
                    return res.redirect('/signup?error=invalid_email');
                } else {
                    console.error('Firebase signup failed:', firebaseSignUpResult.code);
                    const code = encodeURIComponent(firebaseSignUpResult.code || 'UNKNOWN_FIREBASE_ERROR');
                    return res.redirect(`/signup?error=firebase&code=${code}`);
                }
            }

            const newUser = {
                name,
                email,
                password,
                role: 'user',
                firebaseUid
            };

            dbinstance.collection('user').insertOne(newUser).then(() => {
                res.redirect('/login');
            }).catch(err => {
                console.log(err);
                res.redirect('/signup');
            })
        }
    }).catch((err) => {
        console.log(err);
        res.redirect('/signup');
    });
})

app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.log(err);
            return res.redirect('/home');
        }

        res.clearCookie('connect.sid');
        return res.redirect('/login?logout=success');
    });
});

app.post('/booking', ensureDbConnected, async (req, res) => {
    let bokingInfo = req.body;
    dbinstance.collection('booking').insertOne(bokingInfo).then(async () => {
        const bookingEmail = (bokingInfo.email || '').trim();
        const mailJobs = [];

        if (bookingEmail) {
            mailJobs.push(sendMailSafe({
                from: EFFECTIVE_MAIL_FROM,
                to: bookingEmail,
                subject: 'Table Booking Confirmation - KuchBhi',
                text: `Hello ${bokingInfo.uname || 'Guest'},\n\nYour table booking is confirmed.\nDate & Time: ${bokingInfo.date || 'Not provided'}\nNumber of People: ${bokingInfo.people || 'Not provided'}\nSpecial Request: ${bokingInfo.req || 'None'}\n\nThank you for booking with KuchBhi.`,
                html: buildKuchBhiMailHtml({
                    title: 'Table Booking Confirmed',
                    greeting: `Hello ${bokingInfo.uname || 'Guest'},`,
                    message: 'Your table booking is confirmed. We look forward to serving you at KuchBhi.',
                    rows: [
                        { label: 'Date & Time', value: bokingInfo.date || 'Not provided' },
                        { label: 'Number of People', value: bokingInfo.people || 'Not provided' },
                        { label: 'Special Request', value: bokingInfo.req || 'None' }
                    ],
                    actionUrl: buildAppUrl('/menu'),
                    actionText: 'Explore Menu',
                    footer: 'Thank you for booking with KuchBhi.'
                })
            }));
        }

        if (ADMIN_NOTIFICATION_EMAIL) {
            mailJobs.push(sendMailSafe({
                from: EFFECTIVE_MAIL_FROM,
                to: ADMIN_NOTIFICATION_EMAIL,
                subject: 'New Table Booking Received',
                text: `A new booking was submitted.\n\nName: ${bokingInfo.uname || ''}\nEmail: ${bookingEmail || ''}\nDate & Time: ${bokingInfo.date || ''}\nPeople: ${bokingInfo.people || ''}\nSpecial Request: ${bokingInfo.req || ''}`,
                html: buildKuchBhiMailHtml({
                    title: 'New Booking Received',
                    greeting: 'Hello Admin,',
                    message: 'A new table booking has been submitted on KuchBhi.',
                    rows: [
                        { label: 'Name', value: bokingInfo.uname || '' },
                        { label: 'Email', value: bookingEmail || '' },
                        { label: 'Date & Time', value: bokingInfo.date || '' },
                        { label: 'People', value: bokingInfo.people || '' },
                        { label: 'Special Request', value: bokingInfo.req || '' }
                    ],
                    footer: 'Please review this booking in the admin panel.'
                })
            }));
        }

        if (mailJobs.length) {
            const results = await Promise.allSettled(mailJobs);
            const okCount = results.filter((result) => result.status === 'fulfilled' && result.value === true).length;
            console.log(`Booking mail status: ${okCount}/${mailJobs.length} sends successful.`);
        } else {
            console.warn('Booking mail skipped: no recipient email available.');
        }

        res.redirect('/home');
    }).catch((err) => {
        console.log(err);
    })
})


app.post('/orderQ', ensureDbConnected, (req, res) => {
    dbinstance.collection('order').insertOne({ name: req.session.user.name, que: req.body.que }).then(() => {
        dbinstance.collection('order').find().toArray().then((data) => {
            res.json(data.length);
        })
    })
})

app.get('/payment/key', check2, (req, res) => {
    if (!RAZORPAY_KEY_ID) {
        return res.status(500).json({ message: 'Razorpay key is not configured.' });
    }

    res.json({ key: RAZORPAY_KEY_ID });
});

app.post('/payment/create-order', check2, async (req, res) => {
    if (!razorpay) {
        return res.status(500).json({ message: 'Razorpay is not configured on server.' });
    }

    const amount = Number(req.body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ message: 'Invalid payment amount.' });
    }

    try {
        const order = await razorpay.orders.create({
            amount: Math.round(amount * 100),
            currency: 'INR',
            receipt: `rcpt_${Date.now()}`,
            notes: {
                user: req.session.user && req.session.user.name ? req.session.user.name : 'guest'
            }
        });

        res.json(order);
    } catch (err) {
        console.error('Razorpay order creation failed:', err.message || err);
        res.status(500).json({ message: 'Unable to create payment order.' });
    }
});

app.post('/payment/verify', check2, async (req, res) => {
    if (!RAZORPAY_KEY_SECRET) {
        return res.status(500).json({ message: 'Razorpay secret is not configured.' });
    }

    const {
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
        amount,
        cartItems
    } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return res.status(400).json({ message: 'Missing payment verification fields.' });
    }

    const generatedSignature = crypto
        .createHmac('sha256', RAZORPAY_KEY_SECRET)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest('hex');

    if (generatedSignature !== razorpay_signature) {
        return res.status(400).json({ message: 'Payment signature verification failed.' });
    }

    if (dbinstance) {
        dbinstance.collection('payments').insertOne({
            userId: req.session.user && req.session.user._id ? req.session.user._id : null,
            userName: req.session.user && req.session.user.name ? req.session.user.name : '',
            razorpay_order_id,
            razorpay_payment_id,
            amount: Number(amount) || 0,
            currency: 'INR',
            cartItems: Array.isArray(cartItems) ? cartItems : [],
            createdAt: new Date()
        }).catch((err) => {
            console.error('Failed to save payment record:', err.message || err);
        });
    }

    const userName = req.session.user && req.session.user.name ? req.session.user.name : 'Customer';
    const userEmail = req.session.user && req.session.user.email ? String(req.session.user.email).trim() : '';
    const safeAmount = Number(amount) || 0;
    const items = Array.isArray(cartItems) ? cartItems : [];
    const orderSummary = items.length
        ? items.map((item) => `${item.name || 'Item'} x${item.quantity || 1} (Rs.${Number(item.price || 0)})`).join('\n')
        : 'No items provided';

    const mailJobs = [];

    if (userEmail) {
        mailJobs.push(sendMailSafe({
            from: EFFECTIVE_MAIL_FROM,
            to: userEmail,
            subject: 'Payment Successful - KuchBhi Order Confirmation',
            text: `Hello ${userName},\n\nYour payment was successful and your order is confirmed.\nPayment ID: ${razorpay_payment_id}\nOrder ID: ${razorpay_order_id}\nAmount Paid: Rs.${safeAmount.toFixed(2)}\n\nOrder Items:\n${orderSummary}\n\nThank you for ordering from KuchBhi.`,
            html: buildKuchBhiMailHtml({
                title: 'Payment Successful',
                    greeting: `Hello ${userName},`,
                message: 'Your payment was successful and your order is confirmed.',
                rows: [
                    { label: 'Payment ID', value: razorpay_payment_id },
                    { label: 'Order ID', value: razorpay_order_id },
                    { label: 'Amount Paid', value: `Rs.${safeAmount.toFixed(2)}` },
                    { label: 'Items', value: orderSummary }
                ],
                    actionUrl: buildAppUrl('/home'),
                    actionText: 'Go to KuchBhi',
                footer: 'Thank you for ordering from KuchBhi.'
            })
        }));
    } else {
        console.warn('Checkout mail skipped: logged-in user has no email.');
    }

    if (ADMIN_NOTIFICATION_EMAIL) {
        mailJobs.push(sendMailSafe({
            from: EFFECTIVE_MAIL_FROM,
            to: ADMIN_NOTIFICATION_EMAIL,
            subject: 'New Paid Cart Checkout',
            text: `A paid cart checkout was completed.\n\nCustomer: ${userName}\nCustomer Email: ${userEmail || 'Not available'}\nPayment ID: ${razorpay_payment_id}\nOrder ID: ${razorpay_order_id}\nAmount: Rs.${safeAmount.toFixed(2)}\n\nItems:\n${orderSummary}`,
            html: buildKuchBhiMailHtml({
                title: 'New Paid Cart Checkout',
                greeting: 'Hello Admin,',
                message: 'A paid cart checkout has been completed on KuchBhi.',
                rows: [
                    { label: 'Customer', value: userName },
                    { label: 'Customer Email', value: userEmail || 'Not available' },
                    { label: 'Payment ID', value: razorpay_payment_id },
                    { label: 'Order ID', value: razorpay_order_id },
                    { label: 'Amount', value: `Rs.${safeAmount.toFixed(2)}` },
                    { label: 'Items', value: orderSummary }
                ],
                footer: 'Please review this order in the admin panel.'
            })
        }));
    }

    if (mailJobs.length) {
        const results = await Promise.allSettled(mailJobs);
        const okCount = results.filter((result) => result.status === 'fulfilled' && result.value === true).length;
        console.log(`Checkout mail status: ${okCount}/${mailJobs.length} sends successful.`);
    }

    res.json({ success: true, message: 'Payment verified successfully.' });
});

// admin delete

// Handle DELETE requests for deleting bookings
app.delete('/delete/booking/:id', ensureDbConnected, async (req, res) => {
    const bookingId = req.params.id;
    console.log('Deleting booking with ID:', bookingId);

    try {
        const result = await dbinstance.collection('booking').deleteOne({ _id: new mongodb.ObjectId(bookingId) });
        if (!result.deletedCount) {
            return res.status(404).json({ message: 'Booking not found.' });
        }

        console.log('Booking deleted successfully:', result);
        return res.status(200).json({ success: true });
    } catch (err) {
        console.error('Error deleting booking:', err);
        return res.sendStatus(500); // Internal Server Error
    }
});

// Handle DELETE requests for deleting users
app.delete('/delete/user/:id', ensureDbConnected, async (req, res) => {
    const userId = req.params.id;
    console.log('Deleting user with ID:', userId);

    try {
        const result = await dbinstance.collection('user').deleteOne({ _id: new mongodb.ObjectId(userId) });
        if (!result.deletedCount) {
            return res.status(404).json({ message: 'User not found.' });
        }

        console.log('User deleted successfully:', result);
        return res.status(200).json({ success: true });
    } catch (err) {
        console.error('Error deleting user:', err);
        return res.sendStatus(500); // Internal Server Error
    }
});

// Handle DELETE requests for deleting orders
app.delete('/delete/order/:id', ensureDbConnected, async (req, res) => {
    const orderId = req.params.id;
    console.log('Deleting order with ID:', orderId);

    try {
        const result = await dbinstance.collection('order').deleteOne({ _id: new mongodb.ObjectId(orderId) });
        if (!result.deletedCount) {
            return res.status(404).json({ message: 'Order not found.' });
        }

        console.log('Order deleted successfully:', result);
        return res.status(200).json({ success: true });
    } catch (err) {
        console.error('Error deleting order:', err);
        return res.sendStatus(500); // Internal Server Error
    }
});


//admin end


// app.listen(3000, (err) => {
//     if (err)
//         console.log(err);
//     else
//         console.log("SuccessFully Connected to Server");
// }); 
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});