/**
 * BudgetTact Web - Raw WebRTC Sync (Server Mode)
 * Compatible with flutter_webrtc on Android
 * Uses manual signaling through PeerJS server infrastructure
 */

const WebRTCSync = (() => {
  let peerConnection = null;
  let dataChannel = null;
  let signalingSocket = null;
  let onDataCallback = null;
  let onStateChangeCallback = null;
  let myPeerId = null;
  let remotePeerId = null;
  let connectionTimeout = null;

  // PeerJS signaling server configuration
  const SIGNALING_SERVER = 'wss://0.peerjs.com/peerjs';
  const PEERJS_KEY = 'peerjs';

  // WebRTC configuration
  const rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ],
    sdpSemantics: 'unified-plan'
  };

  /**
   * Initialize WebRTC as server - wait for Android to connect
   * @param {string} peerId - Unique peer ID for this session
   * @returns {Promise<string>} Resolves with peer ID when ready
   */
  const init = (peerId) => {
    return new Promise((resolve, reject) => {
      try {
        console.log('🔵 WebRTCSync.init() called with peerId:', peerId);
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
   * Connect to PeerJS signaling server via WebSocket
   */
  const connectToSignalingServer = (peerId) => {
    return new Promise((resolve, reject) => {
      try {
        // Build WebSocket URL for PeerJS server
        const wsUrl = `${SIGNALING_SERVER}?key=${PEERJS_KEY}&id=${peerId}&token=${generateToken()}`;
        console.log('🔌 Connecting to signaling server:', wsUrl);

        signalingSocket = new WebSocket(wsUrl);

        signalingSocket.onopen = () => {
          console.log('✅ [Signaling] WebSocket connected');
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
          console.error('❌ [Signaling] WebSocket error:', error);
          updateState('error');
          reject(error);
        };

        signalingSocket.onclose = () => {
          console.log('🔌 [Signaling] WebSocket closed');
        };
      } catch (err) {
        reject(err);
      }
    });
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
        console.log('🧊 [WebRTC] Sending ICE candidate to Android');
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
      console.log('🔗 [WebRTC] ICE connection state:', peerConnection.iceConnectionState);

      if (peerConnection.iceConnectionState === 'connected') {
        console.log('✅ [WebRTC] Peer connection established!');
      } else if (peerConnection.iceConnectionState === 'disconnected') {
        updateState('disconnected');
      } else if (peerConnection.iceConnectionState === 'failed') {
        console.error('❌ [WebRTC] Connection failed');
        updateState('error');
      }
    };

    // Handle data channel from Android
    peerConnection.ondatachannel = (event) => {
      console.log('📱 [WebRTC] Data channel received from Android!');
      dataChannel = event.channel;
      setupDataChannelHandlers();
    };

    // Connection state
    peerConnection.onconnectionstatechange = () => {
      console.log('🔗 [WebRTC] Connection state:', peerConnection.connectionState);
    };
  };

  /**
   * Set up data channel event handlers
   */
  const setupDataChannelHandlers = () => {
    dataChannel.onopen = () => {
      console.log('✅ [DataChannel] Opened!');
      updateState('connected');

      // Clear expiration timeout
      if (connectionTimeout) {
        clearTimeout(connectionTimeout);
        connectionTimeout = null;
      }
    };

    dataChannel.onmessage = (event) => {
      console.log('📦 [DataChannel] Received data');
      try {
        const message = JSON.parse(event.data);
        handleIncomingData(message);
      } catch (err) {
        console.error('❌ [DataChannel] Failed to parse data:', err);
      }
    };

    dataChannel.onclose = () => {
      console.log('🔌 [DataChannel] Closed');
      updateState('disconnected');
    };

    dataChannel.onerror = (error) => {
      console.error('❌ [DataChannel] Error:', error);
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

      default:
        console.warn('⚠️ Unknown message type:', message.type);
    }
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
   * Set callback for received data
   */
  const onData = (callback) => {
    onDataCallback = callback;
  };

  /**
   * Set callback for state changes
   */
  const onStateChange = (callback) => {
    onStateChangeCallback = callback;
  };

  // Public API
  return {
    init,
    disconnect,
    onData,
    onStateChange
  };
})();
