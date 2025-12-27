/**
 * Cross-Tab Sync Detection
 * Uses BroadcastChannel API to notify other tabs when sync completes
 * Includes fallback periodic IndexedDB checks for older browsers
 */
const CrossTabSync = (() => {
  let channel = null;
  let lastKnownDataCount = 0;
  let checkInterval = null;
  const CHANNEL_NAME = 'budgettact-sync-channel';
  const CHECK_INTERVAL_MS = 3000; // Check every 3 seconds as fallback

  /**
   * Initialize cross-tab sync detection
   */
  function init() {
    console.log('🔗 Initializing cross-tab sync detection...');

    // Try BroadcastChannel API (modern browsers)
    if ('BroadcastChannel' in window) {
      initBroadcastChannel();
    } else {
      console.log('⚠️ BroadcastChannel not supported, using fallback');
    }

    // Always start periodic check as fallback
    startPeriodicCheck();

    // Store initial data count
    updateDataCount();
  }

  /**
   * Initialize BroadcastChannel for cross-tab communication
   */
  function initBroadcastChannel() {
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);

      channel.onmessage = (event) => {
        console.log('📢 Received cross-tab message:', event.data);

        if (event.data.type === 'sync-completed') {
          handleSyncFromOtherTab(event.data);
        } else if (event.data.type === 'data-changed') {
          handleDataChangedFromOtherTab(event.data);
        }
      };

      console.log('✅ BroadcastChannel initialized');
    } catch (error) {
      console.error('❌ Failed to initialize BroadcastChannel:', error);
    }
  }

  /**
   * Broadcast that sync completed (call this when sync finishes)
   */
  function broadcastSyncCompleted(stats = {}) {
    const message = {
      type: 'sync-completed',
      timestamp: Date.now(),
      stats: stats,
      tabId: getTabId()
    };

    console.log('📢 Broadcasting sync-completed to other tabs:', message);

    if (channel) {
      channel.postMessage(message);
    }

    // Also store in localStorage for tabs that don't support BroadcastChannel
    localStorage.setItem('budgettact-last-sync', JSON.stringify(message));
  }

  /**
   * Broadcast that data changed (for real-time updates)
   */
  function broadcastDataChanged(changeType = 'unknown') {
    const message = {
      type: 'data-changed',
      timestamp: Date.now(),
      changeType: changeType,
      tabId: getTabId()
    };

    if (channel) {
      channel.postMessage(message);
    }
  }

  /**
   * Handle sync completed from another tab
   */
  async function handleSyncFromOtherTab(data) {
    console.log('🔄 Sync completed in another tab!', data);

    // Check if we're on the sync view
    const currentHash = window.location.hash.slice(1);

    // Check if data exists now
    const hasData = await Storage.hasData();

    if (hasData) {
      console.log('✅ Data detected from cross-tab sync!');

      // Update pairing info
      PairingManager.updateLastSync();

      // Dispatch data-updated event to refresh UI
      window.dispatchEvent(new CustomEvent('data-updated', {
        detail: { type: 'cross-tab-sync', source: data.tabId }
      }));

      // Navigate to dashboard if on sync view
      if (currentHash === 'sync' || currentHash === '') {
        console.log('🚀 Navigating to dashboard after cross-tab sync...');
        Utils.showNotification('Sync completed from another tab! Loading data...', 'success', 3000);

        setTimeout(() => {
          window.location.hash = 'dashboard';
          // Reload to ensure fresh state
          setTimeout(() => {
            window.location.reload();
          }, 100);
        }, 1500);
      } else {
        Utils.showNotification('Data synced from another tab', 'success', 3000);
      }
    }
  }

  /**
   * Handle data changed from another tab
   */
  async function handleDataChangedFromOtherTab(data) {
    console.log('📝 Data changed in another tab:', data);

    // Refresh current view
    window.dispatchEvent(new CustomEvent('data-updated', {
      detail: { type: 'cross-tab-change', source: data.tabId }
    }));
  }

  /**
   * Start periodic check for data changes (fallback for older browsers)
   */
  function startPeriodicCheck() {
    if (checkInterval) {
      clearInterval(checkInterval);
    }

    checkInterval = setInterval(async () => {
      await checkForDataChanges();
    }, CHECK_INTERVAL_MS);

    console.log(`🔄 Started periodic data check every ${CHECK_INTERVAL_MS}ms`);
  }

  /**
   * Stop periodic check
   */
  function stopPeriodicCheck() {
    if (checkInterval) {
      clearInterval(checkInterval);
      checkInterval = null;
    }
  }

  /**
   * Check if data count has changed (indicates sync from another tab)
   */
  async function checkForDataChanges() {
    try {
      const currentCount = await getDataCount();

      if (currentCount !== lastKnownDataCount) {
        console.log(`📊 Data count changed: ${lastKnownDataCount} -> ${currentCount}`);

        // Check if this is new data appearing (not deletion)
        if (currentCount > lastKnownDataCount && lastKnownDataCount === 0) {
          console.log('🆕 New data detected from another tab!');

          // Check localStorage for sync info
          const lastSyncStr = localStorage.getItem('budgettact-last-sync');
          const lastSync = lastSyncStr ? JSON.parse(lastSyncStr) : null;

          // Only trigger if sync was recent (within 30 seconds)
          if (lastSync && (Date.now() - lastSync.timestamp) < 30000) {
            // Don't process our own sync
            if (lastSync.tabId !== getTabId()) {
              await handleSyncFromOtherTab(lastSync);
            }
          }
        }

        lastKnownDataCount = currentCount;
      }
    } catch (error) {
      // Silently fail - this is just a fallback check
    }
  }

  /**
   * Update stored data count
   */
  async function updateDataCount() {
    lastKnownDataCount = await getDataCount();
    console.log('📊 Initial data count:', lastKnownDataCount);
  }

  /**
   * Get total count of data items
   */
  async function getDataCount() {
    try {
      if (typeof Storage === 'undefined' || !Storage.db) {
        return 0;
      }

      const transactions = await Storage.db.transactions.count();
      const categories = await Storage.db.categories.count();
      const goals = await Storage.db.savingsGoals.count();

      return transactions + categories + goals;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Get unique tab ID (persisted in sessionStorage)
   */
  function getTabId() {
    let tabId = sessionStorage.getItem('budgettact-tab-id');
    if (!tabId) {
      tabId = `tab-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      sessionStorage.setItem('budgettact-tab-id', tabId);
    }
    return tabId;
  }

  /**
   * Cleanup
   */
  function destroy() {
    stopPeriodicCheck();
    if (channel) {
      channel.close();
      channel = null;
    }
  }

  // Public API
  return {
    init,
    broadcastSyncCompleted,
    broadcastDataChanged,
    stopPeriodicCheck,
    destroy,
    getTabId
  };
})();
