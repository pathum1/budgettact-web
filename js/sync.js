const Sync = (() => {
  /**
   * Validate sync payload against SYNC_CONTRACT.md
   * @param {Object} payload - Parsed JSON payload
   * @returns {Object} { valid: boolean, errors: string[] }
   */
  function validateSyncPayload(payload) {
    const errors = [];

    // Check root structure
    if (!payload || typeof payload !== 'object') {
      errors.push('Invalid payload: must be a JSON object');
      return { valid: false, errors };
    }

    // Check version
    if (!payload.version) {
      errors.push('Missing required field: version');
    } else if (payload.version !== '1.0') {
      errors.push(`Unsupported version: ${payload.version} (expected 1.0)`);
    }

    // Check required root fields
    if (!payload.exportedAt) {
      errors.push('Missing required field: exportedAt');
    }

    if (!payload.deviceId) {
      errors.push('Missing required field: deviceId');
    }

    if (!payload.currency) {
      errors.push('Missing required field: currency');
    }

    // Check data object
    if (!payload.data || typeof payload.data !== 'object') {
      errors.push('Missing or invalid data object');
      return { valid: false, errors };
    }

    const { data } = payload;

    // Check required arrays exist
    const requiredArrays = [
      'transactions',
      'categories',
      'budgetHistory',
      'savingsGoals',
      'goalTransactions',
      'recurringTransactions',
      'billers'
    ];

    for (const arrayName of requiredArrays) {
      if (!Array.isArray(data[arrayName])) {
        errors.push(`Missing or invalid array: data.${arrayName}`);
      }
    }

    // Stop here if basic structure is invalid
    if (errors.length > 0) {
      return { valid: false, errors };
    }

    // Validate transactions
    if (data.transactions.length > 0) {
      const transactionErrors = validateTransactions(data.transactions);
      errors.push(...transactionErrors);
    }

    // Validate categories
    if (data.categories.length > 0) {
      const categoryErrors = validateCategories(data.categories);
      errors.push(...categoryErrors);
    }

    // Validate savings goals
    if (data.savingsGoals.length > 0) {
      const goalErrors = validateSavingsGoals(data.savingsGoals);
      errors.push(...goalErrors);
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate transactions array
   */
  function validateTransactions(transactions) {
    const errors = [];
    const validTypes = ['expense', 'income'];

    // Sample validation (check first few items)
    const sampleSize = Math.min(5, transactions.length);

    for (let i = 0; i < sampleSize; i++) {
      const t = transactions[i];

      if (!t.transactionID) {
        errors.push(`Transaction ${i}: missing transactionID`);
      }

      if (!t.merchantName) {
        errors.push(`Transaction ${i}: missing merchantName`);
      }

      if (!t.transactionDate) {
        errors.push(`Transaction ${i}: missing transactionDate`);
      } else if (!isValidISODate(t.transactionDate)) {
        errors.push(`Transaction ${i}: invalid date format`);
      }

      if (!t.transactionType) {
        errors.push(`Transaction ${i}: missing transactionType`);
      } else if (!validTypes.includes(t.transactionType)) {
        errors.push(`Transaction ${i}: invalid transactionType (must be 'expense' or 'income')`);
      }

      if (typeof t.transactionAmount !== 'number') {
        errors.push(`Transaction ${i}: invalid transactionAmount (must be number)`);
      }

      if (typeof t.transactionCategory !== 'number') {
        errors.push(`Transaction ${i}: invalid transactionCategory (must be number)`);
      }
    }

    return errors;
  }

  /**
   * Validate categories array
   */
  function validateCategories(categories) {
    const errors = [];

    for (let i = 0; i < Math.min(5, categories.length); i++) {
      const c = categories[i];

      if (typeof c.id !== 'number') {
        errors.push(`Category ${i}: missing or invalid id`);
      }

      if (!c.categoryType) {
        errors.push(`Category ${i}: missing categoryType`);
      }

      if (typeof c.budgetAmount !== 'number') {
        errors.push(`Category ${i}: invalid budgetAmount`);
      }

      if (typeof c.autoPropagateToNextMonth !== 'boolean') {
        errors.push(`Category ${i}: invalid autoPropagateToNextMonth (must be boolean)`);
      }

      if (typeof c.budgetNotificationsEnabled !== 'boolean') {
        errors.push(`Category ${i}: invalid budgetNotificationsEnabled (must be boolean)`);
      }
    }

    return errors;
  }

  /**
   * Validate savings goals array
   */
  function validateSavingsGoals(goals) {
    const errors = [];
    const validPriorities = ['high', 'medium', 'low'];
    const validCategories = ['emergency', 'vacation', 'vehicle', 'investment', 'home', 'education', 'custom'];

    for (let i = 0; i < Math.min(5, goals.length); i++) {
      const g = goals[i];

      if (typeof g.id !== 'number') {
        errors.push(`Goal ${i}: missing or invalid id`);
      }

      if (!g.goalName) {
        errors.push(`Goal ${i}: missing goalName`);
      }

      if (typeof g.targetAmount !== 'number') {
        errors.push(`Goal ${i}: invalid targetAmount`);
      }

      if (typeof g.currentAmount !== 'number') {
        errors.push(`Goal ${i}: invalid currentAmount`);
      }

      if (g.priority && !validPriorities.includes(g.priority)) {
        errors.push(`Goal ${i}: invalid priority`);
      }

      if (g.category && !validCategories.includes(g.category)) {
        errors.push(`Goal ${i}: invalid category`);
      }

      if (typeof g.isActive !== 'boolean') {
        errors.push(`Goal ${i}: invalid isActive (must be boolean)`);
      }
    }

    return errors;
  }

  /**
   * Check if string is valid ISO 8601 date
   */
  function isValidISODate(dateString) {
    if (typeof dateString !== 'string') return false;

    try {
      const date = new Date(dateString);
      return date.toISOString() === dateString || !isNaN(date.getTime());
    } catch {
      return false;
    }
  }

  /**
   * Import sync data (parse JSON and validate)
   * @param {string} jsonString - JSON string from Android app
   * @returns {Promise<Object>} { success: boolean, message: string, stats?: Object }
   */
  async function importSyncData(jsonString) {
    try {
      // Step 1: Parse JSON
      let payload;
      try {
        payload = JSON.parse(jsonString);
      } catch (error) {
        return {
          success: false,
          message: 'Invalid JSON format. Please check the exported data.'
        };
      }

      // Step 2: Validate structure
      const validation = validateSyncPayload(payload);

      if (!validation.valid) {
        return {
          success: false,
          message: 'Data validation failed',
          errors: validation.errors
        };
      }

      // Step 3: Import to IndexedDB
      try {
        await Storage.importData(payload);
      } catch (error) {
        console.error('Import error:', error);
        return {
          success: false,
          message: 'Failed to save data to database. Please try again.'
        };
      }

      // Step 4: Calculate stats
      const stats = {
        transactions: payload.data.transactions.length,
        categories: payload.data.categories.length,
        goals: payload.data.savingsGoals.length,
        exportedAt: payload.exportedAt,
        deviceName: payload.deviceName || 'Unknown Device'
      };

      return {
        success: true,
        message: 'Data imported successfully!',
        stats
      };
    } catch (error) {
      console.error('Unexpected error during import:', error);
      return {
        success: false,
        message: 'An unexpected error occurred. Please try again.'
      };
    }
  }

  /**
   * Get import summary stats
   */
  async function getImportStats() {
    try {
      const metadata = await Storage.getMetadata();
      if (!metadata) return null;

      const [transactions, categories, goals] = await Promise.all([
        Storage.db.transactions.count(),
        Storage.db.categories.count(),
        Storage.db.savingsGoals.count()
      ]);

      return {
        transactions,
        categories,
        goals,
        lastSync: metadata.exportedAt,
        deviceName: metadata.deviceName,
        importedAt: metadata.importedAt
      };
    } catch (error) {
      console.error('Failed to get import stats:', error);
      return null;
    }
  }

  /**
   * Import already-parsed sync payload (for WebRTC)
   * @param {Object} payload - Already parsed sync payload object
   * @returns {Promise<Object>} { success: boolean, message: string, stats?: Object }
   */
  async function importSyncPayload(payload) {
    try {
      // Step 1: Validate structure (payload already parsed)
      const validation = validateSyncPayload(payload);

      if (!validation.valid) {
        return {
          success: false,
          message: 'Data validation failed',
          errors: validation.errors
        };
      }

      // Step 2: Import to IndexedDB
      try {
        await Storage.importData(payload);
      } catch (error) {
        console.error('Import error:', error);
        return {
          success: false,
          message: 'Failed to save data to database. Please try again.'
        };
      }

      // Step 3: Calculate stats
      const stats = {
        transactions: payload.data.transactions.length,
        categories: payload.data.categories.length,
        goals: payload.data.savingsGoals.length,
        exportedAt: payload.exportedAt,
        deviceName: payload.deviceName || 'Unknown Device'
      };

      return {
        success: true,
        message: 'Data synced successfully!',
        stats
      };
    } catch (error) {
      console.error('Unexpected error during import:', error);
      return {
        success: false,
        message: 'An unexpected error occurred. Please try again.'
      };
    }
  }

  /**
   * Initialize WebRTC sync with QR code display
   * Automatically called when sync view is shown
   */
  async function initializeWebRTCSync(showStatusCallback, showErrorCallback) {
    try {
      if (showStatusCallback) {
        showStatusCallback('Connecting to signaling server...');
      }

      // First, pre-connect to signaling server with fallback support
      // This ensures we know which server works before generating the QR code
      let connectionInfo;
      try {
        connectionInfo = await WebRTCSync.preConnect();
        console.log('✅ Pre-connected to signaling server:', connectionInfo.server?.name);
      } catch (error) {
        console.error('❌ Failed to connect to any signaling server:', error);
        if (showErrorCallback) {
          showErrorCallback('Failed to connect to signaling server. Please check your internet connection and try again.');
        }
        throw error;
      }

      // Generate QR code with peer ID AND signaling server info
      const qrOptions = {
        peerId: connectionInfo.peerId  // Use the peer ID from preConnect
      };
      if (connectionInfo.server) {
        qrOptions.signalingServer = connectionInfo.server.url;
      }
      const peerId = QRGenerator.init('qrCodeContainer', qrOptions);

      if (!peerId) {
        throw new Error('Failed to generate QR code');
      }

      if (showStatusCallback) {
        showStatusCallback('Waiting for phone to scan...');
      }

      // Set up data callback - triggered when Android sends sync data
      // NOTE: This is a legacy handler for direct sync data. When BidirectionalSync is running,
      // it handles all messaging, so we skip processing here to avoid conflicts.
      WebRTCSync.onData(async (syncData) => {
        // Skip if BidirectionalSync is handling the sync flow
        if (typeof BidirectionalSync !== 'undefined' && BidirectionalSync.isInProgress) {
          console.log('📋 [sync.js] Skipping onData - BidirectionalSync is handling messages');
          return;
        }

        if (showStatusCallback) {
          showStatusCallback('Receiving data...');
        }

        try {
          // Parse if string (data handlers receive raw strings)
          let parsedData = syncData;
          if (typeof syncData === 'string') {
            try {
              parsedData = JSON.parse(syncData);
            } catch (e) {
              console.error('Failed to parse sync data:', e);
              return; // Not valid JSON, ignore
            }
          }

          // Skip metadata messages - those are handled by BidirectionalSync
          if (parsedData.type === 'metadata' || parsedData.type === 'changes' ||
              parsedData.type === 'syncComplete' || parsedData.type === 'error') {
            console.log('📋 [sync.js] Skipping message type:', parsedData.type);
            return;
          }

          // Import data using existing function
          const result = await importSyncPayload(parsedData);

          if (result.success) {
            if (showStatusCallback) {
              showStatusCallback('✅ Sync complete! Redirecting to dashboard...');
            }

            // Save pairing information
            PairingManager.savePairing(
              parsedData.deviceId,
              parsedData.deviceName || 'Android Device'
            );
            console.log('✅ Device paired successfully');

            // Show success notification
            Utils.showNotification(
              `Successfully synced ${result.stats.transactions} transactions, ` +
              `${result.stats.categories} categories, and ${result.stats.goals} goals!`,
              'success',
              4000
            );

            // Disconnect and navigate to dashboard
            setTimeout(() => {
              WebRTCSync.disconnect();

              // Navigate to dashboard instead of full reload
              window.location.hash = 'dashboard';

              // Reload the page to ensure fresh data is loaded
              window.location.reload();
            }, 1500);
          } else {
            const errorMsg = result.errors ? result.errors.join(', ') : result.message;
            if (showErrorCallback) {
              showErrorCallback('Failed to import data: ' + errorMsg);
            }
            WebRTCSync.disconnect();
          }
        } catch (err) {
          console.error('Import error:', err);
          if (showErrorCallback) {
            showErrorCallback('Failed to import data: ' + err.message);
          }
          WebRTCSync.disconnect();
        }
      });

      // Set up state change callback
      WebRTCSync.onStateChange((state) => {
        switch (state) {
          case 'waiting':
            if (showStatusCallback) {
              showStatusCallback('Scan QR code with your phone');
            }
            break;
          case 'connected':
            if (showStatusCallback) {
              showStatusCallback('Phone connected! Waiting for data...');
            }
            break;
          case 'receiving':
            if (showStatusCallback) {
              showStatusCallback('Receiving data...');
            }
            break;
          case 'completed':
            if (showStatusCallback) {
              showStatusCallback('Sync complete!');
            }
            break;
          case 'error':
            if (showErrorCallback) {
              showErrorCallback('Connection error. Please try again.');
            }
            break;
          case 'expired':
            if (showErrorCallback) {
              showErrorCallback('QR code expired. Please refresh the page.');
            }
            break;
        }
      });

      // Listen for connection established - trigger bidirectional sync
      WebRTCSync.on('connection-established', async () => {
        // Use persistent logger
        if (typeof SyncDiagnostics !== 'undefined') {
          SyncDiagnostics.logSync('WebRTC connection-established event');
        }

        if (showStatusCallback) {
          showStatusCallback('Connected! Starting sync...');
        }

        try {
          // Trigger bidirectional sync orchestration
          // NOTE: This may return { success: false } if handleMetadataExchange is already handling.
          // That's OK - handleMetadataExchange will emit sync-completed when done.
          const result = await BidirectionalSync.performSync();
          console.log('📋 [SYNC-CONN] BidirectionalSync.performSync result:', result);

          if (result.success) {
            console.log('✅ Bidirectional sync completed successfully:', result.stats);

            if (showStatusCallback) {
              showStatusCallback('✅ Sync complete!');
            }

            // Show success notification
            Utils.showNotification(
              `Sync complete: ${result.stats.webChangesSent} sent, ${result.stats.androidChangesReceived} received`,
              'success',
              4000
            );

            // Verify data was actually saved before navigating
            console.log('📋 [SYNC-CONN] Verifying data was saved to IndexedDB...');
            const hasDataAfterSync = await Storage.hasData();
            const txCount = await Storage.db.transactions.count();
            const catCount = await Storage.db.categories.count();
            console.log('📋 [SYNC-CONN] Post-sync IndexedDB check:', {
              hasData: hasDataAfterSync,
              transactions: txCount,
              categories: catCount
            });

            if (!hasDataAfterSync && result.stats.androidChangesReceived > 0) {
              console.error('❌ CRITICAL: Data was not saved to IndexedDB despite sync completing!');
              console.error('   Expected', result.stats.androidChangesReceived, 'changes but hasData is false');
              Utils.showNotification(
                'Sync completed but data was not saved. Please check browser storage settings (not in incognito?)',
                'error',
                10000
              );
              return;
            }

            // Wait for IndexedDB to fully commit
            console.log('📋 [SYNC-CONN] Waiting 1500ms for IndexedDB commit...');
            await new Promise(resolve => setTimeout(resolve, 1500));

            // Final check before navigation
            const finalCheck = {
              transactions: await Storage.db.transactions.count(),
              categories: await Storage.db.categories.count()
            };
            console.log('📋 [SYNC-CONN] Final IndexedDB check before navigation:', finalCheck);

            // Navigate to dashboard WITHOUT reload
            console.log('📋 [SYNC-CONN] Navigating to dashboard (no reload)');
            window.location.hash = 'dashboard';
            window.dispatchEvent(new CustomEvent('data-updated'));

            // DO NOT reload - this was causing data loss!
            // The sync-completed event handler or app.js router will handle display
          } else {
            // This often means handleMetadataExchange is handling the sync instead
            // That's OK - it will emit sync-completed when done
            console.log('📋 [SYNC-CONN] BidirectionalSync deferred (likely handled by handleMetadataExchange)');
            console.log('📋 [SYNC-CONN] Message:', result.message);

            // Only show error if it's a real error, not just "already in progress"
            if (!result.message?.includes('already in progress')) {
              if (showErrorCallback) {
                showErrorCallback(`Sync issue: ${result.message}`);
              }
              Utils.showNotification(
                `Sync issue: ${result.message}`,
                'warning',
                5000
              );
            } else {
              // handleMetadataExchange is handling - just update status
              if (showStatusCallback) {
                showStatusCallback('Syncing data...');
              }
            }
          }
        } catch (error) {
          console.error('❌ Exception during bidirectional sync:', error);

          if (showErrorCallback) {
            showErrorCallback(`Sync error: ${error.message}`);
          }

          Utils.showNotification(
            `Sync error: ${error.message}`,
            'error',
            5000
          );
        }
      });

      // Listen for sync errors
      WebRTCSync.on('sync-error', (errorInfo) => {
        console.error('❌ Sync error received:', errorInfo);

        const errorMessage = errorInfo.error || 'Unknown sync error';
        const errorDetails = errorInfo.details || {};

        if (showErrorCallback) {
          showErrorCallback(`Sync failed: ${errorMessage}`);
        }

        // Show error notification
        Utils.showNotification(
          `Sync failed: ${errorMessage}`,
          'error',
          5000
        );

        // Disconnect WebRTC
        WebRTCSync.disconnect();
      });

      // Listen for incremental sync completion events
      WebRTCSync.on('sync-completed', async (result) => {
        // Use persistent logger
        if (typeof SyncDiagnostics !== 'undefined') {
          SyncDiagnostics.logNav('sync-completed event received', result);
        }

        // Verify that data verification passed
        if (result.verified === false) {
          console.error('❌ Sync completed but data verification failed');
          if (showErrorCallback) {
            showErrorCallback('Sync completed but data could not be verified in database');
          }
          Utils.showNotification(
            'Sync completed but data verification failed. Please try again.',
            'error',
            5000
          );
          return;
        }

        // Double-check IndexedDB state before navigating
        console.log('📋 [SYNC-NAV] Verifying IndexedDB before navigation...');
        const verifyBeforeNav = {
          transactions: await Storage.db.transactions.count(),
          categories: await Storage.db.categories.count(),
          savingsGoals: await Storage.db.savingsGoals.count(),
          lastSync: PairingManager.getLastSyncTime(),
          isPaired: PairingManager.isPaired()
        };
        console.log('📋 [SYNC-NAV] IndexedDB state:', verifyBeforeNav);

        // If we received changes but have no data, something went wrong
        if (result.received > 0 && verifyBeforeNav.transactions === 0 && verifyBeforeNav.categories === 0) {
          console.error('❌ [SYNC-NAV] CRITICAL: Received changes but IndexedDB is empty!');
          console.error('   This means data was not persisted. Aborting navigation.');
          Utils.showNotification(
            'Sync error: Data was not saved. Please check browser storage settings.',
            'error',
            10000
          );
          return;
        }

        if (showStatusCallback) {
          const message = result.received > 0
            ? `✅ Sync complete! Received ${result.received} changes${result.conflicts > 0 ? ` (${result.conflicts} conflicts)` : ''}`
            : '✅ Sync complete! Already up to date';
          showStatusCallback(message);
        }

        // Show detailed notification for incremental sync
        const notificationMessage = result.counts
          ? `Sync complete: ${result.counts.transactions || 0} transactions, ${result.counts.categories || 0} categories, ${result.counts.savingsGoals || 0} goals`
          : `Incremental sync complete: ${result.received} changes received${result.conflicts > 0 ? `, ${result.conflicts} conflicts resolved` : ''}`;

        Utils.showNotification(
          notificationMessage,
          'success',
          3000
        );

        // Wait for IndexedDB to fully commit before navigating
        console.log('📋 [SYNC-NAV] Waiting 1000ms for IndexedDB commit...');
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Final verification
        const finalCheck = {
          transactions: await Storage.db.transactions.count(),
          categories: await Storage.db.categories.count()
        };
        console.log('📋 [SYNC-NAV] Final IndexedDB check:', finalCheck);

        // Refresh UI
        window.dispatchEvent(new CustomEvent('data-updated'));

        // Navigate to dashboard WITHOUT reload - let app.js handle display
        if (typeof SyncDiagnostics !== 'undefined') {
          SyncDiagnostics.logNav('About to navigate to dashboard', {
            fromHash: window.location.hash,
            finalCheck
          });
        }
        window.location.hash = 'dashboard';

        // DO NOT reload - this was causing data loss!
        // The app.js router will handle displaying the dashboard
        if (typeof SyncDiagnostics !== 'undefined') {
          SyncDiagnostics.logNav('Navigation complete', { newHash: window.location.hash });
        }
      });

      // Initialize WebRTC with the peer ID
      await WebRTCSync.init(peerId);

      // Additional fallback: Monitor for WebRTC activity and pairing status changes
      const initialPairingStatus = PairingManager.isPaired();
      let webrtcActivityDetected = false;

      // Monitor WebRTC activity
      WebRTCSync.on('connection-established', () => {
        webrtcActivityDetected = true;
        console.log('🔗 WebRTC connection activity detected');
      });

      // Also monitor for any WebRTC state changes (connection attempts)
      WebRTCSync.on('state-changed', (state) => {
        if (state && state !== 'waiting' && state !== 'disconnected') {
          webrtcActivityDetected = true;
          console.log('🔗 WebRTC state change detected:', state);
        }
      });

      const checkPairingStatus = setInterval(() => {
        const isCurrentlyPaired = PairingManager.isPaired();
        console.log('🔍 Checking pairing status:', isCurrentlyPaired, 'WebRTC activity:', webrtcActivityDetected);

        // Only proceed if there's evidence of actual sync activity
        if ((isCurrentlyPaired && isCurrentlyPaired !== initialPairingStatus) || webrtcActivityDetected) {
          console.log('✅ Sync activity detected - either pairing changed or WebRTC connected');
          clearInterval(checkPairingStatus);

          // Trigger completion navigation
          setTimeout(() => {
            const currentHash = window.location.hash.slice(1);
            if (currentHash === 'sync') {
              window.location.hash = 'dashboard';

              if (isCurrentlyPaired && isCurrentlyPaired !== initialPairingStatus) {
                Utils.showNotification('Device paired successfully! Sync completed.', 'success', 3000);
              } else {
                Utils.showNotification('Sync completed! Redirecting to dashboard...', 'success', 3000);
              }
            }
          }, 2000);
        }
      }, 3000); // Check every 3 seconds

      // Stop checking after 30 seconds
      setTimeout(() => {
        clearInterval(checkPairingStatus);
      }, 30000);

      // Show user that sync is in progress
      setTimeout(() => {
        const currentHash = window.location.hash.slice(1);
        if (currentHash === 'sync') {
          Utils.showNotification('Sync in progress... Please wait.', 'info', 5000);
        }
      }, 5000); // Show after 5 seconds

      // SMART FALLBACK: Only navigate if there's evidence of sync activity
      let syncActivityDetected = false;
      let lastSyncTime = null;

      // Monitor for sync activity indicators
      const detectSyncActivity = () => {
        // Check if WebRTC connection attempt was made
        if (WebRTCSync.getState && WebRTCSync.getState() !== 'waiting') {
          syncActivityDetected = true;
        }

        // Check if there's any metadata in storage indicating previous sync
        const metadata = Storage.getMetadata ? Storage.getMetadata() : null;
        if (metadata && metadata.lastSync) {
          syncActivityDetected = true;
          lastSyncTime = new Date(metadata.lastSync);
        }

        return syncActivityDetected;
      };

      setTimeout(() => {
        const currentHash = window.location.hash.slice(1);
        if (currentHash === 'sync') {
          if (detectSyncActivity()) {
            console.log('✅ SMART FALLBACK: Sync activity detected, navigating to dashboard');

            if (lastSyncTime) {
              Utils.showNotification(`Last sync: ${lastSyncTime.toLocaleString()}`, 'info', 4000);
            } else {
              Utils.showNotification('Sync completed! Redirecting to dashboard...', 'success', 3000);
            }

            window.location.hash = 'dashboard';

            // Emit data-updated event to refresh UI
            setTimeout(() => {
              window.dispatchEvent(new CustomEvent('data-updated'));
            }, 1000);
          } else {
            console.log('⚠️ SMART FALLBACK: No sync activity detected, staying on sync page');
            Utils.showNotification('No sync activity detected. Please scan the QR code with your Android app.', 'warning', 5000);
          }
        }
      }, 20000); // 20 second smart fallback

    } catch (err) {
      console.error('Failed to initialize sync:', err);
      if (showErrorCallback) {
        showErrorCallback('Failed to initialize sync: ' + err.message);
      }
    }
  }

  // Public API
  return {
    validateSyncPayload,
    importSyncData,
    importSyncPayload,
    getImportStats,
    initializeWebRTCSync
  };
})();
