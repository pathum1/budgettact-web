/**
 * Modal Management System
 * Provides reusable modal dialogs for CRUD operations
 * Design: Modern Financial Brutalism with glassmorphism
 */
const Modals = (() => {
  let activeModal = null;

  /**
   * Create and show a modal
   * @param {Object} config - Modal configuration
   * @returns {HTMLElement} Modal element
   */
  function show(config) {
    // Close any existing modal
    if (activeModal) {
      close();
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.onclick = (e) => {
      if (e.target === overlay) close();
    };

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-header">
        <h2>${config.title}</h2>
        <button class="modal-close" onclick="Modals.close()" aria-label="Close modal">&times;</button>
      </div>
      <div class="modal-body">
        ${config.body}
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Modals.close()">Cancel</button>
        <button class="btn btn-primary" id="modal-submit">${config.submitText || 'Save'}</button>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    activeModal = overlay;

    // Animate in
    requestAnimationFrame(() => {
      overlay.classList.add('modal-visible');
    });

    // Focus first input
    setTimeout(() => {
      const firstInput = modal.querySelector('input:not([type="radio"]):not([type="checkbox"]), select, textarea');
      if (firstInput) firstInput.focus();
    }, 100);

    // Bind submit handler
    const submitBtn = modal.querySelector('#modal-submit');
    submitBtn.onclick = async () => {
      submitBtn.disabled = true;
      const originalText = submitBtn.textContent;
      submitBtn.textContent = 'Saving...';
      submitBtn.classList.add('loading');

      try {
        await config.onSubmit();
        close();
      } catch (error) {
        console.error('Modal submit error:', error);
        showError(error.message || 'An error occurred');
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
        submitBtn.classList.remove('loading');
      }
    };

    // Handle Enter key (but not in textarea)
    modal.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        submitBtn.click();
      }
      if (e.key === 'Escape') {
        close();
      }
    });

    return modal;
  }

  /**
   * Close the active modal
   */
  function close() {
    if (activeModal) {
      activeModal.classList.remove('modal-visible');
      activeModal.classList.add('modal-closing');
      setTimeout(() => {
        if (activeModal && activeModal.parentElement) {
          activeModal.remove();
        }
        activeModal = null;
      }, 250);
    }
  }

  /**
   * Show confirmation dialog
   * @param {string} message - Confirmation message
   * @param {Function} onConfirm - Callback on confirm
   * @param {Object} options - Options {danger: boolean, confirmText: string}
   */
  function confirm(message, onConfirm, options = {}) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'modal modal-confirm';
    modal.innerHTML = `
      <div class="modal-body">
        <div class="confirm-icon ${options.danger ? 'danger' : ''}">
          ${options.danger ? '⚠️' : 'ℹ️'}
        </div>
        <p>${message}</p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
        <button class="btn ${options.danger ? 'btn-danger' : 'btn-primary'}" id="confirm-btn">
          ${options.confirmText || (options.danger ? 'Delete' : 'Confirm')}
        </button>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Animate in
    requestAnimationFrame(() => {
      overlay.classList.add('modal-visible');
    });

    modal.querySelector('#confirm-btn').onclick = async () => {
      const btn = modal.querySelector('#confirm-btn');
      btn.disabled = true;
      btn.classList.add('loading');

      try {
        await onConfirm();
        overlay.classList.remove('modal-visible');
        overlay.classList.add('modal-closing');
        setTimeout(() => overlay.remove(), 250);
      } catch (error) {
        console.error('Confirm action error:', error);
        showError(error.message || 'An error occurred');
        btn.disabled = false;
        btn.classList.remove('loading');
      }
    };

    // Handle Escape key
    modal.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        overlay.remove();
      }
    });
  }

  /**
   * Show error notification
   * @param {string} message - Error message
   */
  function showError(message) {
    const error = document.createElement('div');
    error.className = 'modal-error';
    error.innerHTML = `
      <span class="error-icon">⚠️</span>
      <span class="error-message">${message}</span>
      <button class="error-close" onclick="this.parentElement.remove()">✕</button>
    `;

    const modal = document.querySelector('.modal');
    if (modal) {
      const body = modal.querySelector('.modal-body');
      body.insertBefore(error, body.firstChild);

      // Auto-dismiss after 5 seconds
      setTimeout(() => {
        if (error.parentElement) {
          error.classList.add('error-hiding');
          setTimeout(() => error.remove(), 300);
        }
      }, 5000);
    }
  }

  return { show, close, confirm, showError };
})();
