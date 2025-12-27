/**
 * Auto-Sync on CRUD Operations
 * Queues local changes and syncs them to Android when connected
 */
class AutoSyncOnCRUD {
  constructor() {
    this.pendingChanges = [];
    this.debounceTimer = null;
    this.DEBOUNCE_MS = 2000;
    this.STORAGE_KEY = 'pendingSync';

    // Load any persisted changes
    this.loadPersistedQueue();

    // Drain queue when connection established
    if (typeof WebRTCSync !== 'undefined') {
      WebRTCSync.on('connection-established', () => {
        this.drainQueue();
      });
    }
  }

  /**
   * Record a change for syncing
   * @param {string} tableName - Table that was modified
   * @param {string} operation - 'insert', 'update', or 'delete'
   * @param {Object} record - The modified record
   */
  recordChange(tableName, operation, record) {
    const change = {
      table: tableName,
      operation: operation,
      record: record,
      timestamp: Date.now(),
      id: `${tableName}-${record.transactionID || record.id || record.billerID}-${Date.now()}`
    };

    // Check for duplicate/superseding change
    const existingIndex = this.pendingChanges.findIndex(c =>
      c.table === tableName &&
      (c.record.transactionID === record.transactionID ||
       c.record.id === record.id ||
       c.record.billerID === record.billerID)
    );

    if (existingIndex > -1) {
      // Replace with newer change
      this.pendingChanges[existingIndex] = change;
    } else {
      this.pendingChanges.push(change);
    }

    console.log(`📝 Queued ${operation} for ${tableName}:`,
      record.transactionID || record.id || record.billerID);

    // Schedule sync
    this.scheduleSend();

    // Update pending indicator
    this.updatePendingIndicator();
  }

  /**
   * Schedule sending changes (debounced)
   */
  scheduleSend() {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.sendPendingChanges();
    }, this.DEBOUNCE_MS);
  }

  /**
   * Send pending changes to Android
   */
  async sendPendingChanges() {
    if (this.pendingChanges.length === 0) {
      return;
    }

    // Check if connected
    if (typeof WebRTCSync === 'undefined' || !WebRTCSync.isConnected()) {
      console.log('📴 Not connected - persisting queue');
      await this.persistQueue();
      return;
    }

    console.log(`📤 Sending ${this.pendingChanges.length} pending changes...`);

    try {
      const message = this.formatChangesForSync(this.pendingChanges);
      WebRTCSync.send(JSON.stringify(message));

      // Clear queue after successful send
      this.pendingChanges = [];
      await this.clearPersistedQueue();
      this.updatePendingIndicator();

      console.log('✅ Pending changes sent successfully');
    } catch (error) {
      console.error('❌ Failed to send changes:', error);
      await this.persistQueue();
    }
  }

  /**
   * Drain the queue (send all pending changes)
   * Called when connection is established
   */
  async drainQueue() {
    await this.loadPersistedQueue();
    if (this.pendingChanges.length > 0) {
      console.log(`📤 Draining queue: ${this.pendingChanges.length} changes`);
      await this.sendPendingChanges();
    }
  }

  /**
   * Format changes for sync message
   * @param {Array} changes - Array of change objects
   * @returns {Object} Formatted sync message
   */
  formatChangesForSync(changes) {
    const grouped = {
      type: 'changes',
      transactions: [],
      categories: [],
      savingsGoals: [],
      budgetHistory: [],
      goalTransactions: [],
      recurringTransactions: [],
      billers: [],
      deviceId: 'web',
      timestamp: Date.now()
    };

    for (const change of changes) {
      if (grouped[change.table]) {
        grouped[change.table].push(change.record);
      }
    }

    return grouped;
  }

  /**
   * Persist queue to localStorage
   */
  async persistQueue() {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.pendingChanges));
      console.log(`💾 Persisted ${this.pendingChanges.length} changes to localStorage`);
    } catch (error) {
      console.error('Failed to persist queue:', error);
    }
  }

  /**
   * Load queue from localStorage
   */
  async loadPersistedQueue() {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Merge with current queue, avoiding duplicates
        for (const change of parsed) {
          if (!this.pendingChanges.find(c => c.id === change.id)) {
            this.pendingChanges.push(change);
          }
        }
        console.log(`📂 Loaded ${parsed.length} persisted changes`);
        this.updatePendingIndicator();
      }
    } catch (error) {
      console.error('Failed to load persisted queue:', error);
    }
  }

  /**
   * Clear persisted queue
   */
  async clearPersistedQueue() {
    localStorage.removeItem(this.STORAGE_KEY);
  }

  /**
   * Update UI indicator for pending changes
   */
  updatePendingIndicator() {
    const count = this.pendingChanges.length;
    const indicator = document.getElementById('pending-sync-count');

    if (indicator) {
      if (count > 0) {
        indicator.textContent = count;
        indicator.style.display = 'inline-flex';
      } else {
        indicator.style.display = 'none';
      }
    }

    // Also update sync status if available
    if (typeof syncStatus !== 'undefined') {
      syncStatus.updatePendingCount(count);
    }
  }

  /**
   * Get current pending count
   * @returns {number}
   */
  getPendingCount() {
    return this.pendingChanges.length;
  }
}

// Create singleton instance
const autoSyncCRUD = new AutoSyncOnCRUD();
