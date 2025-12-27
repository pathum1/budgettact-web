/**
 * Conflict Notification System
 * Shows user-friendly notifications when sync conflicts are resolved
 */
const ConflictNotification = (() => {

  /**
   * Show conflict notification
   * @param {Array} conflictDetails - Array of conflict detail objects
   */
  function show(conflictDetails) {
    if (!conflictDetails || conflictDetails.length === 0) {
      return;
    }

    // Remove any existing notification
    const existing = document.querySelector('.conflict-notification');
    if (existing) existing.remove();

    const count = conflictDetails.length;
    const notification = document.createElement('div');
    notification.className = 'conflict-notification';
    notification.innerHTML = `
      <div class="conflict-icon">⚠️</div>
      <div class="conflict-message">
        <strong>${count} sync conflict${count > 1 ? 's' : ''} resolved</strong>
        <span>Tap to view details</span>
      </div>
      <button class="conflict-dismiss" onclick="this.parentElement.remove()">✕</button>
    `;

    notification.onclick = (e) => {
      if (!e.target.classList.contains('conflict-dismiss')) {
        showDetails(conflictDetails);
        notification.remove();
      }
    };

    document.body.appendChild(notification);

    // Auto-dismiss after 10 seconds
    setTimeout(() => {
      if (notification.parentElement) {
        notification.classList.add('conflict-notification-hiding');
        setTimeout(() => notification.remove(), 300);
      }
    }, 10000);
  }

  /**
   * Show detailed conflict modal
   * @param {Array} conflictDetails - Array of conflict detail objects
   */
  function showDetails(conflictDetails) {
    const groupedByEntity = {};
    for (const conflict of conflictDetails) {
      const entity = conflict.entity || 'unknown';
      if (!groupedByEntity[entity]) {
        groupedByEntity[entity] = [];
      }
      groupedByEntity[entity].push(conflict);
    }

    let detailsHtml = '';
    for (const [entity, conflicts] of Object.entries(groupedByEntity)) {
      const entityName = entity.charAt(0).toUpperCase() + entity.slice(1);
      detailsHtml += `
        <div class="conflict-group">
          <h4>${entityName} (${conflicts.length})</h4>
          <ul>
            ${conflicts.map(c => `
              <li>
                <span class="conflict-id">${c.id}</span>
                ${c.error ?
                  `<span class="conflict-error">Error: ${c.error}</span>` :
                  `<span class="conflict-winner">Winner: ${c.winner}</span>`
                }
              </li>
            `).join('')}
          </ul>
        </div>
      `;
    }

    const strategy = (typeof PairingManager !== 'undefined' ? PairingManager.getConflictStrategy() : null) || 'newerWins';
    const strategyNames = {
      newerWins: 'Newer Wins',
      androidWins: 'Android Wins',
      webWins: 'Web Wins'
    };

    if (typeof Modals !== 'undefined') {
      Modals.show({
        title: 'Sync Conflicts Resolved',
        body: `
          <div class="conflict-details">
            <p class="conflict-strategy">
              Resolution strategy: <strong>${strategyNames[strategy] || strategy}</strong>
            </p>
            ${detailsHtml}
          </div>
        `,
        submitText: 'OK',
        onSubmit: () => {} // Just closes modal
      });
    }
  }

  return { show, showDetails };
})();
