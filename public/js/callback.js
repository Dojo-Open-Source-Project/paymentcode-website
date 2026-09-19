const NONCE_PARAM = 'nonce';
const COUNTDOWN_SECONDS = 10;

// Get nonce from URL
const urlParams = new URLSearchParams(window.location.search);
const nonce = urlParams.get(NONCE_PARAM);

if (!nonce) {
    showError('Missing nonce parameter');
} else {
    console.log('🔍 Verifying authentication for nonce:', nonce);
    startPolling();
}

function startPolling() {
    let attempts = 0;
    const maxAttempts = 20; // 10 seconds at 500ms intervals
    const pollInterval = 500;

    const poll = async () => {
        try {
            const response = await fetch(`/check-auth/${nonce}`);
            const data = await response.json();

            console.log('📊 Auth status:', data);

            if (data.status === 'verified') {
                showSuccess(data);
                return;
            }

            if (data.status === 'invalid') {
                showError('Invalid or expired authentication');
                return;
            }

            // Still pending, continue polling
            attempts++;
            if (attempts >= maxAttempts) {
                showError('Authentication timeout');
                return;
            }

            setTimeout(poll, pollInterval);

        } catch (error) {
            console.error('❌ Polling error:', error);
            showError('Failed to verify authentication');
        }
    };

    poll();
}

function showSuccess(data) {
    console.log('✅ Authentication verified:', data);

    // Hide pending, show success
    document.getElementById('pending-state').classList.add('hidden');
    document.getElementById('success-state').classList.remove('hidden');

    // Display nym name
    if (data.nym) {
        document.getElementById('nym-name').textContent = data.nym;
    }

    // Display payment code
    if (data.paymentCode) {
        document.getElementById('payment-code').textContent = data.paymentCode;
    }

    // Fetch and display avatar
    fetchPaynymAvatar(data.nym);

    // Start countdown
    startCountdown();
}

async function fetchPaynymAvatar(nym) {
    try {
        const response = await fetch('/api/paynym/lookup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nym })
        });

        if (response.ok) {
            const data = await response.json();

            // Get primary payment code for avatar
            const primaryCode = data.codes && data.codes.length > 0 
                ? data.codes[0].code 
                : null;

            if (primaryCode) {
                const avatarUrl = `/api/paynym/avatar/${primaryCode}`;
                console.log('🖼️  Avatar URL:', avatarUrl);

                const avatarImg = document.getElementById('avatar');
                avatarImg.src = avatarUrl;
                avatarImg.classList.add('show');

                // Handle avatar load error
                avatarImg.onerror = () => {
                    console.log('⚠️  Failed to load avatar');
                    avatarImg.classList.remove('show');
                };
            }

            // Update nym name if we got a better one from API
            if (data.nymName) {
                document.getElementById('nym-name').textContent = data.nymName;
            }
        }
    } catch (error) {
        console.error('❌ Failed to fetch Paynym details:', error);
    }
}

function showError(message) {
    console.error('❌ Error:', message);

    // Hide pending, show error
    document.getElementById('pending-state').classList.add('hidden');
    document.getElementById('error-state').classList.remove('hidden');
    document.getElementById('error-details').textContent = message;
}

function startCountdown() {
    let seconds = COUNTDOWN_SECONDS;
    const timerElement = document.getElementById('countdown-timer');

    const countdown = setInterval(() => {
        seconds--;
        timerElement.textContent = seconds;

        if (seconds <= 0) {
            clearInterval(countdown);
            console.log('🔄 Redirecting to /auth');
            window.location.href = '/auth';
        }
    }, 1000);
}
