# AGENTS.md - AI Agent Guide for BIP47 Website

This file provides detailed guidance for AI coding agents working on the BIP47 Terminal website project.

## Project Overview

This is a Node.js/Express web application implementing BIP47 Auth47 authentication protocol with a terminal-style interface. It includes a Paynym Explorer for searching and viewing BIP47 payment codes and their social connections.

**Tech Stack:**
- Backend: Node.js with Express (ES modules)
- **Node 24 or later.** `@dojo-tools/*` declares `engines: >=24`. The app does
  in fact run on Node 22 (the test suite passes there), but the floor matches
  what the dependencies ask for. `.nvmrc` pins 24 so `nvm use` selects it.
- Frontend: Vanilla HTML/CSS/JavaScript
- Cryptography: @bitcoinerlab/secp256k1, @dojo-tools/bip47
- Deployment: VPS under pm2, with a Tor hidden service (production); localhost
  (development). The project used to deploy on Railway; that is gone, and
  `railway.json` has been removed.

## Project Vision & Roadmap

The BIP47 Terminal website is a comprehensive showcase hub for BIP47 technology and Paynym ecosystem, featuring a terminal-style cypherpunk aesthetic.

### 6-Card Showcase Vision
1. **AUTH47 LOGIN** - BIP47 authentication protocol demo ✓
2. **BIP47 LAB** - Interactive payment code tools (planned)
3. **GUESTBOOK** - Community signed messages (planned)
4. **PAYNYM EXPLORER** - Search and explore Paynyms ✓
5. **DOCUMENTATION** - Technical docs and API references (planned)
6. **ABOUT** - Educational content about privacy (planned)

### Implementation Phases

**Phase 1: Foundation** (COMPLETED ✓)
- Terminal-style UI with 6-card grid
- Auth47 authentication flow
- Paynym Explorer with search and followers
- Backend API proxy for Paynym services

**Phase 2: Interactive Tools** (COMPLETED ✓)
- BIP47 LAB: Payment code validator
- Interactive "Alice Pays Bob" scenario walkthrough
- Educational BIP47 payment flow demonstration

**Phase 3: Community Features** (COMPLETED ✓)
- Guestbook with Auth47 authentication
- Signed message display with Paynym avatars
- Database integration (MongoDB)

**Phase 4: Documentation** (PLANNED)
- BIP47 protocol explanation
- Auth47 specification
- API endpoint documentation
- Code examples and tutorials

### Current Status
**Progress: 75% Complete (3 of 4 phases)**
- ✅ Foundation & UI
- ✅ Auth47 & Paynym Explorer
- ✅ Interactive Tools (BIP47 LAB)
- ✅ Community Features (Guestbook)
- 📋 Documentation
- 📋 About Page

## Feature Status Matrix

| Feature | Status | Priority | Dependencies | Notes |
|---------|---------|------------|---------|
| **AUTH47 LOGIN** | ✅ Complete | None | Fully functional with QR code and signature verification |
| **PAYNYM EXPLORER** | ✅ Complete | None | Search, followers, and avatar display working |
| **Showcase Hub** | ✅ Complete | None | 6-card grid layout with terminal aesthetic |
| **BIP47 LAB** | ✅ Complete | None | Payment code validator + interactive scenario |
| **GUESTBOOK** | ✅ Complete | Database | Auth47 authentication + message storage with avatars |
| **DOCUMENTATION** | 📋 Planned | None | Technical docs and API references |
| **ABOUT** | 📋 Planned | None | Educational content about privacy |

### Feature Dependencies
```
GUESTBOOK → Database (PostgreSQL/MongoDB) + Auth47
BIP47 LAB → BIP47 library functions (already available)
DOCUMENTATION → Static content
ABOUT → Static content
```

## Detailed Architecture

### Frontend-Backend Data Flow

```
┌─────────────────┐         ┌──────────────────┐         ┌──────────────────┐
│   Frontend     │────────▶│   Express       │────────▶│  External APIs   │
│   (Vanilla JS) │         │   Server        │         │  (paynym.rs)    │
└─────────────────┘         └──────────────────┘         └──────────────────┘
       │                           │                           │
       │                           │                           │
       │◀── JSON Response ◀───────────┘                           │
       │                                                       │
       │◀────────────────────────────────────── JSON Response ◀─────┘
```

### API Endpoint Catalog

#### Auth47 Endpoints
| Method | Endpoint | Purpose | Auth Required |
|---------|-----------|----------|---------------|
| GET | `/start-auth` | Generate authentication challenge | No |
| GET | `/check-auth/:nonce` | Poll auth status | No |
| POST | `/verify` | Verify wallet signature | No |
| POST | `/callback` | Wallet callback endpoint | No |

#### Paynym Explorer Endpoints
| Method | Endpoint | Purpose | Auth Required |
|---------|-----------|----------|---------------|
| POST | `/api/paynym/lookup` | Search Paynym by ID/name | No |
| POST | `/api/paynym/followers` | Get follower details (max 50 ids per call) | No |
| GET | `/api/paynym/avatar/:code` | Proxy + cache a Paynym avatar | No |

**Never link avatars straight to `paynym.rs` from the frontend.** Doing so
hands every visitor's IP and referer to a third party and breaks the strict
`img-src 'self'` CSP. Use `/api/paynym/avatar/:code` instead.

#### BIP47 LAB Endpoints
| Method | Endpoint | Purpose | Auth Required |
|---------|-----------|----------|---------------|
| POST | `/api/bip47/validate` | Validate BIP47 payment code format | No |

#### System Endpoints
| Method | Endpoint | Purpose | Auth Required |
|---------|-----------|----------|---------------|
| GET | `/health` | Health check | No |
| GET | `/` | Main showcase hub | No |
| GET | `/auth` | Auth47 demo page | No |
| GET | `/paynym` | Paynym Explorer page | No |
| GET | `/lab` | BIP47 LAB tools page | No |
| GET | `/guestbook` | Guestbook page | No |

### Frontend-Backend Interaction Patterns

#### Pattern 1: Simple GET Request
```javascript
// Frontend
const response = await fetch('/start-auth');
const data = await response.json();
```

#### Pattern 2: POST Request with JSON
```javascript
// Frontend
const response = await fetch('/api/paynym/lookup', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ nym: paynymId })
});
const data = await response.json();
```

#### Pattern 3: Polling Loop
```javascript
// Frontend - Poll for auth status
const pollAuthStatus = async (nonce) => {
  const interval = setInterval(async () => {
    const response = await fetch(`/check-auth/${nonce}`);
    const data = await response.json();
    if (data.status === 'verified' || data.status === 'invalid') {
      clearInterval(interval);
      // Handle result
    }
  }, 2000);
};
```

### Paynym API Integration Details

**Primary API: paynym.rs**
- Used for: Paynym lookup, follower details
- Base URL: `https://paynym.rs/api/v1/nym/`
- Method: POST
- Request body: `{ nym: "payment_code_or_nym_id" }`
- Response: JSON with Paynym details

**Error Handling Pattern:**
```javascript
// Always check for empty response first
const text = await response.text();
if (!text || text.trim() === '') {
  return res.status(404).json({ error: 'Paynym not found' });
}

// Then parse JSON
const data = JSON.parse(text);
```

**Rate Limiting:**
- Paynym APIs may have rate limits
- Consider caching frequent lookups
- Implement exponential backoff for retries

## Testing Strategy

### Test Coverage Goals

| Feature | Manual Tests | Automated Tests | Priority |
|---------|---------------|------------------|------------|
| Auth47 Flow | ✓ Required | Recommended | High |
| Paynym Explorer | ✓ Required | Recommended | High |
| BIP47 LAB | ✓ Required | Recommended | High |
| Error Handling | ✓ Required | Recommended | High |
| Edge Cases | Optional | Recommended | Medium |
| Performance | Optional | Recommended | Low |

### Testing Priorities

#### High Priority (Must Test)
1. **Valid Auth47 Flow:**
   - Generate QR code
   - Scan with wallet
   - Verify signature
   - Check polling updates

2. **Valid Paynym Search:**
   - Search by nymID (e.g., `+mundanepunch78`)
   - Search by nymName
   - Verify followers load
   - Check avatars display

3. **BIP47 LAB Tools:**
   - Validate a real BIP47 payment code
   - Test with invalid format (should fail)
   - Walk through interactive scenario
   - Verify all 4 steps work

4. **Error Handling:**
   - Invalid Paynym search
   - Missing parameters
   - Network failures
   - Empty API responses

#### Medium Priority (Should Test)
5. **Edge Cases:**
   - Empty search query
   - Very long payment codes
   - Special characters
   - Duplicate requests

6. **Performance:**
   - Large follower lists (100+)
   - Multiple concurrent requests
   - API timeout handling

#### Low Priority (Nice to Have)
7. **UI/UX:**
   - Mobile responsiveness
   - Accessibility features
   - Loading states
   - Error display

### Manual Testing Checklist

**Before Each PR:**
- [ ] Run `npm start` locally
- [ ] Test all new features
- [ ] Test error scenarios
- [ ] Check browser console for errors
- [ ] Test on different browsers (Chrome, Firefox)
- [ ] Test on mobile if applicable

**After Database Changes:**
- [ ] Test database connections
- [ ] Verify data persistence
- [ ] Test query performance
- [ ] Check for SQL injection vulnerabilities
- [ ] Test transaction rollback

### Performance Testing

```bash
# Load test with curl
for i in {1..100}; do
  curl -s -X POST http://localhost:3000/api/paynym/lookup \
    -H "Content-Type: application/json" \
    -d '{"nym":"+test"}' &
done
```

### Automated Testing (Future)

Consider adding:
```javascript
// Example: Jest tests
describe('Paynym API', () => {
  test('should return error for invalid Paynym', async () => {
    const response = await fetch('/api/paynym/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nym: 'invalid' })
    });
    const data = await response.json();
    expect(response.status).toBe(404);
    expect(data.error).toBeDefined();
  });
});
```

## Setup Commands

### Initial Setup

```bash
# Clone the repository
git clone <repository-url>
cd bip47-website

# Install dependencies
npm install

# Start development server
npm start
```

### Development Workflow

```bash
# Start the server (runs on port 3000)
node server.js

# Or use npm script
npm start

# Server will be available at:
# http://localhost:3000 - Main terminal interface
# http://localhost:3000/paynym - Paynym Explorer
# http://localhost:3000/auth - Auth47 demo
```

### Environment Variables

Create a `.env` file or set environment variables:

```bash
# Optional: Override default port
PORT=3000

# Required for production deployment
CALLBACK_URL=https://paymentcode.io/callback

# Environment
NODE_ENV=development
```

## Testing Instructions

### Manual Testing

1. **Auth47 Flow:**
   - Visit http://localhost:3000/auth
   - Click "Generate Auth QR Code"
   - Scan with Samourai Wallet (or compatible BIP47 wallet)
   - Verify authentication status updates

2. **Paynym Explorer:**
   - Visit http://localhost:3000/paynym
   - Search for valid Paynym (e.g., `+mundanepunch78`)
   - Verify follower details load correctly
   - Test invalid searches (should show error message)

3. **BIP47 LAB:**
   - Visit http://localhost:3000/lab
   - Test payment code validator with valid code
   - Test with invalid format (should fail validation)
   - Walk through "Alice Pays Bob" scenario
   - Verify all 4 steps display correctly

4. **API Endpoints:**
   ```bash
   # Health check
   curl http://localhost:3000/health
   
   # Paynym lookup
   curl -X POST http://localhost:3000/api/paynym/lookup \
     -H "Content-Type: application/json" \
     -d '{"nym":"+mundanepunch78"}'
   
   # Follower details
   curl -X POST http://localhost:3000/api/paynym/followers \
     -H "Content-Type: application/json" \
     -d '{"nymIds":["nymEHrso...","nymSPvUv..."]}'
   
   # BIP47 LAB - Validate payment code
   curl -X POST http://localhost:3000/api/bip47/validate \
     -H "Content-Type: application/json" \
     -d '{"paymentCode":"PM8TJJwnXi1t3jv52qM2MMZFWa8wJhj8eyZYcC5cjzEfzENMrxJM9fbnQANqmUSptJdiQmoScyf3Y41SGTPHWpf9PLDVvSSq2UEa8WympaepqxETMgPW"}'
   ```

### Testing Error Handling

```bash
# Test invalid Paynym (should return proper error)
curl -X POST http://localhost:3000/api/paynym/lookup \
  -H "Content-Type: application/json" \
  -d '{"nym":"invalidpaynym"}'

# Expected response:
# {"error":"Paynym not found. Please check the nymID or nymName and try again."}
```

## Code Style

### JavaScript/Node.js

- **ES Modules:** Use `import`/`export` (not CommonJS `require`)
- **Async/Await:** Prefer async/await over Promise chains
- **Error Handling:** Always use try-catch for async operations
- **Logging:** Use emoji prefixes for log messages:
  - `✅` for success
  - `❌` for errors
  - `🔍` for lookups/queries
  - `💥` for exceptions

Example:
```javascript
// ✅ Good
try {
  console.log(`🔍 Looking up Paynym: ${nym}`);
  const response = await fetch(url);
  console.log(`✅ Paynym found: ${data.nymName}`);
} catch (error) {
  console.error('💥 Paynym lookup error:', error);
}

// ❌ Bad
const response = fetch(url); // Missing await
console.log('Found: ' + data); // No error handling
```

### Frontend Code

- **Vanilla JS:** No frameworks - use plain JavaScript
- **CSS:** Use CSS variables for theming
- **HTML:** Semantic HTML5 elements
- **Error Display:** Show user-friendly error messages in the UI

### File Organization

```
bip47-website/
├── public/              # Static frontend files
│   ├── index.html      # Main showcase hub
│   ├── paynym.html     # Paynym Explorer
│   ├── lab.html        # BIP47 LAB tools
│   ├── guestbook.html  # Guestbook with Auth47
│   ├── auth.html       # Auth47 demo
│   ├── callback.html   # Wallet callback page
│   ├── 404.html        # Not-found page
│   ├── styles.css      # Shared design system + @font-face
│   ├── css/            # One stylesheet per page (<page>.css)
│   ├── js/             # One script per page, plus common.js
│   ├── fonts/          # Self-hosted variable fonts
│   └── logos/          # Project logos for SUPPORTED BY sections
├── server.js           # Express server (all backend logic)
├── package.json        # Dependencies
├── package-lock.json   # Committed: deploys must be reproducible
└── AGENTS.md          # This file
```

**No inline `<style>` or `<script>` blocks, and no inline event handlers.**
The CSP sets `script-src 'self'`, so an `onclick="..."` attribute will simply
not fire. Pages declare behaviour with `data-action` attributes and register a
handler in their own script:

```html
<button data-action="do-thing" data-id="42">Go</button>
```
```javascript
registerActions({
  'do-thing': (el) => doThing(el.dataset.id)
});
```

`common.js` provides `escapeHtml()`, `registerActions()` and
`registerImageFallbacks()` (use `data-on-error="hide"` or `"placeholder"`
instead of an `onerror` attribute). Always run API-sourced strings through
`escapeHtml()` before interpolating them into `innerHTML` — including inside
attributes, where unescaped quotes would break out.

Full-width buttons opt in with `class="btn-block"`; buttons are auto-width by
default.

**Inline `<svg>` must carry `width` and `height` attributes**, not just a
`viewBox`. An SVG with only a viewBox has no intrinsic size, so if the
stylesheet has not applied yet - a stale cached `styles.css` (static assets are
served with `max-age=3600`), a slow load, a blocked request - it expands to fill
its container. The footer icon rendered at 1264px that way. CSS may still size
it; the attributes are the floor.

## UI Components

### SUPPORTED BY Section

The project features a "SUPPORTED BY" showcase section that displays logos of BIP47/Paynym-compatible wallets and services.

**Main Page (index.html):**
- Full-width section below the card grid
- Displays 11 project logos: Samourai, Sparrow, BlueWallet, Stack, Ashigaru,
  Lincoin, Mynymbox, The Bitcoin Company, Dojo, The Dojo Bay, BIP47DB
- Grayscale logos that turn colorful on hover
- Links to external project websites

**Auth Page (auth.html):**
- Compact version inside the auth-card, split into two labelled columns
- Clients: Samourai, Ashigaru, Sparrow
- Servers: The Bitcoin Company, PayNym.rs, Dojo, The Dojo Bay
- Each entry carries a `.logo-name` caption under the icon
- Centered below the "Generate Auth QR Code" button
- Same hover effects as main page

**Adding a logo:** drop a 512x512 PNG into `public/logos/` (lowercase filename)
and add an `<a class="logo-link">` entry. The auth page list is Auth47
implementations specifically, so only add an entry there if the project
actually speaks Auth47, and put it in the right column.

**Styling (styles.css):**
```css
/* Main page supported-by */
.supported-by {
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: var(--space-lg);
  text-align: center;
}

.logo-grid {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: var(--space-xl);
  flex-wrap: wrap;
}

.logo-link {
  filter: grayscale(100%);
  opacity: 0.7;
  transition: all var(--transition-normal);
}

.logo-link:hover {
  filter: grayscale(0%);
  opacity: 1;
  transform: scale(1.1);
}

.logo-img {
  height: 40px;
  width: auto;
  max-width: 120px;
  object-fit: contain;
}
```

### Card Component Updates

**Typography Hierarchy:**
- Card titles: 1.25rem, font-weight 700 (bolder)
- Card descriptions: 0.8rem, lighter color, line-height 1.6
- Card icons: 1.75rem for better visual anchors
- Uses flexbox with gap for consistent spacing

**CTA Buttons:**
- Background fill: rgba(74, 222, 128, 0.1)
- Border and rounded corners
- Hover state brightens background
- Keeps bracketed `[ACTION]` style

**Responsive Grid:**
- 3 columns at 1000px+
- 2 columns at 600px-999px
- 1 column below 600px

## PR Instructions

### Before Submitting a PR

1. **Test Locally:**
   - Run `npm start` and verify all features work
   - Test both valid and invalid inputs
   - Check browser console for errors

2. **Code Quality:**
   - Follow the code style guidelines above
   - Add appropriate error handling
   - Include helpful logging messages

3. **Documentation:**
   - Update README.md if adding user-facing features
   - Update AGENTS.md if changing development workflows
   - Add comments for complex logic

### PR Template

```markdown
## Description
Brief description of changes

## Testing
- [ ] Tested locally with `npm start`
- [ ] Tested valid Paynym lookups
- [ ] Tested invalid/error cases
- [ ] Checked browser console for errors

## Changes
- List of files modified
- Brief explanation of each change

## Screenshots (if applicable)
Add screenshots for UI changes
```

## Dev Environment Tips

### Common Issues

1. **Port Already in Use:**
   ```bash
   # Kill existing server
   pkill -f "node server.js"
   
   # Or use a different port
   PORT=3001 node server.js
   ```

2. **Dependencies Issues:**
   ```bash
   # Clean install
   rm -rf node_modules package-lock.json
   npm install
   ```

3. **ES Module Errors:**
   - Ensure `package.json` has `"type": "module"`
   - Use `import` not `require`
   - Use `.js` extension in imports

### Debugging

```bash
# View server logs
node server.js

# Check specific endpoint
curl -v http://localhost:3000/health

# Test API with verbose output
curl -X POST http://localhost:3000/api/paynym/lookup \
  -H "Content-Type: application/json" \
  -d '{"nym":"+test"}' \
  -v
```

### Working with Paynym API

**Important Notes:**
- Paynym API (`paynym.is`) returns empty responses for invalid Paynyms
- Always check if response body is empty before parsing JSON
- Use `paynym.rs` API for follower details (more reliable)
- Handle errors gracefully - show user-friendly messages

Example error handling:
```javascript
const text = await response.text();
if (!text || text.trim() === '') {
  return res.status(404).json({ 
    error: 'Paynym not found. Please check the nymID or nymName and try again.' 
  });
}

let data;
try {
  data = JSON.parse(text);
} catch (parseError) {
  return res.status(500).json({ 
    error: 'Invalid response from Paynym API' 
  });
}
```

### Adding New Features

1. **Backend Changes:**
   - Add routes in `server.js`
   - Include proper error handling
   - Add logging with emoji prefixes
   - Test with curl before frontend integration

2. **Frontend Changes:**
   - Keep vanilla JS (no frameworks)
   - Use existing CSS variables for consistency
   - Add loading states for async operations
   - Show user-friendly error messages

3. **API Integration:**
   - Use the existing proxy pattern (don't call external APIs directly from frontend)
   - Handle rate limiting and errors
   - Cache responses when appropriate

### Deployment

Production is a VPS running the app under pm2, with a Tor hidden service
alongside. There is no build step and no CI: deploying is pull, install,
restart.

```bash
git pull
npm ci                     # respects package-lock.json
pm2 restart bip47          # or: pm2 start server.js --name bip47
pm2 logs bip47
```

Configuration lives in a `.env` file in the repo root, loaded by `dotenv`. It is
gitignored, so it is not managed from here.

**`CALLBACK_URL` is load-bearing.** It is the resource that every Auth47 proof is
verified against (see the resource binding section). If it does not match the
site's real public URL, every login fails - and if it were ever set to a URL
someone else controls, the binding would be verifying against the wrong site.

**`trust proxy` is set to `1`** in server.js, meaning exactly one proxy hop is
trusted for the client IP. Rate limiting keys on `req.ip`, so this number has to
match the real topology: with nothing in front, `X-Forwarded-For` can be spoofed
to bypass the limits; with two hops, every request looks like it comes from the
same address. Revisit it if the fronting setup changes.

**Environment-Specific Behavior:**
- Development: Uses `http://localhost:3000/callback`
- Production: Uses `CALLBACK_URL` environment variable

## Key Dependencies

- **@bitcoinerlab/secp256k1**: Bitcoin cryptography (signature verification)
- **@dojo-tools/bip47**: BIP47 payment code implementation
- **@dojo-tools/auth47**: Auth47 protocol (verification is NOT resource-bound;
  see the Auth47 resource binding section)
- **@dojo-tools/bitcoinjs-message**: Bitcoin message signing/verification

These were `@samouraiwallet/*` until the projects moved to the
[dojo-tools](https://github.com/Dojo-Open-Source-Project/dojo-tools) monorepo.
The public API is unchanged across that move, and payment codes, notification
addresses and signatures are byte-identical between the old and new versions,
so the migration was import renames only.
- **express**: Web server framework
- **cors**: Cross-origin resource sharing
- **qrcode**: QR code generation

## Architecture Notes

### Auth47 Flow
1. Server generates nonce and creates Auth47 URI
2. QR code displayed to user
3. Wallet scans QR and signs challenge
4. Wallet POSTs signature to `/verify` or `/callback`
5. Server verifies signature using BIP47 notification key
6. Frontend polls `/check-auth/:nonce` for status

### Paynym Explorer
1. User searches for Paynym (nymID or nymName)
2. Frontend calls `/api/paynym/lookup` (proxies to paynym.rs)
3. Backend returns Paynym details including followers
4. Frontend calls `/api/paynym/followers` with follower nymIDs
5. Backend fetches details from paynym.rs API in parallel
6. Frontend displays follower cards with avatars

## Security Considerations

- **Auth47 proofs MUST be bound to this site's resource URL.** See below.
- Nonces expire after 5 minutes
- Each nonce can only be used once
- All signature verification happens server-side
- Payment codes are public (BIP47 design)
- No private keys are stored or handled

### Auth47 resource binding (do not remove)

`Auth47Verifier.verifyProof()` answers "is this signed?", not "is this signed
**for me**?". It validates that the challenge's `r` parses as an http(s) URL,
but it has no idea which URL is ours. Without comparing `r` to our own callback
URL, an attacker can request a live nonce here, show a victim the same challenge
with `r` naming the attacker's site, and relay the victim's genuine signature
back to us — creating a session in the victim's name. Nonce expiry, single use
and a valid signature do not prevent this.

Every proof therefore goes through `verifyAuth47Proof(proof, expectedResource)`
in `server.js`, which takes the expected resource as a **required** argument and
throws without it. Both `/verify` and `/callback` call it; never verify a proof
by calling `verifier.verifyProof()` directly, and never add a third entry point
that skips it.

The rule worth keeping generally: *no verification function may take only the
thing being verified.* It must also take the expectation, so that omitting the
binding is a missing argument rather than an invisible silence.

Regression tests live in `test/auth47-resource-binding.test.mjs`:

```bash
npm test
```

They spawn a real server and relay a genuinely-signed proof at it. If the
binding is removed, three of them fail. Reported by maxtannahill of
[The Dojo Bay](https://dojobay.org).

### Request limits

Every externally reachable endpoint is bounded. When adding a route, give it a
limiter and validate input length before the value reaches a library or an
upstream URL.

| Limit | Value | Where |
|-------|-------|-------|
| JSON body | 32 kb | `express.json` |
| Guestbook message | 500 chars | `MAX_MESSAGE_LENGTH` |
| Follower ids per request | 50 | `MAX_FOLLOWER_IDS` |
| Upstream concurrency | 5 | `FOLLOWER_CONCURRENCY` |
| QR text | 512 chars | `MAX_QR_TEXT_LENGTH` |
| Upstream timeout | 8s | `UPSTREAM_TIMEOUT_MS` |
| Paynym lookups | 10/min/IP | `paynymLimiter` |
| Avatars | 120/min/IP | `avatarLimiter` |
| Auth endpoints | 30/15min/IP | `authLimiter` |
| Guestbook submit | 5/hour/IP | `submitLimiter` |

### CORS

CORS is opened only on the read-only lookup endpoints (`publicApiCors`). Auth
and guestbook writes stay same-origin so a third-party page cannot drive them
from a visitor's browser. Do not add `publicApiCors` to a state-changing route.

### A valid test payment code

BIP47 v1 payment codes are **116 base58 characters**. This one is generated
from a throwaway seed and passes `/api/bip47/validate`:

```
PM8TJJwnXi1t3jv52qM2MMZFWa8wJhj8eyZYcC5cjzEfzENMrxJM9fbnQANqmUSptJdiQmoScyf3Y41SGTPHWpf9PLDVvSSq2UEa8WympaepqxETMgPW
```

## Future Enhancements

### BIP47 LAB Feature Specifications (Completed ✓)

**Payment Code Validator (✅ IMPLEMENTED):**
- Validates BIP47 payment code format
- Checks: format, length, base58 encoding, checksum, version
- User-friendly error messages
- Visual pass/fail indicators

**Interactive "Alice Pays Bob" Scenario (✅ IMPLEMENTED):**
- 4-step walkthrough of complete BIP47 payment flow
- Step 1: Exchange payment codes
- Step 2: Create notification transaction (with ECDH visualization)
- Step 3: Derive payment addresses (with formula)
- Step 4: Bob receives & spends (with private key derivation)
- Progress indicators and reset functionality
- Educational tooltips and explanations

### Future BIP47 LAB Enhancements

**Advanced Features (PLANNED):**
- Payment Code Generator from BIP39 mnemonic
- Visual payment code breakdown (byte-level)
- Notification address derivation from outpoint
- Real cryptography operations (not just simulations)
- Payment address derivation calculator
- Transaction builder simulator

### Guestbook Database Schema

**PostgreSQL Schema:**
```sql
CREATE TABLE messages (
  id SERIAL PRIMARY KEY,
  payment_code VARCHAR(80) NOT NULL,
  nym_name VARCHAR(50),
  message TEXT NOT NULL,
  signature TEXT NOT NULL,
  verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (payment_code) REFERENCES payment_codes(code)
);
```

**MongoDB Schema:**
```javascript
{
  paymentCode: String,    // BIP47 payment code
  nymName: String,       // Paynym name (if available)
  nymAvatar: String,     // Paynym avatar URL (fetched from Paynym API)
  message: String,        // Message content
  signature: String,      // Auth47 signature
  verified: Boolean,      // Signature verification status
  createdAt: Date,        // Timestamp
  nonce: String          // Auth47 challenge nonce
}
```

**Avatar Fetching:**
- Use existing `fetchPaynymDetails()` function from Paynym Explorer
- Fetch avatar URL from Paynym API during message submission
- Store avatar URL with message for display
- Fallback: Display generic placeholder if avatar fails to load

**Guestbook API Endpoints:**
- `GET /api/guestbook/messages` - List all verified messages
- `POST /api/guestbook/submit` - Submit new message (with Auth47)
- `GET /api/guestbook/verify/:id` - Verify message signature

### Documentation Structure

**Suggested Sections:**
1. **BIP47 Protocol**
   - What is BIP47?
   - How payment codes work
   - Privacy benefits
   - Notification address concept

2. **Auth47 Specification**
   - Protocol overview
   - Challenge-response flow
   - Signature verification
   - Security considerations

3. **API Documentation**
   - All endpoints documented
   - Request/response examples
   - Error codes
   - Rate limiting info

4. **Code Examples**
   - Generate payment codes
   - Verify signatures
   - Integrate with wallet
   - Build Paynym applications

### About Page Content Outline

**Topics to Cover:**
1. **BIP47 Privacy Benefits**
   - Reusable payment codes
   - No address reuse
   - Privacy from blockchain analysis
   - How it differs from regular addresses

2. **How Paynyms Work**
   - Paynym ID vs payment code
   - Social graph concept
   - Following and followers
   - Identity verification

3. **Resources**
   - Official BIP47 specification
   - Samourai Wallet documentation
   - Paynym network info
   - Community resources

### Performance & Optimization

**Caching Strategies:**
```javascript
// Simple in-memory cache for Paynym lookups
const paynymCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

app.post('/api/paynym/lookup', async (req, res) => {
  const { nym } = req.body;
  
  // Check cache
  const cached = paynymCache.get(nym);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return res.json(cached.data);
  }
  
  // Fetch fresh data
  const data = await fetchPaynym(nym);
  
  // Update cache
  paynymCache.set(nym, { data, timestamp: Date.now() });
  
  res.json(data);
});
```

**Rate Limiting Considerations:**
- Implement rate limiting per IP
- Limit: 10 requests per minute for Paynym API
- Use Express rate-limit middleware
- Cache frequently requested Paynyms

**Frontend Optimization:**
- Lazy load follower cards
- Implement infinite scroll for large lists
- Use Intersection Observer for images
- Minimize DOM updates

**Database Optimization:**
- Add indexes on payment_code, created_at
- Use connection pooling
- Implement query caching
- Consider read replicas for scaling

### Development Workflow

**Feature Development Checklist:**
- [ ] Design feature architecture
- [ ] Write API endpoints first
- [ ] Test with curl/postman
- [ ] Implement frontend
- [ ] Add error handling
- [ ] Write unit tests (if applicable)
- [ ] Manual testing
- [ ] Update documentation
- [ ] Submit PR

**Testing Requirements Per Feature:**
1. **Happy Path**: Feature works with valid inputs
2. **Error Cases**: Graceful failure on invalid inputs
3. **Edge Cases**: Boundary conditions, empty inputs
4. **Performance**: Acceptable response times
5. **Security**: No vulnerabilities exposed

**Code Review Criteria:**
- Follows code style guidelines
- Proper error handling
- Adequate logging
- No hardcoded values
- Security best practices
- Performance considerations
- Documentation updated

**Deployment Checklist:**
- [ ] All tests pass
- [ ] Environment variables set
- [ ] Database migrations applied
- [ ] API endpoints tested in production
- [ ] Frontend assets built/minified
- [ ] Monitoring configured
- [ ] Rollback plan documented

## Getting Help

- **BIP47 Protocol**: [Samourai Wallet docs](https://freesamourai.com/)
- **Paynym API**: Check `paynym-api.md` for API documentation
- **Issues**: Create a GitHub issue for bugs or feature requests