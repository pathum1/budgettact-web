// Main Application
(async function() {
  let currentView = 'dashboard';

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

    // Register service worker
    registerServiceWorker();

    // Set up event listeners
    setupNavigation();
    setupImportModal();
    setupFilters();

    // Load initial view
    const hash = window.location.hash.slice(1) || 'dashboard';
    await navigateToView(hash);

    // Update sync status
    UI.updateSyncStatus();

    console.log('BudgetTact Web initialized');
  }

  /**
   * Register service worker for PWA
   */
  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/service-worker.js')
        .then(registration => {
          console.log('Service Worker registered:', registration);
        })
        .catch(error => {
          console.log('Service Worker registration failed:', error);
        });
    }
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
      viewElement.classList.add('active');
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
    switch (currentView) {
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
   * Set up import modal
   */
  function setupImportModal() {
    const modal = document.getElementById('import-modal');
    const importBtn = document.getElementById('import-btn');
    const closeBtn = document.getElementById('close-modal');
    const cancelBtn = document.getElementById('cancel-import');
    const confirmBtn = document.getElementById('confirm-import');
    const textarea = document.getElementById('import-textarea');
    const errorDiv = document.getElementById('import-error');
    const successDiv = document.getElementById('import-success');

    // Open modal
    importBtn.addEventListener('click', () => {
      modal.classList.add('active');
      textarea.value = '';
      errorDiv.classList.remove('active');
      successDiv.classList.remove('active');
      errorDiv.textContent = '';
      successDiv.textContent = '';
    });

    // Close modal
    const closeModal = () => {
      modal.classList.remove('active');
    };

    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);

    // Click outside to close
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeModal();
      }
    });

    // Confirm import
    confirmBtn.addEventListener('click', async () => {
      const jsonString = textarea.value.trim();

      if (!jsonString) {
        errorDiv.textContent = 'Please paste your budget data';
        errorDiv.classList.add('active');
        return;
      }

      // Disable button during import
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Importing...';
      errorDiv.classList.remove('active');
      successDiv.classList.remove('active');

      try {
        const result = await Sync.importSyncData(jsonString);

        if (result.success) {
          successDiv.textContent = `${result.message}\n\nImported:\n- ${result.stats.transactions} transactions\n- ${result.stats.categories} categories\n- ${result.stats.goals} goals`;
          successDiv.classList.add('active');

          // Update UI
          await UI.updateSyncStatus();

          // Close modal and refresh view after 2 seconds
          setTimeout(async () => {
            closeModal();
            await renderCurrentView();
            Utils.showNotification('Data imported successfully!', 'success');
          }, 2000);
        } else {
          let errorMessage = result.message;
          if (result.errors && result.errors.length > 0) {
            errorMessage += '\n\nErrors:\n' + result.errors.slice(0, 5).join('\n');
            if (result.errors.length > 5) {
              errorMessage += `\n... and ${result.errors.length - 5} more errors`;
            }
          }
          errorDiv.textContent = errorMessage;
          errorDiv.classList.add('active');
        }
      } catch (error) {
        console.error('Import error:', error);
        errorDiv.textContent = 'An unexpected error occurred. Please try again.';
        errorDiv.classList.add('active');
      } finally {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Import';
      }
    });
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

  // Check for updates periodically
  setInterval(checkForUpdates, 60000); // Check every minute
})();
