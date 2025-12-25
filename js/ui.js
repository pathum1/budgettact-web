const UI = (() => {
  let currentFilters = {
    type: 'all',
    categoryId: null,
    search: ''
  };

  // State for selected month (null = current month)
  let selectedMonthOffset = 0; // 0 = current, -1 = previous, 1 = next, etc.

  // State for chart view type
  let chartViewType = 'cumulative'; // 'cumulative' or 'daily'

  // State for selected week in weekly expenses
  let selectedWeek = null; // null = current week

  // Store current chart data for re-rendering without full dashboard refresh
  let currentChartData = {
    transactions: [],
    currency: 'USD',
    monthYear: ''
  };

  /**
   * Get month-year string based on offset from current month
   */
  function getMonthByOffset(offset) {
    const date = new Date();
    date.setMonth(date.getMonth() + offset);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  /**
   * Get formatted month name for display
   */
  function getMonthNameByOffset(offset) {
    const date = new Date();
    date.setMonth(date.getMonth() + offset);
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  /**
   * Get weeks in a month
   */
  function getWeeksInMonth(monthYear) {
    const [year, month] = monthYear.split('-').map(Number);
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);
    const daysInMonth = lastDay.getDate();

    // Calculate number of weeks (ceiling of days / 7)
    const weeks = [];
    let weekStart = 1;
    let weekNum = 1;

    while (weekStart <= daysInMonth) {
      const weekEnd = Math.min(weekStart + 6, daysInMonth);
      weeks.push({
        weekNum,
        startDay: weekStart,
        endDay: weekEnd,
        startDate: new Date(year, month - 1, weekStart),
        endDate: new Date(year, month - 1, weekEnd, 23, 59, 59)
      });
      weekStart = weekEnd + 1;
      weekNum++;
    }

    return weeks;
  }

  /**
   * Get current week number in the month
   */
  function getCurrentWeekInMonth(monthYear) {
    const today = new Date();
    const [year, month] = monthYear.split('-').map(Number);

    // If not current month, return 1
    if (today.getFullYear() !== year || today.getMonth() + 1 !== month) {
      return 1;
    }

    const dayOfMonth = today.getDate();
    return Math.ceil(dayOfMonth / 7);
  }

  /**
   * Get expenses for a specific week
   */
  function getWeekExpenses(transactions, week) {
    return transactions.filter(t => {
      if (t.transactionType !== 'expense') return false;
      const date = new Date(t.transactionDate);
      return date >= week.startDate && date <= week.endDate;
    });
  }

  /**
   * Get daily expenses for a week (array of 7 days, Mon-Sun or actual days)
   */
  function getWeeklyDailyExpenses(transactions, week) {
    const dailyExpenses = [];
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    for (let day = week.startDay; day <= week.endDay; day++) {
      const date = new Date(week.startDate);
      date.setDate(day);

      const dayExpenses = transactions.filter(t => {
        if (t.transactionType !== 'expense') return false;
        const tDate = new Date(t.transactionDate);
        return tDate.getDate() === day &&
               tDate.getMonth() === date.getMonth() &&
               tDate.getFullYear() === date.getFullYear();
      }).reduce((sum, t) => sum + Math.abs(t.transactionAmount), 0);

      dailyExpenses.push({
        day: day,
        dayName: dayNames[date.getDay()],
        amount: dayExpenses
      });
    }

    return dailyExpenses;
  }

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

      const currentMonth = getMonthByOffset(selectedMonthOffset);
      const [transactions, allTransactions, categories, goals, billers, metadata] = await Promise.all([
        Storage.getTransactionsByMonth(currentMonth),
        Storage.getAllTransactions(),
        Storage.getAllCategories(),
        Storage.getAllSavingsGoals(true),
        Storage.getAllBillers(),
        Storage.getMetadata()
      ]);

      // Calculate stats
      const totalSpent = transactions
        .filter(t => t.transactionType === 'expense')
        .reduce((sum, t) => sum + Math.abs(t.transactionAmount), 0);

      const totalIncome = transactions
        .filter(t => t.transactionType === 'income')
        .reduce((sum, t) => sum + Math.abs(t.transactionAmount), 0);

      // Calculate weeks for the current month
      const weeks = getWeeksInMonth(currentMonth);
      const currentWeekNum = getCurrentWeekInMonth(currentMonth);
      if (selectedWeek === null) {
        selectedWeek = currentWeekNum;
      }
      const activeWeek = weeks[Math.min(selectedWeek - 1, weeks.length - 1)];

      // Calculate weekly expenses for selected week
      const weeklyExpenses = getWeekExpenses(transactions, activeWeek)
        .reduce((sum, t) => sum + Math.abs(t.transactionAmount), 0);

      // Get daily data for the week chart
      const weeklyDailyData = getWeeklyDailyExpenses(transactions, activeWeek);

      const currency = metadata?.currency || 'USD';
      const monthlyIncome = metadata?.monthlyIncome || 0;

      // Debug: Log currency information
      console.log('Currency from metadata:', metadata?.currency);
      console.log('Using currency:', currency);

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

      // Calculate total budget and spent (must be after categoriesWithSpent is defined)
      const totalBudget = categoriesWithSpent.reduce((sum, c) => sum + (c.budgetAmount || 0), 0);
      const totalSpentAllCategories = categoriesWithSpent.reduce((sum, c) => sum + c.spent, 0);
      const totalAvailable = totalBudget - totalSpentAllCategories;

      // Calculate biller balances
      const billersWithBalances = calculateBillerBalances(billers, allTransactions);

      // Generate week selector buttons
      const weekButtons = weeks.map((w, i) => `
        <button class="week-btn ${selectedWeek === w.weekNum ? 'active' : ''}" data-week="${w.weekNum}">W${w.weekNum}</button>
      `).join('');

      let html = `
        <div class="month-navigation">
          <button class="month-nav-btn" id="prev-month" title="Previous month">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
          </button>
          <div class="month-display">
            <div class="month-label">${getMonthNameByOffset(selectedMonthOffset)}</div>
            <div class="month-nav-dots">
              <span class="month-dot" data-offset="-1" title="${getMonthNameByOffset(selectedMonthOffset - 1)}"></span>
              <span class="month-dot active" data-offset="0" title="${getMonthNameByOffset(selectedMonthOffset)}"></span>
              <span class="month-dot" data-offset="1" title="${getMonthNameByOffset(selectedMonthOffset + 1)}"></span>
            </div>
          </div>
          <button class="month-nav-btn" id="next-month" title="Next month">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </button>
        </div>
        <div class="dashboard-container">
          <div class="dashboard-main">
            <!-- Top Row: 3 Stat Cards -->
            <div class="stats-row">
              <div class="stat-card-new">
                <div class="stat-header">
                  <span class="stat-label">Monthly Income</span>
                  <div class="stat-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <line x1="12" y1="1" x2="12" y2="23"></line>
                      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                    </svg>
                  </div>
                </div>
                <div class="stat-value">${Utils.formatCurrency(totalIncome, currency)}</div>
                <div class="stat-change positive">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="18 15 12 9 6 15"></polyline>
                  </svg>
                  <span>This month</span>
                </div>
              </div>

              <div class="stat-card-new">
                <div class="stat-header">
                  <span class="stat-label">Monthly Expenses</span>
                  <div class="stat-icon" style="background: rgba(255, 107, 107, 0.15);">
                    <svg viewBox="0 0 24 24" fill="none" stroke="#ff6b6b" stroke-width="2">
                      <path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                    </svg>
                  </div>
                </div>
                <div class="stat-value">${Utils.formatCurrency(totalSpent, currency)}</div>
                <div class="stat-change negative">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                  <span>This month</span>
                </div>
              </div>

              <div class="stat-card-new weekly-card">
                <div class="stat-header">
                  <span class="stat-label">Weekly Expenses</span>
                  <div class="week-selector">${weekButtons}</div>
                </div>
                <div class="stat-value">${Utils.formatCurrency(weeklyExpenses, currency)}</div>
                <div class="weekly-chart-container">
                  <canvas id="weeklyChart"></canvas>
                </div>
              </div>
            </div>

            <!-- Middle Row: Expense Trend (left), Category Budget (right expanded) -->
            <div class="dashboard-grid two-col">
              <div class="dashboard-card">
                <div class="card-title-section">
                  <h3>Expense Trend</h3>
                  <div class="chart-view-toggle">
                    <button class="toggle-btn ${chartViewType === 'cumulative' ? 'active' : ''}" data-view="cumulative">Cumulative</button>
                    <button class="toggle-btn ${chartViewType === 'daily' ? 'active' : ''}" data-view="daily">Daily</button>
                  </div>
                </div>
                <div class="chart-container">
                  <canvas id="spendingChart"></canvas>
                </div>
              </div>

              <div class="dashboard-card category-budget-card">
                <div class="card-title-section">
                  <h3>Category Budget Overview</h3>
                </div>
                <div class="category-budget-content">
                  <div class="budget-left-section">
                    <div class="budget-chart-section">
                      <div class="chart-container doughnut">
                        <canvas id="categoryChart"></canvas>
                      </div>
                    </div>
                    <div class="budget-summary-compact">
                      <div class="budget-summary-row">
                        <span class="budget-dot budget"></span>
                        <span class="budget-label">Budget</span>
                        <span class="budget-value">${Utils.formatCurrency(totalBudget, currency)}</span>
                      </div>
                      <div class="budget-summary-row">
                        <span class="budget-dot spent"></span>
                        <span class="budget-label">Spent</span>
                        <span class="budget-value spent">${Utils.formatCurrency(totalSpentAllCategories, currency)}</span>
                      </div>
                      <div class="budget-summary-row">
                        <span class="budget-dot remaining"></span>
                        <span class="budget-label">Left</span>
                        <span class="budget-value ${totalAvailable < 0 ? 'negative' : 'positive'}">${Utils.formatCurrency(totalAvailable, currency)}</span>
                      </div>
                    </div>
                  </div>
                  <div class="category-breakdown" id="categoryBreakdown"></div>
                </div>
              </div>
            </div>

            <!-- Recent Activity Section -->
            <div class="full-width-card">
              <div class="card-header">
                <h3 class="card-title">Recent Activity</h3>
              </div>
              ${renderTransactionsList(transactions.slice(0, 8), categories, currency)}
            </div>

            <!-- Goals Section -->
            <div class="full-width-card">
              <div class="card-header">
                <h3 class="card-title">Active Goals</h3>
              </div>
              ${renderGoalsList(goals.slice(0, 3), currency)}
            </div>
          </div>

          <div class="billers-sidebar">
            ${renderBillerCards(billersWithBalances, currency)}
          </div>
        </div>
      `;

      container.innerHTML = html;

      // Store current chart data for toggle functionality
      currentChartData = {
        transactions: transactions,
        currency: currency,
        monthYear: currentMonth
      };

      // Render charts and lists after DOM is updated
      setTimeout(() => {
        renderSpendingLineChart(transactions, currency, currentMonth);
        renderWeeklyBarChart(weeklyDailyData, currency);
        renderCategoryDoughnutChart(categoriesWithSpent, currency);
        renderCategoryBreakdown(categoriesWithSpent, currency);

        // Add month navigation event listeners
        const prevBtn = document.getElementById('prev-month');
        const nextBtn = document.getElementById('next-month');

        if (prevBtn) {
          prevBtn.addEventListener('click', () => {
            selectedMonthOffset--;
            selectedWeek = null; // Reset to current week for new month
            renderDashboard();
          });
        }

        if (nextBtn) {
          nextBtn.addEventListener('click', () => {
            selectedMonthOffset++;
            selectedWeek = null; // Reset to current week for new month
            renderDashboard();
          });
        }

        // Add week selector event listeners
        const weekBtns = document.querySelectorAll('.week-btn');
        weekBtns.forEach(btn => {
          btn.addEventListener('click', async (e) => {
            const newWeek = parseInt(e.target.dataset.week);
            if (newWeek !== selectedWeek) {
              selectedWeek = newWeek;
              // Only update the weekly card instead of re-rendering the entire dashboard
              await updateWeeklyExpenseCard(currentMonth, selectedWeek);
            }
          });
        });

        // Add chart view toggle event listeners
        const toggleBtns = document.querySelectorAll('.chart-view-toggle .toggle-btn');
        toggleBtns.forEach(btn => {
          btn.addEventListener('click', (e) => {
            const newView = e.target.dataset.view;
            if (newView !== chartViewType) {
              chartViewType = newView;

              // Update toggle button states
              toggleBtns.forEach(b => b.classList.remove('active'));
              e.target.classList.add('active');

              // Re-render only the spending chart
              renderSpendingLineChart(
                currentChartData.transactions,
                currentChartData.currency,
                currentChartData.monthYear
              );
            }
          });
        });
      }, 100);

    } catch (error) {
      console.error('Failed to render dashboard:', error);
      container.innerHTML = renderErrorState('Failed to load dashboard');
    }
  }

  /**
   * Render spending line chart with gradient
   */
  function renderSpendingLineChart(transactions, currency, monthYear) {
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

    let labels, data;

    if (chartViewType === 'daily') {
      // Daily view: Show spending for each day of the month
      const [year, month] = monthYear.split('-');
      const daysInMonth = new Date(year, month, 0).getDate();

      // Create labels for all days in the month
      labels = [];
      const dailyAmounts = new Array(daysInMonth).fill(0);

      for (let day = 1; day <= daysInMonth; day++) {
        labels.push(day.toString());
      }

      // Fill in actual spending data
      expenses.forEach(t => {
        const date = new Date(t.transactionDate);
        const day = date.getDate();
        dailyAmounts[day - 1] += Math.abs(t.transactionAmount);
      });

      data = dailyAmounts;
    } else {
      // Cumulative view: Show cumulative spending over time
      const dailySpending = {};
      let cumulative = 0;

      expenses.forEach(t => {
        const date = new Date(t.transactionDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        if (!dailySpending[date]) {
          dailySpending[date] = 0;
        }
        // Use absolute value since expenses are stored as negative
        dailySpending[date] += Math.abs(t.transactionAmount);
      });

      labels = Object.keys(dailySpending);
      data = labels.map(label => {
        cumulative += dailySpending[label];
        return cumulative; // Positive values for proper chart display
      });
    }

    const ctx = canvas.getContext('2d');

    // Create gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, 200);
    if (chartViewType === 'daily') {
      // Bar chart gradient (vertical)
      gradient.addColorStop(0, 'rgba(110, 97, 239, 0.9)');
      gradient.addColorStop(1, 'rgba(110, 97, 239, 0.3)');
    } else {
      // Line chart gradient
      gradient.addColorStop(0, 'rgba(110, 97, 239, 0.4)');
      gradient.addColorStop(1, 'rgba(110, 97, 239, 0.01)');
    }

    const chartConfig = {
      type: chartViewType === 'daily' ? 'bar' : 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Expenses',
          data: data,
          borderColor: '#6E61EF',
          backgroundColor: gradient,
          borderWidth: chartViewType === 'daily' ? 0 : 3,
          fill: true,
          tension: 0.4,
          pointRadius: chartViewType === 'daily' ? 0 : 4,
          pointBackgroundColor: '#6E61EF',
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
          pointHoverRadius: 6,
          borderRadius: chartViewType === 'daily' ? 6 : 0,
          borderSkipped: false
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
                const label = chartViewType === 'daily' ? 'Spent: ' : 'Total: ';
                return label + Utils.formatCurrency(context.parsed.y, currency);
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
              display: chartViewType === 'daily',
              color: 'rgba(148, 143, 153, 0.05)',
              drawBorder: false
            },
            ticks: {
              color: '#cac4cf',
              maxRotation: chartViewType === 'daily' ? 0 : 45,
              minRotation: chartViewType === 'daily' ? 0 : 45,
              autoSkip: true,
              maxTicksLimit: chartViewType === 'daily' ? 15 : undefined
            }
          }
        }
      }
    };

    canvas.chart = new Chart(ctx, chartConfig);
  }

  /**
   * Render weekly bar chart
   */
  function renderWeeklyBarChart(dailyData, currency) {
    const canvas = document.getElementById('weeklyChart');
    if (!canvas) return;

    // Destroy existing chart if any
    if (canvas.chart) {
      canvas.chart.destroy();
    }

    const ctx = canvas.getContext('2d');

    // Create gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, 80);
    gradient.addColorStop(0, 'rgba(89, 214, 102, 0.9)');
    gradient.addColorStop(1, 'rgba(89, 214, 102, 0.3)');

    canvas.chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: dailyData.map(d => d.dayName),
        datasets: [{
          data: dailyData.map(d => d.amount),
          backgroundColor: gradient,
          borderRadius: 4,
          borderSkipped: false,
          barThickness: 12
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(43, 41, 48, 0.95)',
            titleColor: '#e6e1e6',
            bodyColor: '#e6e1e6',
            padding: 8,
            displayColors: false,
            callbacks: {
              label: (ctx) => Utils.formatCurrency(ctx.parsed.y, currency)
            }
          }
        },
        scales: {
          y: {
            display: false,
            beginAtZero: true
          },
          x: {
            grid: { display: false },
            ticks: {
              color: '#cac4cf',
              font: { size: 9 }
            }
          }
        }
      }
    });
  }

  /**
   * Update only the weekly expense card without re-rendering entire dashboard
   */
  async function updateWeeklyExpenseCard(currentMonth, weekNum) {
    try {
      // Get transactions for the current month
      const transactions = await Storage.getTransactionsByMonth(currentMonth);
      const metadata = await Storage.getMetadata();
      const currency = metadata?.currency || 'USD';

      // Calculate weeks for the current month
      const weeks = getWeeksInMonth(currentMonth);
      const activeWeek = weeks[Math.min(weekNum - 1, weeks.length - 1)];

      // Calculate weekly expenses for selected week
      const weeklyExpenses = getWeekExpenses(transactions, activeWeek)
        .reduce((sum, t) => sum + Math.abs(t.transactionAmount), 0);

      // Get daily data for the week chart
      const weeklyDailyData = getWeeklyDailyExpenses(transactions, activeWeek);

      // Update the stat value
      const statValueElement = document.querySelector('.weekly-card .stat-value');
      if (statValueElement) {
        statValueElement.textContent = Utils.formatCurrency(weeklyExpenses, currency);
      }

      // Update active week button
      const weekBtns = document.querySelectorAll('.week-btn');
      weekBtns.forEach(btn => {
        const btnWeek = parseInt(btn.dataset.week);
        if (btnWeek === weekNum) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });

      // Re-render only the weekly chart
      renderWeeklyBarChart(weeklyDailyData, currency);
    } catch (error) {
      console.error('Error updating weekly expense card:', error);
    }
  }

  /**
   * Render category doughnut chart with percentage indicators
   */
  function renderCategoryDoughnutChart(categories, currency) {
    const canvas = document.getElementById('categoryChart');
    if (!canvas) return;

    // Destroy existing chart if any
    if (canvas.chart) {
      canvas.chart.destroy();
    }

    // Filter categories with budget
    const validCategories = categories.filter(c => c.budgetAmount > 0 || c.spent > 0);

    if (validCategories.length === 0) {
      canvas.parentElement.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 40px;">No category data</p>';
      return;
    }

    const colors = [
      '#6E61EF', '#59d666', '#ff6b6b', '#ff9800', '#2196F3',
      '#e91e63', '#00bcd4', '#9c27b0', '#4caf50', '#ff5722'
    ];

    const ctx = canvas.getContext('2d');

    // Data shows spent amounts (what's been used)
    const spentData = validCategories.map(c => c.spent);
    const chartColors = validCategories.map((_, i) => colors[i % colors.length]);

    canvas.chart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: validCategories.map(c => c.categoryType),
        datasets: [{
          data: spentData,
          backgroundColor: chartColors,
          borderColor: '#2b2930',
          borderWidth: 2,
          hoverOffset: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '70%',
        plugins: {
          legend: { display: false },
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
                const percentage = Utils.calculatePercentage(category.spent, category.budgetAmount);
                return [
                  `Spent: ${Utils.formatCurrency(category.spent, currency)}`,
                  `Budget: ${Utils.formatCurrency(category.budgetAmount, currency)}`,
                  `${percentage.toFixed(0)}% used`
                ];
              }
            }
          }
        }
      }
    });
  }

  /**
   * Render category breakdown list with progress bars
   */
  function renderCategoryBreakdown(categories, currency) {
    const container = document.getElementById('categoryBreakdown');
    if (!container) return;

    // Filter and sort by spent amount
    const validCategories = categories
      .filter(c => c.budgetAmount > 0 || c.spent > 0)
      .sort((a, b) => b.spent - a.spent)
      .slice(0, 5);

    if (validCategories.length === 0) {
      container.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 10px;">No categories</p>';
      return;
    }

    const colors = [
      '#6E61EF', '#59d666', '#ff6b6b', '#ff9800', '#2196F3'
    ];

    container.innerHTML = validCategories.map((category, index) => {
      const percentage = Utils.calculatePercentage(category.spent, category.budgetAmount);
      const icon = Utils.getCategoryIcon(category.iconName);
      const color = colors[index % colors.length];
      const progressClass = percentage >= 100 ? 'over' : percentage >= 80 ? 'warning' : '';

      return `
        <div class="category-breakdown-item">
          <div class="category-breakdown-header">
            <div class="category-breakdown-left">
              <span class="category-breakdown-icon" style="color: ${color};">${icon}</span>
              <span class="category-breakdown-name">${Utils.escapeHtml(category.categoryType)}</span>
            </div>
            <span class="category-breakdown-percent ${progressClass}">${percentage.toFixed(0)}%</span>
          </div>
          <div class="category-breakdown-bar">
            <div class="category-breakdown-fill ${progressClass}" style="width: ${Math.min(percentage, 100)}%; background: ${color};"></div>
          </div>
          <div class="category-breakdown-amounts">
            <span>${Utils.formatCurrency(category.spent, currency)} spent</span>
            <span>of ${Utils.formatCurrency(category.budgetAmount, currency)}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  /**
   * Render compact transactions list for dashboard
   */
  function renderCompactTransactionsList(transactions, categories, currency) {
    if (transactions.length === 0) {
      return '<p style="text-align: center; color: var(--text-secondary); padding: 20px;">No recent transactions</p>';
    }

    // Create category lookup map
    const categoryMap = {};
    categories.forEach(c => {
      categoryMap[c.id] = {
        name: c.categoryType,
        icon: Utils.getCategoryIcon(c.iconName)
      };
    });

    return transactions.map(t => {
      const category = categoryMap[t.transactionCategory] || { name: 'Unknown', icon: '?' };
      const amountClass = t.transactionType === 'expense' ? 'expense' : 'income';
      const amountPrefix = t.transactionType === 'expense' ? '-' : '+';

      return `
        <div class="compact-transaction-item">
          <div class="compact-transaction-icon">${category.icon}</div>
          <div class="compact-transaction-info">
            <span class="compact-transaction-name">${Utils.escapeHtml(t.merchantName)}</span>
            <span class="compact-transaction-date">${Utils.formatRelativeDate(t.transactionDate)}</span>
          </div>
          <span class="compact-transaction-amount ${amountClass}">${amountPrefix}${Utils.formatCurrency(t.transactionAmount, currency)}</span>
        </div>
      `;
    }).join('');
  }

  /**
   * Calculate biller balances from transactions
   */
  function calculateBillerBalances(billers, transactions) {
    const billersWithBalances = billers.map(biller => {
      // Find all transactions for this biller
      const billerTransactions = transactions.filter(t =>
        t.billerName === biller.billerName
      );

      // Calculate balance (income adds, expenses subtract)
      const balance = billerTransactions.reduce((sum, t) => {
        if (t.transactionType === 'income') {
          return sum + t.transactionAmount;
        } else if (t.transactionType === 'expense') {
          return sum - t.transactionAmount;
        }
        return sum;
      }, 0);

      return {
        ...biller,
        balance,
        transactionCount: billerTransactions.length
      };
    });

    // Find the "Total" or "Total Balance" biller and update its balance to sum of all others
    const totalBiller = billersWithBalances.find(b =>
      b.billerName === 'Total' || b.billerName === 'Total Balance'
    );

    if (totalBiller) {
      // Calculate sum of all non-Total billers
      const totalBalance = billersWithBalances
        .filter(b => b.billerName !== 'Total' && b.billerName !== 'Total Balance')
        .reduce((sum, b) => sum + b.balance, 0);

      totalBiller.balance = totalBalance;
    }

    return billersWithBalances.sort((a, b) => {
      // Sort: Total first, then Wallet, then others by balance
      if (a.billerName === 'Total' || a.billerName === 'Total Balance') return -1;
      if (b.billerName === 'Total' || b.billerName === 'Total Balance') return 1;
      if (a.billerName === 'Wallet') return -1;
      if (b.billerName === 'Wallet') return 1;
      return b.balance - a.balance;
    });
  }

  /**
   * Render biller cards in credit card style
   */
  function renderBillerCards(billers, currency) {
    if (!billers || billers.length === 0) {
      return '<p style="text-align: center; color: var(--text-secondary); padding: 20px;">No accounts found</p>';
    }

    const getBillerCardClass = (billerName) => {
      const name = billerName.toLowerCase();
      if (name.includes('wallet')) return 'wallet';
      if (name.includes('total')) return 'total';
      return 'other';
    };

    const getBillerIcon = (billerName) => {
      const name = billerName.toLowerCase();
      if (name.includes('wallet')) {
        return `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"></path>
            <path d="M3 5v14a2 2 0 0 0 2 2h16v-5"></path>
            <path d="M18 12a2 2 0 0 0 0 4h4v-4Z"></path>
          </svg>
        `;
      }
      if (name.includes('total')) {
        return `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
            <line x1="1" y1="10" x2="23" y2="10"></line>
          </svg>
        `;
      }
      return `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
          <line x1="1" y1="10" x2="23" y2="10"></line>
        </svg>
      `;
    };

    const header = '<div class="billers-header">Billers / Accounts</div>';

    const cards = billers.map(biller => {
      const cardClass = getBillerCardClass(biller.billerName);
      const icon = getBillerIcon(biller.billerName);
      const displayName = biller.billerActualName || biller.billerName;

      return `
        <div class="biller-card ${cardClass}">
          <div class="biller-card-header">
            <div class="biller-name">${Utils.escapeHtml(displayName)}</div>
            <div class="biller-icon">${icon}</div>
          </div>

          <div class="biller-balance">
            <div class="biller-balance-label">Current Balance</div>
            <div class="biller-balance-amount">
              ${Utils.formatCurrency(biller.balance, currency)}
            </div>
          </div>

          <div class="biller-card-footer">
            <div class="biller-type">${Utils.escapeHtml(biller.billerName)}</div>
            <div class="biller-chip"></div>
          </div>
        </div>
      `;
    }).join('');

    return header + cards;
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
        const icon = Utils.getCategoryIcon(category.iconName);

        return `
          <div class="category-card">
            <div class="category-header">
              <div class="category-name">
                <span class="category-icon">${icon}</span>
                ${Utils.escapeHtml(category.categoryType)}
              </div>
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

    // Create category lookup map with name and icon
    const categoryMap = {};
    categories.forEach(c => {
      categoryMap[c.id] = {
        name: c.categoryType,
        icon: Utils.getCategoryIcon(c.iconName)
      };
    });

    return transactions.map(t => {
      const category = categoryMap[t.transactionCategory] || { name: 'Unknown', icon: '💰' };
      const amountClass = t.transactionType === 'expense' ? 'expense' : 'income';
      const amountPrefix = t.transactionType === 'expense' ? '-' : '+';

      return `
        <div class="transaction-item">
          <div class="transaction-info">
            <div class="transaction-merchant">
              <span class="category-icon">${category.icon}</span>
              ${Utils.escapeHtml(t.merchantName)}
            </div>
            <div class="transaction-meta">
              ${Utils.formatRelativeDate(t.transactionDate)} &bull; ${Utils.escapeHtml(category.name)}
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
