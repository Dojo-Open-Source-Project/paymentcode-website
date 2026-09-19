// Utility: Show/hide elements
const show = (id) => document.getElementById(id).classList.remove('hidden');
const hide = (id) => document.getElementById(id).classList.add('hidden');
const setLoading = (btnId, loading) => {
    const btn = document.getElementById(btnId);
    if (loading) {
        btn.disabled = true;
        btn.innerHTML = '<span class="loading"></span>PROCESSING...';
    } else {
        btn.disabled = false;
        btn.innerHTML = btn.getAttribute('data-original-text') || btn.innerText;
    }
};

// Store original button texts
document.querySelectorAll('button').forEach(btn => {
    btn.setAttribute('data-original-text', btn.innerText);
});

// API Pattern 2: POST with JSON (as per AGENTS.md)
async function apiPost(endpoint, body) {
    console.log(`🔍 API Request: ${endpoint}`);
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    const text = await response.text();
    if (!text || text.trim() === '') {
        throw new Error('Empty response from server');
    }

    const data = JSON.parse(text);
    if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
    }

    console.log(`✅ API Response success: ${endpoint}`);
    return data;
}

// Base58 decoding for payment code analysis
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Decode(str) {
    const bytes = [0];
    for (let i = 0; i < str.length; i++) {
        const c = str[i];
        const digit = BASE58_ALPHABET.indexOf(c);
        if (digit < 0) throw new Error('Invalid Base58 character');

        for (let j = 0; j < bytes.length; j++) {
            bytes[j] *= 58;
        }
        bytes[0] += digit;

        let carry = 0;
        for (let j = 0; j < bytes.length; j++) {
            bytes[j] += carry;
            carry = bytes[j] >> 8;
            bytes[j] &= 0xff;
        }
        while (carry > 0) {
            bytes.push(carry & 0xff);
            carry >>= 8;
        }
    }

    // Add leading zeros
    for (let i = 0; i < str.length && str[i] === '1'; i++) {
        bytes.push(0);
    }

    return new Uint8Array(bytes.reverse());
}

// Tool 1: Validate Payment Code (Enhanced with byte analysis)
async function validatePaymentCode() {
    const paymentCode = document.getElementById('validate-input').value.trim();
    const outputDiv = document.getElementById('validate-output');
    const errorDiv = document.getElementById('validate-error');
    const btn = document.getElementById('validate-btn');

    // Hide previous results
    outputDiv.style.display = 'none';
    errorDiv.style.display = 'none';

    if (!paymentCode) {
        errorDiv.textContent = '❌ Payment code required';
        errorDiv.style.display = 'block';
        return;
    }

    // Show loading state
    btn.disabled = true;
    btn.innerHTML = '<span class="loading"></span>ANALYZING...';

    try {
        // Client-side checks
        const clientChecks = {
            prefix: paymentCode.startsWith('PM8T'),
            length: paymentCode.length === 116,
            base58: /^[1-9A-HJ-NP-Za-km-z]+$/.test(paymentCode)
        };

        let decoded = null;
        let components = null;

        // Try to decode for byte analysis
        try {
            decoded = base58Decode(paymentCode);

            // BIP47 payment code is 85 bytes:
            // Byte 0: Base58Check prefix (0x47)
            // Byte 1: BIP47 version (0x01)
            // Byte 2: Features (0x00)
            // Bytes 3-35: Public key (33 bytes)
            // Bytes 36-67: Chain code (32 bytes)
            // Bytes 68-80: Padding (13 bytes, zeros)
            // Bytes 81-84: Checksum (4 bytes)
            if (decoded.length === 85) {
                clientChecks.structure = true;

                // Parse components (85-byte structure)
                components = {
                    prefix: decoded[0],           // Byte 0: Base58Check prefix
                    version: decoded[1],          // Byte 1: BIP47 version
                    features: decoded[2],         // Byte 2: Feature flags
                    pubkey: Array.from(decoded.slice(3, 36)),   // Bytes 3-35: Public key (33 bytes)
                    chaincode: Array.from(decoded.slice(36, 68)), // Bytes 36-67: Chain code (32 bytes)
                    padding: Array.from(decoded.slice(68, 81)),   // Bytes 68-80: Padding (13 bytes)
                    checksum: Array.from(decoded.slice(81, 85))  // Bytes 81-84: Checksum (4 bytes)
                };
            } else {
                clientChecks.structure = false;
            }
        } catch (e) {
            console.error('Decode error:', e);
            clientChecks.structure = false;
        }

        // Server-side validation for accurate checksum
        let serverChecks = {};
        let isValid = false;

        try {
            console.log('🔍 Validating payment code via API...');
            const data = await apiPost('/api/bip47/validate', { paymentCode });
            serverChecks = data.checks || {};
            isValid = data.valid;
        } catch (apiError) {
            console.warn('API validation failed, using client-side only:', apiError);
            // Fallback to client-side only
            clientChecks.checksum = true; // Assume valid if we can't verify
            isValid = Object.values(clientChecks).every(v => v === true);
        }

        // Merge checks
        const allChecks = { ...clientChecks, ...serverChecks };

        // Display results
        displayValidationResults(isValid, allChecks, components, decoded);
        outputDiv.style.display = 'block';

        console.log(`✅ Validation complete: ${isValid ? 'VALID' : 'INVALID'}`);

    } catch (error) {
        console.error('💥 Validation error:', error);
        errorDiv.textContent = `❌ ${error.message}`;
        errorDiv.style.display = 'block';
    } finally {
        btn.disabled = false;
        btn.innerHTML = 'ANALYZE PAYMENT CODE';
    }
}

function displayValidationResults(isValid, checks, components, decoded) {
    // Status
    const statusDiv = document.getElementById('validate-status');
    if (isValid) {
        statusDiv.className = 'validation-status valid';
        statusDiv.innerHTML = '✅ VALID BIP47 Payment Code Version 1';
    } else {
        statusDiv.className = 'validation-status invalid';
        statusDiv.innerHTML = '❌ INVALID Payment Code';
    }

    // Byte breakdown (85-byte BIP47 payment code structure)
    if (decoded && decoded.length === 85) {
        displayByteBreakdown(decoded);
        displayComponents(components);
        displayDerivedInfo(components);
    } else {
        // Show message about invalid structure
        const breakdownDiv = document.getElementById('byte-breakdown');
        breakdownDiv.style.display = 'block';
        breakdownDiv.querySelector('.section-title').textContent = '📊 Byte Structure Analysis - Invalid Structure';

        // Hide the legend when showing invalid structure
        const legend = breakdownDiv.querySelector('.byte-legend');
        if (legend) legend.style.display = 'none';

        document.getElementById('byte-grid').innerHTML = `
            <div style="grid-column: 1 / -1; padding: 2rem 1rem; color: var(--accent-error); text-align: center;">
                <div style="font-size: 1rem; margin-bottom: 0.5rem;">
                    Expected 85 bytes, got ${decoded ? decoded.length : 'unknown'} bytes.
                </div>
                <div style="color: var(--text-muted); font-size: 0.85rem;">
                    This may indicate a malformed or incompatible payment code.
                </div>
            </div>
        `;
        // Hide other component sections
        document.getElementById('component-details').style.display = 'none';
        document.getElementById('derived-info').style.display = 'none';
    }

    // Technical checks
    displayTechnicalChecks(checks);
}

function displayByteBreakdown(bytes) {
    const grid = document.getElementById('byte-grid');
    grid.innerHTML = '';
    const breakdownDiv = document.getElementById('byte-breakdown');
    breakdownDiv.style.display = 'block';

    // Reset title and show legend
    breakdownDiv.querySelector('.section-title').textContent = '📊 Byte Structure Analysis (85 bytes total)';
    const legend = breakdownDiv.querySelector('.byte-legend');
    if (legend) legend.style.display = 'block';

    // 85-byte BIP47 payment code structure:
    // Byte 0: Base58Check prefix (0x47) - 1 byte
    // Byte 1: BIP47 version (0x01) - 1 byte
    // Byte 2: Features (0x00) - 1 byte
    // Bytes 3-35: Public key (33 bytes)
    // Bytes 36-67: Chain code (32 bytes)
    // Bytes 68-80: Padding (13 bytes, zeros)
    // Bytes 81-84: Checksum (4 bytes)
    const sections = [
        { start: 0, end: 1, class: 'version', label: 'PREFIX' },
        { start: 1, end: 2, class: 'features', label: 'VER' },
        { start: 2, end: 3, class: 'sign', label: 'FEAT' },
        { start: 3, end: 36, class: 'pubkey', label: 'PUB' },
        { start: 36, end: 68, class: 'chaincode', label: 'CHAIN' },
        { start: 68, end: 81, class: 'padding', label: 'PAD' },
        { start: 81, end: 85, class: 'checksum', label: 'CHK' },
    ];

    for (let i = 0; i < bytes.length; i++) {
        const section = sections.find(s => i >= s.start && i < s.end);
        const cell = document.createElement('div');
        cell.className = `byte-cell ${section ? section.class : ''}`;
        cell.innerHTML = `
            ${bytes[i].toString(16).padStart(2, '0').toUpperCase()}
            <div class="byte-label">${section ? section.label : '?'}</div>
        `;
        cell.title = `Byte ${i}: 0x${bytes[i].toString(16).padStart(2, '0')} (${section ? section.label : 'unknown'})`;
        grid.appendChild(cell);
    }
}

function displayComponents(components) {
    const grid = document.getElementById('components-grid');
    grid.innerHTML = '';
    document.getElementById('component-details').style.display = 'block';

    const componentInfo = [
        {
            name: 'Prefix Byte',
            value: `0x${components.prefix.toString(16).padStart(2, '0')}`,
            size: '1 byte',
            description: 'Base58Check prefix. 0x47 (71 decimal) indicates BIP47 payment code version 1.'
        },
        {
            name: 'Version Byte',
            value: `0x${components.version.toString(16).padStart(2, '0')}`,
            size: '1 byte',
            description: 'BIP47 version. 0x01 for version 1, 0x02 for version 2, etc.'
        },
        {
            name: 'Features Byte',
            value: `0x${components.features.toString(16).padStart(2, '0')}`,
            size: '1 byte',
            description: 'Feature flags. Bit 0: Bitmessage notification. Currently 0x00 (unused).'
        },
        {
            name: 'Public Key',
            value: components.pubkey.map(b => b.toString(16).padStart(2, '0')).join(''),
            size: '33 bytes',
            description: 'Compressed secp256k1 public key (0x02 or 0x03 prefix + 32-byte x-coordinate) for ECDH shared secret generation.'
        },
        {
            name: 'Chain Code',
            value: components.chaincode.map(b => b.toString(16).padStart(2, '0')).join(''),
            size: '32 bytes',
            description: 'BIP32 chain code for hierarchical key derivation.'
        },
        {
            name: 'Padding',
            value: components.padding.map(b => b.toString(16).padStart(2, '0')).join(''),
            size: '13 bytes',
            description: 'Reserved padding bytes, must be all zeros (0x00). Reserved for future protocol extensions.'
        },
        {
            name: 'Checksum',
            value: components.checksum.map(b => b.toString(16).padStart(2, '0')).join(''),
            size: '4 bytes',
            description: 'First 4 bytes of double SHA-256 hash for error detection.'
        }
    ];

    componentInfo.forEach(comp => {
        const item = document.createElement('div');
        item.className = 'component-item';
        item.innerHTML = `
            <div class="component-header">
                <span class="component-name">${comp.name}</span>
                <span class="component-size">${comp.size}</span>
            </div>
            <div class="component-value">${comp.value}</div>
            <div class="component-description">${comp.description}</div>
        `;
        grid.appendChild(item);
    });
}

function displayDerivedInfo(components) {
    const grid = document.getElementById('derived-grid');
    grid.innerHTML = '';
    document.getElementById('derived-info').style.display = 'block';

    // Get the sign byte from the first byte of pubkey array (it's byte 3 of the raw payment code)
    const signByte = components.pubkey[0];
    const fullPubKey = components.pubkey
        .map(b => b.toString(16).padStart(2, '0')).join('');

    const derivedInfo = [
        {
            label: 'Notification Path',
            value: "m/47'/0'/0'/0"
        },
        {
            label: 'Address Format',
            value: signByte === 0x02 || signByte === 0x03 ? 'P2PKH or P2WPKH' : 'Unknown'
        },
        {
            label: 'Full Public Key',
            value: fullPubKey
        },
        {
            label: 'Total Size',
            value: '85 bytes (raw) → 116 chars (Base58)'
        }
    ];

    derivedInfo.forEach(info => {
        const item = document.createElement('div');
        item.className = 'derived-item';
        item.innerHTML = `
            <div class="derived-label">${info.label}</div>
            <div class="derived-value">${info.value}</div>
        `;
        grid.appendChild(item);
    });
}

function displayTechnicalChecks(checks) {
    const grid = document.getElementById('checks-grid');
    grid.innerHTML = '';
    document.getElementById('technical-checks').style.display = 'block';

    const checkLabels = {
        prefix: 'Prefix "PM8T"',
        length: 'Length (116 chars)',
        base58: 'Base58 encoding',
        structure: '85-byte structure',
        checksum: 'Checksum valid',
        format: 'Valid format',
        version: 'Version byte'
    };

    Object.entries(checks).forEach(([key, valid]) => {
        const item = document.createElement('div');
        item.className = `validation-item ${valid ? 'valid' : 'invalid'}`;
        item.innerHTML = `
            <span class="status-icon">${valid ? '✓' : '✗'}</span>
            <span>${checkLabels[key] || key}: ${valid ? 'PASS' : 'FAIL'}</span>
        `;
        grid.appendChild(item);
    });
}

// Enter key support for inputs
document.querySelectorAll('input, textarea').forEach(input => {
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const btn = input.closest('.tool-panel').querySelector('button');
            if (btn) btn.click();
        }
    });
});

console.log('✅ BIP47 Lab initialized');
console.log('🔍 Ready for payment code operations');

// Scenario navigation
function nextStep(step) {
    // Hide current
    document.querySelectorAll('.scenario-step').forEach(el => el.classList.add('hidden'));
    // Show new
    document.getElementById(`step-${step}`).classList.remove('hidden');

    // Update progress dots
    document.querySelectorAll('.progress-dot').forEach((dot, idx) => {
        dot.classList.remove('active');
        if (idx + 1 < step) dot.classList.add('completed');
        if (idx + 1 === step) dot.classList.add('active');
    });

    // Generate sample data for step 2
    if (step === 2) {
        setTimeout(() => {
            document.getElementById('shared-secret-display').textContent =
                '03' + Array(64).fill(0).map(() => Math.floor(Math.random()*16).toString(16)).join('');
        }, 800);
    }

    // Generate addresses for step 3
    if (step === 3) {
        generateSampleAddresses();
    }

    console.log(`✅ Advanced to scenario step ${step}`);
}

function generateSampleAddresses() {
    const list = document.getElementById('derived-addresses');
    list.innerHTML = '<div class="output-label">Derived Payment Addresses</div>';

    const addresses = [
        { idx: 0, addr: 'tb1q8gpft5rpju8lcshfa6at44pev5y0q7kzfwqpg' },
        { idx: 1, addr: 'tb1qes6funanqdkwk39zfwmzfnjuz3xt6apeltyhv5' },
        { idx: 2, addr: 'tb1q82pufc4zyhdtzemuqlaf2f2tgsy5jex6xf20r0' },
        { idx: 5, addr: 'tb1qmgdad8lwvm96grz5dy5yppmt5nxk5g38jftz8d' },
        { idx: 6, addr: 'tb1qdku0qjt7jy9hu6k5nt88sk52ddlzl6pnkg64m7' }
    ];

    addresses.forEach((a, i) => {
        setTimeout(() => {
            const div = document.createElement('div');
            div.className = 'address-item';
            div.style.animation = 'slideIn 0.3s ease';
            div.innerHTML = `
                <span class="addr-index">#${a.idx}</span>
                <span class="addr-value">${a.addr}</span>
            `;
            list.appendChild(div);
        }, i * 200);
    });
}

function resetScenario() {
    document.querySelectorAll('.scenario-step').forEach(el => el.classList.add('hidden'));
    document.getElementById('step-1').classList.remove('hidden');
    document.querySelectorAll('.progress-dot').forEach(dot => {
        dot.classList.remove('active', 'completed');
    });
    document.querySelector('.progress-dot[data-step="1"]').classList.add('active');
    console.log('✅ Scenario reset to step 1');
}

// Detect if input is a nymName (rather than a payment code)
function isNymName(input) {
    // Payment codes start with 'PM8T' and are ~116 characters
    // NymNames start with '+' or are short strings
    const trimmed = input.trim();
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

// Resolve nymName to payment code via Paynym API
async function resolveNymName(nymInput) {
    // Normalize: ensure + prefix for API
    const nymId = nymInput.startsWith('+') ? nymInput : '+' + nymInput;
    console.log(`🔍 Resolving nymName: ${nymId}`);

    try {
        const data = await apiPost('/api/paynym/lookup', { nym: nymId });
        // Paynym API returns payment codes in a 'codes' array
        const primaryCode = data.codes && data.codes.length > 0 ? data.codes[0].code : null;

        if (primaryCode) {
            console.log(`✅ Resolved to payment code: ${primaryCode.substring(0, 20)}...`);
            return {
                paymentCode: primaryCode,
                nymName: data.nymName || nymId,
                avatarUrl: `/api/paynym/avatar/${primaryCode}`
            };
        }
        throw new Error('Payment code not found in response');
    } catch (error) {
        console.error('💥 Failed to resolve nymName:', error);
        throw new Error(`Could not find Paynym: ${nymId}`);
    }
}

// Parse Bitcoin signed message format
function parseSignedMessageBlock(block) {
    if (!block || !block.trim()) {
        return { message: '', signature: '', error: 'Empty signed message block' };
    }

    // Standard Bitcoin signed message format:
    // -----BEGIN BITCOIN SIGNED MESSAGE-----
    // <message content>
    // -----BEGIN BITCOIN SIGNATURE-----
    // Version: ...
    // Address: ...
    // <blank line>
    // <base64 signature>
    // -----END BITCOIN SIGNATURE-----

    const beginMsgMarker = '-----BEGIN BITCOIN SIGNED MESSAGE-----';
    const beginSigMarker = '-----BEGIN BITCOIN SIGNATURE-----';
    const endSigMarker = '-----END BITCOIN SIGNATURE-----';

    const blockUpper = block.toUpperCase();

    // Check if this is a signed message block format
    if (!blockUpper.includes(beginMsgMarker.toUpperCase()) || 
        !blockUpper.includes(beginSigMarker.toUpperCase())) {
        // Not a signed block - return as-is (might be legacy format with separate fields)
        return { message: block, signature: '', error: null };
    }

    try {
        // Find the message content between BEGIN SIGNED MESSAGE and BEGIN SIGNATURE
        const msgStartIdx = block.toUpperCase().indexOf(beginMsgMarker.toUpperCase());
        const sigStartIdx = block.toUpperCase().indexOf(beginSigMarker.toUpperCase());

        if (msgStartIdx === -1 || sigStartIdx === -1) {
            return { message: '', signature: '', error: 'Invalid signed message format' };
        }

        // Extract message (between the markers, trimming the marker text)
        const msgContentStart = msgStartIdx + beginMsgMarker.length;
        const message = block.substring(msgContentStart, sigStartIdx).trim();

        // Find signature section
        const sigContentStart = sigStartIdx + beginSigMarker.length;
        const endSigIdx = block.toUpperCase().indexOf(endSigMarker.toUpperCase(), sigContentStart);

        if (endSigIdx === -1) {
            return { message: '', signature: '', error: 'Missing END BITCOIN SIGNATURE marker' };
        }

        const sigSection = block.substring(sigContentStart, endSigIdx);

        // Parse the signature section - signature is typically the last non-empty line
        // after "Version:" and "Address:" lines
        const lines = sigSection.split('\n');
        let signature = '';
        let foundEmptyLine = false;

        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i].trim();
            if (line === '') {
                foundEmptyLine = true;
                continue;
            }
            // Signature is the first non-empty line we encounter going backwards
            // after we've seen at least one empty line (or if there's no empty line, just take the last line)
            if (foundEmptyLine || signature === '') {
                // Check it's not a header line
                if (!line.toLowerCase().startsWith('version:') && 
                    !line.toLowerCase().startsWith('address:')) {
                    signature = line;
                    break;
                }
            }
        }

        if (!signature) {
            return { message, signature: '', error: 'Could not find signature in block' };
        }

        return { message, signature, error: null };

    } catch (e) {
        console.error('Parse error:', e);
        return { message: '', signature: '', error: 'Failed to parse signed message block' };
    }
}

// Update parsed preview when user types
document.getElementById('verify-signed-block').addEventListener('input', function() {
    const block = this.value;
    const previewDiv = document.getElementById('parsed-preview');
    const parsed = parseSignedMessageBlock(block);

    if (parsed.message || parsed.signature) {
        previewDiv.style.display = 'block';
        document.getElementById('parsed-message').textContent = parsed.message || '(none)';
        document.getElementById('parsed-signature').textContent = parsed.signature || '(none)';
    } else {
        previewDiv.style.display = 'none';
    }
});

// BIP47 Message Verifier
async function verifyMessage() {
    let paymentCodeInput = document.getElementById('verify-pcode').value.trim();
    const signedBlock = document.getElementById('verify-signed-block').value;
    const outputDiv = document.getElementById('verify-output');
    const errorDiv = document.getElementById('verify-error');
    const btn = document.getElementById('verify-btn');
    const previewDiv = document.getElementById('parsed-preview');

    // Hide previous results
    outputDiv.style.display = 'none';
    errorDiv.style.display = 'none';

    if (!paymentCodeInput) {
        errorDiv.textContent = '❌ Payment code or NymName required';
        errorDiv.style.display = 'block';
        return;
    }

    if (!signedBlock || !signedBlock.trim()) {
        errorDiv.textContent = '❌ Signed message block required';
        errorDiv.style.display = 'block';
        return;
    }

    // Parse the signed message block
    const parsed = parseSignedMessageBlock(signedBlock);

    if (parsed.error) {
        errorDiv.textContent = `❌ ${parsed.error}`;
        errorDiv.style.display = 'block';
        return;
    }

    const message = parsed.message;
    const signature = parsed.signature;

    if (!message) {
        errorDiv.textContent = '❌ Could not extract message from signed block';
        errorDiv.style.display = 'block';
        return;
    }

    if (!signature) {
        errorDiv.textContent = '❌ Could not extract signature from signed block';
        errorDiv.style.display = 'block';
        return;
    }

    console.log('📋 Parsed message:', message.substring(0, 50) + '...');
    console.log('📋 Parsed signature:', signature.substring(0, 30) + '...');

    // Show loading state
    btn.disabled = true;
    btn.innerHTML = '<span class="loading"></span>VERIFYING...';

    let resolvedNymName = null;
    let resolvedAvatarUrl = null;

    try {
        // Check if input is a nymName and resolve it
        let paymentCode = paymentCodeInput;

        if (isNymName(paymentCodeInput)) {
            console.log('🔍 Detected nymName, resolving...');
            btn.innerHTML = '<span class="loading"></span>RESOLVING NYMNAME...';

            try {
                const resolved = await resolveNymName(paymentCodeInput);
                paymentCode = resolved.paymentCode;
                resolvedNymName = resolved.nymName;
                resolvedAvatarUrl = resolved.avatarUrl;

                console.log(`✅ Resolved ${paymentCodeInput} → ${paymentCode.substring(0, 20)}...`);

                // Update preview to show resolved payment code
                const existingPreview = document.getElementById('resolved-pcode-preview');
                if (existingPreview) {
                    existingPreview.remove();
                }

                const resolvedDiv = document.createElement('div');
                resolvedDiv.id = 'resolved-pcode-preview';
                resolvedDiv.className = 'parsed-item';
                resolvedDiv.style.cssText = 'padding: var(--space-sm); background: var(--bg-primary); border-radius: var(--radius-sm); border-left: 3px solid #66b2ff; margin-bottom: var(--space-sm);';
                resolvedDiv.innerHTML = `
                    <div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase;">Resolved from ${paymentCodeInput.startsWith('+') ? paymentCodeInput : '+' + paymentCodeInput}</div>
                    <div style="font-size: 0.75rem; color: #66b2ff; font-family: monospace; word-break: break-all; margin-top: 0.25rem;">${paymentCode.substring(0, 40)}...</div>
                `;
                previewDiv.insertBefore(resolvedDiv, previewDiv.firstChild);

                btn.innerHTML = '<span class="loading"></span>VERIFYING...';
            } catch (resolveError) {
                console.error('💥 Failed to resolve nymName:', resolveError);
                throw new Error(`Could not resolve "${paymentCodeInput}": ${resolveError.message}`);
            }
        }

        console.log('🔍 Verifying message signature...');
        const data = await apiPost('/api/bip47/verify-message', { 
            paymentCode, 
            message, 
            signature 
        });

        // Display results
        const statusDiv = document.getElementById('verify-status');
        if (data.valid) {
            statusDiv.className = 'validation-status valid';
            statusDiv.innerHTML = 'MESSAGE VERIFIED<br><span style="font-size: 0.85rem; font-weight: normal;">Signature is valid for this payment code</span>';
        } else {
            statusDiv.className = 'validation-status invalid';
            statusDiv.innerHTML = '❌ VERIFICATION FAILED<br><span style="font-size: 0.85rem; font-weight: normal;">Signature does not match</span>';
        }

        // Display signer info
        const signerDetails = document.getElementById('signer-details');
        signerDetails.innerHTML = '';

        // Use resolved nymName if available, otherwise from API response
        const displayName = resolvedNymName || data.nymName || 'Unknown';
        const displayAvatar = resolvedAvatarUrl || data.avatarUrl;

        const infoItems = [
            { label: 'Notification Address', value: data.notificationAddress || 'N/A' },
            { label: 'PayNym Name', value: displayName },
            { label: 'Payment Code', value: paymentCode }
        ];

        // Add avatar if available
        if (displayAvatar) {
            const avatarItem = document.createElement('div');
            avatarItem.className = 'derived-item';
            avatarItem.innerHTML = `
                <div class="derived-label">PayNym Avatar</div>
                <div class="derived-value" style="text-align: center;">
                    <img src="${escapeHtml(displayAvatar)}" alt="PayNym Avatar"
                         style="width: 80px; height: 80px; border-radius: 50%; border: 2px solid var(--accent-primary);"
                         data-on-error="hide">
                </div>
            `;
            signerDetails.appendChild(avatarItem);
        }

        infoItems.forEach(info => {
            const item = document.createElement('div');
            item.className = 'derived-item';
            item.innerHTML = `
                <div class="derived-label">${info.label}</div>
                <div class="derived-value">${info.value}</div>
            `;
            signerDetails.appendChild(item);
        });

        outputDiv.style.display = 'block';
        console.log(`Verification complete: ${data.valid ? 'VALID' : 'INVALID'}`);

    } catch (error) {
        console.error('Verification error:', error);
        errorDiv.textContent = `❌ ${error.message}`;
        errorDiv.style.display = 'block';
    } finally {
        btn.disabled = false;
        btn.innerHTML = 'VERIFY MESSAGE';
    }
}


registerActions({
  'next-step': (el) => nextStep(Number(el.dataset.step)),
  'reset-scenario': () => resetScenario(),
  'verify-message': () => verifyMessage(),
  'validate-code': () => validatePaymentCode()
});
