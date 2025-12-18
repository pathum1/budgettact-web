/**
 * TURN Configuration for WebRTC using Metered.ca
 * Uses static credentials for reliable cross-network connections
 *
 * Domain: global.relay.metered.ca
 * Credentials are long-lived and managed via Metered dashboard
 */

const TurnConfig = (() => {
  // Metered TURN server credentials
  const METERED_USERNAME = '45a834da3d55d52992dc7b85';
  const METERED_PASSWORD = 'PF8A/9izG2KZrllK';

  /**
   * Get ICE server configuration with Metered TURN credentials
   * Returns configuration with STUN and TURN servers for NAT traversal
   */
  const getIceServers = () => {
    return {
      iceServers: [
        // Metered STUN server
        { urls: 'stun:stun.relay.metered.ca:80' },

        // Google STUN servers (backup)
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },

        // Metered TURN servers (UDP)
        {
          urls: 'turn:global.relay.metered.ca:80',
          username: METERED_USERNAME,
          credential: METERED_PASSWORD
        },

        // Metered TURN servers (TCP) - Better for restrictive networks
        {
          urls: 'turn:global.relay.metered.ca:80?transport=tcp',
          username: METERED_USERNAME,
          credential: METERED_PASSWORD
        },

        // Metered TURN servers (TLS on 443) - Works through most firewalls
        {
          urls: 'turn:global.relay.metered.ca:443',
          username: METERED_USERNAME,
          credential: METERED_PASSWORD
        },
        {
          urls: 'turns:global.relay.metered.ca:443?transport=tcp',
          username: METERED_USERNAME,
          credential: METERED_PASSWORD
        }
      ],
      iceTransportPolicy: 'all', // Try STUN first, fallback to TURN if needed
      iceCandidatePoolSize: 10, // Pre-gather candidates for faster connection
      sdpSemantics: 'unified-plan'
    };
  };

  /**
   * Check if TURN is properly configured
   */
  const isConfigured = () => {
    return true; // Static Metered credentials
  };

  // Public API
  return {
    getIceServers,
    isConfigured
  };
})();
