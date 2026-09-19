// Inline SVG placeholders shown when an avatar cannot be loaded. Defined here
// rather than inside an onerror attribute so the page needs no inline script.
function placeholderAvatar(size, glyph, fontSize) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
              `<rect width="${size}" height="${size}" fill="#1a241a"/>` +
              `<text x="50%" y="55%" font-size="${fontSize}" text-anchor="middle" ` +
              `dominant-baseline="middle" fill="#4ade80">${glyph}</text></svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

const AVATAR_FALLBACK_LARGE = placeholderAvatar(100, '\u{1F3AD}', 40);
const AVATAR_FALLBACK_SMALL = placeholderAvatar(60, '?', 30);

registerImageFallbacks({
  'avatar-large': (img) => { img.src = AVATAR_FALLBACK_LARGE; },
  'avatar-small': (img) => { img.src = AVATAR_FALLBACK_SMALL; }
});

// Detect if input is a nymName (rather than a payment code)
function isNymName(input) {
  const trimmed = input.trim();
  // Payment codes start with 'PM8T' and are ~116 characters
  if (trimmed.startsWith('PM8T') && trimmed.length > 80) {
    return false; // Looks like a payment code
  }
  // NymNames: start with + or are short alphanumeric strings
  if (trimmed.startsWith('+')) return true;
  // Also accept nymNames without the + prefix
  if (/^[a-zA-Z0-9]+$/.test(trimmed) && trimmed.length < 50 && !trimmed.startsWith('PM')) {
    return true;
  }
  return false;
}

async function searchPaynym() {
  const input = document.getElementById('searchInput');
  const btn = document.getElementById('searchBtn');
  const resultsContainer = document.getElementById('resultsContainer');
  const emptyState = document.getElementById('emptyState');

  let query = input.value.trim();
  if (!query) return;

  // Normalize nymName: ensure + prefix for API
  if (isNymName(query) && !query.startsWith('+')) {
    query = '+' + query;
    console.log(`🔍 Normalized nymName: ${input.value.trim()} → ${query}`);
  }

  // Show loading state
  btn.disabled = true;
  btn.textContent = 'SEARCHING...';
  emptyState.style.display = 'none';
  resultsContainer.classList.add('visible');
  resultsContainer.innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <div class="loading-text">Searching Paynym database...</div>
    </div>
  `;

  try {
    const response = await fetch('/api/paynym/lookup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ nym: query })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Paynym not found');
    }

    displayResults(data);
  } catch (error) {
    resultsContainer.innerHTML = `
      <div class="error">
        <div class="error-icon" aria-hidden="true">❌</div>
        <div>${error.message}</div>
      </div>
    `;
  } finally {
    btn.disabled = false;
    btn.textContent = 'SEARCH';
  }
}

// Store current data for toggle functionality
let currentFollowers = [];
let currentFollowing = [];
let currentDisplayMode = 'followers'; // 'followers' or 'following'

async function displayResults(data) {
  const resultsContainer = document.getElementById('resultsContainer');

  // Calculate total stats
  const totalFollowing = data.following ? data.following.length : 0;
  const totalFollowers = data.followers ? data.followers.length : 0;
  const totalCodes = data.codes ? data.codes.length : 0;

  // Use first code for avatar
  const primaryCode = data.codes && data.codes.length > 0 ? data.codes[0].code : '';
  const avatarUrl = primaryCode ? `/api/paynym/avatar/${primaryCode}` : '';

  // Build payment codes HTML with copy and QR buttons
  const codesHtml = data.codes.map((code, index) => `
    <div class="code-item">
      <div class="code-header">
        <span class="code-label">Payment Code</span>
        <span class="code-status ${code.claimed ? 'status-claimed' : 'status-unclaimed'}">
          ${code.claimed ? 'CLAIMED' : 'UNCLAIMED'}
        </span>
      </div>
      <div class="code-value" id="code-${index}">${escapeHtml(code.code)}</div>
      <div class="code-actions">
        <button class="copy-btn" data-action="copy" data-code="${escapeHtml(code.code)}">
          📋 Copy
        </button>
        <button class="qr-toggle-btn" data-action="toggle-qr" data-code="${escapeHtml(code.code)}" data-qr-target="qr-${index}">
          📱 QR Code
        </button>
      </div>
      <div id="qr-${index}" class="qr-container"></div>
      ${code.segwit ? '<span class="segwit-badge" title="Segwit payment codes use bech32 encoding for lower transaction fees. Legacy codes use base58. Both work, but segwit is recommended for new payments.">⚡ SEGWIT ENABLED</span>' : ''}
    </div>
  `).join('');

  // Build social section (no tabs, stat boxes handle navigation)
  let socialHtml = '';
  if (totalFollowers > 0 || totalFollowing > 0) {
    socialHtml = `
      <div class="followers-section">
        <div id="socialGrid" class="followers-grid">
          <div class="followers-loading">
            <div class="spinner"></div>
            <div>Loading...</div>
          </div>
        </div>
        <div id="expandedContent" class="expanded-content"></div>
        <button id="expandBtn" class="expand-btn" style="display: none;" data-action="toggle-expanded">Show all</button>
      </div>
    `;
  }

  resultsContainer.innerHTML = `
    <div class="result-card">
      <div class="result-header">
        <div class="avatar-container">
          <img src="${escapeHtml(avatarUrl)}" alt="Paynym Avatar" data-on-error="avatar-large">
        </div>
        <div class="result-info">
          <div class="nym-name">${escapeHtml(data.nymName || 'Unknown')}</div>
          <div class="nym-id">${escapeHtml(data.nymID)}</div>
        </div>
      </div>

      <div class="stats-grid">
        <div class="stat-box" id="stat-codes" data-action="scroll-to-codes">
          <div class="stat-value">${totalCodes}</div>
          <div class="stat-label">Payment Codes</div>
        </div>
        <div class="stat-box" id="stat-followers" data-action="switch-tab" data-tab="followers">
          <div class="stat-value">${totalFollowers}</div>
          <div class="stat-label">Followers</div>
        </div>
        <div class="stat-box" id="stat-following" data-action="switch-tab" data-tab="following">
          <div class="stat-value">${totalFollowing}</div>
          <div class="stat-label">Following</div>
        </div>
      </div>

      ${socialHtml}

      <div class="codes-section">
        <div class="section-title">Payment Codes</div>
        ${codesHtml}
      </div>
    </div>
  `;

  // Store data for toggling
  currentFollowers = data.followers || [];
  currentFollowing = data.following || [];

  // Load initial tab
  await loadSocialTab(currentDisplayMode);
}

async function switchTab(mode) {
  currentDisplayMode = mode;

  // Update stat box active states
  document.querySelectorAll('.stat-box').forEach(box => box.classList.remove('active'));
  document.getElementById(`stat-${mode}`).classList.add('active');

  // Load the tab content
  await loadSocialTab(mode);
}

function scrollToCodes() {
  const codesSection = document.querySelector('.codes-section');
  if (codesSection) {
    codesSection.scrollIntoView({ behavior: 'smooth' });
  }
}

async function loadSocialTab(mode) {
  const grid = document.getElementById('socialGrid');
  const expandBtn = document.getElementById('expandBtn');
  const expandedContent = document.getElementById('expandedContent');

  // Hide expanded content when switching
  expandedContent.classList.remove('visible');

  const items = mode === 'followers' ? currentFollowers : currentFollowing;
  const total = items.length;

  if (total === 0) {
    grid.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: var(--space-lg);">No ${mode} yet</div>`;
    expandBtn.style.display = 'none';
    return;
  }

  grid.innerHTML = `
    <div class="followers-loading">
      <div class="spinner"></div>
      <div>Loading ${mode}...</div>
    </div>
  `;

  try {
    const nymIds = items.map(f => f.nymId);
    const response = await fetch('/api/paynym/followers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nymIds: nymIds.slice(0, 6) })
    });

    const details = await response.json();

    // Display first 6
    grid.innerHTML = buildFollowersCards(details);

    // Setup expand button if needed
    if (total > 6) {
      expandBtn.style.display = 'block';
      expandBtn.textContent = `Show all ${total} ${mode}`;
      expandBtn.onclick = () => toggleExpanded(mode, nymIds);

      // Prepare expanded content
      const remainingResponse = await fetch('/api/paynym/followers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nymIds: nymIds.slice(6) })
      });
      const remainingDetails = await remainingResponse.json();
      expandedContent.innerHTML = `<div class="followers-grid">${buildFollowersCards(remainingDetails)}</div>`;
    } else {
      expandBtn.style.display = 'none';
      expandedContent.innerHTML = '';
    }
  } catch (error) {
    console.error(`Error loading ${mode}:`, error);
    grid.innerHTML = `<div style="color: #ff4444; text-align: center;">Failed to load ${mode}</div>`;
  }
}

function toggleExpanded(mode, nymIds) {
  const expandedContent = document.getElementById('expandedContent');
  const expandBtn = document.getElementById('expandBtn');
  const items = mode === 'followers' ? currentFollowers : currentFollowing;

  if (expandedContent.classList.contains('visible')) {
    expandedContent.classList.remove('visible');
    expandBtn.textContent = `Show all ${items.length} ${mode}`;
  } else {
    expandedContent.classList.add('visible');
    expandBtn.textContent = `Show fewer ${mode}`;
  }
}

async function copyToClipboard(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    const originalText = btn.innerHTML;
    btn.innerHTML = '✓ Copied!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.innerHTML = originalText;
      btn.classList.remove('copied');
    }, 2000);
  } catch (err) {
    console.error('Failed to copy:', err);
    btn.innerHTML = '❌ Failed';
    setTimeout(() => {
      btn.innerHTML = '📋 Copy';
    }, 2000);
  }
}

async function toggleQR(paymentCode, containerId) {
  const container = document.getElementById(containerId);

  if (container.classList.contains('visible')) {
    container.classList.remove('visible');
    container.innerHTML = '';
  } else {
    container.innerHTML = '<div class="spinner" style="width: 30px; height: 30px;"></div>';
    container.classList.add('visible');

    try {
      const response = await fetch(`/api/qr?text=${encodeURIComponent(paymentCode)}`);
      const data = await response.json();

      if (data.qr) {
        container.innerHTML = `<img src="${data.qr}" alt="Payment Code QR">`;
      } else {
        container.innerHTML = '<div style="color: #ff4444;">Failed to generate QR</div>';
      }
    } catch (error) {
      console.error('QR generation error:', error);
      container.innerHTML = '<div style="color: #ff4444;">Failed to generate QR</div>';
    }
  }
}

async function fetchFollowerDetails(followers) {
  const nymIds = followers.map(f => f.nymId);

  try {
    const response = await fetch('/api/paynym/followers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ nymIds })
    });

    const followerDetails = await response.json();
    currentFollowers = followerDetails;

    // Display first 6 followers
    displayFollowersGrid(followerDetails.slice(0, 6));

    // Prepare expanded content with all followers
    if (followerDetails.length > 6) {
      const expandedGrid = document.getElementById('expandedContent');
      expandedGrid.innerHTML = `<div class="followers-grid">${buildFollowersCards(followerDetails.slice(6))}</div>`;
    }
  } catch (error) {
    console.error('Error fetching follower details:', error);
    const grid = document.getElementById('followersGrid');
    if (grid) {
      grid.innerHTML = '<div style="color: #ff4444; text-align: center;">Failed to load followers</div>';
    }
  }
}

function buildFollowersCards(followers) {
  return followers.map(follower => `
    <div class="follower-card" data-action="search-follower" data-nym="${escapeHtml(follower.primaryCode || follower.nymName)}">
      <div class="follower-avatar">
        <img src="${escapeHtml(follower.avatarUrl || AVATAR_FALLBACK_SMALL)}"
             alt="${escapeHtml(follower.nymName)}"
             data-on-error="avatar-small">
      </div>
      <div class="follower-name">${escapeHtml(follower.nymName)}</div>
      <div class="follower-id">${escapeHtml(follower.nymId.substring(0, 10))}...</div>
    </div>
  `).join('');
}

function displayFollowersGrid(followers) {
  const grid = document.getElementById('followersGrid');
  if (grid) {
    grid.innerHTML = buildFollowersCards(followers);
  }
}

function toggleFollowers() {
  const expandedContent = document.getElementById('expandedContent');
  const expandBtn = document.getElementById('expandBtn');

  if (expandedContent.classList.contains('visible')) {
    expandedContent.classList.remove('visible');
    expandBtn.textContent = `Show all ${currentFollowers.length} followers`;
  } else {
    expandedContent.classList.add('visible');
    expandBtn.textContent = 'Show fewer followers';
  }
}

function searchFollower(nymId) {
  document.getElementById('searchInput').value = nymId;
  searchPaynym();
}


registerActions({
  'search': () => searchPaynym(),
  'copy': (el) => copyToClipboard(el.dataset.code, el),
  'toggle-qr': (el) => toggleQR(el.dataset.code, el.dataset.qrTarget),
  'toggle-expanded': () => toggleExpanded(),
  'scroll-to-codes': () => scrollToCodes(),
  'switch-tab': (el) => switchTab(el.dataset.tab),
  'search-follower': (el) => searchFollower(el.dataset.nym)
});
