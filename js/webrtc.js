/**
 * BudgetTact Web - Raw WebRTC Sync (Server Mode)
 * Compatible with flutter_webrtc on Android
 * Uses manual signaling through PeerJS server infrastructure
 */

/**
 * Persistent Sync Diagnostics Logger
 * Stores logs in localStorage to survive page navigation/reload
 * Access via: SyncDiagnostics.dump() or SyncDiagnostics.getAll()
 */
const SyncDiagnostics = (() => {
  const STORAGE_KEY = 'budgettact_sync_diagnostics';
  const MAX_ENTRIES = 500; // Limit to prevent localStorage overflow
  const SESSION_KEY = 'budgettact_sync_session';

  // Generate or retrieve session ID
  const getSessionId = () => {
    let sessionId = sessionStorage.getItem(SESSION_KEY);
    if (!sessionId) {
      sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
      sessionStorage.setItem(SESSION_KEY, sessionId);
    }
    return sessionId;
  };

  const sessionId = getSessionId();
  const sessionStart = Date.now();

  // Get all stored logs
  const getAll = () => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch (e) {
      console.error('Failed to read sync diagnostics:', e);
      return [];
    }
  };

  // Save logs to storage
  const save = (entries) => {
    try {
      // Trim to max entries
      const trimmed = entries.slice(-MAX_ENTRIES);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch (e) {
      console.error('Failed to save sync diagnostics:', e);
      // Try clearing old entries if storage is full
      try {
        const trimmed = entries.slice(-100);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
      } catch (e2) {
        console.error('Failed to save even trimmed diagnostics:', e2);
      }
    }
  };

  // Log an entry
  const log = (category, message, data = null) => {
    const entry = {
      timestamp: new Date().toISOString(),
      elapsed: Date.now() - sessionStart,
      sessionId,
      category,
      message,
      data: data ? JSON.parse(JSON.stringify(data)) : null // Deep clone to avoid circular refs
    };

    // Also log to console
    const consoleMsg = `📋 [${category}] ${message}`;
    if (data) {
      console.log(consoleMsg, data);
    } else {
      console.log(consoleMsg);
    }

    // Append to storage
    const entries = getAll();
    entries.push(entry);
    save(entries);

    return entry;
  };

  // Log with specific categories
  const logSync = (message, data) => log('SYNC', message, data);
  const logNav = (message, data) => log('NAV', message, data);
  const logDB = (message, data) => log('DB', message, data);
  const logError = (message, data) => log('ERROR', message, data);
  const logState = (message, data) => log('STATE', message, data);

  // Dump all logs to console (for debugging)
  const dump = () => {
    const entries = getAll();
    console.log('='.repeat(60));
    console.log('SYNC DIAGNOSTICS DUMP - Total entries:', entries.length);
    console.log('='.repeat(60));

    // Group by session
    const bySession = {};
    entries.forEach(e => {
      if (!bySession[e.sessionId]) bySession[e.sessionId] = [];
      bySession[e.sessionId].push(e);
    });

    Object.keys(bySession).forEach(sid => {
      console.log(`\n--- Session: ${sid} (${bySession[sid].length} entries) ---`);
      bySession[sid].forEach(e => {
        const dataStr = e.data ? ` | ${JSON.stringify(e.data)}` : '';
        console.log(`[${e.timestamp}] +${e.elapsed}ms [${e.category}] ${e.message}${dataStr}`);
      });
    });

    console.log('='.repeat(60));
    return entries;
  };

  // Get logs for current session only
  const getCurrentSession = () => {
    return getAll().filter(e => e.sessionId === sessionId);
  };

  // Clear all logs
  const clear = () => {
    localStorage.removeItem(STORAGE_KEY);
    console.log('Sync diagnostics cleared');
  };

  // Get summary of recent sync attempts
  const getSummary = () => {
    const entries = getAll();
    const syncStarts = entries.filter(e => e.message.includes('START') || e.message.includes('metadata_received'));
    const syncCompletes = entries.filter(e => e.message.includes('COMPLETED') || e.message.includes('sync_complete'));
    const errors = entries.filter(e => e.category === 'ERROR');
    const navEvents = entries.filter(e => e.category === 'NAV');

    return {
      totalEntries: entries.length,
      syncAttempts: syncStarts.length,
      syncCompletes: syncCompletes.length,
      errors: errors.length,
      navigationEvents: navEvents.length,
      lastEntry: entries[entries.length - 1],
      currentSession: sessionId
    };
  };

  // Log page load/navigation
  log('NAV', 'Page loaded/navigated', {
    url: window.location.href,
    hash: window.location.hash,
    referrer: document.referrer,
    sessionId
  });

  // Expose globally for console access
  window.SyncDiagnostics = {
    log, logSync, logNav, logDB, logError, logState,
    getAll, getCurrentSession, dump, clear, getSummary,
    sessionId
  };

  return window.SyncDiagnostics;
})();

const WebRTCSync = (() => {
  let peerConnection = null;
  let dataChannel = null;
  let signalingSocket = null;
  let onDataCallback = null;
  let onStateChangeCallback = null;
  let myPeerId = null;
  let remotePeerId = null;
  let connectionTimeout = null;
  const listeners = {};
  const dataHandlers = []; // Multiple data handlers for bidirectional sync

  // PeerJS signaling server configuration with fallbacks
  // Primary: 0.peerjs.com (more reliable), Fallback: peerjs.com
  const SIGNALING_SERVERS = [
    { url: 'wss://0.peerjs.com/peerjs', key: 'peerjs', name: '0.peerjs.com' },
    { url: 'wss://peerjs.com/peerjs', key: 'peerjs', name: 'peerjs.com' }
  ];
  let currentServerIndex = 0;

  // WebRTC configuration - loaded from TurnConfig
  const rtcConfig = TurnConfig.getIceServers();

  // Log configuration status
  if (TurnConfig.isConfigured()) {
    console.log('🔧 WebRTC: Using public TURN servers (OpenRelay + Numb)');
  } else {
    console.warn('⚠️ WebRTC: TURN not configured, using STUN only');
  }

  /**
   * Initialize WebRTC as server - wait for Android to connect
   * @param {string} peerId - Unique peer ID for this session
   * @returns {Promise<string>} Resolves with peer ID when ready
   */
  // Global error handlers to catch silent errors
  window.addEventListener('error', (event) => {
    console.error('🔥 [Global] JavaScript error:', event.error);
    console.error('🔥 [Global] Error filename:', event.filename, 'line:', event.lineno, 'column:', event.colno);
  });

  window.addEventListener('unhandledrejection', (event) => {
    console.error('🔥 [Global] Unhandled promise rejection:', event.reason);
    event.preventDefault();
  });

  const init = (peerId) => {
    return new Promise((resolve, reject) => {
      try {
        console.log('🔵 WebRTCSync.init() called with peerId:', peerId);

        // Diagnostic: Check what WebRTC APIs are available
        console.log('🔍 WebRTC API Check:', {
          RTCPeerConnection: typeof RTCPeerConnection,
          webkitRTCPeerConnection: typeof webkitRTCPeerConnection,
          mozRTCPeerConnection: typeof mozRTCPeerConnection,
          RTCSessionDescription: typeof RTCSessionDescription,
          RTCIceCandidate: typeof RTCIceCandidate,
          getUserMedia: typeof navigator.mediaDevices?.getUserMedia,
          adapter: typeof adapter
        });

        // Test WebSocket connectivity
        console.log('🔍 Testing WebSocket support:', {
          WebSocket: typeof WebSocket,
          wsSupported: 'WebSocket' in window
        });

        // Check if WebRTC is supported
        if (typeof RTCPeerConnection === 'undefined') {
          const error = new Error('WebRTC is not supported in this browser. Please use a modern browser (Chrome, Firefox, Edge, Safari) with WebRTC enabled.');
          console.error('❌ RTCPeerConnection is not defined. WebRTC APIs are not available.');
          console.error('💡 Possible causes:');
          console.error('   1. WebRTC is DISABLED in Firefox settings');
          console.error('      Fix: Go to about:config and set media.peerconnection.enabled = true');
          console.error('   2. Privacy.resistFingerprinting is enabled (disables WebRTC)');
          console.error('      Fix: Go to about:config and set privacy.resistFingerprinting = false');
          console.error('   3. Browser extension is blocking WebRTC (Privacy Badger, uBlock, NoScript)');
          console.error('      Fix: Disable WebRTC blocking in extension settings');
          console.error('   4. adapter.js failed to load from CDN');
          console.error('      Check Network tab for script loading errors');
          console.error('');
          console.error('🔧 Quick Firefox fix: Type about:config in address bar, search for "media.peerconnection.enabled", set to true');
          updateState('error');
          reject(error);
          return;
        }

        // Check if already connected via preConnect
        if (myPeerId === peerId && signalingSocket && signalingSocket.readyState === WebSocket.OPEN) {
          console.log('✅ Already connected to signaling server via preConnect');
          updateState('waiting');

          // Set expiration timeout
          connectionTimeout = setTimeout(() => {
            if (!dataChannel || dataChannel.readyState !== 'open') {
              console.log('⏱️ No connection received, QR code expired');
              updateState('expired');
              disconnect();
            }
          }, 300000); // 5 minutes

          resolve(peerId);
          return;
        }

        myPeerId = peerId;

        // Connect to signaling server
        connectToSignalingServer(peerId)
          .then(() => {
            console.log('✅ Connected to signaling server');
            updateState('waiting');
            resolve(peerId);

            // Set expiration timeout
            connectionTimeout = setTimeout(() => {
              if (!dataChannel || dataChannel.readyState !== 'open') {
                console.log('⏱️ No connection received, QR code expired');
                updateState('expired');
                disconnect();
              }
            }, 300000); // 5 minutes
          })
          .catch(reject);
      } catch (err) {
        reject(err);
      }
    });
  };

  /**
   * Connect to PeerJS signaling server via WebSocket with fallback support
   */
  const connectToSignalingServer = (peerId) => {
    return new Promise((resolve, reject) => {
      let attemptCount = 0;
      let lastError = null;

      const tryNextServer = () => {
        if (attemptCount >= SIGNALING_SERVERS.length) {
          // All servers failed
          console.error('❌ [Signaling] All signaling servers failed');
          console.error('💡 WebSocket connection failed. Possible causes:');
          console.error('   1. Firefox extension blocking WebSockets (uBlock Origin, NoScript, Privacy Badger)');
          console.error('      Fix: Disable WebSocket blocking in extension settings or whitelist this site');
          console.error('   2. Network/Firewall blocking WebSocket connections (port 443)');
          console.error('      Fix: Check firewall settings or try a different network');
          console.error('   3. Firefox network.websocket.enabled is disabled');
          console.error('      Fix: Go to about:config and set network.websocket.enabled = true');
          console.error('   4. Corporate proxy/VPN blocking WebSockets');
          console.error('      Fix: Try without VPN or configure proxy to allow WebSockets');
          console.error('');
          console.error('🔧 Test WebSocket manually: Open console and run:');
          console.error('   new WebSocket("wss://echo.websocket.org")');
          console.error('   If this fails, WebSockets are blocked on your system');
          updateState('error');
          reject(lastError || new Error('All signaling servers failed'));
          return;
        }

        const server = SIGNALING_SERVERS[attemptCount];
        const wsUrl = `${server.url}?key=${server.key}&id=${peerId}&token=${generateToken()}`;
        console.log(`🔌 Connecting to signaling server (${attemptCount + 1}/${SIGNALING_SERVERS.length}): ${server.name}`);
        console.log(`   URL: ${wsUrl}`);

        try {
          signalingSocket = new WebSocket(wsUrl);

          // Set a connection timeout
          const connectionTimer = setTimeout(() => {
            console.warn(`⏱️ [Signaling] Connection timeout for ${server.name}, trying next...`);
            signalingSocket.close();
            attemptCount++;
            tryNextServer();
          }, 5000); // 5 second timeout per server

          signalingSocket.onopen = () => {
            clearTimeout(connectionTimer);
            console.log(`✅ [Signaling] Connected to ${server.name}`);
            currentServerIndex = attemptCount;
            resolve();
          };

          signalingSocket.onmessage = (event) => {
            try {
              const message = JSON.parse(event.data);
              console.log('📨 [Signaling] Received:', message);
              handleSignalingMessage(message);
            } catch (err) {
              console.error('❌ [Signaling] Failed to parse message:', err);
            }
          };

          signalingSocket.onerror = (error) => {
            clearTimeout(connectionTimer);
            console.warn(`⚠️ [Signaling] Failed to connect to ${server.name}:`, error);
            lastError = error;
            attemptCount++;
            tryNextServer();
          };

          signalingSocket.onclose = () => {
            // Only log close if we were previously connected
            if (currentServerIndex === attemptCount) {
              console.log('🔌 [Signaling] WebSocket closed');
            }
          };
        } catch (err) {
          console.warn(`⚠️ [Signaling] Exception connecting to ${server.name}:`, err);
          lastError = err;
          attemptCount++;
          tryNextServer();
        }
      };

      tryNextServer();
    });
  };

  /**
   * Get the currently connected signaling server info
   */
  const getConnectedServer = () => {
    if (currentServerIndex < SIGNALING_SERVERS.length) {
      return SIGNALING_SERVERS[currentServerIndex];
    }
    return null;
  };

  /**
   * Generate a peer ID without connecting
   * Useful for getting a stable peer ID before QR code generation
   */
  const generatePeerId = () => {
    return `web-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  };

  /**
   * Pre-connect to signaling server and return connection info
   * Used to establish connection before QR code generation
   * IMPORTANT: This now does a GRACEFUL transition - keeping the old connection
   * alive until the new one is established to prevent race conditions
   * @returns {Promise<{peerId: string, server: Object}>}
   */
  const preConnect = async () => {
    const peerId = generatePeerId();
    console.log('🔵 WebRTCSync.preConnect() generating peerId:', peerId);

    // Store reference to old socket for graceful cleanup
    const oldSocket = signalingSocket;
    const oldPeerId = myPeerId;

    // Store new peer ID
    myPeerId = peerId;

    // Connect to signaling server with fallback
    // This creates a NEW socket (doesn't close old one yet)
    await connectToSignalingServer(peerId);

    const server = getConnectedServer();
    console.log('✅ Pre-connected to signaling server:', server?.name);

    // NOW close the old socket after the new one is established
    // This eliminates the race window where neither socket is active
    if (oldSocket && oldSocket !== signalingSocket) {
      console.log(`🔄 Graceful transition: closing old socket for ${oldPeerId}`);
      try {
        oldSocket.close();
      } catch (e) {
        // Ignore close errors
      }
    }

    return {
      peerId,
      server
    };
  };

  /**
   * Handle incoming signaling messages
   */
  const handleSignalingMessage = async (message) => {
    const { type, src, payload } = message;

    switch (type) {
      case 'OPEN':
        console.log('✅ [Signaling] Peer registered successfully');
        break;

      case 'OFFER':
        console.log('📱 [WebRTC] Received OFFER from Android:', src);
        remotePeerId = src;
        // CRITICAL: Stop QR auto-refresh immediately when we receive an offer
        // This prevents the race condition where QR refreshes during connection
        if (typeof QRGenerator !== 'undefined' && QRGenerator.setConnected) {
          console.log('🛑 Pausing QR auto-refresh - connection attempt in progress');
          QRGenerator.setConnected(true);
        }
        await handleOffer(payload);
        break;

      case 'ANSWER':
        console.log('📱 [WebRTC] Received ANSWER from Android');
        await handleAnswer(payload);
        break;

      case 'CANDIDATE':
        console.log('🧊 [WebRTC] Received ICE candidate from Android');
        await handleCandidate(payload);
        break;

      case 'LEAVE':
      case 'EXPIRE':
        console.log('👋 [Signaling] Remote peer disconnected');
        updateState('disconnected');
        // Resume QR auto-refresh if connection failed/expired
        // Only do this if we're still on the sync page
        if (typeof QRGenerator !== 'undefined' && QRGenerator.setConnected) {
          const currentHash = window.location.hash.slice(1);
          if (currentHash === 'sync' || currentHash === '') {
            console.log('🔄 Resuming QR auto-refresh after disconnect');
            QRGenerator.setConnected(false);
          }
        }
        break;

      default:
        console.warn('⚠️ [Signaling] Unknown message type:', type);
    }
  };

  /**
   * Handle incoming OFFER from Android
   */
  const handleOffer = async (offer) => {
    try {
      console.log('🎬 [WebRTC] Creating peer connection...');

      // Create RTCPeerConnection
      peerConnection = new RTCPeerConnection(rtcConfig);

      // Set up event handlers
      setupPeerConnectionHandlers();

      // Set remote description (offer from Android)
      console.log('📝 [WebRTC] Setting remote description (offer)');
      await peerConnection.setRemoteDescription(new RTCSessionDescription({
        type: 'offer',
        sdp: offer.sdp
      }));

      // Create answer
      console.log('📝 [WebRTC] Creating answer...');
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      // Send answer to Android via signaling server
      console.log('📤 [Signaling] Sending ANSWER to Android');
      sendSignalingMessage({
        type: 'ANSWER',
        dst: remotePeerId,
        src: myPeerId,
        payload: {
          sdp: answer.sdp,
          type: 'answer'
        }
      });

      console.log('✅ [WebRTC] Answer sent, waiting for ICE candidates...');
    } catch (err) {
      console.error('❌ [WebRTC] Error handling offer:', err);
      updateState('error');
    }
  };

  /**
   * Handle incoming ANSWER from Android (not used in server mode)
   */
  const handleAnswer = async (answer) => {
    try {
      await peerConnection.setRemoteDescription(new RTCSessionDescription({
        type: 'answer',
        sdp: answer.sdp
      }));
    } catch (err) {
      console.error('❌ [WebRTC] Error handling answer:', err);
    }
  };

  /**
   * Handle incoming ICE candidate from Android
   */
  const handleCandidate = async (candidate) => {
    try {
      if (peerConnection && candidate.candidate) {
        // Parse candidate type for diagnostics
        const candidateStr = candidate.candidate || '';
        let candidateType = 'unknown';
        if (candidateStr.includes('typ host')) {
          candidateType = 'host';
        } else if (candidateStr.includes('typ srflx')) {
          candidateType = 'srflx (STUN)';
        } else if (candidateStr.includes('typ relay')) {
          candidateType = 'relay (TURN)';
        }

        console.log(`📥 [WebRTC] Received ICE candidate from Android: type=${candidateType}`);
        console.log(`   Full candidate: ${candidateStr}`);

        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        console.log('✅ [WebRTC] ICE candidate added');
      }
    } catch (err) {
      console.error('❌ [WebRTC] Error adding ICE candidate:', err);
    }
  };

  /**
   * Set up RTCPeerConnection event handlers
   */
  const setupPeerConnectionHandlers = () => {
    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        // Parse candidate type for diagnostics
        const candidateStr = event.candidate.candidate || '';
        let candidateType = 'unknown';
        if (candidateStr.includes('typ host')) {
          candidateType = 'host';
        } else if (candidateStr.includes('typ srflx')) {
          candidateType = 'srflx (STUN)';
        } else if (candidateStr.includes('typ relay')) {
          candidateType = 'relay (TURN)';
        }

        console.log(`🧊 [WebRTC] Generated ICE candidate: type=${candidateType}`);
        console.log(`   Full candidate: ${candidateStr}`);

        sendSignalingMessage({
          type: 'CANDIDATE',
          dst: remotePeerId,
          src: myPeerId,
          payload: {
            candidate: event.candidate.candidate,
            sdpMid: event.candidate.sdpMid,
            sdpMLineIndex: event.candidate.sdpMLineIndex
          }
        });
      }
    };

    // Handle ICE connection state
    peerConnection.oniceconnectionstatechange = () => {
      const iceState = peerConnection.iceConnectionState;
      console.log('🔗 [WebRTC] ICE connection state:', iceState);

      if (iceState === 'connected') {
        console.log('✅ [WebRTC] ICE connection established!');
      } else if (iceState === 'completed') {
        console.log('✅ [WebRTC] ICE connection completed!');
      } else if (iceState === 'disconnected') {
        console.log('⚠️ [WebRTC] ICE connection disconnected');
        updateState('disconnected');
      } else if (iceState === 'failed') {
        console.error('❌ [WebRTC] ICE connection failed - NAT/firewall issue detected');
        console.error('💡 Possible causes:');
        console.error('   - Devices not on same network');
        console.error('   - Firewall blocking WebRTC');
        console.error('   - TURN server not configured or not working');
        console.error('   - Network may be blocking peer-to-peer connections');
        updateState('error');
      } else if (iceState === 'closed') {
        console.log('🔌 [WebRTC] ICE connection closed');
        updateState('disconnected');
      }
    };

    // Handle data channel from Android
    peerConnection.ondatachannel = (event) => {
      console.log('📱 [WebRTC] Data channel received from Android!');
      dataChannel = event.channel;
      console.log('📱 [DataChannel] Label:', dataChannel.label);
      console.log('📱 [DataChannel] ReadyState:', dataChannel.readyState);
      console.log('📱 [DataChannel] Max packet size:', dataChannel.maxPacketLifeTime);
      setupDataChannelHandlers();
    };

    // Connection state
    peerConnection.onconnectionstatechange = () => {
      const connectionState = peerConnection.connectionState;
      console.log('🔗 [WebRTC] Connection state:', connectionState);
      console.log('🔗 [WebRTC] ICE connection state:', peerConnection.iceConnectionState);

      if (connectionState === 'connected') {
        console.log('✅ [WebRTC] Full connection established!');
        console.log('🔗 [WebRTC] Data channel should be opening next...');
      } else if (connectionState === 'connecting') {
        console.log('🔄 [WebRTC] Connection in progress...');
      } else if (connectionState === 'disconnected') {
        console.log('⚠️ [WebRTC] Connection disconnected');
        updateState('disconnected');
      } else if (connectionState === 'failed') {
        console.error('❌ [WebRTC] Connection failed');
        updateState('error');
      } else if (connectionState === 'closed') {
        console.log('🔌 [WebRTC] Connection closed');
        updateState('disconnected');
      }
    };
  };

  /**
   * Set up data channel event handlers
   */
  const setupDataChannelHandlers = () => {
    dataChannel.onopen = () => {
      console.log('✅ [DataChannel] Opened!');
      console.log('🔍 [DataChannel] State:', dataChannel.readyState);
      console.log('🔍 [DataChannel] Label:', dataChannel.label);
      console.log('🔍 [DataChannel] Max packet size:', dataChannel.maxPacketSize);
      updateState('connected');
      emit('connection-established');

      // Stop QR code auto-refresh now that we're connected
      if (typeof QRGenerator !== 'undefined' && QRGenerator.setConnected) {
        QRGenerator.setConnected(true);
      }

      // Clear expiration timeout
      if (connectionTimeout) {
        clearTimeout(connectionTimeout);
        connectionTimeout = null;
      }
    };

    dataChannel.onerror = (error) => {
      console.error('❌ [DataChannel] Error:', error);
      console.error('❌ [DataChannel] Error details:', error.error || error);
      updateState('error');
    };

    dataChannel.onmessage = (event) => {
      console.log('📦 [DataChannel] Received data:', event.data);
      try {
        const message = JSON.parse(event.data);
        console.log('📦 [DataChannel] Parsed message:', message);

        // Call all registered data handlers (for bidirectional sync)
        dataHandlers.forEach(handler => {
          try {
            handler(event.data); // Pass raw string data
          } catch (handlerErr) {
            console.error('❌ [DataChannel] Handler error:', handlerErr);
          }
        });

        handleIncomingData(message);
        emit('message', message);
        if (message.type) {
          console.log(`📦 [DataChannel] Emitting message:${message.type} event`);
          emit(`message:${message.type}`, message);
        }
      } catch (err) {
        console.error('❌ [DataChannel] Failed to parse data:', err);
        console.error('❌ [DataChannel] Raw data that failed to parse:', event.data);
      }
    };

    dataChannel.onclose = (event) => {
      console.log('🔌 [DataChannel] Closed - event:', event);
      if (dataChannel) {
        console.log('🔌 [DataChannel] ReadyState was:', dataChannel.readyState);
      }
      updateState('disconnected');
    };

    dataChannel.onerror = (error) => {
      console.error('❌ [DataChannel] Error:', error);
      console.error('❌ [DataChannel] Error details:', error.error);
      updateState('error');
    };
  };

  /**
   * Handle incoming data messages
   */
  const handleIncomingData = async (message) => {
    if (!message || !message.type) {
      console.error('Invalid message format');
      return;
    }

    switch (message.type) {
      case 'metadata':
        // Check if bidirectional sync is already handling this
        if (typeof BidirectionalSync !== 'undefined' && BidirectionalSync.isInProgress) {
          console.log('📋 Metadata received but BidirectionalSync is handling it - skipping');
          break;
        }
        console.log('📋 Received metadata from Android, initiating bidirectional sync...');
        // Handle both formats: message.payload (older) or direct fields (newer)
        const androidMetadata = message.payload || message;
        console.log('📋 Android metadata structure:', message);
        await handleMetadataExchange(androidMetadata);
        break;

      case 'syncData':
        console.log('💾 Processing sync data...');
        updateState('receiving');

        if (onDataCallback) {
          try {
            await onDataCallback(message.payload);
            sendAck();
            console.log('✅ Sync complete!');
            updateState('completed');
          } catch (err) {
            console.error('❌ Failed to process sync data:', err);
            sendError(err.message);
            updateState('error');
          }
        }
        break;

      case 'ping':
        console.log('🏓 Received ping, sending pong');
        sendPong();
        break;

      case 'changes':
      case 'syncData':
        console.log('📋 Received changes/syncData message - routing to appropriate handler');
        // Check if bidirectional sync is in progress
        if (typeof window !== 'undefined' && window._bidirectionalSyncInProgress) {
          console.log('📋 Routing to bidirectional sync handler');
          // Let the bidirectional sync handler deal with this
          break;
        }

        // For standalone incremental sync (not bidirectional)
        if (onDataCallback) {
          try {
            // Handle Android's message structure
            let data = message.payload || message.data;
            if (message.type === 'syncData' && data && data.data) {
              data = data.data; // Extract actual data from Android's structure
            }
            await onDataCallback(data);
            sendAck();
            console.log('✅ Incremental sync complete!');
            updateState('completed');
          } catch (err) {
            console.error('❌ Failed to process changes:', err);
            sendError(err.message);
            updateState('error');
          }
        }
        break;

      case 'incrementalChange':
      case 'syncComplete':
        // Handled by incremental sync listeners
        break;

      default:
        console.warn('⚠️ Unknown message type:', message.type);
    }
  };

  /**
   * Handle metadata exchange and initiate bidirectional sync
   */
  const handleMetadataExchange = async (androidMetadata) => {
    let syncInProgress = true;
    const syncStartTime = Date.now();

    // Use persistent logger
    SyncDiagnostics.logSync('handleMetadataExchange START', {
      timestamp: new Date().toISOString(),
      androidMetadata: androidMetadata
    });

    // Set flag for main message handler to know bidirectional sync is in progress
    if (typeof window !== 'undefined') {
      window._bidirectionalSyncInProgress = true;
      window._syncStartTime = syncStartTime;

      // Add beforeunload handler to detect page unload during sync
      const beforeUnloadHandler = (event) => {
        const elapsed = Date.now() - syncStartTime;
        SyncDiagnostics.logError('PAGE UNLOADING during sync!', {
          elapsed,
          syncInProgress,
          indexedDBState: 'unknown - page unloading'
        });
      };
      window.addEventListener('beforeunload', beforeUnloadHandler);
      window._syncBeforeUnloadHandler = beforeUnloadHandler;

      // Also track visibility changes (tab switching)
      const visibilityHandler = () => {
        const elapsed = Date.now() - syncStartTime;
        SyncDiagnostics.logNav('Visibility changed', {
          state: document.visibilityState,
          elapsed
        });
      };
      document.addEventListener('visibilitychange', visibilityHandler);
      window._syncVisibilityHandler = visibilityHandler;

      // Track hash changes (navigation)
      const hashChangeHandler = () => {
        const elapsed = Date.now() - syncStartTime;
        SyncDiagnostics.logNav('Hash changed during sync', {
          newHash: window.location.hash,
          elapsed,
          syncInProgress
        });
      };
      window.addEventListener('hashchange', hashChangeHandler);
      window._syncHashChangeHandler = hashChangeHandler;
    }

    try {
      SyncDiagnostics.logSync('Getting web metadata');
      // Get web app metadata
      const webMetadata = await getWebMetadata();
      SyncDiagnostics.logSync('Web metadata prepared', webMetadata);

      // Send web metadata back to Android
      await sendMessage({
        type: 'metadata',
        deviceId: webMetadata.deviceId,
        deviceName: webMetadata.deviceName,
        version: webMetadata.version,
        currency: webMetadata.currency,
        lastSync: webMetadata.lastSync,
        exportedAt: webMetadata.exportedAt,
        platform: webMetadata.platform,
        timestamp: webMetadata.timestamp
      });
      SyncDiagnostics.logSync('Sent web metadata to Android');

      // Get web app changes and send them
      const ourChanges = await incrementalSyncManager.getChangesSinceLastSync();
      SyncDiagnostics.logSync('Got web changes', { hasChanges: ourChanges && hasChanges(ourChanges) });

      if (ourChanges && hasChanges(ourChanges)) {
        await sendMessage({
          type: 'changes',
          data: ourChanges
        });
        SyncDiagnostics.logSync('Sent web changes to Android', { count: countChanges(ourChanges) });
      } else {
        // Still send empty changes to indicate completion
        await sendMessage({
          type: 'changes',
          data: {}
        });
        SyncDiagnostics.logSync('Sent empty changes (up to date)');
      }

      // Set up listener for Android's changes response (could be 'changes' or 'syncData' type)
      const androidChangesListener = async (message) => {
        if (!syncInProgress) return;
        SyncDiagnostics.logSync('Received Android response', { type: message.type });

        console.log('📥 Received Android response message:', {
          type: message.type,
          hasData: !!message.data,
          hasPayload: !!message.payload,
          messageKeys: Object.keys(message)
        });

        try {
          // Handle both 'changes' and 'syncData' message types
          const changesData = message.data || message.payload || message;
          console.log('📥 Changes data structure:', {
            keys: Object.keys(changesData || {}),
            hasDataField: !!changesData.data,
            hasExportedAt: !!changesData.exportedAt,
            hasDeviceId: !!changesData.deviceId,
            hasTransactions: !!changesData.transactions,
            hasCategories: !!changesData.categories
          });

          let applyResult;

          // Unwrap Android's message structure
          let actualData = changesData;

          // Android might send: { type: 'syncData', payload: { data: {...} } }
          if (changesData.payload && changesData.payload.data) {
            actualData = changesData.payload.data;
          } else if (changesData.data && typeof changesData.data === 'object') {
            // Check if 'data' is the nested data object (full sync) or just a field
            const dataKeys = Object.keys(changesData.data);
            const hasFullSyncStructure = dataKeys.includes('transactions') || dataKeys.includes('categories');
            if (hasFullSyncStructure) {
              actualData = changesData.data;
            }
          }

          console.log('📥 Unwrapped data structure:', {
            keys: Object.keys(actualData || {}),
            hasDataField: !!actualData.data,
            hasExportedAt: !!actualData.exportedAt,
            hasVersion: !!actualData.version,
            hasTransactions: !!actualData.transactions,
            hasSavingsGoals: !!actualData.savingsGoals
          });

          // Determine if this is a full sync or incremental sync
          const lastSyncTime = PairingManager.getLastSyncTime();
          const isFirstSync = !lastSyncTime || lastSyncTime === null;

          // Full sync detection:
          // 1. Has nested 'data' object with 'exportedAt', 'deviceId', 'version' (Android full sync format)
          // 2. OR it's the first sync and has transaction/category arrays directly
          const hasFullSyncStructure = actualData.data && actualData.exportedAt && actualData.deviceId;
          const hasIncrementalStructure = (actualData.transactions || actualData.categories || actualData.savingsGoals) && !actualData.data;

          console.log('📥 Sync type detection:', {
            isFirstSync,
            lastSyncTime,
            hasFullSyncStructure,
            hasIncrementalStructure
          });

          if (hasFullSyncStructure) {
            // This is a full sync payload from Android (first-time sync)
            console.log('📥 Processing FULL SYNC from Android');
            console.log('📥 Full sync payload:', {
              version: actualData.version,
              exportedAt: actualData.exportedAt,
              deviceId: actualData.deviceId,
              deviceName: actualData.deviceName,
              dataKeys: Object.keys(actualData.data || {})
            });

            const result = await Sync.importSyncPayload(actualData);

            if (result.success) {
              applyResult = {
                applied: result.stats?.transactions || 0,
                conflicts: 0
              };
              console.log(`✅ Full sync complete: ${result.stats?.transactions || 0} items imported`);
            } else {
              console.error('❌ Full sync failed:', result.message, result.errors);
              throw new Error(result.message || 'Full sync failed');
            }
          } else if (hasIncrementalStructure || isFirstSync) {
            // This is incremental changes OR first-time sync with direct data arrays
            console.log('📥 Processing INCREMENTAL SYNC from Android');

            // Check how many records have hashes
            let totalRecords = 0;
            let recordsWithHashes = 0;

            ['transactions', 'categories', 'savingsGoals', 'budgetHistory', 'goalTransactions', 'recurringTransactions', 'billers'].forEach(table => {
              if (actualData[table] && Array.isArray(actualData[table])) {
                const records = actualData[table];
                totalRecords += records.length;
                recordsWithHashes += records.filter(r => r.data_hash).length;
              }
            });

            console.log('📥 Incremental data:', {
              transactions: actualData.transactions?.length || 0,
              categories: actualData.categories?.length || 0,
              savingsGoals: actualData.savingsGoals?.length || 0,
              budgetHistory: actualData.budgetHistory?.length || 0,
              goalTransactions: actualData.goalTransactions?.length || 0,
              recurringTransactions: actualData.recurringTransactions?.length || 0,
              billers: actualData.billers?.length || 0
            });

            console.log(`🔐 Hash status: ${recordsWithHashes}/${totalRecords} records have hashes`);

            // Extract and store currency from incoming transactions
            if (actualData.transactions && actualData.transactions.length > 0) {
              const currency = actualData.transactions[0].currency;
              if (currency) {
                console.log('💱 Currency extracted from transaction:', currency);
                try {
                  // Get existing metadata and update it with currency
                  let metadata = await Storage.db.metadata.get('lastSync');
                  if (!metadata) {
                    // Create new metadata if it doesn't exist
                    metadata = { key: 'lastSync' };
                  }
                  metadata.currency = currency;
                  await Storage.db.metadata.put(metadata);
                  console.log('✅ Currency stored in lastSync metadata:', currency);
                } catch (error) {
                  console.error('❌ Failed to store currency in metadata:', error);
                }
              } else {
                console.warn('⚠️ No currency found in first transaction');
              }
            } else {
              console.log('ℹ️ No transactions in sync data, currency not extracted');
            }

            // Log IndexedDB state BEFORE applying changes
            const countsBefore = {
              transactions: await Storage.db.transactions.count(),
              categories: await Storage.db.categories.count(),
              savingsGoals: await Storage.db.savingsGoals.count()
            };
            SyncDiagnostics.logDB('IndexedDB BEFORE apply', countsBefore);

            applyResult = await incrementalSyncManager.applyIncomingChanges(actualData);
            SyncDiagnostics.logSync('Applied incoming changes', { applied: applyResult.applied, conflicts: applyResult.conflicts });

            // Log IndexedDB state AFTER applying changes
            const countsAfter = {
              transactions: await Storage.db.transactions.count(),
              categories: await Storage.db.categories.count(),
              savingsGoals: await Storage.db.savingsGoals.count()
            };
            const diff = {
              transactions: countsAfter.transactions - countsBefore.transactions,
              categories: countsAfter.categories - countsBefore.categories,
              savingsGoals: countsAfter.savingsGoals - countsBefore.savingsGoals
            };
            SyncDiagnostics.logDB('IndexedDB AFTER apply', { countsAfter, diff });
          } else {
            console.error('❌ Unknown data structure from Android:', actualData);
            throw new Error('Unrecognized data format from Android');
          }

          // Verify data was actually saved to IndexedDB
          // Add a delay to ensure IndexedDB transactions are fully committed
          SyncDiagnostics.logDB('Starting verification wait (500ms)', { appliedChanges: applyResult.applied });
          await new Promise(resolve => setTimeout(resolve, 500));
          SyncDiagnostics.logDB('Verification wait complete, checking data');
          const verificationResult = await verifyDataSaved();
          SyncDiagnostics.logDB('Verification result', verificationResult);

          if (!verificationResult.success) {
            SyncDiagnostics.logError('Data verification FAILED', {
              error: verificationResult.error,
              appliedChanges: applyResult.applied,
              receivedFromAndroid: {
                transactions: actualData.transactions?.length || 0,
                categories: actualData.categories?.length || 0,
                savingsGoals: actualData.savingsGoals?.length || 0
              }
            });
            throw new Error(`Data verification failed: ${verificationResult.error}`);
          }

          SyncDiagnostics.logDB('Verification SUCCESSFUL', verificationResult.counts);

          // Save pairing information AFTER data is verified (important for isPaired check)
          if (androidMetadata && (androidMetadata.deviceId || androidMetadata.device_id)) {
            const deviceId = androidMetadata.deviceId || androidMetadata.device_id;
            const deviceName = androidMetadata.deviceName || androidMetadata.device_name || 'Android Device';
            PairingManager.savePairing(deviceId, deviceName);
            SyncDiagnostics.logState('Saved pairing info', { deviceId, deviceName });
          }

          // Update lastSync AFTER data is verified (moved from applyIncomingChanges)
          PairingManager.updateLastSync();
          SyncDiagnostics.logState('Updated lastSync timestamp', { lastSync: PairingManager.getLastSyncTime() });

          // Send sync completion message
          await sendMessage({
            type: 'syncComplete',
            applied: applyResult.applied,
            conflicts: applyResult.conflicts
          });
          SyncDiagnostics.logSync('Sent syncComplete to Android');

          // Final verification - check data one more time before emitting events
          const finalCheck = {
            transactions: await Storage.db.transactions.count(),
            categories: await Storage.db.categories.count(),
            savingsGoals: await Storage.db.savingsGoals.count(),
            lastSync: PairingManager.getLastSyncTime(),
            isPaired: PairingManager.isPaired()
          };
          SyncDiagnostics.logState('FINAL STATE CHECK before emit', finalCheck);

          // Emit event to update UI
          emit('sync-completed', {
            received: applyResult.applied,
            conflicts: applyResult.conflicts,
            verified: true,
            counts: verificationResult.counts
          });
          SyncDiagnostics.logSync('Emitted sync-completed event');

          syncInProgress = false;

          // Clean up event listeners
          if (window._syncBeforeUnloadHandler) {
            window.removeEventListener('beforeunload', window._syncBeforeUnloadHandler);
            delete window._syncBeforeUnloadHandler;
          }
          if (window._syncVisibilityHandler) {
            document.removeEventListener('visibilitychange', window._syncVisibilityHandler);
            delete window._syncVisibilityHandler;
          }
          if (window._syncHashChangeHandler) {
            window.removeEventListener('hashchange', window._syncHashChangeHandler);
            delete window._syncHashChangeHandler;
          }

          // Log complete sync diagnostics
          const totalTime = Date.now() - syncStartTime;
          SyncDiagnostics.logSync('SYNC COMPLETED SUCCESSFULLY', {
            totalTimeMs: totalTime,
            finalCounts: finalCheck
          });

          // Clear bidirectional sync flag
          if (typeof window !== 'undefined') {
            window._bidirectionalSyncInProgress = false;
          }

        } catch (error) {
          console.error('❌ Failed to apply Android changes:', error);
          console.error('❌ Error stack:', error.stack);

          // Provide detailed error information
          const errorDetails = {
            message: error.message,
            name: error.name,
            phase: 'applying-changes'
          };
          SyncDiagnostics.logError('Failed to apply Android changes', errorDetails);

          // Try to send error to Android
          try {
            await sendMessage({
              type: 'error',
              error: error.message,
              details: errorDetails
            });
            console.log('📤 Sent error notification to Android');
          } catch (sendError) {
            console.error('❌ Failed to send error message to Android:', sendError);
          }

          // Emit error event for UI
          emit('sync-error', {
            error: error.message,
            details: errorDetails
          });

          syncInProgress = false;

          // Clear bidirectional sync flag
          if (typeof window !== 'undefined') {
            window._bidirectionalSyncInProgress = false;
          }
        } finally {
          // Remove listeners
          off('message:changes', androidChangesListener);
          off('message:syncData', androidChangesListener);

          // Clear bidirectional sync flag
          if (typeof window !== 'undefined') {
            window._bidirectionalSyncInProgress = false;
          }
        }
      };

      // Listen for both message types
      on('message:changes', androidChangesListener);
      on('message:syncData', androidChangesListener);

      // Set longer timeout for Android response (60 seconds)
      setTimeout(() => {
        if (syncInProgress) {
          off('message:changes', androidChangesListener);
          off('message:syncData', androidChangesListener);
          console.warn('⚠️ Timeout waiting for Android changes after 60 seconds');
          syncInProgress = false;

          // Clear bidirectional sync flag
          if (typeof window !== 'undefined') {
            window._bidirectionalSyncInProgress = false;
          }

          // Send error to let Android know we timed out
          sendMessage({
            type: 'error',
            error: 'Web app timed out waiting for changes'
          }).catch(console.error);
        }
      }, 60000);

      console.log('⏳ Waiting for Android changes response...');

    } catch (error) {
      console.error('❌ Metadata exchange failed:', error);
      syncInProgress = false;

      // Clear bidirectional sync flag
      if (typeof window !== 'undefined') {
        window._bidirectionalSyncInProgress = false;
      }

      try {
        await sendMessage({
          type: 'error',
          error: 'Metadata exchange failed: ' + error.message
        });
      } catch (sendError) {
        console.error('❌ Failed to send error message:', sendError);
      }
    }
  };

  /**
   * Get web app metadata
   */
  const getWebMetadata = async () => {
    try {
      const metadata = await Storage.getMetadata();
      // Use getWebPeerId if available, otherwise generate a new one
      const deviceId = PairingManager.getWebPeerId?.() || 'web-' + Date.now();

      return {
        deviceId: deviceId,
        deviceName: 'BudgetTact Web',
        version: '1.0',
        currency: metadata?.currency || 'USD',
        lastSync: PairingManager.getLastSyncTime(),
        exportedAt: new Date().toISOString(),
        platform: 'web',
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('❌ Failed to get web metadata:', error);
      // Return fallback metadata
      return {
        deviceId: 'web-' + Date.now(),
        deviceName: 'BudgetTact Web',
        version: '1.0',
        currency: 'USD',
        lastSync: null,
        exportedAt: new Date().toISOString(),
        platform: 'web',
        timestamp: Date.now()
      };
    }
  };

  /**
   * Verify that data was successfully saved to IndexedDB
   */
  const verifyDataSaved = async () => {
    try {
      const counts = {
        transactions: await Storage.db.transactions.count(),
        categories: await Storage.db.categories.count(),
        savingsGoals: await Storage.db.savingsGoals.count(),
        budgetHistory: await Storage.db.budgetHistory.count()
      };

      console.log('📊 IndexedDB counts:', counts);

      // Check if we have at least some data
      const hasData = counts.transactions > 0 || counts.categories > 0 || counts.savingsGoals > 0;

      if (!hasData) {
        return {
          success: false,
          error: 'No data found in IndexedDB after sync',
          counts
        };
      }

      return {
        success: true,
        counts
      };
    } catch (error) {
      console.error('❌ Error verifying data:', error);
      return {
        success: false,
        error: error.message,
        counts: {}
      };
    }
  };

  /**
   * Send a message via the data channel
   */
  const sendMessage = async (message) => {
    if (!dataChannel) {
      throw new Error('Data channel is not initialized');
    }

    if (dataChannel.readyState !== 'open') {
      throw new Error(`Data channel is not open (state: ${dataChannel.readyState})`);
    }

    try {
      const messageString = JSON.stringify(message);
      console.log(`📤 [DataChannel] Sending message:`, message);
      dataChannel.send(messageString);
      console.log(`📤 [DataChannel] Message sent successfully (${messageString.length} bytes)`);
    } catch (error) {
      console.error('❌ [DataChannel] Failed to send message:', error);
      console.error('❌ [DataChannel] Message that failed to send:', message);
      throw error;
    }
  };

  /**
   * Check if changes object has any actual changes
   */
  const hasChanges = (changes) => {
    if (!changes) return false;
    const changeTypes = ['transactions', 'categories', 'budgetHistory', 'savingsGoals', 'goalTransactions', 'recurringTransactions', 'billers'];
    return changeTypes.some(type => changes[type] && changes[type].length > 0);
  };

  /**
   * Count total changes
   */
  const countChanges = (changes) => {
    if (!changes) return 0;
    let count = 0;
    ['transactions', 'categories', 'budgetHistory', 'savingsGoals', 'goalTransactions', 'recurringTransactions', 'billers'].forEach((key) => {
      if (changes[key]) count += changes[key].length;
    });
    return count;
  };

  /**
   * Send acknowledgment to Android
   */
  const sendAck = () => {
    if (dataChannel?.readyState === 'open') {
      dataChannel.send(JSON.stringify({
        type: 'ack',
        timestamp: new Date().toISOString()
      }));
      console.log('✅ ACK sent to Android');
    }
  };

  /**
   * Send pong response
   */
  const sendPong = () => {
    if (dataChannel?.readyState === 'open') {
      dataChannel.send(JSON.stringify({
        type: 'pong',
        timestamp: new Date().toISOString()
      }));
    }
  };

  /**
   * Send error message
   */
  const sendError = (errorMessage) => {
    if (dataChannel?.readyState === 'open') {
      dataChannel.send(JSON.stringify({
        type: 'error',
        error: errorMessage,
        timestamp: new Date().toISOString()
      }));
    }
  };

  /**
   * Send signaling message via WebSocket
   */
  const sendSignalingMessage = (message) => {
    if (signalingSocket?.readyState === WebSocket.OPEN) {
      signalingSocket.send(JSON.stringify(message));
    } else {
      console.error('❌ Cannot send signaling message - socket not open');
    }
  };

  /**
   * Update connection state
   */
  const updateState = (state) => {
    console.log('📊 State changed:', state);
    if (onStateChangeCallback) {
      onStateChangeCallback(state);
    }
    emit('state', state);
  };

  /**
   * Generate random token for PeerJS
   */
  const generateToken = () => {
    return Math.random().toString(36).substring(2, 15);
  };

  /**
   * Disconnect and clean up
   */
  const disconnect = () => {
    console.log('🧹 Cleaning up...');

    // Clear timeout
    if (connectionTimeout) {
      clearTimeout(connectionTimeout);
      connectionTimeout = null;
    }

    // Close data channel
    if (dataChannel) {
      dataChannel.close();
      dataChannel = null;
    }

    // Close peer connection
    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
    }

    // Close signaling socket
    if (signalingSocket) {
      signalingSocket.close();
      signalingSocket = null;
    }

    updateState('disconnected');
  };

  /**
   * Set callback for received data (legacy single callback)
   */
  const onData = (callback) => {
    if (typeof callback === 'function' && !dataHandlers.includes(callback)) {
      dataHandlers.push(callback);
    }
  };

  /**
   * Remove a data handler
   * @param {Function} callback - Handler to remove
   */
  const offData = (callback) => {
    const index = dataHandlers.indexOf(callback);
    if (index > -1) {
      dataHandlers.splice(index, 1);
      console.log('🗑️ [DataChannel] Removed data handler');
    }
  };

  /**
   * Set callback for state changes
   */
  const onStateChange = (callback) => {
    onStateChangeCallback = callback;
  };

  const send = async (payload) => {
    if (dataChannel?.readyState !== 'open') {
      throw new Error('Data channel is not open');
    }
    dataChannel.send(JSON.stringify(payload));
  };

  const waitForMessage = (type, timeout = 15000) => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off(`message:${type}`, handler);
        reject(new Error(`Timed out waiting for message type ${type}`));
      }, timeout);

      const handler = (message) => {
        clearTimeout(timer);
        off(`message:${type}`, handler);
        resolve(message);
      };

      on(`message:${type}`, handler);
    });
  };

  const isConnected = () => dataChannel?.readyState === 'open';

  function on(event, callback) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(callback);
  }

  function once(event, callback) {
    const wrapper = (data) => {
      off(event, wrapper);
      callback(data);
    };
    on(event, wrapper);
  }

  function off(event, callback) {
    if (!listeners[event]) return;
    listeners[event] = listeners[event].filter(cb => cb !== callback);
  }

  function emit(event, data) {
    if (!listeners[event]) return;
    listeners[event].forEach(cb => cb(data));
  }

  // Public API
  return {
    init,
    preConnect,
    disconnect,
    onData,
    offData,
    onStateChange,
    send,
    waitForMessage,
    on,
    once,
    off,
    emit,  // Expose emit for external event triggering (e.g., from BidirectionalSync)
    isConnected,
    getConnectedServer,
    getPeerId: () => myPeerId
  };
})();
