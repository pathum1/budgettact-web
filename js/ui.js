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
      const totalSpent = transactions
        .filter(t => t.transactionType === 'expense')
        .reduce((sum, t) => sum + t.transactionAmount, 0);

      const currency = metadata?.currency || 'USD';

      // Calculate category data for doughnut chart
      const categoriesWithSpent = await Promise.all(
        categories.map(async (category) => {
          const spent = await Storage.getCategorySpent(category.id, currentMonth);
          return {
            ...category,
            spent,
            budgetAmount: category.budgetAmount || 0
          };
        })
      );

      let html = `
        <div class="dashboard-grid">
          <div class="dashboard-card">
            <div class="card-title-section">
              <h3>Total Spent</h3>
            </div>
            <div class="card-amount">${Utils.formatCurrency(totalSpent, currency)}</div>
            <div class="chart-container">
              <canvas id="spendingChart"></canvas>
            </div>
          </div>

          <div class="dashboard-card">
            <div class="card-title-section">
              <h3>Category Budget Overview</h3>
            </div>
            <div class="chart-container doughnut">
              <canvas id="categoryChart"></canvas>
            </div>
            <div class="category-legend" id="categoryLegend"></div>
          </div>
        </div>

        <div class="full-width-card">
          <div class="card-header">
            <h3 class="card-title">Recent Transactions</h3>
          </div>
          ${renderTransactionsList(transactions.slice(0, 10), categories, currency)}
        </div>

        <div class="full-width-card">
          <div class="card-header">
            <h3 class="card-title">Active Goals</h3>
          </div>
          ${renderGoalsList(goals.slice(0, 3), currency)}
        </div>
      `;

      container.innerHTML = html;

      // Render charts after DOM is updated
      setTimeout(() => {
        renderSpendingLineChart(transactions, currency);
        renderCategoryDoughnutChart(categoriesWithSpent, currency);
      }, 100);

    } catch (error) {
      console.error('Failed to render dashboard:', error);
      container.innerHTML = renderErrorState('Failed to load dashboard');
    }
  }

  /**
   * Render spending line chart with gradient
   */
  function renderSpendingLineChart(transactions, currency) {
    const canvas = document.getElementById('spendingChart');
    if (!canvas) return;

    // Destroy existing chart if any
    if (canvas.chart) {
      canvas.chart.destroy();
    }

    // Get expense transactions only
    const expenses = transactions.filter(t => t.transactionType === 'expense');

    // Sort by date
    expenses.sort((a, b) => new Date(a.transactionDate) - new Date(b.transactionDate));

    // Group by day and calculate cumulative spending
    const dailySpending = {};
    let cumulative = 0;

    expenses.forEach(t => {
      const date = new Date(t.transactionDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      if (!dailySpending[date]) {
        dailySpending[date] = 0;
      }
      dailySpending[date] += t.transactionAmount;
    });

    const labels = Object.keys(dailySpending);
    const data = labels.map(label => {
      cumulative += dailySpending[label];
      return cumulative;
    });

    const ctx = canvas.getContext('2d');

    // Create gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, 200);
    gradient.addColorStop(0, 'rgba(110, 97, 239, 0.4)');
    gradient.addColorStop(1, 'rgba(110, 97, 239, 0.01)');

    canvas.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Cumulative Spending',
          data: data,
          borderColor: '#6E61EF',
          backgroundColor: gradient,
          borderWidth: 3,
          fill: true,
          tension: 0.4,
          pointRadius: 4,
          pointBackgroundColor: '#6E61EF',
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
          pointHoverRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            backgroundColor: 'rgba(43, 41, 48, 0.95)',
            titleColor: '#e6e1e6',
            bodyColor: '#e6e1e6',
            borderColor: '#6E61EF',
            borderWidth: 1,
            padding: 12,
            displayColors: false,
            callbacks: {
              label: function(context) {
                return 'Total: ' + Utils.formatCurrency(context.parsed.y, currency);
              }
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            grid: {
              color: 'rgba(148, 143, 153, 0.1)',
              drawBorder: false
            },
            ticks: {
              color: '#cac4cf',
              callback: function(value) {
                return Utils.formatCurrency(value, currency);
              }
            }
          },
          x: {
            grid: {
              display: false,
              drawBorder: false
            },
            ticks: {
              color: '#cac4cf',
              maxRotation: 45,
              minRotation: 45
            }
          }
        }
      }
    });
  }

  /**
   * Render category doughnut chart
   */
  function renderCategoryDoughnutChart(categories, currency) {
    const canvas = document.getElementById('categoryChart');
    const legendContainer = document.getElementById('categoryLegend');
    if (!canvas) return;

    // Destroy existing chart if any
    if (canvas.chart) {
      canvas.chart.destroy();
    }

    // Filter out categories with no budget or spending
    const validCategories = categories.filter(c => c.budgetAmount > 0 || c.spent > 0);

    if (validCategories.length === 0) {
      canvas.parentElement.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 40px;">No category data available</p>';
      return;
    }

    // Generate vibrant, distinct colors for each category
    const colors = [
      '#6E61EF', // Primary purple
      '#59d666', // Success green
      '#ff6b6b', // Danger red
      '#ff9800', // Warning orange
      '#2196F3', // Blue
      '#e91e63', // Pink
      '#00bcd4', // Cyan
      '#9c27b0', // Purple
      '#4caf50', // Green
      '#ff5722', // Deep orange
      '#795548', // Brown
      '#607d8b'  // Blue grey
    ];

    const labels = validCategories.map(c => c.categoryType);
    const budgetData = validCategories.map(c => c.budgetAmount);
    const spentData = validCategories.map(c => c.spent);
    const chartColors = validCategories.map((_, i) => colors[i % colors.length]);

    const ctx = canvas.getContext('2d');

    // Create combined data (budget + spent)
    const combinedData = validCategories.map(c => c.budgetAmount + c.spent);

    canvas.chart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: combinedData,
          backgroundColor: chartColors,
          borderColor: '#2b2930',
          borderWidth: 3,
          hoverOffset: 10
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            backgroundColor: 'rgba(43, 41, 48, 0.95)',
            titleColor: '#e6e1e6',
            bodyColor: '#e6e1e6',
            borderColor: '#6E61EF',
            borderWidth: 1,
            padding: 12,
            callbacks: {
              label: function(context) {
                const category = validCategories[context.dataIndex];
                return [
                  `Budget: ${Utils.formatCurrency(category.budgetAmount, currency)}`,
                  `Spent: ${Utils.formatCurrency(category.spent, currency)}`,
                  `Remaining: ${Utils.formatCurrency(category.budgetAmount - category.spent, currency)}`
                ];
              }
            }
          }
        }
      }
    });

    // Render custom legend
    if (legendContainer) {
      legendContainer.innerHTML = validCategories.map((category, index) => {
        const percentage = Utils.calculatePercentage(category.spent, category.budgetAmount);
        const remaining = category.budgetAmount - category.spent;
        return `
          <div class="legend-item" style="border-left-color: ${chartColors[index]}">
            <div class="legend-left">
              <div class="legend-color" style="background-color: ${chartColors[index]}"></div>
              <span class="legend-name">${Utils.escapeHtml(category.categoryType)}</span>
            </div>
            <div class="legend-right">
              <span class="legend-amount">${Utils.formatCurrency(category.spent, currency)} / ${Utils.formatCurrency(category.budgetAmount, currency)}</span>
              <span class="legend-percentage">${percentage.toFixed(0)}% used</span>
            </div>
          </div>
        `;
      }).join('');
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
    try {
      const metadata = await Storage.getMetadata();
      if (typeof syncStatus !== 'undefined' && syncStatus.statusElement) {
        if (metadata?.exportedAt) {
          const exportDate = Utils.formatDate(metadata.exportedAt, 'time');
          syncStatus.setDetailsMessage(`Last synced: ${exportDate}`);
        } else {
          syncStatus.updateLastSyncTime();
        }
        return;
      }

      const statusElement = document.getElementById('sync-status');
      if (!statusElement) return;

      if (!metadata) {
        statusElement.textContent = 'No data loaded';
        return;
      }

      const exportDate = Utils.formatDate(metadata.exportedAt, 'time');
      statusElement.textContent = `Last synced: ${exportDate} from ${metadata.deviceName}`;
    } catch (error) {
      console.error('Failed to update sync status:', error);
      const statusElement = document.getElementById('sync-status');
      if (statusElement) {
        statusElement.textContent = 'Sync status unavailable';
      }
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
