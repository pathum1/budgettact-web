/**
 * CRUD UI Components
 * Handles UI interactions for creating, editing, and deleting records
 * Design: Modern Financial Brutalism with smooth interactions
 */
const CrudUI = (() => {

  // ============================================
  // TRANSACTION CRUD
  // ============================================

  /**
   * Show add transaction modal
   */
  async function showAddTransactionModal() {
    const categories = await Storage.getActiveCategories();
    const billers = await Storage.getAllBillers();

    // Ensure currency is a string
    let currency = await Storage.getMetadata('currency');
    if (typeof currency === 'object' && currency !== null) {
      currency = currency.value || currency.currency || 'USD';
    }
    currency = currency || 'USD';

    const categoryOptions = categories
      .map(c => `<option value="${c.id}">${c.categoryType}</option>`)
      .join('');

    const billerOptions = billers
      .map(b => `<option value="${b.billerName}">${b.billerName}</option>`)
      .join('');

    // Default to current date (no time)
    const today = new Date().toISOString().slice(0, 10);

    Modals.show({
      title: 'Add Transaction',
      body: `
        <form id="transaction-form" class="crud-form">
          <div class="form-group">
            <label>Type</label>
            <div class="radio-group">
              <label class="radio-option">
                <input type="radio" name="transactionType" value="expense" checked>
                <span class="radio-indicator"></span>
                <span class="radio-text expense-text">Expense</span>
              </label>
              <label class="radio-option">
                <input type="radio" name="transactionType" value="income">
                <span class="radio-indicator"></span>
                <span class="radio-text income-text">Income</span>
              </label>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group" style="flex: 2;">
              <label for="amount">Amount</label>
              <div class="input-with-prefix">
                <span class="input-prefix">${currency === 'USD' ? '$' : currency}</span>
                <input type="number" id="amount" step="0.01" min="0.01" required placeholder="0.00" autofocus>
              </div>
            </div>
            <div class="form-group" style="flex: 1;">
              <label for="date">Date</label>
              <input type="date" id="date" required value="${today}">
            </div>
          </div>

          <div class="form-group">
            <label for="merchant">Description</label>
            <input type="text" id="merchant" required placeholder="e.g., Grocery Store, Salary, Coffee">
          </div>

          <div class="form-group">
            <label for="category">Category</label>
            <select id="category" required>
              <option value="">Select category...</option>
              ${categoryOptions}
            </select>
          </div>

          ${billerOptions ? `
            <div class="form-group">
              <label for="biller">Biller (optional)</label>
              <select id="biller">
                <option value="">None</option>
                ${billerOptions}
              </select>
            </div>
          ` : ''}
        </form>
      `,
      submitText: 'Add Transaction',
      onSubmit: async () => {
        const form = document.getElementById('transaction-form');
        const data = {
          transactionType: form.querySelector('input[name="transactionType"]:checked').value,
          transactionAmount: parseFloat(document.getElementById('amount').value),
          merchantName: document.getElementById('merchant').value.trim(),
          transactionCategory: parseInt(document.getElementById('category').value),
          transactionDate: new Date(document.getElementById('date').value + 'T00:00:00').toISOString(),
          billerName: document.getElementById('biller')?.value || null
        };

        console.log('Creating transaction with data:', data);
        await Storage.createTransaction(data);
      }
    });
  }

  /**
   * Show edit transaction modal
   * @param {string} transactionID - Transaction ID to edit
   */
  async function showEditTransactionModal(transactionID) {
    const transaction = await Storage.db.transactions.get(transactionID);
    if (!transaction) {
      Modals.showError('Transaction not found');
      return;
    }

    const categories = await Storage.getActiveCategories();
    const billers = await Storage.getAllBillers();

    // Ensure currency is a string
    let currency = await Storage.getMetadata('currency');
    if (typeof currency === 'object' && currency !== null) {
      currency = currency.value || currency.currency || 'USD';
    }
    currency = currency || 'USD';

    const categoryOptions = categories
      .map(c => `<option value="${c.id}" ${c.id === transaction.transactionCategory ? 'selected' : ''}>${c.categoryType}</option>`)
      .join('');

    const billerOptions = billers
      .map(b => `<option value="${b.billerName}" ${b.billerName === transaction.billerName ? 'selected' : ''}>${b.billerName}</option>`)
      .join('');

    const dateValue = new Date(transaction.transactionDate).toISOString().slice(0, 10);

    Modals.show({
      title: 'Edit Transaction',
      body: `
        <form id="transaction-form" class="crud-form">
          <div class="form-group">
            <label>Type</label>
            <div class="radio-group">
              <label class="radio-option">
                <input type="radio" name="transactionType" value="expense" ${transaction.transactionType === 'expense' ? 'checked' : ''}>
                <span class="radio-indicator"></span>
                <span class="radio-text expense-text">Expense</span>
              </label>
              <label class="radio-option">
                <input type="radio" name="transactionType" value="income" ${transaction.transactionType === 'income' ? 'checked' : ''}>
                <span class="radio-indicator"></span>
                <span class="radio-text income-text">Income</span>
              </label>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group" style="flex: 2;">
              <label for="amount">Amount</label>
              <div class="input-with-prefix">
                <span class="input-prefix">${currency === 'USD' ? '$' : currency}</span>
                <input type="number" id="amount" step="0.01" min="0.01" required value="${transaction.transactionAmount}">
              </div>
            </div>
            <div class="form-group" style="flex: 1;">
              <label for="date">Date</label>
              <input type="date" id="date" required value="${dateValue}">
            </div>
          </div>

          <div class="form-group">
            <label for="merchant">Description</label>
            <input type="text" id="merchant" required value="${transaction.merchantName || ''}">
          </div>

          <div class="form-group">
            <label for="category">Category</label>
            <select id="category" required>
              ${categoryOptions}
            </select>
          </div>

          ${billerOptions ? `
            <div class="form-group">
              <label for="biller">Biller (optional)</label>
              <select id="biller">
                <option value="">None</option>
                ${billerOptions}
              </select>
            </div>
          ` : ''}
        </form>
      `,
      submitText: 'Save Changes',
      onSubmit: async () => {
        const form = document.getElementById('transaction-form');
        const updates = {
          transactionType: form.querySelector('input[name="transactionType"]:checked').value,
          transactionAmount: parseFloat(document.getElementById('amount').value),
          merchantName: document.getElementById('merchant').value.trim(),
          transactionCategory: parseInt(document.getElementById('category').value),
          transactionDate: new Date(document.getElementById('date').value + 'T00:00:00').toISOString(),
          billerName: document.getElementById('biller')?.value || null
        };

        await Storage.updateTransaction(transactionID, updates);
      }
    });
  }

  /**
   * Delete a transaction with confirmation
   * @param {string} transactionID - Transaction ID to delete
   */
  function deleteTransaction(transactionID) {
    Modals.confirm(
      'Are you sure you want to delete this transaction? This action cannot be undone.',
      async () => {
        await Storage.deleteTransaction(transactionID);
      },
      { danger: true, confirmText: 'Delete' }
    );
  }

  // ============================================
  // CATEGORY CRUD
  // ============================================

  /**
   * Show add category modal
   */
  function showAddCategoryModal() {
    const iconOptions = [
      { value: 'groceries', label: '🛒 Groceries' },
      { value: 'dining', label: '🍽️ Dining' },
      { value: 'transport', label: '🚗 Transport' },
      { value: 'utilities', label: '💡 Utilities' },
      { value: 'entertainment', label: '🎬 Entertainment' },
      { value: 'shopping', label: '🛍️ Shopping' },
      { value: 'health', label: '🏥 Health' },
      { value: 'education', label: '📚 Education' },
      { value: 'travel', label: '✈️ Travel' },
      { value: 'savings', label: '💰 Savings' },
      { value: 'default', label: '📁 Default' }
    ].map(icon => `<option value="${icon.value}">${icon.label}</option>`).join('');

    Modals.show({
      title: 'Add Category',
      body: `
        <form id="category-form" class="crud-form">
          <div class="form-group">
            <label for="categoryName">Category Name</label>
            <input type="text" id="categoryName" required placeholder="e.g., Groceries" autofocus>
          </div>

          <div class="form-row">
            <div class="form-group" style="flex: 1;">
              <label for="budgetAmount">Monthly Budget</label>
              <input type="number" id="budgetAmount" step="0.01" min="0" value="0" placeholder="0.00">
            </div>
            <div class="form-group" style="flex: 1;">
              <label for="iconName">Icon</label>
              <select id="iconName">
                ${iconOptions}
              </select>
            </div>
          </div>

          <div class="form-group">
            <label for="colorCode">Color</label>
            <input type="color" id="colorCode" value="#4A90A4">
          </div>

          <div class="form-group checkbox-group">
            <label class="checkbox-option">
              <input type="checkbox" id="autoPropagateToNextMonth" checked>
              <span class="checkbox-indicator"></span>
              <span class="checkbox-text">Auto-propagate budget to next month</span>
            </label>
          </div>
        </form>
      `,
      submitText: 'Add Category',
      onSubmit: async () => {
        const data = {
          categoryType: document.getElementById('categoryName').value.trim(),
          budgetAmount: parseFloat(document.getElementById('budgetAmount').value) || 0,
          iconName: document.getElementById('iconName').value,
          colorCode: document.getElementById('colorCode').value,
          autoPropagateToNextMonth: document.getElementById('autoPropagateToNextMonth').checked
        };

        await Storage.createCategory(data);
      }
    });
  }

  /**
   * Show edit category modal
   * @param {number} categoryId - Category ID to edit
   */
  async function showEditCategoryModal(categoryId) {
    const category = await Storage.db.categories.get(categoryId);
    if (!category) {
      Modals.showError('Category not found');
      return;
    }

    const iconOptions = [
      { value: 'groceries', label: '🛒 Groceries' },
      { value: 'dining', label: '🍽️ Dining' },
      { value: 'transport', label: '🚗 Transport' },
      { value: 'utilities', label: '💡 Utilities' },
      { value: 'entertainment', label: '🎬 Entertainment' },
      { value: 'shopping', label: '🛍️ Shopping' },
      { value: 'health', label: '🏥 Health' },
      { value: 'education', label: '📚 Education' },
      { value: 'travel', label: '✈️ Travel' },
      { value: 'savings', label: '💰 Savings' },
      { value: 'default', label: '📁 Default' }
    ].map(icon => `<option value="${icon.value}" ${icon.value === category.iconName ? 'selected' : ''}>${icon.label}</option>`).join('');

    Modals.show({
      title: 'Edit Category',
      body: `
        <form id="category-form" class="crud-form">
          <div class="form-group">
            <label for="categoryName">Category Name</label>
            <input type="text" id="categoryName" required value="${category.categoryType}">
          </div>

          <div class="form-row">
            <div class="form-group" style="flex: 1;">
              <label for="budgetAmount">Monthly Budget</label>
              <input type="number" id="budgetAmount" step="0.01" min="0" value="${category.budgetAmount || 0}">
            </div>
            <div class="form-group" style="flex: 1;">
              <label for="iconName">Icon</label>
              <select id="iconName">
                ${iconOptions}
              </select>
            </div>
          </div>

          <div class="form-group">
            <label for="colorCode">Color</label>
            <input type="color" id="colorCode" value="${category.colorCode || '#4A90A4'}">
          </div>

          <div class="form-group checkbox-group">
            <label class="checkbox-option">
              <input type="checkbox" id="autoPropagateToNextMonth" ${category.autoPropagateToNextMonth ? 'checked' : ''}>
              <span class="checkbox-indicator"></span>
              <span class="checkbox-text">Auto-propagate budget to next month</span>
            </label>
          </div>
        </form>
      `,
      submitText: 'Save Changes',
      onSubmit: async () => {
        const updates = {
          categoryType: document.getElementById('categoryName').value.trim(),
          budgetAmount: parseFloat(document.getElementById('budgetAmount').value) || 0,
          iconName: document.getElementById('iconName').value,
          colorCode: document.getElementById('colorCode').value,
          autoPropagateToNextMonth: document.getElementById('autoPropagateToNextMonth').checked
        };

        await Storage.updateCategory(categoryId, updates);
      }
    });
  }

  /**
   * Delete a category with confirmation
   * @param {number} categoryId - Category ID to delete
   */
  function deleteCategory(categoryId) {
    Modals.confirm(
      'Are you sure you want to delete this category? This action cannot be undone if there are no transactions using it.',
      async () => {
        await Storage.deleteCategory(categoryId);
      },
      { danger: true, confirmText: 'Delete' }
    );
  }

  /**
   * Quick edit budget amount inline
   * @param {number} categoryId - Category ID
   * @param {number} currentAmount - Current budget amount
   */
  async function quickEditBudget(categoryId, currentAmount) {
    const newAmount = prompt('Enter new budget amount:', currentAmount);
    if (newAmount !== null) {
      const parsed = parseFloat(newAmount);
      if (!isNaN(parsed) && parsed >= 0) {
        await Storage.updateCategory(categoryId, { budgetAmount: parsed });
      } else {
        Modals.showError('Please enter a valid positive number');
      }
    }
  }

  // ============================================
  // SAVINGS GOAL CRUD
  // ============================================

  /**
   * Show add savings goal modal
   */
  function showAddGoalModal() {
    const categoryOptions = [
      'emergency', 'vacation', 'vehicle', 'investment', 'home', 'education', 'custom'
    ].map(cat => `<option value="${cat}">${cat.charAt(0).toUpperCase() + cat.slice(1)}</option>`).join('');

    Modals.show({
      title: 'Add Savings Goal',
      body: `
        <form id="goal-form" class="crud-form">
          <div class="form-group">
            <label for="goalName">Goal Name</label>
            <input type="text" id="goalName" required placeholder="e.g., Emergency Fund" autofocus>
          </div>

          <div class="form-row">
            <div class="form-group" style="flex: 1;">
              <label for="targetAmount">Target Amount</label>
              <input type="number" id="targetAmount" step="0.01" min="0.01" required placeholder="0.00">
            </div>
            <div class="form-group" style="flex: 1;">
              <label for="currentAmount">Current Amount</label>
              <input type="number" id="currentAmount" step="0.01" min="0" value="0" placeholder="0.00">
            </div>
          </div>

          <div class="form-row">
            <div class="form-group" style="flex: 1;">
              <label for="category">Category</label>
              <select id="category">
                ${categoryOptions}
              </select>
            </div>
            <div class="form-group" style="flex: 1;">
              <label for="priority">Priority</label>
              <select id="priority">
                <option value="high">High</option>
                <option value="medium" selected>Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
          </div>

          <div class="form-group">
            <label for="targetDate">Target Date (optional)</label>
            <input type="date" id="targetDate">
          </div>

          <div class="form-group">
            <label for="description">Description (optional)</label>
            <textarea id="description" rows="2" placeholder="Notes about this goal..."></textarea>
          </div>
        </form>
      `,
      submitText: 'Create Goal',
      onSubmit: async () => {
        const targetDate = document.getElementById('targetDate').value;
        const data = {
          goalName: document.getElementById('goalName').value.trim(),
          targetAmount: parseFloat(document.getElementById('targetAmount').value),
          currentAmount: parseFloat(document.getElementById('currentAmount').value) || 0,
          category: document.getElementById('category').value,
          priority: document.getElementById('priority').value,
          targetDate: targetDate ? new Date(targetDate).toISOString() : null,
          description: document.getElementById('description').value.trim()
        };

        await Storage.createSavingsGoal(data);
      }
    });
  }

  /**
   * Show edit savings goal modal
   * @param {number} goalId - Goal ID to edit
   */
  async function showEditGoalModal(goalId) {
    const goal = await Storage.db.savingsGoals.get(goalId);
    if (!goal) {
      Modals.showError('Goal not found');
      return;
    }

    const categoryOptions = [
      'emergency', 'vacation', 'vehicle', 'investment', 'home', 'education', 'custom'
    ].map(cat => `<option value="${cat}" ${cat === goal.category ? 'selected' : ''}>${cat.charAt(0).toUpperCase() + cat.slice(1)}</option>`).join('');

    const targetDateValue = goal.targetDate ? new Date(goal.targetDate).toISOString().slice(0, 10) : '';

    Modals.show({
      title: 'Edit Savings Goal',
      body: `
        <form id="goal-form" class="crud-form">
          <div class="form-group">
            <label for="goalName">Goal Name</label>
            <input type="text" id="goalName" required value="${goal.goalName}">
          </div>

          <div class="form-group">
            <label for="targetAmount">Target Amount</label>
            <input type="number" id="targetAmount" step="0.01" min="0.01" required value="${goal.targetAmount}">
          </div>

          <div class="form-row">
            <div class="form-group" style="flex: 1;">
              <label for="category">Category</label>
              <select id="category">
                ${categoryOptions}
              </select>
            </div>
            <div class="form-group" style="flex: 1;">
              <label for="priority">Priority</label>
              <select id="priority">
                <option value="high" ${goal.priority === 'high' ? 'selected' : ''}>High</option>
                <option value="medium" ${goal.priority === 'medium' ? 'selected' : ''}>Medium</option>
                <option value="low" ${goal.priority === 'low' ? 'selected' : ''}>Low</option>
              </select>
            </div>
          </div>

          <div class="form-group">
            <label for="targetDate">Target Date</label>
            <input type="date" id="targetDate" value="${targetDateValue}">
          </div>

          <div class="form-group">
            <label for="description">Description</label>
            <textarea id="description" rows="2">${goal.description || ''}</textarea>
          </div>

          <div class="form-group checkbox-group">
            <label class="checkbox-option">
              <input type="checkbox" id="isActive" ${goal.isActive ? 'checked' : ''}>
              <span class="checkbox-indicator"></span>
              <span class="checkbox-text">Goal is active</span>
            </label>
          </div>
        </form>
      `,
      submitText: 'Save Changes',
      onSubmit: async () => {
        const targetDate = document.getElementById('targetDate').value;
        const updates = {
          goalName: document.getElementById('goalName').value.trim(),
          targetAmount: parseFloat(document.getElementById('targetAmount').value),
          category: document.getElementById('category').value,
          priority: document.getElementById('priority').value,
          targetDate: targetDate ? new Date(targetDate).toISOString() : null,
          description: document.getElementById('description').value.trim(),
          isActive: document.getElementById('isActive').checked ? 1 : 0
        };

        await Storage.updateSavingsGoal(goalId, updates);
      }
    });
  }

  /**
   * Show add contribution/withdrawal modal
   * @param {number} goalId - Goal ID
   * @param {string} goalName - Goal name for display
   */
  function showAddGoalTransactionModal(goalId, goalName) {
    Modals.show({
      title: `Add to: ${goalName}`,
      body: `
        <form id="goal-txn-form" class="crud-form">
          <div class="form-group">
            <label>Type</label>
            <div class="radio-group">
              <label class="radio-option">
                <input type="radio" name="txnType" value="contribution" checked>
                <span class="radio-indicator"></span>
                <span class="radio-text income-text">Contribution</span>
              </label>
              <label class="radio-option">
                <input type="radio" name="txnType" value="withdrawal">
                <span class="radio-indicator"></span>
                <span class="radio-text expense-text">Withdrawal</span>
              </label>
            </div>
          </div>

          <div class="form-group">
            <label for="amount">Amount</label>
            <input type="number" id="amount" step="0.01" min="0.01" required placeholder="0.00" autofocus>
          </div>

          <div class="form-group">
            <label for="description">Note (optional)</label>
            <input type="text" id="description" placeholder="e.g., Monthly savings">
          </div>
        </form>
      `,
      submitText: 'Save',
      onSubmit: async () => {
        const form = document.getElementById('goal-txn-form');
        const data = {
          goalId: goalId,
          transactionType: form.querySelector('input[name="txnType"]:checked').value,
          amount: parseFloat(document.getElementById('amount').value),
          description: document.getElementById('description').value.trim()
        };

        await Storage.createGoalTransaction(data);
      }
    });
  }

  /**
   * Delete a savings goal with confirmation
   * @param {number} goalId - Goal ID to delete
   */
  function deleteGoal(goalId) {
    Modals.confirm(
      'Are you sure you want to delete this savings goal? All associated transactions will be preserved but marked as orphaned.',
      async () => {
        await Storage.deleteSavingsGoal(goalId);
      },
      { danger: true, confirmText: 'Delete' }
    );
  }

  // ============================================
  // PUBLIC API
  // ============================================

  return {
    // Transactions
    showAddTransactionModal,
    showEditTransactionModal,
    deleteTransaction,

    // Categories
    showAddCategoryModal,
    showEditCategoryModal,
    deleteCategory,
    quickEditBudget,

    // Goals
    showAddGoalModal,
    showEditGoalModal,
    showAddGoalTransactionModal,
    deleteGoal
  };
})();
