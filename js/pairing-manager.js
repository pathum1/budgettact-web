/**
 * PairingManager - Manages persistent pairing with Android device
 * Stores pairing information in localStorage
 */
const PairingManager = (() => {
  // LocalStorage keys
  const PAIRED_DEVICE_KEY = 'paired_android_device';
  const LAST_SYNC_KEY = 'last_sync_timestamp';
  const WEB_PEER_ID_KEY = 'web_peer_id';
  const SYNC_SETTINGS_KEY = 'sync_settings';
  const CONFLICT_STRATEGY_KEY = 'conflict_resolution_strategy';

  /**
   * Check if web app is paired with an Android device
   * @returns {boolean}
   */
  function isPaired() {
    return localStorage.getItem(PAIRED_DEVICE_KEY) !== null;
  }

  /**
   * Get paired Android device ID
   * @returns {string|null}
   */
  function getPairedDeviceId() {
    const stored = localStorage.getItem(PAIRED_DEVICE_KEY);
    if (!stored) return null;

    // Handle both legacy string and structured object storage
    try {
      const parsed = JSON.parse(stored);
      return parsed.deviceId || parsed.id || stored;
    } catch (e) {
      return stored;
    }
  }

  /**
   * Save pairing information
   * @param {string} androidDeviceId - Android device identifier
   * @param {string} androidDeviceName - Friendly device name
   */
  function savePairing(androidDeviceId, androidDeviceName = 'Android Device') {
    const pairingInfo = {
      deviceId: androidDeviceId,
      deviceName: androidDeviceName,
      pairedAt: new Date().toISOString()
    };

    localStorage.setItem(PAIRED_DEVICE_KEY, JSON.stringify(pairingInfo));
    localStorage.setItem(LAST_SYNC_KEY, Date.now().toString());

    console.log('✅ Device paired:', pairingInfo);

    // Dispatch pairing event
    window.dispatchEvent(new CustomEvent('device-paired', {
      detail: pairingInfo
    }));
  }

  /**
   * Get pairing information
   * @returns {Object|null} { deviceId, deviceName, pairedAt }
   */
  function getPairingInfo() {
    const stored = localStorage.getItem(PAIRED_DEVICE_KEY);
    if (!stored) return null;

    try {
      return JSON.parse(stored);
    } catch (e) {
      console.error('Failed to parse pairing info:', e);
      return {
        deviceId: stored,
        deviceName: 'Android Device',
        pairedAt: null
      };
    }
  }

  /**
   * Clear pairing (unpair device)
   */
  function clearPairing() {
    localStorage.removeItem(PAIRED_DEVICE_KEY);
    localStorage.removeItem(LAST_SYNC_KEY);

    console.log('🔓 Device unpaired');

    // Dispatch unpairing event
    window.dispatchEvent(new CustomEvent('device-unpaired'));
  }

  /**
   * Get or generate persistent web peer ID
   * @returns {string}
   */
  function getWebPeerId() {
    let peerId = localStorage.getItem(WEB_PEER_ID_KEY);

    if (!peerId) {
      peerId = `web-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      localStorage.setItem(WEB_PEER_ID_KEY, peerId);
      console.log('🆕 Generated new web peer ID:', peerId);
    }

    return peerId;
  }

  /**
   * Update last sync timestamp
   * @param {number} timestamp - Unix timestamp in milliseconds
   */
  function updateLastSync(timestamp = Date.now()) {
    localStorage.setItem(LAST_SYNC_KEY, timestamp.toString());
  }

  /**
   * Get last sync timestamp
   * @returns {number|null} Unix timestamp in milliseconds
   */
  function getLastSync() {
    const stored = localStorage.getItem(LAST_SYNC_KEY);
    return stored ? parseInt(stored, 10) : null;
  }

  function getLastSyncTime() {
    return getLastSync();
  }

  /**
   * Get sync settings
   * @returns {Object} { autoSync, conflictResolution }
   */
  function getSyncSettings() {
    const stored = localStorage.getItem(SYNC_SETTINGS_KEY);

    const defaults = {
      autoSync: true,
      conflictResolution: 'newerWins' // Options: 'newerWins', 'androidWins', 'webWins'
    };

    if (!stored) return defaults;

    try {
      return { ...defaults, ...JSON.parse(stored) };
    } catch (e) {
      console.error('Failed to parse sync settings:', e);
      return defaults;
    }
  }

  /**
   * Update sync settings
   * @param {Object} settings - { autoSync?, conflictResolution? }
   */
  function updateSyncSettings(settings) {
    const current = getSyncSettings();
    const updated = { ...current, ...settings };
    localStorage.setItem(SYNC_SETTINGS_KEY, JSON.stringify(updated));
    console.log('⚙️ Sync settings updated:', updated);
  }

  function getConflictStrategy() {
    const settingsStrategy = getSyncSettings().conflictResolution;
    return localStorage.getItem(CONFLICT_STRATEGY_KEY) || settingsStrategy || 'newerWins';
  }

  function setConflictStrategy(strategy) {
    localStorage.setItem(CONFLICT_STRATEGY_KEY, strategy);
    updateSyncSettings({ conflictResolution: strategy });
  }

  // Public API
  return {
    isPaired,
    getPairedDeviceId,
    savePairing,
    getPairingInfo,
    clearPairing,
    getWebPeerId,
    updateLastSync,
    getLastSync,
    getLastSyncTime,
    getSyncSettings,
    updateSyncSettings,
    getConflictStrategy,
    setConflictStrategy
  };
})();
