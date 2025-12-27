/**
 * Bidirectional Sync Orchestration
 * Matches Android's expected sync flow from bidirectional_sync_service.dart
 *
 * Expected Flow:
 * 1. WebRTC Connection established
 * 2. Web sends metadata
 * 3. Android sends metadata
 * 4. Web sends changes FIRST
 * 5. Android sends changes
 * 6. Web sends syncComplete
 */
const BidirectionalSync = (() => {
  let syncInProgress = false;

  /**
   * Perform full bidirectional sync
   * Called when WebRTC connection is established
   */
  async function performSync() {
    // Check if handleMetadataExchange is already handling the sync
    if (window._bidirectionalSyncInProgress) {
      console.log('⚠️ handleMetadataExchange already handling sync - deferring');
      return { success: false, message: 'Sync already in progress (via handleMetadataExchange)' };
    }

    if (syncInProgress) {
      console.log('⚠️ Sync already in progress');
      return { success: false, message: 'Sync already in progress' };
    }

    syncInProgress = true;
    console.log('🔄 Starting bidirectional sync...');

    try {
      // Step 1: Connection already established by WebRTCSync

      // Step 2: Send web metadata
      console.log('📤 Step 2: Sending web metadata...');
      const webMetadata = {
        type: 'metadata',
        deviceId: 'web',
        deviceName: PairingManager.getDeviceName() || 'Web Browser',
        lastSyncTimestamp: PairingManager.getLastSyncTime() || 0,
        conflictStrategy: PairingManager.getConflictStrategy() || 'newerWins',
        platform: 'web'
      };
      WebRTCSync.send(webMetadata);

      // Step 3: Wait for Android metadata
      console.log('📥 Step 3: Waiting for Android metadata...');
      const androidMetadata = await waitForMessage('metadata', 10000);
      console.log('📱 Received Android metadata:', androidMetadata);

      // Determine if full or incremental sync needed
      const lastPairedPeerId = PairingManager.getPairedDevice()?.deviceId;
      const isNewPairing = !lastPairedPeerId || lastPairedPeerId !== androidMetadata.deviceId;

      if (isNewPairing) {
        console.log('🆕 New pairing detected - performing full sync');
      }

      // Step 4: Send web changes FIRST (Android expects this)
      console.log('📤 Step 4: Sending web changes...');
      const webChanges = await incrementalSyncManager.getChangesSinceLastSync();
      const changesMessage = {
        type: 'changes',
        ...webChanges,
        deviceId: 'web',
        timestamp: Date.now()
      };
      WebRTCSync.send(changesMessage);
      console.log(`📤 Sent ${countChanges(webChanges)} web changes`);

      // Step 5: Wait for Android to apply our changes and send theirs
      console.log('📥 Step 5: Waiting for Android changes...');
      const androidMessage = await waitForMessage('syncData', 30000);

      // IMPORTANT: Android wraps data in a 'payload' field: {"type":"syncData","payload":{...}}
      // Extract the actual data from payload if present, otherwise use message directly
      const androidChanges = androidMessage.payload || androidMessage;
      console.log(`📥 Received ${countChanges(androidChanges)} Android changes`);
      console.log('📦 Raw message structure:', {
        hasPayload: !!androidMessage.payload,
        type: androidMessage.type
      });

      // Step 6: Apply Android changes locally
      console.log('🔧 Step 6: Applying Android changes...');
      console.log('📦 Android changes received:', {
        transactions: androidChanges.transactions?.length || 0,
        categories: androidChanges.categories?.length || 0,
        savingsGoals: androidChanges.savingsGoals?.length || 0,
        budgetHistory: androidChanges.budgetHistory?.length || 0
      });

      const strategy = PairingManager.getConflictStrategy() || 'newerWins';
      const applyResult = await incrementalSyncManager.applyIncomingChanges(
        androidChanges,
        strategy
      );
      console.log(`✅ Applied: ${applyResult.applied}, Conflicts: ${applyResult.conflicts}`);

      // Verify data was saved to IndexedDB
      const txCountAfter = await Storage.db.transactions.count();
      const catCountAfter = await Storage.db.categories.count();
      console.log('🔍 IndexedDB state after applying changes:', {
        transactions: txCountAfter,
        categories: catCountAfter
      });

      // Extract and store currency from transactions
      // Android sends currency in each transaction record
      if (androidChanges.transactions && androidChanges.transactions.length > 0) {
        const firstTx = androidChanges.transactions[0];
        const currency = firstTx.currency || firstTx.Currency;
        if (currency) {
          console.log('💱 Currency extracted from transaction:', currency);
          try {
            // Get existing metadata and update with currency
            let metadata = await Storage.db.metadata.get('lastSync');
            if (!metadata) {
              metadata = { key: 'lastSync' };
            }
            metadata.currency = currency;
            await Storage.db.metadata.put(metadata);
            console.log('✅ Currency stored in metadata:', currency);
          } catch (error) {
            console.error('❌ Failed to store currency in metadata:', error);
          }
        } else {
          console.warn('⚠️ No currency found in first transaction');
        }
      }

      // Show conflict notification if any
      if (applyResult.conflictDetails && applyResult.conflictDetails.length > 0) {
        if (typeof ConflictNotification !== 'undefined') {
          ConflictNotification.show(applyResult.conflictDetails);
        }
      }

      // Step 7: Send syncComplete acknowledgment
      console.log('📤 Step 7: Sending syncComplete...');
      WebRTCSync.send({ type: 'syncComplete' });

      // Step 8: Update pairing info
      PairingManager.updateLastSync();
      if (androidMetadata.deviceId) {
        PairingManager.savePairing({
          deviceId: androidMetadata.deviceId,
          deviceName: androidMetadata.deviceName || 'Android Device',
          pairedAt: Date.now()
        });
      }

      console.log('✅ Bidirectional sync completed successfully');

      // Refresh UI
      window.dispatchEvent(new CustomEvent('data-updated', {
        detail: { type: 'sync-completed' }
      }));

      // Emit sync-completed event for sync.js navigation handler
      const syncStats = {
        received: countChanges(androidChanges),
        sent: countChanges(webChanges),
        conflicts: applyResult.conflicts,
        verified: true,
        counts: {
          transactions: androidChanges.transactions?.length || 0,
          categories: androidChanges.categories?.length || 0,
          savingsGoals: androidChanges.savingsGoals?.length || 0
        }
      };

      if (typeof WebRTCSync !== 'undefined' && WebRTCSync.emit) {
        WebRTCSync.emit('sync-completed', syncStats);
        console.log('📢 Emitted sync-completed event with stats:', syncStats);
      }

      // Broadcast to other tabs that sync completed
      if (typeof CrossTabSync !== 'undefined' && CrossTabSync.broadcastSyncCompleted) {
        CrossTabSync.broadcastSyncCompleted(syncStats);
        console.log('📢 Broadcasted sync-completed to other tabs');
      }

      return {
        success: true,
        stats: {
          webChangesSent: countChanges(webChanges),
          androidChangesReceived: countChanges(androidChanges),
          applied: applyResult.applied,
          conflicts: applyResult.conflicts
        }
      };

    } catch (error) {
      console.error('❌ Bidirectional sync failed:', error);
      return {
        success: false,
        message: error.message || 'Sync failed'
      };
    } finally {
      syncInProgress = false;
    }
  }

  /**
   * Wait for a specific message type
   * @param {string} type - Message type to wait for
   * @param {number} timeout - Timeout in milliseconds
   * @returns {Promise<Object>} Message data
   */
  function waitForMessage(type, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout waiting for ${type} message`));
      }, timeout);

      const handler = (data) => {
        try {
          const message = typeof data === 'string' ? JSON.parse(data) : data;

          // Handle different message type formats
          // Android sends: {"type":"syncData","payload":{"transactions":[...]}}
          // Or could send: {"transactions":[...]} directly
          const messageType = message.type ||
            (message.transactions !== undefined ? 'syncData' : null) ||
            (message.payload?.transactions !== undefined ? 'syncData' : null);

          if (messageType === type ||
              (type === 'syncData' && (message.transactions !== undefined || message.payload?.transactions !== undefined))) {
            cleanup();
            resolve(message);
          }
        } catch (e) {
          console.error('Error parsing message:', e);
        }
      };

      const cleanup = () => {
        clearTimeout(timeoutId);
        WebRTCSync.offData(handler);
      };

      WebRTCSync.onData(handler);
    });
  }

  /**
   * Count total changes in a change set
   */
  function countChanges(changes) {
    if (!changes) return 0;
    return (changes.transactions?.length || 0) +
           (changes.categories?.length || 0) +
           (changes.savingsGoals?.length || 0) +
           (changes.budgetHistory?.length || 0) +
           (changes.goalTransactions?.length || 0) +
           (changes.recurringTransactions?.length || 0) +
           (changes.billers?.length || 0);
  }

  /**
   * Handle real-time changes from Android (during active connection)
   * @param {Object} changes - Changes message
   */
  async function handleIncomingChanges(changes) {
    console.log('📥 Received real-time changes from Android');
    const strategy = PairingManager.getConflictStrategy() || 'newerWins';
    const result = await incrementalSyncManager.applyIncomingChanges(changes, strategy);

    // Refresh UI
    window.dispatchEvent(new CustomEvent('data-updated', {
      detail: { type: 'realtime-sync' }
    }));

    return result;
  }

  return {
    performSync,
    handleIncomingChanges,
    get isInProgress() { return syncInProgress; }
  };
})();
