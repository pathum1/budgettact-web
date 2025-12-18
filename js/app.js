// Main Application
(async function() {
  let currentView = null;  // Start as null so first navigation always renders

  /**
   * Initialize application
   */
  async function init() {
    console.log('Initializing BudgetTact Web...');

    // Initialize database
    const dbReady = await Storage.initDatabase();
    if (!dbReady) {
      Utils.showNotification('Failed to initialize database', 'error');
      return;
    }

    if (typeof syncStatus !== 'undefined') {
      syncStatus.init();
    }

    // Register service worker
    registerServiceWorker();

    // Set up event listeners
    setupNavigation();
    setupSyncButton();
    setupFilters();

    // Check sync state and data
    const hasData = await Storage.hasData();
    const isPaired = PairingManager.isPaired();
    const lastSync = PairingManager.getLastSyncTime();
    const metadata = await Storage.getMetadata();

    console.log('🔍 Sync state check:', {
      hasData,
      isPaired,
      lastSync,
      lastSyncDate: lastSync ? new Date(lastSync).toLocaleDateString() : 'Never',
      currency: metadata?.currency || 'Not set'
    });

    // Determine initial view based on requirements
    let initialView;
    let shouldShowSyncPrompt = false;

    if (!isPaired && !hasData) {
      // Never synced and no data - initial sync needed
      console.log('👋 First-time user - showing sync view for initial sync');
      initialView = 'sync';
      document.body.classList.add('landing-mode');
    } else if (isPaired && !hasData) {
      // Paired before but no data - initial sync needed
      console.log('🔄 Paired but no data - showing sync view for initial sync');
      initialView = 'sync';
      document.body.classList.add('landing-mode');
    } else if (isPaired && hasData) {
      // Has synced before and has data - show dashboard
      console.log('📊 Returning user with data - showing dashboard');
      initialView = 'dashboard';
      document.body.classList.remove('landing-mode');

      // Check if sync is old (> 1 day)
      const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
      if (lastSync && lastSync < oneDayAgo) {
        shouldShowSyncPrompt = true;
        const daysSinceSync = Math.floor((Date.now() - lastSync) / (24 * 60 * 60 * 1000));
        console.log(`⚠️ Sync is ${daysSinceSync} days old - will prompt to sync`);
      }
    } else {
      // Default to dashboard for any other case
      console.log('📊 Default - showing dashboard');
      initialView = 'dashboard';
      document.body.classList.remove('landing-mode');
    }

    await navigateToView(initialView);

    // Show sync prompt if needed (after dashboard loads)
    if (shouldShowSyncPrompt && typeof Utils !== 'undefined' && Utils.showNotification) {
      setTimeout(() => {
        const lastSyncDate = new Date(lastSync).toLocaleDateString();
        Utils.showNotification(
          `Data was last synced on ${lastSyncDate}. Consider syncing for latest changes.`,
          'info',
          8000
        );
      }, 2000);
    }

    // Auto sync on load if already paired
    if (typeof AutoSyncOnLoad !== 'undefined') {
      AutoSyncOnLoad.init();
    }

    // Update sync status
    UI.updateSyncStatus();

    console.log('BudgetTact Web initialized');
  }

  /**
   * Register service worker for PWA
   */
  function registerServiceWorker() {
    // Temporarily disabled for testing
    console.log('Service Worker registration disabled for testing');
    /*
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./service-worker.js')
        .then(registration => {
          console.log('Service Worker registered:', registration);
        })
        .catch(error => {
          console.log('Service Worker registration failed:', error);
        });
    }
    */
  }

  /**
   * Set up navigation event listeners
   */
  function setupNavigation() {
    // Navigation clicks
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
      item.addEventListener('click', async (e) => {
        e.preventDefault();
        const view = item.dataset.view;
        await navigateToView(view);
      });
    });

    // Handle browser back/forward
    window.addEventListener('hashchange', async () => {
      const hash = window.location.hash.slice(1) || 'dashboard';
      await navigateToView(hash);
    });
  }

  /**
   * Navigate to a view
   */
  async function navigateToView(viewName) {
    // Prevent re-navigation if already on this view
    if (currentView === viewName) {
      console.log('Already on view:', viewName);
      return;
    }

    console.log('Navigating to view:', viewName);

    // If navigating to a data view (not sync), ensure sidebar is visible
    // This fixes the issue where auto-refresh shows dashboard without sidebar
    if (viewName !== 'sync') {
      document.body.classList.remove('landing-mode');
    }

    // Update active nav item
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.remove('active');
      if (item.dataset.view === viewName) {
        item.classList.add('active');
      }
    });

    // Hide all views
    document.querySelectorAll('.view').forEach(view => {
      view.classList.remove('active');
    });

    // Show selected view
    const viewElement = document.getElementById(`view-${viewName}`);
    if (viewElement) {
      console.log('View element found, showing:', `view-${viewName}`);
      viewElement.classList.add('active');
    } else {
      console.error('View element not found:', `view-${viewName}`);
    }

    // Update hash
    window.location.hash = viewName;
    currentView = viewName;

    // Render view content
    await renderCurrentView();
  }

  /**
   * Render current view
   */
  async function renderCurrentView() {
    console.log('Rendering view:', currentView);
    switch (currentView) {
      case 'sync':
        console.log('Initializing WebRTC sync...');
        try {
          await Sync.initializeWebRTCSync(showSyncStatus, showError);
          console.log('WebRTC sync initialized successfully');
        } catch (err) {
          console.error('Failed to initialize WebRTC sync:', err);
        }
        break;
      case 'dashboard':
        await UI.renderDashboard();
        break;
      case 'transactions':
        await UI.renderTransactions();
        break;
      case 'categories':
        await UI.renderCategories();
        break;
      case 'goals':
        await UI.renderGoals();
        break;
    }
  }

  /**
   * Set up sync button - navigates to sync view
   */
  function setupSyncButton() {
    const syncBtn = document.getElementById('sync-btn');
    const headerImportBtn = document.getElementById('import-btn');
    const manualImportBtn = document.getElementById('manualImportBtn');
    const manualImportModal = document.getElementById('manualImportModal');
    const closeManualImportBtn = document.getElementById('closeManualImportBtn');
    const confirmImportBtn = document.getElementById('importBtn');
    const manualImportData = document.getElementById('manualImportData');
    const importError = document.getElementById('import-error');
    const importSuccess = document.getElementById('import-success');

    // Sync button - navigate to sync view
    if (syncBtn) {
      syncBtn.addEventListener('click', () => {
        console.log('Sync button clicked - navigating to sync view');
        navigateToView('sync');
      });
    } else {
      console.error('Sync button not found!');
    }

    // Header import button - also navigate to sync view
    if (headerImportBtn) {
      headerImportBtn.addEventListener('click', () => {
        console.log('Header import button clicked - navigating to sync view');
        navigateToView('sync');
      });
    }

    // Manual import button - open manual import modal
    if (manualImportBtn) {
      manualImportBtn.addEventListener('click', () => {
        manualImportModal.style.display = 'block';
        manualImportData.value = '';
        importError.textContent = '';
        importSuccess.textContent = '';
        importError.classList.remove('active');
        importSuccess.classList.remove('active');
      });
    }

    // Close manual import modal
    if (closeManualImportBtn) {
      closeManualImportBtn.addEventListener('click', () => {
        manualImportModal.style.display = 'none';
      });
    }

    // Click outside to close
    if (manualImportModal) {
      manualImportModal.addEventListener('click', (e) => {
        if (e.target === manualImportModal) {
          manualImportModal.style.display = 'none';
        }
      });
    }

    // Import button click
    if (confirmImportBtn) {
      confirmImportBtn.addEventListener('click', async () => {
        const jsonData = manualImportData.value.trim();

        if (!jsonData) {
          importError.textContent = 'Please paste your JSON data';
          importError.classList.add('active');
          return;
        }

        confirmImportBtn.disabled = true;
        confirmImportBtn.textContent = 'Importing...';
        importError.classList.remove('active');
        importSuccess.classList.remove('active');

        try {
          const result = await Sync.importSyncData(jsonData);

          if (result.success) {
            importSuccess.textContent = `${result.message}\n\nImported:\n- ${result.stats.transactions} transactions\n- ${result.stats.categories} categories\n- ${result.stats.goals} goals`;
            importSuccess.classList.add('active');

            setTimeout(() => {
              manualImportModal.style.display = 'none';
              window.location.reload();
            }, 2000);
          } else {
            let errorMessage = result.message;
            if (result.errors && result.errors.length > 0) {
              errorMessage += '\n\nErrors:\n' + result.errors.slice(0, 5).join('\n');
            }
            importError.textContent = errorMessage;
            importError.classList.add('active');
          }
        } catch (err) {
          importError.textContent = 'Invalid JSON data: ' + err.message;
          importError.classList.add('active');
        } finally {
          confirmImportBtn.disabled = false;
          confirmImportBtn.textContent = 'Import Data';
        }
      });
    }
  }

  /**
   * Show sync status message
   */
  function showSyncStatus(message) {
    const statusText = document.querySelector('#syncStatus .status-text');
    const spinner = document.getElementById('syncSpinner');

    if (statusText) {
      statusText.textContent = message;
    }

    if (spinner && message.includes('...')) {
      spinner.style.display = 'block';
    } else if (spinner) {
      spinner.style.display = 'none';
    }
  }

  /**
   * Show error notification
   */
  function showError(message) {
    Utils.showNotification(message, 'error');
  }

  /**
   * Show success notification
   */
  function showSuccess(message) {
    Utils.showNotification(message, 'success');
  }

  /**
   * Set up filter controls
   */
  function setupFilters() {
    // Type filter buttons
    const filterButtons = document.querySelectorAll('.filter-btn');
    filterButtons.forEach(btn => {
      btn.addEventListener('click', async () => {
        // Update active button
        filterButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // Update filter and re-render
        const type = btn.dataset.type;
        UI.setFilters({ type: type === 'all' ? null : type });
        await UI.renderTransactions();
      });
    });

    // Category filter
    const categorySelect = document.getElementById('filter-category');
    if (categorySelect) {
      categorySelect.addEventListener('change', async (e) => {
        const categoryId = e.target.value ? parseInt(e.target.value) : null;
        UI.setFilters({ categoryId });
        await UI.renderTransactions();
      });
    }

    // Search input
    const searchInput = document.getElementById('search-transactions');
    if (searchInput) {
      const debouncedSearch = Utils.debounce(async (value) => {
        UI.setFilters({ search: value });
        await UI.renderTransactions();
      }, 300);

      searchInput.addEventListener('input', (e) => {
        debouncedSearch(e.target.value);
      });
    }
  }

  /**
   * Check for updates and prompt user
   */
  async function checkForUpdates() {
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration) {
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              Utils.showNotification('New version available! Refresh to update.', 'info', 5000);
            }
          });
        });
      }
    }
  }

  // Initialize app when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Re-render when data changes (e.g., after sync)
  window.addEventListener('data-updated', async () => {
    if (currentView) {
      await renderCurrentView();
    }
    if (typeof syncStatus !== 'undefined') {
      syncStatus.updateLastSyncTime();
    }
  });

  // Check for updates periodically
  setInterval(checkForUpdates, 60000); // Check every minute
})();
