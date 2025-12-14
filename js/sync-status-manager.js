class SyncStatusManager {
  constructor() {
    this.statusElement = null;
    this.currentStatus = 'disconnected';
  }

  init() {
    this.createStatusIndicator();
    this.updateLastSyncTime();
  }

  createStatusIndicator() {
    // Remove legacy footer status if present
    const legacy = document.getElementById('sync-status');
    if (legacy) legacy.remove();

    const statusDiv = document.createElement('div');
    statusDiv.id = 'sync-status';
    statusDiv.className = 'sync-status';
    statusDiv.innerHTML = `
      <div class="status-indicator">
        <span class="status-dot"></span>
        <span class="status-text">Disconnected</span>
      </div>
      <div class="status-details">
        <small class="last-sync">Never synced</small>
      </div>
    `;

    document.body.appendChild(statusDiv);
    this.statusElement = statusDiv;
  }

  setStatus(status, message = '') {
    this.currentStatus = status;

    const dot = this.statusElement.querySelector('.status-dot');
    const text = this.statusElement.querySelector('.status-text');

    switch (status) {
      case 'connected':
        dot.className = 'status-dot connected';
        text.textContent = 'Connected';
        break;
      case 'syncing':
        dot.className = 'status-dot syncing';
        text.textContent = 'Syncing...';
        break;
      case 'offline':
        dot.className = 'status-dot offline';
        text.textContent = 'Phone offline';
        this.showOfflineWarning();
        break;
      case 'error':
        dot.className = 'status-dot error';
        text.textContent = 'Sync error';
        break;
      default:
        dot.className = 'status-dot';
        text.textContent = 'Disconnected';
    }

    if (message) {
      this.setDetailsMessage(message);
    }
  }

  setDetailsMessage(message) {
    const details = this.statusElement.querySelector('.last-sync');
    details.textContent = message;
  }

  showOfflineWarning() {
    const warning = document.createElement('div');
    warning.className = 'offline-warning';
    warning.innerHTML = `
      <div class="warning-content">
        <span class="warning-icon">⚠️</span>
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
    const lastSync = PairingManager.getLastSyncTime();
    if (lastSync) {
      const date = new Date(lastSync);
      const timeAgo = this.getTimeAgo(date);
      this.setDetailsMessage(`Last synced: ${timeAgo}`);
    } else {
      this.setDetailsMessage('Never synced');
    }
  }

  getTimeAgo(date) {
    const seconds = Math.floor((Date.now() - date) / 1000);
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  }
}

// Global instance
const syncStatus = new SyncStatusManager();
