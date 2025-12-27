class SyncStatusManager {
  constructor() {
    this.statusElement = null;
    this.currentStatus = 'disconnected';
  }

  init() {
    // Use existing element from HTML
    this.statusElement = document.getElementById('sync-status');
    this.updateLastSyncTime();
  }

  setStatus(status, message = '') {
    this.currentStatus = status;
    if (!this.statusElement) return;

    const dot = this.statusElement.querySelector('.status-dot');
    const text = this.statusElement.querySelector('.status-text');

    switch (status) {
      case 'connected':
        dot.className = 'status-dot connected';
        this.updateLastSyncTime();
        break;
      case 'syncing':
        dot.className = 'status-dot syncing';
        text.textContent = 'Syncing...';
        break;
      case 'offline':
        dot.className = 'status-dot offline';
        this.updateLastSyncTime();
        this.showOfflineWarning();
        break;
      case 'error':
        dot.className = 'status-dot error';
        text.textContent = 'Sync error';
        break;
      default:
        dot.className = 'status-dot';
        this.updateLastSyncTime();
    }

    if (message) {
      this.setDetailsMessage(message);
    }
  }

  setDetailsMessage(message) {
    // Update the status text with the message if provided
    if (this.statusElement) {
      const text = this.statusElement.querySelector('.status-text');
      if (text && message) {
        text.textContent = message;
      }
    }
  }

  showOfflineWarning() {
    // Remove existing warning if any
    const existingWarning = document.querySelector('.offline-warning');
    if (existingWarning) existingWarning.remove();

    const warning = document.createElement('div');
    warning.className = 'offline-warning';
    warning.innerHTML = `
      <div class="warning-content">
        <span class="warning-icon">!</span>
        <div class="warning-text">
          <strong>Phone is offline</strong>
          <p>Your changes will sync when your phone reconnects</p>
        </div>
        <button class="warning-dismiss" aria-label="Dismiss offline warning">×</button>
      </div>
    `;

    const dismissBtn = warning.querySelector('.warning-dismiss');
    dismissBtn.addEventListener('click', () => warning.remove());

    document.body.appendChild(warning);
    setTimeout(() => warning.remove(), 10000);
  }

  updateLastSyncTime() {
    if (!this.statusElement) return;

    const text = this.statusElement.querySelector('.status-text');
    if (!text) return;

    const lastSync = PairingManager.getLastSyncTime();
    if (lastSync) {
      const date = new Date(lastSync);
      const formattedTime = this.formatLastSync(date);
      text.textContent = `Last sync: ${formattedTime}`;
    } else {
      text.textContent = 'Last sync: Never';
    }
  }

  formatLastSync(date) {
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);

    // If less than a minute ago
    if (seconds < 60) return 'Just now';

    // If less than an hour ago
    if (seconds < 3600) {
      const mins = Math.floor(seconds / 60);
      return `${mins}m ago`;
    }

    // If same day, show time
    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }

    // If yesterday
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday ' + date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }

    // Otherwise show date and time
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
           ' ' + date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  getTimeAgo(date) {
    const seconds = Math.floor((Date.now() - date) / 1000);
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  }

  /**
   * Update pending changes count
   * @param {number} count - Number of pending changes
   */
  updatePendingCount(count) {
    const statusText = this.statusElement?.querySelector('.status-text');
    if (statusText && count > 0) {
      statusText.textContent = `${count} pending`;
    } else if (statusText && count === 0) {
      this.updateLastSyncTime();
    }
  }
}

// Global instance
const syncStatus = new SyncStatusManager();
