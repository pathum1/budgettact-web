class AutoSyncOnCRUD {
  constructor() {
    this.pendingChanges = [];
    this.debounceTimer = null;
    this.webrtc = null;
  }

  queueChange(entity, operation, data) {
    this.pendingChanges.push({
      entity,
      operation,
      data,
      timestamp: Date.now()
    });

    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.syncPendingChanges(), 2000);
  }

  async syncPendingChanges() {
    if (this.pendingChanges.length === 0) return;

    console.log(`🔄 Syncing ${this.pendingChanges.length} pending changes...`);

    if (!PairingManager.isPaired()) {
      console.log('ℹ️ Not paired - leaving changes queued locally');
      if (typeof syncStatus !== 'undefined') {
        syncStatus.setStatus('offline', 'Not paired - changes pending');
      }
      return;
    }

    try {
      const webrtc = await this.getOrCreateConnection();

      await webrtc.send({
        type: 'incrementalChange',
        changes: this.pendingChanges
      });

      console.log('✅ Changes synced to Android');
      if (typeof syncStatus !== 'undefined') {
        syncStatus.setStatus('connected', 'Synced');
        syncStatus.updateLastSyncTime();
      }

      this.pendingChanges = [];
    } catch (error) {
      console.warn('⚠️ Failed to sync changes:', error);
      if (typeof syncStatus !== 'undefined') {
        syncStatus.setStatus('offline', 'Changes queued for sync');
      }
    }
  }

  async getOrCreateConnection() {
    if (this.webrtc && this.webrtc.isConnected()) {
      return this.webrtc;
    }

    this.webrtc = WebRTCSync;
    await this.webrtc.init(PairingManager.getWebPeerId());

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Connection timeout')), 10000);
      this.webrtc.once('connection-established', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    return this.webrtc;
  }
}

const autoSyncCRUD = new AutoSyncOnCRUD();
