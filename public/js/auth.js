let pollInterval = null;
let currentNonce = null;
let countdownInterval = null;
let fetchedPaynymName = null;
const COUNTDOWN_SECONDS = 10;

async function startAuth() {
  const btn = document.getElementById('startAuth');
  const qrDiv = document.getElementById('qrCode');
  const status = document.getElementById('status');
  const result = document.getElementById('result');

  if (pollInterval)     { clearInterval(pollInterval);     pollInterval = null; }
  if (countdownInterval){ clearInterval(countdownInterval); countdownInterval = null; }

  btn.disabled = true;
  status.style.display = 'block';
  status.className = 'status';
  status.innerHTML = '<div class="spinner"></div> Generating...';
  qrDiv.style.display = 'none';
  result.style.display = 'none';

  try {
    const response = await fetch('/start-auth');
    const data = await response.json();

    if (data.error) throw new Error(data.error);

    currentNonce = data.nonce;

    qrDiv.innerHTML = `
      <img src="${data.qr}" alt="Auth QR Code">
      <div class="uri-display">
        <div class="uri-label">Auth47 URI:</div>
        <div class="uri-value">${data.uri}</div>
      </div>
      <div class="uri-display" style="margin-top:0.5rem;">
        <div class="uri-label">Nonce:</div>
        <div class="uri-value">${data.nonce}</div>
      </div>
      <div class="qr-tap-hint">👆 Tap QR code to open in wallet app</div>
    `;
    qrDiv.style.display = 'block';

    qrDiv.querySelector('img').onclick = () => { window.location.href = data.uri; };

    status.className = 'status pending';
    status.innerHTML = 'Waiting for wallet to scan… <div class="spinner"></div>';

    startPolling(data.nonce);

  } catch (error) {
    status.className = 'status error';
    status.innerHTML = `❌ Error: ${error.message}`;
    btn.disabled = false;
  }
}

function startPolling(nonce) {
  pollInterval = setInterval(async () => {
    try {
      const response = await fetch(`/check-auth/${nonce}`);
      const data = await response.json();

      if (data.status === 'verified') {
        clearInterval(pollInterval);
        showSuccess(data);
      } else if (data.status === 'invalid') {
        clearInterval(pollInterval);
        showError('Authentication expired or invalid');
      }
    } catch (error) {
      console.error('Poll error:', error);
    }
  }, 2000);

  setTimeout(() => {
    if (pollInterval) {
      clearInterval(pollInterval);
      showError('Authentication timeout (5 minutes)');
    }
  }, 300000);
}

function showSuccess(data) {
  const status  = document.getElementById('status');
  const result  = document.getElementById('result');
  const qrDiv   = document.getElementById('qrCode');

  qrDiv.style.display = 'none';

  status.className = 'status success';
  status.innerHTML = 'Authentication Successful!';

  result.style.display = 'block';

  if (data.nym)         document.getElementById('nym-name').textContent     = data.nym;
  if (data.paymentCode) document.getElementById('payment-code').textContent = data.paymentCode;

  fetchPaynymAvatar(data.nym);
  startCountdown();
}

const fetchPaynymAvatar = async (nym) => {
  try {
    const response = await fetch('/api/paynym/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nym })
    });

    if (response.ok) {
      const data = await response.json();

      fetchedPaynymName = data.nymName || null;

      const primaryCode = data.codes && data.codes.length > 0
        ? data.codes[0].code : null;

      if (primaryCode) {
        const avatarImg = document.getElementById('avatar');
        const placeholder = document.getElementById('avatar-placeholder');

        avatarImg.src = `/api/paynym/avatar/${primaryCode}`;
        avatarImg.onload = () => {
          placeholder.style.display = 'none';
          avatarImg.classList.add('show');
        };
        avatarImg.onerror = () => {
          // keep placeholder visible
        };
      }

      if (fetchedPaynymName) {
        document.getElementById('nym-name').textContent = fetchedPaynymName;
      }
    }
  } catch (error) {
    console.error('Failed to fetch Paynym details:', error);
  }
};

const startCountdown = () => {
  let seconds = COUNTDOWN_SECONDS;
  document.getElementById('countdown-timer').textContent = seconds;

  countdownInterval = setInterval(() => {
    seconds--;
    document.getElementById('countdown-timer').textContent = seconds;
    if (seconds <= 0) {
      clearInterval(countdownInterval);
      resetAuthUI();
    }
  }, 1000);
};

const resetAuthUI = () => {
  document.getElementById('startAuth').disabled = false;
  document.getElementById('status').style.display = 'none';
  document.getElementById('result').style.display = 'none';

  const avatarImg = document.getElementById('avatar');
  avatarImg.classList.remove('show');
  avatarImg.src = '';

  document.getElementById('avatar-placeholder').style.display = 'flex';
};

function showError(message) {
  document.getElementById('status').className = 'status error';
  document.getElementById('status').innerHTML = `❌ ${message}`;
  document.getElementById('startAuth').disabled = false;
}


// Wire declarative data-action attributes to this page's functions.
registerActions({
  'start-auth': () => startAuth()
});
