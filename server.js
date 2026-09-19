// server.js - Manual BIP47 Auth47 implementation
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { MongoClient } from 'mongodb';
import ecc from '@bitcoinerlab/secp256k1';
import { BIP47Factory } from '@samouraiwallet/bip47';
import { networks } from '@samouraiwallet/bip47/utils';
import { Auth47Verifier } from '@samouraiwallet/auth47';
import { bitcoinMessageFactory } from '@samouraiwallet/bitcoinjs-message';
import QRCode from 'qrcode';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// Request limits. Every one of these was previously unbounded, which let a
// single request pin the CPU, bloat the database, or turn this server into an
// amplifier against paynym.rs.
const MAX_MESSAGE_LENGTH = 500;   // matches the textarea maxlength in guestbook.html
const MAX_FOLLOWER_IDS = 50;      // per /api/paynym/followers request
const FOLLOWER_CONCURRENCY = 5;   // simultaneous upstream fetches
const MAX_QR_TEXT_LENGTH = 512;

// Payment codes are base58; anything else must never reach an upstream URL.
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{1,120}$/;

// Railway terminates TLS one hop in front of us, so req.ip needs the real
// client address for rate limiting to key on anything meaningful.
app.set('trust proxy', 1);

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/bip47-guestbook';
let db;

// Connect to MongoDB
async function connectToDatabase() {
  try {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    console.log('✅ Connected to MongoDB');
    db = client.db();
    
    // Create index on payment_code for faster lookups
    await db.collection('messages').createIndex({ paymentCode: 1 });
    await db.collection('messages').createIndex({ createdAt: -1 });
    console.log('✅ Database indexes created');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    // Continue running even if DB fails (for local development)
    console.log('⚠️  Running without database - guestbook will be disabled');
  }
}

// Initialize database connection
connectToDatabase();

// Security headers. Every asset, font and avatar is served from this origin,
// so the CSP can stay narrow.
//
// script-src is strict: all page scripts live in /js and all behaviour is wired
// through data-action attributes, so there is no inline script to allow. That
// is the control that actually stops injected markup from executing.
//
// style-src still needs 'unsafe-inline' because ~100 style="..." attributes
// remain in the markup. Narrowing that means converting them to classes; it is
// a much smaller risk than inline script, so it is left for a later pass.
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "object-src 'none'"
  ].join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
  next();
});

// CORS is opened only on the read-only lookup endpoints that the docs page
// advertises as a public API. Auth and guestbook writes stay same-origin so a
// third-party page cannot drive them from a visitor's browser.
const publicApiCors = cors({ origin: '*', methods: ['GET', 'POST'] });

// Rate limits, tuned per endpoint cost. AGENTS.md calls for ~10/min against
// the Paynym API; avatars get a higher ceiling because one profile view loads
// many of them, and they are served from cache after the first hit.
const rateLimitOpts = { standardHeaders: 'draft-7', legacyHeaders: false };
const makeLimiter = (windowMs, limit, message) =>
  rateLimit({ ...rateLimitOpts, windowMs, limit, message: { error: message } });

const paynymLimiter = makeLimiter(60 * 1000, 10, 'Too many lookups. Please wait a minute.');
const avatarLimiter = makeLimiter(60 * 1000, 120, 'Too many avatar requests.');
const authLimiter = makeLimiter(15 * 60 * 1000, 30, 'Too many authentication attempts.');
const qrLimiter = makeLimiter(60 * 1000, 30, 'Too many QR requests.');
const submitLimiter = makeLimiter(60 * 60 * 1000, 5, 'Too many messages. Please try again later.');
const labLimiter = makeLimiter(60 * 1000, 60, 'Too many requests.');

// Advertise Tor hidden service to Tor Browser (Onion-Location standard)
if (process.env.ONION_ADDRESS) {
  app.use((req, res, next) => {
    res.setHeader('Onion-Location', `http://${process.env.ONION_ADDRESS}${req.path}`);
    next();
  });
}

app.use(express.json({ limit: '32kb' }));
app.use(express.static(PUBLIC_DIR, { maxAge: '1h' }));

// Initialize BIP47 with ECC
const bip47 = BIP47Factory(ecc);
const bitcoinjsMessage = bitcoinMessageFactory(ecc);

// Dynamic callback URL for production deployment
const CALLBACK_URL = process.env.CALLBACK_URL || `http://localhost:${PORT}/callback`;

// Initialize Auth47 Verifier (constructor expects ecc first, then callback URL)
const verifier = new Auth47Verifier(ecc, CALLBACK_URL);


// Store pending authentications (use Redis/DB in production)
const pendingAuths = new Map();

// Generate Auth47 URI
app.get('/start-auth', authLimiter, async (req, res) => {
  try {
    const nonce = crypto.randomBytes(16).toString('hex');
    
    // Calculate expiry (5 minutes from now)
    const expiry = Math.floor(Date.now() / 1000) + 300; // 5 minutes
    
    // Auth47 URI format with both c= and r= for maximum wallet compatibility
    // - c= (callback): Used by Samourai/Ashigaru wallets
    // - r= (resource): Auth47 spec-compliant (BlueWallet, Sparrow)
    // NOTE: Do NOT url-encode the callback URL - wallets expect it unencoded
    const uri = `auth47://${nonce}?c=${CALLBACK_URL}&e=${expiry}&r=${CALLBACK_URL}`;
    const qr = await QRCode.toDataURL(uri);
    
    // Store nonce with expiry
    pendingAuths.set(nonce, {
      timestamp: Date.now(),
      verified: false,
      expiry: expiry
    });
    
    // Clean up old nonces (>5 minutes)
    for (const [key, value] of pendingAuths.entries()) {
      if (Date.now() - value.timestamp > 300000) {
        pendingAuths.delete(key);
      }
    }
    
    console.log(`✅ Generated auth URI with nonce: ${nonce}, expiry: ${expiry}`);
    
    res.json({ 
      uri, 
      qr, 
      nonce,
      callbackUrl: CALLBACK_URL,
      expiry: expiry
    });
  } catch (error) {
    console.error('❌ Error generating auth:', error);
    res.status(500).json({ error: error.message });
  }
});

// Check auth status (polling endpoint)
app.get('/check-auth/:nonce', authLimiter, (req, res) => {
  // Disable caching to ensure fresh auth status
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  
  const { nonce } = req.params;
  const auth = pendingAuths.get(nonce);
  
  if (!auth) {
    return res.json({ status: 'invalid' });
  }
  
  if (auth.verified) {
    return res.json({ 
      status: 'verified',
      nym: auth.nym,
      paymentCode: auth.paymentCode,
      challenge: auth.challenge,
      signature: auth.signature
    });
  }
  
  res.json({ status: 'pending' });
});

// Verify Auth47 proof
app.post('/verify', authLimiter, async (req, res) => {
  try {
    console.log('📥 Received verification request:', JSON.stringify(req.body, null, 2));
    
    const { auth47_response, challenge, nym, signature } = req.body;
    
    // Validate required fields
    if (!challenge || !nym || !signature) {
      console.error('❌ Missing required fields');
      return res.status(400).json({
        result: 'error',
        error: 'Missing required fields: challenge, nym, signature'
      });
    }
    
    // Parse challenge URL to extract nonce and validate expiry
    let nonce;
    let challengeExpiry;
    try {
      const challengeUrl = new URL(challenge);
      nonce = challengeUrl.hostname || challengeUrl.pathname.replace(/^\/\//, '');
      
      // Extract expiry from challenge parameters
      const params = new URLSearchParams(challengeUrl.search);
      challengeExpiry = params.get('e');
      
      if (!challengeExpiry) {
        console.error('❌ Missing expiry parameter in challenge');
        return res.status(400).json({
          result: 'error',
          error: 'Missing expiry parameter in challenge'
        });
      }
    } catch (e) {
      console.error('❌ Invalid challenge format:', challenge);
      return res.status(400).json({
        result: 'error',
        error: 'Invalid challenge format'
      });
    }
    
    console.log(`🔍 Extracted nonce: ${nonce}, expiry: ${challengeExpiry}`);
    
    // Verify nonce exists
    const auth = pendingAuths.get(nonce);
    if (!auth) {
      console.error('❌ Invalid or expired nonce');
      return res.status(400).json({
        result: 'error',
        error: 'Invalid or expired nonce'
      });
    }
    
    // Verify expiry matches and is not expired
    const currentTime = Math.floor(Date.now() / 1000);
    const expiryTime = parseInt(challengeExpiry, 10);
    
    if (expiryTime <= currentTime) {
      console.error('❌ Challenge has expired');
      return res.status(400).json({
        result: 'error',
        error: 'Challenge has expired'
      });
    }
    
    if (auth.expiry !== expiryTime) {
      console.error('❌ Expiry mismatch in challenge');
      return res.status(400).json({
        result: 'error',
        error: 'Expiry mismatch in challenge'
      });
    }
    
    if (auth.verified) {
      console.error('❌ Nonce already used');
      return res.status(400).json({
        result: 'error',
        error: 'Nonce already used'
      });
    }
    
    // Verify signature using Auth47 library (Bitcoin Message Signing protocol)
    const verifiedProof = verifier.verifyProof(req.body, 'bitcoin');
    
    if (verifiedProof.result === 'ok') {
      // Mark as verified and store auth data
      auth.verified = true;
      auth.nym = nym;
      auth.paymentCode = nym;
      auth.challenge = challenge;
      auth.signature = signature;
      
      console.log(`🎉 Authentication successful for ${nym}`);
      
      res.json({
        result: 'ok',
        nym,
        payment_code: nym
      });
    } else {
      console.error(`❌ Invalid signature: ${verifiedProof.error}`);
      res.json({
        result: 'error',
        error: verifiedProof.error
      });
    }
  } catch (error) {
    console.error('💥 Verification error:', error);
    res.status(400).json({
      result: 'error',
      error: error.message
    });
  }
});

// Callback endpoint (displayed after wallet scans)
app.get('/callback', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'callback.html'));
});

// Handle Auth47 wallet callback (POST request from wallet)
app.post('/callback', async (req, res) => {
  try {
    console.log('📥 Received Auth47 callback:', JSON.stringify(req.body, null, 2));
    
    const { auth47_response, challenge, nym, signature } = req.body;
    
    // Validate required fields
    if (!challenge || !nym || !signature) {
      console.error('❌ Missing required fields in callback');
      return res.sendFile(path.join(__dirname, 'public', 'callback.html'));
    }
    
    // Parse challenge URL to extract nonce and validate expiry
    let nonce;
    let challengeExpiry;
    try {
      const challengeUrl = new URL(challenge);
      nonce = challengeUrl.hostname || challengeUrl.pathname.replace(/^\/\//, '');
      
      // Extract expiry from challenge parameters
      const params = new URLSearchParams(challengeUrl.search);
      challengeExpiry = params.get('e');
      
      if (!challengeExpiry) {
        console.error('❌ Missing expiry parameter in challenge');
        return res.sendFile(path.join(__dirname, 'public', 'callback.html'));
      }
    } catch (e) {
      console.error('❌ Invalid challenge format in callback:', challenge);
      return res.sendFile(path.join(__dirname, 'public', 'callback.html'));
    }
    
    console.log(`🔍 Callback - Extracted nonce: ${nonce}, expiry: ${challengeExpiry}`);
    
    // Verify nonce exists
    const auth = pendingAuths.get(nonce);
    if (!auth) {
      console.error('❌ Invalid or expired nonce in callback');
      return res.sendFile(path.join(__dirname, 'public', 'callback.html'));
    }
    
    // Verify expiry matches and is not expired
    const currentTime = Math.floor(Date.now() / 1000);
    const expiryTime = parseInt(challengeExpiry, 10);
    
    if (expiryTime <= currentTime) {
      console.error('❌ Challenge has expired in callback');
      return res.sendFile(path.join(__dirname, 'public', 'callback.html'));
    }
    
    if (auth.expiry !== expiryTime) {
      console.error('❌ Expiry mismatch in callback');
      return res.sendFile(path.join(__dirname, 'public', 'callback.html'));
    }
    
    if (auth.verified) {
      console.error('❌ Nonce already used in callback');
      return res.sendFile(path.join(__dirname, 'public', 'callback.html'));
    }
    
    // Verify signature using Auth47 library (Bitcoin Message Signing protocol)
    try {
      const verifiedProof = verifier.verifyProof(req.body, 'bitcoin');
      
      if (verifiedProof.result === 'ok') {
        // Mark as verified and store auth data
        auth.verified = true;
        auth.nym = nym;
        auth.paymentCode = nym;
        auth.challenge = challenge;
        auth.signature = signature;
        
        console.log(`🎉 Authentication successful via callback for ${nym}`);
        
        // Redirect to callback page with nonce parameter so it can poll auth status
        return res.redirect(`/callback?nonce=${nonce}`);
      } else {
        console.log(`❌ Callback verification failed: ${verifiedProof.error}`);
        // Redirect to callback page with nonce for error display
        return res.redirect(`/callback?nonce=${nonce}`);
      }
    } catch (verifyError) {
      console.log('❌ Callback verification error:', verifyError.message);
      // Still serve the callback page
      res.sendFile(path.join(__dirname, 'public', 'callback.html'));
    }
  } catch (error) {
    console.error('💥 Callback error:', error);
    // Still serve the callback page even on error
    res.sendFile(path.join(__dirname, 'public', 'callback.html'));
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    database: db ? 'connected' : 'unavailable'
  });
});

// --- Paynym upstream helpers ------------------------------------------------

// Overridable so the proxy can be exercised against a stub in tests.
const PAYNYM_ORIGIN = process.env.PAYNYM_ORIGIN || 'https://paynym.rs';
const PAYNYM_API = `${PAYNYM_ORIGIN}/api/v1/nym/`;
const UPSTREAM_TIMEOUT_MS = 8000;
const NYM_CACHE_TTL = 5 * 60 * 1000;
const AVATAR_CACHE_TTL = 60 * 60 * 1000;

const nymCache = new Map();
const avatarCache = new Map();

function cacheGet(cache, key, ttl) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.timestamp > ttl) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(cache, key, value, maxEntries = 500) {
  // Oldest-first eviction keeps these caches from growing without bound.
  if (cache.size >= maxEntries) cache.delete(cache.keys().next().value);
  cache.set(key, { value, timestamp: Date.now() });
}

function primaryCodeOf(data) {
  return data?.codes?.length ? data.codes[0].code : null;
}

// Avatars are proxied through this server rather than linked straight to
// paynym.rs, so a visitor's browser never contacts a third party.
function avatarPath(code) {
  return code ? `/api/paynym/avatar/${code}` : null;
}

async function fetchNym(nym) {
  const cached = cacheGet(nymCache, nym, NYM_CACHE_TTL);
  if (cached) return cached;

  const response = await fetch(PAYNYM_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nym }),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
  });

  const text = await response.text();
  if (!response.ok || !text || text.trim() === '') return null;

  const data = JSON.parse(text);
  cacheSet(nymCache, nym, data);
  return data;
}

// Same as fetchNym, but swallows failures for the call sites where a missing
// Paynym is not an error worth failing the whole request over.
async function fetchNymSafe(nym) {
  try {
    return await fetchNym(nym);
  } catch (error) {
    console.error(`❌ Paynym fetch failed for ${nym}:`, error.message);
    return null;
  }
}

// Runs fn over items with a ceiling on simultaneous work. Promise.all over an
// unbounded array previously let one request fan out arbitrarily wide upstream.
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;

  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Paynym API proxy endpoint
app.post('/api/paynym/lookup', paynymLimiter, publicApiCors, async (req, res) => {
  try {
    const { nym } = req.body;

    if (!nym || typeof nym !== 'string') {
      return res.status(400).json({ error: 'Missing nym parameter' });
    }

    if (nym.length > 120) {
      return res.status(400).json({ error: 'nym parameter is too long' });
    }

    const cached = cacheGet(nymCache, nym, NYM_CACHE_TTL);
    if (cached) {
      console.log(`✅ Paynym cache hit: ${cached.nymName}`);
      return res.json(cached);
    }

    console.log(`🔍 Looking up Paynym: ${nym}`);

    let data;
    try {
      data = await fetchNym(nym);
    } catch (parseError) {
      console.error(`❌ Failed to read API response:`, parseError.message);
      return res.status(502).json({ error: 'Invalid response from Paynym API' });
    }

    if (!data) {
      console.error(`❌ Paynym lookup failed: no result from API`);
      return res.status(404).json({
        error: 'Paynym not found. Please check the nymID or nymName and try again.'
      });
    }

    console.log(`✅ Paynym found: ${data.nymName}`);
    res.json(data);

  } catch (error) {
    console.error('💥 Paynym lookup error:', error);
    res.status(500).json({ error: 'Failed to lookup Paynym' });
  }
});

// Avatar proxy. Keeps visitor IPs off paynym.rs and lets the strict img-src
// CSP stay at 'self'. The payment code is validated before it reaches a URL.
app.get('/api/paynym/avatar/:code', avatarLimiter, async (req, res) => {
  try {
    const { code } = req.params;

    if (!BASE58_RE.test(code)) {
      return res.status(400).json({ error: 'Invalid payment code' });
    }

    const cached = cacheGet(avatarCache, code, AVATAR_CACHE_TTL);
    if (cached) {
      res.setHeader('Content-Type', cached.contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.send(cached.body);
    }

    const upstream = await fetch(`${PAYNYM_ORIGIN}/${code}/avatar`, {
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
    });

    if (!upstream.ok) {
      return res.status(404).json({ error: 'Avatar not found' });
    }

    const contentType = upstream.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) {
      console.error(`❌ Unexpected avatar content-type: ${contentType}`);
      return res.status(502).json({ error: 'Unexpected avatar response' });
    }

    const body = Buffer.from(await upstream.arrayBuffer());
    cacheSet(avatarCache, code, { body, contentType }, 200);

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(body);

  } catch (error) {
    console.error('💥 Avatar proxy error:', error.message);
    res.status(502).json({ error: 'Failed to fetch avatar' });
  }
});

// Batch Paynym details endpoint for followers
app.post('/api/paynym/followers', paynymLimiter, publicApiCors, async (req, res) => {
  try {
    const { nymIds } = req.body;

    if (!nymIds || !Array.isArray(nymIds)) {
      return res.status(400).json({ error: 'Missing or invalid nymIds parameter' });
    }

    if (nymIds.length === 0) {
      return res.json([]);
    }

    // Cap the batch and the concurrency. Without both, one request could fan
    // out arbitrarily many simultaneous fetches at paynym.rs.
    const requested = nymIds
      .filter(id => typeof id === 'string' && id.length <= 120)
      .slice(0, MAX_FOLLOWER_IDS);

    if (requested.length < nymIds.length) {
      console.log(`⚠️  Trimmed follower batch from ${nymIds.length} to ${requested.length}`);
    }

    console.log(`🔍 Fetching details for ${requested.length} followers`);

    const followers = await mapWithConcurrency(requested, FOLLOWER_CONCURRENCY, async (nymId) => {
      const data = await fetchNymSafe(nymId);
      if (!data) return null;

      const primaryCode = primaryCodeOf(data);
      return {
        nymId: data.nymID,
        nymName: data.nymName || 'Unknown',
        avatarUrl: avatarPath(primaryCode),
        primaryCode: primaryCode || ''
      };
    });

    const validFollowers = followers.filter(Boolean);

    console.log(`✅ Successfully fetched ${validFollowers.length} follower details`);
    res.json(validFollowers);

  } catch (error) {
    console.error('💥 Batch followers error:', error);
    res.status(500).json({
      error: 'Failed to fetch follower details'
    });
  }
});

// Auth page route
app.get('/auth', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'auth.html'));
});

// Paynym Explorer page route
app.get('/paynym', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'paynym.html'));
});

// Root route - serve the main terminal interface
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// BIP47 LAB API endpoints - Client-side payment code tools

// Payment Code Validator
app.post('/api/bip47/validate', labLimiter, publicApiCors, (req, res) => {
  try {
    const { paymentCode } = req.body;

    if (!paymentCode || typeof paymentCode !== 'string') {
      return res.status(400).json({ error: 'Payment code required' });
    }

    if (paymentCode.length > 200) {
      return res.status(400).json({ error: 'Payment code is too long' });
    }

    const checks = {
      format: paymentCode.startsWith('PM8T'),
      length: paymentCode.length === 116,
      base58: /^[1-9A-HJ-NP-Za-km-z]+$/.test(paymentCode),
      checksum: false,
      version: false
    };

    // Check checksum by trying to parse
    try {
      const pc = bip47.fromBase58(paymentCode);
      checks.checksum = true;
      checks.version = true;
    } catch (e) {
      checks.checksum = false;
    }

    const isValid = checks.format && checks.length && checks.base58 && 
                    checks.checksum && checks.version;

    res.json({
      valid: isValid,
      checks,
      details: isValid ? {
        type: 'BIP47 Payment Code v1',
        features: 'Reusable payment codes for stealth addresses',
        warning: 'Always verify payment codes before use'
      } : null
    });

  } catch (error) {
    console.error('💥 Validation error:', error);
    res.status(500).json({ error: 'Validation failed: ' + error.message });
  }
});

// BIP47 Message Verifier - Verify message signed with notification address
app.post('/api/bip47/verify-message', labLimiter, publicApiCors, async (req, res) => {
  try {
    const { paymentCode, message, signature } = req.body;

    if (!paymentCode || !message || !signature) {
      return res.status(400).json({ 
        error: 'Missing required fields: paymentCode, message, signature' 
      });
    }

    console.log(`🔍 Verifying message for payment code: ${paymentCode.substring(0, 20)}...`);

    // Parse the payment code
    let paynym;
    try {
      paynym = bip47.fromBase58(paymentCode);
    } catch (e) {
      console.error('❌ Invalid payment code:', e.message);
      return res.status(400).json({ 
        valid: false,
        error: 'Invalid payment code format' 
      });
    }

    // Get the notification address from the payment code
    const notificationAddress = paynym.getNotificationAddress();
    console.log(`📧 Notification address: ${notificationAddress}`);

    // Verify the signature
    let isValid;
    try {
      isValid = bitcoinjsMessage.verify(
        message, 
        notificationAddress, 
        signature, 
        networks.bitcoin.messagePrefix
      );
    } catch (e) {
      console.error('❌ Signature verification error:', e.message);
      return res.json({
        valid: false,
        error: 'Invalid signature format',
        notificationAddress
      });
    }

    // Try to fetch Paynym details for additional info
    const paynymData = await fetchNymSafe(paymentCode);
    const nymName = paynymData?.nymName || null;
    const avatarUrl = avatarPath(primaryCodeOf(paynymData));

    console.log(`${isValid ? '✅' : '❌'} Message verification ${isValid ? 'successful' : 'failed'}`);

    res.json({
      valid: isValid,
      notificationAddress,
      nymName,
      avatarUrl,
      paymentCode
    });

  } catch (error) {
    console.error('💥 Message verification error:', error);
    res.status(500).json({ 
      valid: false,
      error: 'Verification failed: ' + error.message 
    });
  }
});

// Lab page route
app.get('/lab', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'lab.html'));
});

// Guestbook page route
app.get('/guestbook', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'guestbook.html'));
});

// Documentation page route
app.get('/docs', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'docs.html'));
});

// About page route
app.get('/about', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'about.html'));
});

// QR Code generation endpoint for payment codes
app.get('/api/qr', qrLimiter, async (req, res) => {
  try {
    const { text } = req.query;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Missing text parameter' });
    }

    // Unbounded input here was a cheap way to make the server do expensive work.
    if (text.length > MAX_QR_TEXT_LENGTH) {
      return res.status(400).json({
        error: `Text too long (max ${MAX_QR_TEXT_LENGTH} characters)`
      });
    }
    
    const qr = await QRCode.toDataURL(text);
    res.json({ qr });
  } catch (error) {
    console.error('💥 QR generation error:', error);
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// Guestbook API endpoints

// GET /api/guestbook/messages - List all verified messages
app.get('/api/guestbook/messages', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ 
        error: 'Database not available' 
      });
    }

    const messages = await db.collection('messages')
      .find({ verified: true })
      .sort({ createdAt: -1 })
      .toArray();

    // Rows written before the avatar proxy existed hold absolute paynym.rs
    // URLs. Rewrite them on read so old messages keep their avatars without
    // needing a migration, and without the browser hitting a third party.
    const normalized = messages.map(msg => {
      const legacy = typeof msg.nymAvatar === 'string'
        ? msg.nymAvatar.match(/^https?:\/\/paynym\.rs\/([1-9A-HJ-NP-Za-km-z]+)\/avatar$/)
        : null;
      return legacy ? { ...msg, nymAvatar: avatarPath(legacy[1]) } : msg;
    });

    console.log(`✅ Retrieved ${normalized.length} messages`);
    res.json(normalized);

  } catch (error) {
    console.error('💥 Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// POST /api/guestbook/submit - Submit new message with Auth47
app.post('/api/guestbook/submit', submitLimiter, async (req, res) => {
  try {
    const { nonce, message, challenge, signature, nym } = req.body;

    if (!nonce || !message || !challenge || !signature || !nym) {
      return res.status(400).json({ 
        error: 'Missing required fields: nonce, message, challenge, signature, nym' 
      });
    }

    // The textarea enforces this client-side; the server has to as well, or
    // anyone posting directly to the API can store arbitrarily large documents.
    if (typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message must be a non-empty string' });
    }

    const trimmedMessage = message.trim();
    if (trimmedMessage.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({
        error: `Message too long (max ${MAX_MESSAGE_LENGTH} characters)`
      });
    }

    if (!db) {
      return res.status(503).json({ 
        error: 'Database not available' 
      });
    }

    // Verify the Auth47 authentication
    const auth = pendingAuths.get(nonce);
    if (!auth || !auth.verified || auth.paymentCode !== nym) {
      return res.status(401).json({ 
        error: 'Invalid or expired authentication' 
      });
    }

    console.log(`📝 Submitting message from ${nym}`);

    // Fetch Paynym details including avatar
    const paynymData = await fetchNymSafe(nym);
    const nymName = paynymData?.nymName || nym;
    const nymAvatar = avatarPath(primaryCodeOf(paynymData));

    if (paynymData) {
      console.log(`✅ Fetched Paynym: ${nymName}, avatar: ${nymAvatar ? 'yes' : 'no'}`);
    }

    // Store message in database
    const messageDoc = {
      paymentCode: nym,
      nymName,
      nymAvatar,
      message: trimmedMessage,
      signature,
      verified: true,
      createdAt: new Date(),
      nonce
    };

    await db.collection('messages').insertOne(messageDoc);
    
    console.log(`✅ Message saved for ${nymName}`);
    
    // Mark nonce as used to prevent reuse
    pendingAuths.delete(nonce);

    res.json({ 
      success: true,
      message: 'Message submitted successfully',
      data: messageDoc
    });

  } catch (error) {
    console.error('💥 Error submitting message:', error);
    res.status(500).json({ error: 'Failed to submit message' });
  }
});

// Unknown routes. Without this, Express serves its own unstyled HTML page.
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html'));
});

app.listen(PORT, () => {
  console.log('\n🟢 BIP47 Terminal Server running!');
  console.log(`→ http://localhost:${PORT}`);
  console.log(`→ Callback: ${CALLBACK_URL}`);
  console.log(`→ Using @bitcoinerlab/secp256k1\n`);
});
