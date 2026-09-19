// Regression tests for the Auth47 resource binding.
//
// Background: verifyProof() confirms a challenge was signed, not that it was
// signed for us. Without comparing the challenge's `r` against our own URL, an
// attacker can take a live nonce from this server, have a victim sign a
// challenge naming the attacker's site, and relay the genuine proof back here
// to open a session as the victim. Reported by maxtannahill (The Dojo Bay).
//
// Run: node --test test/

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import ecc from '@bitcoinerlab/secp256k1';
import { BIP47Factory } from '@dojo-tools/bip47';
import { networks } from '@dojo-tools/bip47/utils';
import { bitcoinMessageFactory } from '@dojo-tools/bitcoinjs-message';

const PORT = 3199;
const BASE = `http://localhost:${PORT}`;
const OUR_RESOURCE = `${BASE}/callback`;

const bip47 = BIP47Factory(ecc);
const message = bitcoinMessageFactory(ecc);

// Stand-in for a victim's wallet.
const wallet = bip47.fromSeed(Buffer.alloc(64, 42));
const paymentCode = wallet.toPaymentCodePublic().toBase58();
const notificationKey = wallet.getNotificationPrivateKey();

function signChallenge(challenge) {
  const raw = message.sign(challenge, notificationKey, true, networks.bitcoin.messagePrefix);
  return Buffer.from(raw).toString('base64');
}

// Builds a genuine proof over whatever challenge string it is handed.
function proofFor(challenge) {
  return {
    auth47_response: '1.0',
    challenge,
    signature: signChallenge(challenge),
    nym: paymentCode
  };
}

async function newChallenge() {
  const res = await fetch(`${BASE}/start-auth`);
  const body = await res.json();
  assert.ok(body.nonce, `expected a nonce, got ${JSON.stringify(body)}`);
  return body;
}

const post = (path, proof) => fetch(`${BASE}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(proof),
  redirect: 'manual'
});

let server;

before(async () => {
  server = spawn('node', ['server.js'], {
    env: { ...process.env, PORT: String(PORT), MONGODB_URI: '' },
    stdio: 'ignore'
  });
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('server did not start');
});

after(() => server?.kill());

test('accepts a proof signed for this site', async () => {
  const { nonce, expiry } = await newChallenge();
  const res = await post('/verify', proofFor(`auth47://${nonce}?e=${expiry}&r=${OUR_RESOURCE}`));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.result, 'ok');
  assert.equal(body.nym, paymentCode);
});

test('a trailing slash is still this site', async () => {
  const { nonce, expiry } = await newChallenge();
  const res = await post('/verify', proofFor(`auth47://${nonce}?e=${expiry}&r=${OUR_RESOURCE}/`));
  const body = await res.json();
  assert.equal(body.result, 'ok', 'trailing slash must not be treated as a different site');
});

test('THE RELAY: rejects a genuine proof signed for another origin', async () => {
  const { nonce, expiry } = await newChallenge();
  const relayed = proofFor(`auth47://${nonce}?e=${expiry}&r=https://evil.example/callback`);

  // The signature really is valid - that is the point of the test.
  assert.ok(message.verify(
    relayed.challenge,
    wallet.toPaymentCodePublic().getNotificationAddress(),
    relayed.signature,
    networks.bitcoin.messagePrefix
  ), 'test is meaningless unless the signature is genuine');

  const res = await post('/verify', relayed);
  const body = await res.json();
  assert.equal(body.result, 'error');
  assert.match(body.error, /different site/);

  // And no session may exist for that nonce.
  const poll = await (await fetch(`${BASE}/check-auth/${nonce}`)).json();
  assert.equal(poll.status, 'pending');
  assert.equal(poll.nym, undefined);
});

test('rejects a proof signed for a different path on the same origin', async () => {
  const { nonce, expiry } = await newChallenge();
  const res = await post('/verify', proofFor(`auth47://${nonce}?e=${expiry}&r=${BASE}/not-our-callback`));
  const body = await res.json();
  assert.equal(body.result, 'error');
  assert.match(body.error, /different site/);
});

test('rejects a challenge with no resource at all', async () => {
  const { nonce, expiry } = await newChallenge();
  const res = await post('/verify', proofFor(`auth47://${nonce}?e=${expiry}`));
  const body = await res.json();
  assert.equal(body.result, 'error');
});

test('/callback enforces the binding too', async () => {
  const { nonce, expiry } = await newChallenge();
  const res = await post('/callback', proofFor(`auth47://${nonce}?e=${expiry}&r=https://evil.example/callback`));
  assert.equal(res.status, 400, '/callback must not accept a relayed proof');

  const poll = await (await fetch(`${BASE}/check-auth/${nonce}`)).json();
  assert.equal(poll.status, 'pending');
});

test('/callback still accepts a legitimate proof', async () => {
  const { nonce, expiry } = await newChallenge();
  const res = await post('/callback', proofFor(`auth47://${nonce}?e=${expiry}&r=${OUR_RESOURCE}`));
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location') ?? '', new RegExp(`nonce=${nonce}`));
});

test('a nonce cannot be used twice', async () => {
  const { nonce, expiry } = await newChallenge();
  const proof = proofFor(`auth47://${nonce}?e=${expiry}&r=${OUR_RESOURCE}`);
  assert.equal((await (await post('/verify', proof)).json()).result, 'ok');
  const second = await (await post('/verify', proof)).json();
  assert.equal(second.result, 'error');
  assert.match(second.error, /already used/);
});
