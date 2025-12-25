/**
 * BudgetTact Web - QR Code Generator
 * Generates and displays QR codes for Android app to scan
 *
 * Note: Android uses flutter_webrtc, signaling compatibility required
 */

const QRGenerator = (() => {
  let currentPeerId = null;
  let qrCodeElement = null;

  /**
   * Generate a unique peer ID for this session
   * Format: web-{timestamp}-{random}
   */
  const generatePeerId = () => {
    return `web-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  };

  /**
   * Initialize QR code generation and display
   * @param {string} containerId - ID of container element for QR code
   * @param {Object} options - Optional configuration
   * @param {string} options.peerId - Existing peer ID to use (if already connected to signaling server)
   * @param {string} options.signalingServer - Signaling server URL to include in QR
   * @returns {string|null} Generated peer ID or null if failed
   */
  const init = (containerId, options = {}) => {
    console.log('QRGenerator.init called with container:', containerId);

    const container = document.getElementById(containerId);
    if (!container) {
      console.error(`Container ${containerId} not found`);
      return null;
    }

    console.log('Container found:', container);

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

      return currentPeerId;
    } catch (err) {
      console.error('Failed to generate QR code:', err);
      return null;
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
    if (qrCodeElement) {
      const container = qrCodeElement._el;
      if (container) {
        container.innerHTML = '';
      }
      qrCodeElement = null;
    }
    currentPeerId = null;
  };

  // Public API
  return {
    init,
    getPeerId,
    clear
  };
})();
