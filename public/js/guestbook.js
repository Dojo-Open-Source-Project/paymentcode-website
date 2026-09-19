let currentNonce = null;
let currentAuth = null;
let pollInterval = null;

// Load messages on page load
window.addEventListener('DOMContentLoaded', () => {
    loadMessages();
});

// Load all messages
async function loadMessages() {
    try {
        console.log('🔍 Loading messages...');
        const response = await fetch('/api/guestbook/messages');
        const payload = await response.json();

        // The endpoint returns { error } rather than an array when the
        // database is down. Calling .map() on that threw an opaque
        // "messages.map is not a function" instead of explaining why.
        if (!response.ok || !Array.isArray(payload)) {
            throw new Error(payload?.error || `Request failed (${response.status})`);
        }

        const messages = payload;
        const container = document.getElementById('messages-container');

        if (messages.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon" aria-hidden="true">📝</div>
                    <div>No messages yet. Be the first to sign!</div>
                </div>
            `;
            return;
        }

        container.innerHTML = messages.map(msg => `
            <div class="message-card">
                <div class="message-header">
                    ${msg.nymAvatar 
                        ? `<img src="${escapeHtml(msg.nymAvatar)}" class="avatar" alt="${escapeHtml(msg.nymName)}" data-on-error="placeholder">
                           <div class="avatar-placeholder" style="display: none;">?</div>`
                        : `<div class="avatar-placeholder">?</div>`
                    }
                    <div class="message-meta">
                        <div class="nym-name">${escapeHtml(msg.nymName)}</div>
                        <div class="timestamp">${formatDate(msg.createdAt)}</div>
                    </div>
                </div>
                <div class="message-body">${escapeHtml(msg.message)}</div>
            </div>
        `).join('');

        console.log(`✅ Loaded ${messages.length} messages`);
    } catch (error) {
        console.error('💥 Error loading messages:', error);
        document.getElementById('messages-container').innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon" aria-hidden="true">❌</div>
                <div>Failed to load messages. Please try again.</div>
                <div class="text-muted mt-sm">${escapeHtml(error.message)}</div>
            </div>
        `;
    }
}

// Open auth modal
async function openAuthModal() {
    document.getElementById('auth-modal').classList.add('active');
    document.getElementById('auth-step-1').style.display = 'block';
    document.getElementById('auth-step-2').style.display = 'none';
    document.getElementById('qr-loading').style.display = 'block';
    document.getElementById('qr-code').style.display = 'none';
    document.getElementById('qr-tap-hint').style.display = 'none';
    document.getElementById('auth-status').className = 'auth-status pending';
    document.getElementById('auth-status').textContent = 'Waiting for wallet signature...';

    try {
        console.log('🔍 Starting authentication...');
        const response = await fetch('/start-auth');
        const data = await response.json();

        currentNonce = data.nonce;
        console.log(`✅ Generated nonce: ${currentNonce}`);

        const qrCode = document.getElementById('qr-code');
        qrCode.src = data.qr;
        qrCode.style.display = 'block';
        qrCode.onclick = () => {
            // Open auth47:// URI directly on mobile
            window.location.href = data.uri;
        };
        document.getElementById('qr-loading').style.display = 'none';
        document.getElementById('qr-tap-hint').style.display = 'block';

        // Start polling for auth status
        startPolling(data.nonce);
    } catch (error) {
        console.error('💥 Error starting auth:', error);
        document.getElementById('auth-status').className = 'auth-status error';
        document.getElementById('auth-status').textContent = 'Failed to generate QR code';
    }
}

// Start polling for auth status
function startPolling(nonce) {
    pollInterval = setInterval(async () => {
        try {
            const response = await fetch(`/check-auth/${nonce}`);
            const data = await response.json();

            if (data.status === 'verified') {
                clearInterval(pollInterval);
                currentAuth = data;
                console.log(`✅ Auth verified for ${data.nym}`);

                document.getElementById('auth-status').className = 'auth-status verified';
                document.getElementById('auth-status').textContent = '✅ Authentication successful!';

                // Show step 2
                setTimeout(() => {
                document.getElementById('auth-step-1').style.display = 'none';
                document.getElementById('auth-step-2').style.display = 'block';

                // Show nymName instead of full payment code
                const displayNym = data.nym.length > 30 
                    ? data.nym.substring(0, 30) + '...'
                    : data.nym;
                document.getElementById('verified-nym').textContent = displayNym;

                    // Setup character counter
                    const textarea = document.getElementById('message-text');
                    textarea.addEventListener('input', () => {
                        document.getElementById('char-count').textContent = textarea.value.length;
                    });
                }, 1000);
            } else if (data.status === 'invalid') {
                clearInterval(pollInterval);
                document.getElementById('auth-status').className = 'auth-status error';
                document.getElementById('auth-status').textContent = '❌ Authentication failed or expired';
            }
        } catch (error) {
            console.error('💥 Polling error:', error);
        }
    }, 2000);
}

// Close auth modal
function closeAuthModal() {
    if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
    }
    document.getElementById('auth-modal').classList.remove('active');
    currentNonce = null;
    currentAuth = null;
}

// Submit message
async function submitMessage() {
    const message = document.getElementById('message-text').value.trim();

    if (!message) {
        showError('Please enter a message');
        return;
    }

    if (!currentAuth) {
        showError('Authentication expired. Please try again.');
        return;
    }

    const submitBtn = document.getElementById('submit-btn');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="loading"></span>SUBMITTING...';

    try {
        console.log('📝 Submitting message...');
        const response = await fetch('/api/guestbook/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                nonce: currentNonce,
                message: message,
                challenge: currentAuth.challenge,
                signature: currentAuth.signature,
                nym: currentAuth.paymentCode
            })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            console.log('✅ Message submitted successfully');
            closeAuthModal();
            loadMessages(); // Reload messages
            alert('✅ Message submitted successfully!');
        } else {
            showError(data.error || 'Failed to submit message');
        }
    } catch (error) {
        console.error('💥 Submit error:', error);
        showError('Failed to submit message. Please try again.');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = 'SUBMIT MESSAGE';
    }
}

// Show error message
function showError(message) {
    const errorDiv = document.getElementById('submit-error');
    errorDiv.textContent = `❌ ${message}`;
    errorDiv.style.display = 'block';
    setTimeout(() => {
        errorDiv.style.display = 'none';
    }, 5000);
}

// Escape HTML to prevent XSS
// escapeHtml() comes from common.js.

// Format date
function formatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;

    return date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric',
        year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    });
}

console.log('✅ Guestbook initialized');
console.log('🔍 Ready for Auth47 authentication');


registerActions({
  'open-auth': () => openAuthModal(),
  'close-auth': () => closeAuthModal(),
  'submit-message': () => submitMessage()
});
