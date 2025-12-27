/**
 * BudgetTact Web - QR Code Generator
 * Generates and displays QR codes for Android app to scan
 * Features auto-refresh to prevent stale peer IDs
 *
 * Note: Android uses flutter_webrtc, signaling compatibility required
 */

const QRGenerator = (() => {
  let currentPeerId = null;
  let qrCodeElement = null;
  let refreshInterval = null;
  let countdownInterval = null;
  let containerId = null;
  let currentOptions = {};
  let secondsRemaining = 0;
  let isConnected = false;
  let onRefreshCallback = null;

  // Refresh interval in seconds (60 seconds to give Android plenty of time to connect)
  // Reduced from 30s because Android needs time to: scan QR, parse, init WebRTC, connect to signaling, send OFFER
  const REFRESH_INTERVAL_SECONDS = 60;

  // Grace period in ms - keep old signaling connection alive after generating new QR
  const TRANSITION_GRACE_PERIOD_MS = 45000;

  /**
   * Generate a unique peer ID for this session
   * Format: web-{timestamp}-{random}
   */
  const generatePeerId = () => {
    return `web-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  };

  /**
   * Initialize QR code generation and display with auto-refresh
   * @param {string} containerIdParam - ID of container element for QR code
   * @param {Object} options - Optional configuration
   * @param {string} options.peerId - Existing peer ID to use (if already connected to signaling server)
   * @param {string} options.signalingServer - Signaling server URL to include in QR
   * @param {boolean} options.autoRefresh - Enable auto-refresh (default: true)
   * @param {number} options.refreshIntervalSeconds - Refresh interval in seconds (default: 30)
   * @param {Function} options.onRefresh - Callback when QR is refreshed (receives new peerId)
   * @returns {string|null} Generated peer ID or null if failed
   */
  const init = (containerIdParam, options = {}) => {
    console.log('QRGenerator.init called with container:', containerIdParam);

    const container = document.getElementById(containerIdParam);
    if (!container) {
      console.error(`Container ${containerIdParam} not found`);
      return null;
    }

    // Store for refresh
    containerId = containerIdParam;
    currentOptions = options;
    onRefreshCallback = options.onRefresh || null;
    isConnected = false;

    // Clear any existing refresh timers
    stopAutoRefresh();

    console.log('Container found:', container);

    // Generate the QR code
    const peerId = generateQRCode(container, options);

    // Start auto-refresh if enabled (default: true)
    const autoRefresh = options.autoRefresh !== false;
    if (autoRefresh && peerId) {
      const intervalSeconds = options.refreshIntervalSeconds || REFRESH_INTERVAL_SECONDS;
      startAutoRefresh(intervalSeconds);
    }

    return peerId;
  };

  /**
   * Generate QR code (internal function)
   */
  const generateQRCode = (container, options) => {
    // Clear any existing QR code
    container.innerHTML = '';

    // Use provided peer ID or generate a new one
    currentPeerId = options.peerId || generatePeerId();
    console.log('Using peer ID:', currentPeerId, options.peerId ? '(from preConnect)' : '(newly generated)');

    // Create QR data payload
    // Keep version 1.0 for backward compatibility with Android app
    // Extra fields like signalingServer are safely ignored by older parsers
    const qrData = {
      version: '1.0',
      type: 'budgettact-sync',
      peerId: currentPeerId,
      timestamp: new Date().toISOString()
    };

    // Add signaling server if provided
    if (options.signalingServer) {
      qrData.signalingServer = options.signalingServer;
      console.log('Including signaling server in QR:', options.signalingServer);
    }

    console.log('QR data:', qrData);

    try {
      // Check if QRCode is available
      if (typeof QRCode === 'undefined') {
        console.error('QRCode library not loaded!');
        return null;
      }

      console.log('QRCode library available, generating QR code...');

      // Generate QR code using qrcode.js library
      qrCodeElement = new QRCode(container, {
        text: JSON.stringify(qrData),
        width: 300,
        height: 300,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
      });

      console.log('📱 QR Code displayed. Scan with Android app.');
      console.log('Peer ID:', currentPeerId);

      // Show peer ID in UI for debugging
      updatePeerIdDisplay();

      return currentPeerId;
    } catch (err) {
      console.error('Failed to generate QR code:', err);
      return null;
    }
  };

  /**
   * Start auto-refresh timer
   */
  const startAutoRefresh = (intervalSeconds) => {
    console.log(`🔄 Starting QR auto-refresh every ${intervalSeconds} seconds`);
    secondsRemaining = intervalSeconds;

    // Update countdown every second
    countdownInterval = setInterval(() => {
      if (isConnected) {
        // Stop refreshing if connected
        stopAutoRefresh();
        return;
      }

      secondsRemaining--;
      updateCountdownDisplay();

      if (secondsRemaining <= 0) {
        // Time to refresh
        refresh();
        secondsRemaining = intervalSeconds;
      }
    }, 1000);

    // Initial countdown display
    updateCountdownDisplay();
  };

  /**
   * Stop auto-refresh timer
   */
  const stopAutoRefresh = () => {
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
    if (refreshInterval) {
      clearInterval(refreshInterval);
      refreshInterval = null;
    }
    // Hide countdown display
    const countdownEl = document.getElementById('qr-countdown');
    if (countdownEl) {
      countdownEl.style.display = 'none';
    }
  };

  /**
   * Update peer ID display in UI (for debugging)
   */
  const updatePeerIdDisplay = () => {
    let peerIdEl = document.getElementById('qr-peer-id');

    // Create peer ID display element if it doesn't exist
    if (!peerIdEl && containerId) {
      const container = document.getElementById(containerId);
      if (container && container.parentElement) {
        peerIdEl = document.createElement('div');
        peerIdEl.id = 'qr-peer-id';
        peerIdEl.style.cssText = `
          text-align: center;
          margin-top: 8px;
          font-size: 11px;
          color: #888;
          font-family: monospace;
          word-break: break-all;
          padding: 4px 8px;
          background: rgba(0,0,0,0.05);
          border-radius: 4px;
        `;
        container.parentElement.insertBefore(peerIdEl, container.nextSibling);
      }
    }

    if (peerIdEl && currentPeerId) {
      // Show shortened peer ID for readability
      const shortId = currentPeerId.replace('web-', '');
      peerIdEl.innerHTML = `<strong>Peer ID:</strong> ${shortId}`;
      peerIdEl.title = currentPeerId; // Full ID on hover
    }
  };

  /**
   * Update countdown display in UI
   */
  const updateCountdownDisplay = () => {
    // Also update peer ID display
    updatePeerIdDisplay();

    let countdownEl = document.getElementById('qr-countdown');

    // Create countdown element if it doesn't exist
    if (!countdownEl && containerId) {
      const container = document.getElementById(containerId);
      if (container && container.parentElement) {
        countdownEl = document.createElement('div');
        countdownEl.id = 'qr-countdown';
        countdownEl.style.cssText = `
          text-align: center;
          margin-top: 10px;
          font-size: 14px;
          color: #666;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        `;
        // Insert after peer ID display
        const peerIdEl = document.getElementById('qr-peer-id');
        if (peerIdEl) {
          peerIdEl.parentElement.insertBefore(countdownEl, peerIdEl.nextSibling);
        } else {
          container.parentElement.insertBefore(countdownEl, container.nextSibling);
        }
      }
    }

    if (countdownEl) {
      countdownEl.style.display = 'flex';
      const refreshIcon = secondsRemaining <= 5 ? '🔄' : '⏱️';
      const urgencyStyle = secondsRemaining <= 5 ? 'color: #e67e22; font-weight: bold;' : '';
      countdownEl.innerHTML = `
        <span style="${urgencyStyle}">${refreshIcon} Refreshing in ${secondsRemaining}s</span>
      `;
    }
  };

  /**
   * Refresh the QR code with a new peer ID
   * IMPORTANT: We keep the old signaling connection alive for a grace period
   * to handle the race condition where Android scans just before refresh
   */
  const refresh = async () => {
    if (isConnected) {
      console.log('🔗 Already connected, skipping QR refresh');
      return;
    }

    console.log('🔄 Refreshing QR code with new peer ID...');
    console.log('⏳ Old signaling connection will remain active for grace period');

    try {
      // IMPORTANT: Do NOT disconnect the old signaling connection immediately!
      // Instead, create a new one and let them both coexist briefly.
      // The old connection will be cleaned up after the grace period.

      // Store reference to old peer ID for logging
      const oldPeerId = typeof WebRTCSync !== 'undefined' ? WebRTCSync.getPeerId?.() : null;

      // Pre-connect to signaling server with NEW peer ID
      // This creates a new WebSocket connection, but importantly,
      // WebRTCSync.preConnect() doesn't close the old one - it just creates a new peerId
      // Actually, looking at the code, it does overwrite signalingSocket...
      // We need a different approach: just generate new QR with new peerId
      // but DON'T reconnect to signaling until absolutely necessary

      // Generate new peer ID without disconnecting
      const newPeerId = generatePeerId();
      console.log(`🔄 Transitioning from ${oldPeerId || 'none'} to ${newPeerId}`);

      // Update options with new peer ID
      const newOptions = {
        ...currentOptions,
        peerId: newPeerId
      };

      // Keep the signaling server URL from current options if available
      if (currentOptions.signalingServer) {
        newOptions.signalingServer = currentOptions.signalingServer;
      }

      // Regenerate QR code with the new peer ID
      const container = document.getElementById(containerId);
      if (container) {
        generateQRCode(container, newOptions);
        console.log('📱 QR Code refreshed with new peer ID:', newPeerId);

        // Notify callback if provided
        if (onRefreshCallback) {
          onRefreshCallback(newPeerId);
        }
      }

      // NOW reconnect to signaling with new peer ID
      // preConnect() now handles graceful transition - it creates new connection
      // BEFORE closing old one, eliminating the race window
      if (typeof WebRTCSync !== 'undefined') {
        // No need to call disconnect() - preConnect() does graceful transition
        const connectionInfo = await WebRTCSync.preConnect();
        console.log('✅ Re-connected to signaling server:', connectionInfo.server?.name);

        // Update the QR with the actual connected peer ID if different
        if (connectionInfo?.peerId && connectionInfo.peerId !== newPeerId) {
          const updatedOptions = {
            ...newOptions,
            peerId: connectionInfo.peerId
          };
          if (connectionInfo?.server) {
            updatedOptions.signalingServer = connectionInfo.server.url;
          }
          if (container) {
            generateQRCode(container, updatedOptions);
            console.log('📱 QR Code updated with connected peer ID:', connectionInfo.peerId);
          }
        }
      }
    } catch (error) {
      console.error('❌ Failed to refresh QR code:', error);
      // Continue with refresh timer - will try again next interval
    }
  };

  /**
   * Mark as connected - stops or resumes auto-refresh
   */
  const setConnected = (connected) => {
    isConnected = connected;
    if (connected) {
      console.log('🔗 Connection established, stopping QR auto-refresh');
      stopAutoRefresh();
    } else {
      // Resume auto-refresh if disconnected
      console.log('🔄 Connection lost, resuming QR auto-refresh');
      const intervalSeconds = currentOptions.refreshIntervalSeconds || REFRESH_INTERVAL_SECONDS;
      startAutoRefresh(intervalSeconds);
    }
  };

  /**
   * Get the current peer ID
   * @returns {string|null} Current peer ID or null
   */
  const getPeerId = () => currentPeerId;

  /**
   * Clear the QR code and reset state
   */
  const clear = () => {
    stopAutoRefresh();

    if (qrCodeElement) {
      const container = qrCodeElement._el;
      if (container) {
        container.innerHTML = '';
      }
      qrCodeElement = null;
    }
    currentPeerId = null;
    containerId = null;
    currentOptions = {};
    isConnected = false;

    // Remove countdown element
    const countdownEl = document.getElementById('qr-countdown');
    if (countdownEl) {
      countdownEl.remove();
    }
  };

  // Public API
  return {
    init,
    getPeerId,
    clear,
    refresh,
    setConnected,
    stopAutoRefresh
  };
})();
