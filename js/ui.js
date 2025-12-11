const UI = (() => {
  let currentFilters = {
    type: 'all',
    categoryId: null,
    search: ''
  };

  /**
   * Render Dashboard View
   */
  async function renderDashboard() {
    const container = document.getElementById('dashboard-content');

    try {
      const hasData = await Storage.hasData();

      if (!hasData) {
        container.innerHTML = renderEmptyState(
          'No Data',
          'Import your budget data to get started',
          'Click the import button above'
        );
        return;
      }

      const currentMonth = Utils.getCurrentMonthYear();
      const [transactions, categories, goals, metadata] = await Promise.all([
        Storage.getTransactionsByMonth(currentMonth),
        Storage.getAllCategories(),
        Storage.getAllSavingsGoals(true),
        Storage.getMetadata()
      ]);

      // Calculate stats
      const totalBudget = categories.reduce((sum, c) => sum + c.budgetAmount, 0);
      const totalSpent = transactions
        .filter(t => t.transactionType === 'expense')
        .reduce((sum, t) => sum + t.transactionAmount, 0);
      const totalIncome = transactions
        .filter(t => t.transactionType === 'income')
        .reduce((sum, t) => sum + t.transactionAmount, 0);
      const remaining = totalBudget - totalSpent;

      const currency = metadata?.currency || 'USD';

      let html = `
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">Budget</div>
            <div class="stat-value">${Utils.formatCurrency(totalBudget, currency)}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Spent</div>
            <div class="stat-value negative">${Utils.formatCurrency(totalSpent, currency)}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Remaining</div>
            <div class="stat-value ${remaining >= 0 ? 'positive' : 'negative'}">
              ${Utils.formatCurrency(remaining, currency)}
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Income</div>
            <div class="stat-value positive">${Utils.formatCurrency(totalIncome, currency)}</div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Recent Transactions</h3>
          </div>
          ${renderTransactionsList(transactions.slice(0, 10), categories, currency)}
        </div>

        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Active Goals</h3>
          </div>
          ${renderGoalsList(goals.slice(0, 3), currency)}
        </div>
      `;

      container.innerHTML = html;
    } catch (error) {
      console.error('Failed to render dashboard:', error);
      container.innerHTML = renderErrorState('Failed to load dashboard');
    }
  }

  /**
   * Render Transactions View
   */
  async function renderTransactions() {
    const container = document.getElementById('transactions-content');

    try {
      const [transactions, categories, metadata] = await Promise.all([
        Storage.getAllTransactions(currentFilters),
        Storage.getAllCategories(),
        Storage.getMetadata()
      ]);

      const currency = metadata?.currency || 'USD';

      if (transactions.length === 0) {
        container.innerHTML = renderEmptyState(
          'No Transactions',
          'No transactions match your filters',
          'Try adjusting your filters'
        );
        return;
      }

      container.innerHTML = `
        <div class="card">
          ${renderTransactionsList(transactions, categories, currency)}
        </div>
      `;

      // Update category filter dropdown
      updateCategoryFilter(categories);
    } catch (error) {
      console.error('Failed to render transactions:', error);
      container.innerHTML = renderErrorState('Failed to load transactions');
    }
  }

  /**
   * Render Categories View
   */
  async function renderCategories() {
    const container = document.getElementById('categories-content');

    try {
      const [categories, metadata] = await Promise.all([
        Storage.getAllCategories(),
        Storage.getMetadata()
      ]);

      if (categories.length === 0) {
        container.innerHTML = renderEmptyState(
          'No Categories',
          'No budget categories found',
          'Import data to see categories'
        );
        return;
      }

      const currentMonth = Utils.getCurrentMonthYear();
      const currency = metadata?.currency || 'USD';

      // Calculate spent for each category
      const categoriesWithSpent = await Promise.all(
        categories.map(async (category) => {
          const spent = await Storage.getCategorySpent(category.id, currentMonth);
          return { ...category, spent };
        })
      );

      // Sort by budget amount (descending)
      categoriesWithSpent.sort((a, b) => b.budgetAmount - a.budgetAmount);

      const html = categoriesWithSpent.map(category => {
        const remaining = category.budgetAmount - category.spent;
        const percentage = Utils.calculatePercentage(category.spent, category.budgetAmount);
        const progressClass = percentage >= 100 ? 'danger' : percentage >= 80 ? 'warning' : '';

        return `
          <div class="category-card">
            <div class="category-header">
              <div class="category-name">${Utils.escapeHtml(category.categoryType)}</div>
            </div>
            <div class="category-amounts">
              <span class="category-budget">Budget: ${Utils.formatCurrency(category.budgetAmount, currency)}</span>
              <span class="category-spent">Spent: ${Utils.formatCurrency(category.spent, currency)}</span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill ${progressClass}" style="width: ${Math.min(percentage, 100)}%"></div>
            </div>
            <div class="category-amounts" style="margin-top: 8px;">
              <span class="category-remaining ${remaining < 0 ? 'over-budget' : ''}">
                Remaining: ${Utils.formatCurrency(remaining, currency)}
              </span>
              <span style="color: var(--text-secondary);">${percentage.toFixed(0)}%</span>
            </div>
          </div>
        `;
      }).join('');

      container.innerHTML = html;
    } catch (error) {
      console.error('Failed to render categories:', error);
      container.innerHTML = renderErrorState('Failed to load categories');
    }
  }

  /**
   * Render Savings Goals View
   */
  async function renderGoals() {
    const container = document.getElementById('goals-content');

    try {
      const [goals, metadata] = await Promise.all([
        Storage.getAllSavingsGoals(),
        Storage.getMetadata()
      ]);

      if (goals.length === 0) {
        container.innerHTML = renderEmptyState(
          'No Goals',
          'No savings goals found',
          'Import data to see goals'
        );
        return;
      }

      const currency = metadata?.currency || 'USD';

      // Sort by priority and then by percentage
      goals.sort((a, b) => {
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        const aPriority = priorityOrder[a.priority] ?? 3;
        const bPriority = priorityOrder[b.priority] ?? 3;

        if (aPriority !== bPriority) return aPriority - bPriority;

        const aPercentage = Utils.calculatePercentage(a.currentAmount, a.targetAmount);
        const bPercentage = Utils.calculatePercentage(b.currentAmount, b.targetAmount);
        return bPercentage - aPercentage;
      });

      const html = goals.map(goal => {
        const percentage = Utils.calculatePercentage(goal.currentAmount, goal.targetAmount);
        const progressClass = percentage >= 100 ? 'success' : percentage >= 75 ? 'warning' : '';
        const daysText = goal.targetDate ? Utils.formatDaysUntil(goal.targetDate) : '';

        return `
          <div class="goal-card">
            <div class="goal-header">
              <div class="goal-name">${Utils.escapeHtml(goal.goalName)}</div>
              ${goal.priority ? `<span class="goal-priority ${goal.priority}">${goal.priority}</span>` : ''}
            </div>
            ${goal.description ? `<p class="card-subtitle">${Utils.escapeHtml(goal.description)}</p>` : ''}
            <div class="goal-progress">${percentage.toFixed(1)}%</div>
            <div class="progress-bar">
              <div class="progress-fill ${progressClass}" style="width: ${Math.min(percentage, 100)}%"></div>
            </div>
            <div class="goal-amounts">
              <span>${Utils.formatCurrency(goal.currentAmount, currency)}</span>
              <span>${Utils.formatCurrency(goal.targetAmount, currency)}</span>
            </div>
            ${daysText ? `
              <div style="text-align: center; margin-top: 8px; font-size: 14px; color: var(--text-secondary);">
                ${daysText}
              </div>
            ` : ''}
            ${!goal.isActive ? '<div style="text-align: center; margin-top: 8px; color: var(--warning-color);">Inactive</div>' : ''}
          </div>
        `;
      }).join('');

      container.innerHTML = html;
    } catch (error) {
      console.error('Failed to render goals:', error);
      container.innerHTML = renderErrorState('Failed to load goals');
    }
  }

  /**
   * Render transactions list
   */
  function renderTransactionsList(transactions, categories, currency) {
    if (transactions.length === 0) {
      return '<p style="text-align: center; color: var(--text-secondary); padding: 20px;">No transactions</p>';
    }

    // Create category lookup map
    const categoryMap = {};
    categories.forEach(c => {
      categoryMap[c.id] = c.categoryType;
    });

    return transactions.map(t => {
      const categoryName = categoryMap[t.transactionCategory] || 'Unknown';
      const amountClass = t.transactionType === 'expense' ? 'expense' : 'income';
      const amountPrefix = t.transactionType === 'expense' ? '-' : '+';

      return `
        <div class="transaction-item">
          <div class="transaction-info">
            <div class="transaction-merchant">${Utils.escapeHtml(t.merchantName)}</div>
            <div class="transaction-meta">
              ${Utils.formatRelativeDate(t.transactionDate)} &bull; ${Utils.escapeHtml(categoryName)}
            </div>
          </div>
          <div class="transaction-amount ${amountClass}">
            ${amountPrefix}${Utils.formatCurrency(t.transactionAmount, currency)}
          </div>
        </div>
      `;
    }).join('');
  }

  /**
   * Render goals list
   */
  function renderGoalsList(goals, currency) {
    if (goals.length === 0) {
      return '<p style="text-align: center; color: var(--text-secondary); padding: 20px;">No active goals</p>';
    }

    return goals.map(goal => {
      const percentage = Utils.calculatePercentage(goal.currentAmount, goal.targetAmount);

      return `
        <div class="transaction-item">
          <div class="transaction-info">
            <div class="transaction-merchant">${Utils.escapeHtml(goal.goalName)}</div>
            <div class="transaction-meta">${percentage.toFixed(0)}% complete</div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 14px; color: var(--text-secondary);">
              ${Utils.formatCurrency(goal.currentAmount, currency)}
            </div>
            <div style="font-size: 12px; color: var(--text-secondary);">
              of ${Utils.formatCurrency(goal.targetAmount, currency)}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  /**
   * Update category filter dropdown
   */
  function updateCategoryFilter(categories) {
    const select = document.getElementById('filter-category');
    if (!select) return;

    const options = categories.map(c =>
      `<option value="${c.id}">${Utils.escapeHtml(c.categoryType)}</option>`
    ).join('');

    select.innerHTML = `<option value="">All Categories</option>${options}`;
  }

  /**
   * Render empty state
   */
  function renderEmptyState(title, message, hint) {
    return `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
        <h3>${title}</h3>
        <p>${message}</p>
        ${hint ? `<p style="font-size: 12px; margin-top: 8px;">${hint}</p>` : ''}
      </div>
    `;
  }

  /**
   * Render error state
   */
  function renderErrorState(message) {
    return `
      <div class="empty-state">
        <h3>Error</h3>
        <p>${message}</p>
      </div>
    `;
  }

  /**
   * Update sync status footer
   */
  async function updateSyncStatus() {
    const statusElement = document.getElementById('sync-status');
    if (!statusElement) return;

    try {
      const metadata = await Storage.getMetadata();

      if (!metadata) {
        statusElement.textContent = 'No data loaded';
        return;
      }

      const exportDate = Utils.formatDate(metadata.exportedAt, 'time');
      statusElement.textContent = `Last synced: ${exportDate} from ${metadata.deviceName}`;
    } catch (error) {
      console.error('Failed to update sync status:', error);
      statusElement.textContent = 'Sync status unavailable';
    }
  }

  /**
   * Set transaction filters
   */
  function setFilters(filters) {
    currentFilters = { ...currentFilters, ...filters };
  }

  /**
   * Get current filters
   */
  function getFilters() {
    return { ...currentFilters };
  }

  // Public API
  return {
    renderDashboard,
    renderTransactions,
    renderCategories,
    renderGoals,
    updateSyncStatus,
    setFilters,
    getFilters
  };
})();
