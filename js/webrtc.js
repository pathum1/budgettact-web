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
  const listeners = {};

  // PeerJS signaling server configuration
  const SIGNALING_SERVER = 'wss://0.peerjs.com/peerjs';
  const PEERJS_KEY = 'peerjs';

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
    console.log('📋 Android metadata received:', androidMetadata);

    // Set flag for main message handler to know bidirectional sync is in progress
    if (typeof window !== 'undefined') {
      window._bidirectionalSyncInProgress = true;
    }

    try {
      // Get web app metadata
      const webMetadata = await getWebMetadata();
      console.log('📋 Web metadata prepared:', webMetadata);

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
      console.log('📤 Sent web metadata to Android');

      // Get web app changes and send them
      const ourChanges = await incrementalSyncManager.getChangesSinceLastSync();
      console.log('📦 Web changes ready:', ourChanges ? 'Changes found' : 'No changes');

      if (ourChanges && hasChanges(ourChanges)) {
        await sendMessage({
          type: 'changes',
          data: ourChanges
        });
        console.log(`📤 Sent ${countChanges(ourChanges)} changes to Android`);
      } else {
        // Still send empty changes to indicate completion
        await sendMessage({
          type: 'changes',
          data: {}
        });
        console.log('📤 Sent empty changes (up to date)');
      }

      // Set up listener for Android's changes response (could be 'changes' or 'syncData' type)
      const androidChangesListener = async (message) => {
        if (!syncInProgress) return;

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

            // Log IndexedDB state BEFORE applying changes
            const countsBefore = {
              transactions: await Storage.db.transactions.count(),
              categories: await Storage.db.categories.count(),
              savingsGoals: await Storage.db.savingsGoals.count()
            };
            console.log('📊 IndexedDB BEFORE apply:', countsBefore);

            applyResult = await incrementalSyncManager.applyIncomingChanges(actualData);
            console.log(`✅ Applied ${applyResult.applied} changes from Android (${applyResult.conflicts} conflicts)`);

            // Log IndexedDB state AFTER applying changes
            const countsAfter = {
              transactions: await Storage.db.transactions.count(),
              categories: await Storage.db.categories.count(),
              savingsGoals: await Storage.db.savingsGoals.count()
            };
            console.log('📊 IndexedDB AFTER apply:', countsAfter);
            console.log('📊 Difference:', {
              transactions: countsAfter.transactions - countsBefore.transactions,
              categories: countsAfter.categories - countsBefore.categories,
              savingsGoals: countsAfter.savingsGoals - countsBefore.savingsGoals
            });
          } else {
            console.error('❌ Unknown data structure from Android:', actualData);
            throw new Error('Unrecognized data format from Android');
          }

          // Verify data was actually saved to IndexedDB
          // Add a delay to ensure IndexedDB transactions are fully committed
          console.log('🔍 Verifying data was saved to IndexedDB (applied: ' + applyResult.applied + ' changes)...');
          console.log('⏳ Waiting 200ms for IndexedDB transaction commit...');
          await new Promise(resolve => setTimeout(resolve, 200));
          const verificationResult = await verifyDataSaved();

          if (!verificationResult.success) {
            console.error('❌ Data verification failed:', verificationResult.error);
            console.error('   Applied changes:', applyResult.applied);
            console.error('   Received from Android:', {
              transactions: actualData.transactions?.length || 0,
              categories: actualData.categories?.length || 0,
              savingsGoals: actualData.savingsGoals?.length || 0
            });
            console.error('   This suggests data was marked as applied but not actually saved to IndexedDB');
            console.error('   Possible causes: IndexedDB permission issue, quota exceeded, or storage.js bug');
            throw new Error(`Data verification failed: ${verificationResult.error}`);
          }

          console.log('✅ Data verification successful:', {
            transactionCount: verificationResult.counts.transactions,
            categoryCount: verificationResult.counts.categories,
            savingsGoalCount: verificationResult.counts.savingsGoals
          });

          // Send sync completion message
          await sendMessage({
            type: 'syncComplete',
            applied: applyResult.applied,
            conflicts: applyResult.conflicts
          });
          console.log('📤 Sent sync completion to Android');

          // Emit event to update UI
          emit('sync-completed', {
            received: applyResult.applied,
            conflicts: applyResult.conflicts,
            verified: true,
            counts: verificationResult.counts
          });

          syncInProgress = false;

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
    disconnect,
    onData,
    onStateChange,
    send,
    waitForMessage,
    on,
    once,
    off,
    isConnected
  };
})();
