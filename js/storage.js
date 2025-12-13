const Storage = (() => {
  // Initialize Dexie database
  const db = new Dexie('BudgetTactDB');

  // Define schema
  db.version(1).stores({
    metadata: 'key',
    transactions: 'transactionID, transactionDate, transactionCategory, transactionType',
    categories: 'id, categoryType',
    budgetHistory: '++id, [categoryId+yearMonth]',
    savingsGoals: 'id, isActive, category',
    goalTransactions: '++id, goalId, transactionDate',
    recurringTransactions: 'id, transactionID, nextDueDate, status',
    billers: 'billerID'
  });

  /**
   * Initialize database
   */
  async function initDatabase() {
    try {
      await db.open();
      console.log('Database initialized successfully');

      // Migrate existing data to ensure proper boolean types
      await migrateData();

      return true;
    } catch (error) {
      console.error('Failed to initialize database:', error);
      return false;
    }
  }

  /**
   * Migrate existing data to ensure proper data types
   * Converts integer booleans (1/0) to actual booleans (true/false)
   */
  async function migrateData() {
    try {
      console.log('🔄 Checking for data migration...');

      // Migrate savingsGoals
      const goals = await db.savingsGoals.toArray();
      console.log(`🔍 Found ${goals.length} savings goals to check`);

      if (goals.length > 0) {
        console.log('🔍 First goal before migration:', goals[0]);
        console.log('🔍 isActive type:', typeof goals[0].isActive);
      }

      let migratedGoals = 0;
      for (const goal of goals) {
        if (typeof goal.isActive !== 'boolean') {
          console.log(`🔧 Migrating goal ${goal.id}: isActive from ${goal.isActive} (${typeof goal.isActive}) to boolean`);
          goal.isActive = Boolean(goal.isActive);
          goal.notificationsEnabled = Boolean(goal.notificationsEnabled || false);
          await db.savingsGoals.put(goal);
          migratedGoals++;
        }
      }
      if (migratedGoals > 0) {
        console.log(`✅ Migrated ${migratedGoals} savings goals`);
      }

      // Migrate categories
      const categories = await db.categories.toArray();
      let migratedCategories = 0;
      for (const cat of categories) {
        if (typeof cat.autoPropagateToNextMonth !== 'boolean') {
          cat.autoPropagateToNextMonth = Boolean(cat.autoPropagateToNextMonth);
          cat.budgetNotificationsEnabled = Boolean(cat.budgetNotificationsEnabled || false);
          await db.categories.put(cat);
          migratedCategories++;
        }
      }
      if (migratedCategories > 0) {
        console.log(`✅ Migrated ${migratedCategories} categories`);
      }

      if (migratedGoals === 0 && migratedCategories === 0) {
        console.log('✅ No migration needed - data already correct');
      }
    } catch (error) {
      console.error('❌ Migration failed:', error);
      // Don't throw - migration failure shouldn't prevent app from working
    }
  }

  /**
   * Clear all data from database
   */
  async function clearAllData() {
    try {
      await db.transactions.clear();
      await db.categories.clear();
      await db.budgetHistory.clear();
      await db.savingsGoals.clear();
      await db.goalTransactions.clear();
      await db.recurringTransactions.clear();
      await db.billers.clear();
      console.log('All data cleared');
      return true;
    } catch (error) {
      console.error('Failed to clear data:', error);
      throw error;
    }
  }

  /**
   * Import sync payload into database
   * @param {Object} syncPayload - The full sync payload
   */
  async function importData(syncPayload) {
    try {
      // Clear existing data
      await clearAllData();

      const { data } = syncPayload;

      // Store metadata
      await db.metadata.put({
        key: 'lastSync',
        exportedAt: syncPayload.exportedAt,
        deviceId: syncPayload.deviceId,
        deviceName: syncPayload.deviceName,
        currency: syncPayload.currency,
        version: syncPayload.version,
        importedAt: new Date().toISOString()
      });

      // Import all data tables
      if (data.transactions && data.transactions.length > 0) {
        // Normalize transaction amounts (convert negative to positive)
        const normalizedTransactions = data.transactions.map(t => ({
          ...t,
          transactionAmount: Math.abs(t.transactionAmount)
        }));
        await db.transactions.bulkAdd(normalizedTransactions);
      }

      if (data.categories && data.categories.length > 0) {
        // Normalize boolean fields (Android sends 1/0, we need true/false)
        const normalizedCategories = data.categories.map(c => ({
          ...c,
          autoPropagateToNextMonth: Boolean(c.autoPropagateToNextMonth),
          budgetNotificationsEnabled: Boolean(c.budgetNotificationsEnabled || false)
        }));
        await db.categories.bulkAdd(normalizedCategories);
      }

      if (data.budgetHistory && data.budgetHistory.length > 0) {
        await db.budgetHistory.bulkAdd(data.budgetHistory);
      }

      if (data.savingsGoals && data.savingsGoals.length > 0) {
        // Normalize boolean fields (Android sends 1/0, we need true/false)
        const normalizedGoals = data.savingsGoals.map(g => ({
          ...g,
          isActive: Boolean(g.isActive),
          notificationsEnabled: Boolean(g.notificationsEnabled || false)
        }));
        await db.savingsGoals.bulkAdd(normalizedGoals);
      }

      if (data.goalTransactions && data.goalTransactions.length > 0) {
        await db.goalTransactions.bulkAdd(data.goalTransactions);
      }

      if (data.recurringTransactions && data.recurringTransactions.length > 0) {
        await db.recurringTransactions.bulkAdd(data.recurringTransactions);
      }

      if (data.billers && data.billers.length > 0) {
        await db.billers.bulkAdd(data.billers);
      }

      console.log('Data imported successfully');
      return true;
    } catch (error) {
      console.error('Failed to import data:', error);
      throw error;
    }
  }

  /**
   * Get sync metadata
   */
  async function getMetadata() {
    try {
      return await db.metadata.get('lastSync');
    } catch (error) {
      console.error('Failed to get metadata:', error);
      return null;
    }
  }

  /**
   * Check if database has data
   */
  async function hasData() {
    try {
      const count = await db.transactions.count();
      return count > 0;
    } catch (error) {
      console.error('Failed to check data:', error);
      return false;
    }
  }

  /**
   * Get all transactions with optional filters
   * @param {Object} filters - Filter options
   */
  async function getAllTransactions(filters = {}) {
    try {
      let query = db.transactions;

      // Apply filters
      if (filters.type && filters.type !== 'all') {
        query = query.where('transactionType').equals(filters.type);
      }

      if (filters.categoryId) {
        query = query.where('transactionCategory').equals(filters.categoryId);
      }

      let transactions = await query.toArray();

      // Apply search filter
      if (filters.search) {
        const searchLower = filters.search.toLowerCase();
        transactions = transactions.filter(t =>
          t.merchantName.toLowerCase().includes(searchLower)
        );
      }

      // Sort by date (newest first)
      transactions.sort((a, b) => new Date(b.transactionDate) - new Date(a.transactionDate));

      return transactions;
    } catch (error) {
      console.error('Failed to get transactions:', error);
      return [];
    }
  }

  /**
   * Get transactions for a specific month
   * @param {string} yearMonth - Format: YYYY-MM
   */
  async function getTransactionsByMonth(yearMonth) {
    try {
      const transactions = await db.transactions.toArray();
      return transactions.filter(t => {
        const tYearMonth = Utils.getMonthYear(t.transactionDate);
        return tYearMonth === yearMonth;
      });
    } catch (error) {
      console.error('Failed to get transactions by month:', error);
      return [];
    }
  }

  /**
   * Get all categories
   */
  async function getAllCategories() {
    try {
      return await db.categories.toArray();
    } catch (error) {
      console.error('Failed to get categories:', error);
      return [];
    }
  }

  /**
   * Get category by ID
   * @param {number} id - Category ID
   */
  async function getCategoryById(id) {
    try {
      return await db.categories.get(id);
    } catch (error) {
      console.error('Failed to get category:', error);
      return null;
    }
  }

  /**
   * Get budget history for a category
   * @param {number} categoryId - Category ID
   * @param {string} yearMonth - Format: YYYY-MM
   */
  async function getBudgetHistory(categoryId, yearMonth) {
    try {
      return await db.budgetHistory
        .where('[categoryId+yearMonth]')
        .equals([categoryId, yearMonth])
        .first();
    } catch (error) {
      console.error('Failed to get budget history:', error);
      return null;
    }
  }

  /**
   * Get all savings goals
   * @param {boolean} activeOnly - Only get active goals
   */
  async function getAllSavingsGoals(activeOnly = false) {
    try {
      console.log('📊 getAllSavingsGoals called with activeOnly:', activeOnly);

      // First, get ALL goals to inspect the data
      const allGoals = await db.savingsGoals.toArray();
      console.log('📊 Total savings goals in DB:', allGoals.length);

      if (allGoals.length > 0) {
        // Log the first goal to see its structure
        console.log('📊 Sample goal:', allGoals[0]);
        console.log('📊 isActive type:', typeof allGoals[0].isActive);
        console.log('📊 isActive value:', allGoals[0].isActive);

        // Check all goals for type consistency
        const typeCheck = allGoals.map(g => ({
          id: g.id,
          isActiveType: typeof g.isActive,
          isActiveValue: g.isActive
        }));
        console.log('📊 All goals type check:', typeCheck);
      }

      if (activeOnly) {
        // Try filtering manually instead of using indexed query
        console.log('📊 Filtering for active goals only...');
        const activeGoals = allGoals.filter(g => g.isActive === true || g.isActive === 1);
        console.log('📊 Active goals found:', activeGoals.length);
        return activeGoals;
      }

      return allGoals;
    } catch (error) {
      console.error('❌ Failed to get savings goals:', error);
      console.error('❌ Error details:', error.message, error.stack);
      return [];
    }
  }

  /**
   * Get goal transactions for a specific goal
   * @param {number} goalId - Goal ID
   */
  async function getGoalTransactions(goalId) {
    try {
      const transactions = await db.goalTransactions
        .where('goalId')
        .equals(goalId)
        .toArray();

      // Sort by date (newest first)
      transactions.sort((a, b) => new Date(b.transactionDate) - new Date(a.transactionDate));

      return transactions;
    } catch (error) {
      console.error('Failed to get goal transactions:', error);
      return [];
    }
  }

  /**
   * Calculate spent amount for a category in a specific month
   * @param {number} categoryId - Category ID
   * @param {string} yearMonth - Format: YYYY-MM
   */
  async function getCategorySpent(categoryId, yearMonth) {
    try {
      const transactions = await getTransactionsByMonth(yearMonth);
      const categoryTransactions = transactions.filter(
        t => t.transactionCategory === categoryId && t.transactionType === 'expense'
      );

      return categoryTransactions.reduce((sum, t) => sum + t.transactionAmount, 0);
    } catch (error) {
      console.error('Failed to calculate category spent:', error);
      return 0;
    }
  }

  /**
   * Get all billers
   */
  async function getAllBillers() {
    try {
      return await db.billers.toArray();
    } catch (error) {
      console.error('Failed to get billers:', error);
      return [];
    }
  }

  /**
   * Get recurring transactions
   * @param {string} status - Filter by status (active, paused, completed)
   */
  async function getRecurringTransactions(status = null) {
    try {
      if (status) {
        return await db.recurringTransactions.where('status').equals(status).toArray();
      }
      return await db.recurringTransactions.toArray();
    } catch (error) {
      console.error('Failed to get recurring transactions:', error);
      return [];
    }
  }

  // Public API
  return {
    db,
    initDatabase,
    clearAllData,
    importData,
    getMetadata,
    hasData,
    getAllTransactions,
    getTransactionsByMonth,
    getAllCategories,
    getCategoryById,
    getBudgetHistory,
    getAllSavingsGoals,
    getGoalTransactions,
    getCategorySpent,
    getAllBillers,
    getRecurringTransactions
  };
})();
