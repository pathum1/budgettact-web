class AutoSyncOnLoad {
  static async init() {
    console.log('🔄 Checking for paired Android device...');

    if (!PairingManager.isPaired()) {
      console.log('ℹ️ Not paired with any Android device');
      if (typeof syncStatus !== 'undefined') {
        syncStatus.setStatus('disconnected', 'Scan QR to pair');
      }
      return;
    }

    if (typeof syncStatus !== 'undefined') {
      syncStatus.setStatus('syncing', 'Connecting...');
    }

    try {
      await this.performAutoSync();
    } catch (error) {
      console.error('❌ Auto-sync failed:', error);
      if (typeof syncStatus !== 'undefined') {
        syncStatus.setStatus('offline', 'Phone offline - changes will sync later');
      }
    }
  }

  static async performAutoSync() {
    const webPeerId = PairingManager.getWebPeerId();
    const webrtc = WebRTCSync;
    await webrtc.init(webPeerId);

    const connected = await this.waitForAndroidConnection(webrtc, 10000);
    if (!connected) {
      throw new Error('Android connection timeout');
    }

    if (typeof syncStatus !== 'undefined') {
      syncStatus.setStatus('connected', 'Connected to phone');
    }

    const result = await this.bidirectionalSync(webrtc);

    if (typeof syncStatus !== 'undefined') {
      if (result.received > 0 || result.sent > 0) {
        syncStatus.setStatus('connected', `Synced: ${result.received} received, ${result.sent} sent`);
      } else {
        syncStatus.setStatus('connected', 'Up to date');
      }
      syncStatus.updateLastSyncTime();
    }
  }

  static waitForAndroidConnection(webrtc, timeout) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), timeout);
      webrtc.once('connection-established', () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  static async bidirectionalSync(webrtc) {
    const incrementalSync = new IncrementalSyncManager();
    const ourChanges = await incrementalSync.getChangesSinceLastSync();

    await webrtc.send({ type: 'changes', data: ourChanges });
    console.log(`📤 Sent ${this.countChanges(ourChanges)} changes to Android`);

    const androidResponse = await webrtc.waitForMessage('changes');
    const androidChanges = androidResponse.data || androidResponse;
    console.log(`📥 Received ${this.countChanges(androidChanges)} changes from Android`);

    const applyResult = await incrementalSync.applyIncomingChanges(androidChanges);
    if (applyResult.applied > 0) {
      this.refreshUI();
    }

    await webrtc.send({
      type: 'syncComplete',
      applied: applyResult.applied,
      conflicts: applyResult.conflicts
    });

    return {
      sent: this.countChanges(ourChanges),
      received: applyResult.applied,
      conflicts: applyResult.conflicts
    };
  }

  static countChanges(changes) {
    if (!changes) return 0;
    let count = 0;
    ['transactions', 'categories', 'budgetHistory', 'savingsGoals', 'goalTransactions', 'recurringTransactions', 'billers'].forEach((key) => {
      if (changes[key]) count += changes[key].length;
    });
    return count;
  }

  static refreshUI() {
    window.dispatchEvent(new CustomEvent('data-updated'));
  }
}
