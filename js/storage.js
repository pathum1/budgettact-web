const Storage = (() => {
  // Initialize Dexie database
  const db = new Dexie('BudgetTactDB');

  // Define schema
  // Version 1: Initial schema
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

  // Version 2: Add sync metadata columns for bidirectional sync
  db.version(2).stores({
    metadata: 'key',
    transactions: 'transactionID, transactionDate, transactionCategory, transactionType, updatedAt, deleted',
    categories: 'id, categoryType, updatedAt, deleted',
    budgetHistory: '++id, [categoryId+yearMonth], updatedAt, deleted',
    savingsGoals: 'id, isActive, category, updatedAt, deleted',
    goalTransactions: '++id, goalId, transactionDate, updatedAt, deleted',
    recurringTransactions: 'id, transactionID, nextDueDate, status, updatedAt, deleted',
    billers: 'billerID, updatedAt, deleted'
  }).upgrade(tx => {
    // Add default sync metadata to existing records
    console.log('🔄 Upgrading database to v2: Adding sync metadata...');
    const now = new Date().toISOString();

    // Update transactions
    return tx.table('transactions').toCollection().modify(transaction => {
      if (!transaction.createdAt) transaction.createdAt = now;
      if (!transaction.updatedAt) transaction.updatedAt = now;
      if (transaction.deleted === undefined) transaction.deleted = false;
      if (!transaction.deviceId) transaction.deviceId = 'web';
    }).then(() => {
      // Update categories
      return tx.table('categories').toCollection().modify(category => {
        if (!category.createdAt) category.createdAt = now;
        if (!category.updatedAt) category.updatedAt = now;
        if (category.deleted === undefined) category.deleted = false;
        if (!category.deviceId) category.deviceId = 'web';
      });
    }).then(() => {
      // Update savingsGoals
      return tx.table('savingsGoals').toCollection().modify(goal => {
        if (!goal.createdAt) goal.createdAt = now;
        if (!goal.updatedAt) goal.updatedAt = now;
        if (goal.deleted === undefined) goal.deleted = false;
        if (!goal.deviceId) goal.deviceId = 'web';
      });
    }).then(() => {
      // Update budgetHistory
      return tx.table('budgetHistory').toCollection().modify(budget => {
        if (!budget.createdAt) budget.createdAt = now;
        if (!budget.updatedAt) budget.updatedAt = now;
        if (budget.deleted === undefined) budget.deleted = false;
        if (!budget.deviceId) budget.deviceId = 'web';
      });
    }).then(() => {
      // Update goalTransactions
      return tx.table('goalTransactions').toCollection().modify(goalTx => {
        if (!goalTx.createdAt) goalTx.createdAt = now;
        if (!goalTx.updatedAt) goalTx.updatedAt = now;
        if (goalTx.deleted === undefined) goalTx.deleted = false;
        if (!goalTx.deviceId) goalTx.deviceId = 'web';
      });
    }).then(() => {
      // Update recurringTransactions
      return tx.table('recurringTransactions').toCollection().modify(recurring => {
        if (!recurring.createdAt) recurring.createdAt = now;
        if (!recurring.updatedAt) recurring.updatedAt = now;
        if (recurring.deleted === undefined) recurring.deleted = false;
        if (!recurring.deviceId) recurring.deviceId = 'web';
      });
    }).then(() => {
      // Update billers
      return tx.table('billers').toCollection().modify(biller => {
        if (!biller.createdAt) biller.createdAt = now;
        if (!biller.updatedAt) biller.updatedAt = now;
        if (biller.deleted === undefined) biller.deleted = false;
        if (!biller.deviceId) biller.deviceId = 'web';
      });
    }).then(() => {
      console.log('✅ Database upgraded to v2 successfully');
    });
  });

  // Version 3: Add sync metadata indexes and deviceId for bidirectional sync
  db.version(3).stores({
    metadata: 'key',
    transactions: 'transactionID, updatedAt, deleted, deviceId, transactionDate, transactionCategory, transactionType',
    categories: 'id, updatedAt, deleted, deviceId, categoryType',
    budgetHistory: '++id, [categoryId+yearMonth], updatedAt, deleted, deviceId',
    savingsGoals: 'id, isActive, category, updatedAt, deleted, deviceId',
    goalTransactions: '++id, goalId, transactionDate, updatedAt, deleted, deviceId',
    recurringTransactions: 'id, transactionID, nextDueDate, status, updatedAt, deleted, deviceId',
    billers: 'billerID, updatedAt, deleted, deviceId'
  }).upgrade(async (tx) => {
    const now = Date.now();
    const normalizeRecord = (record) => {
      record.createdAt = record.createdAt ? normalizeTimestamp(record.createdAt) : now;
      record.updatedAt = record.updatedAt ? normalizeTimestamp(record.updatedAt) : now;
      record.deleted = record.deleted === undefined ? false : Boolean(record.deleted);
      record.deviceId = record.deviceId || 'web';
    };

    const normalizeTable = async (tableName) => {
      await tx.table(tableName).toCollection().modify(normalizeRecord);
    };

    await normalizeTable('transactions');
    await normalizeTable('categories');
    await normalizeTable('budgetHistory');
    await normalizeTable('savingsGoals');
    await normalizeTable('goalTransactions');
    await normalizeTable('recurringTransactions');
    await normalizeTable('billers');
  });

  /**
   * Initialize database
   */
  function normalizeTimestamp(value) {
    if (typeof value === 'number') return value;
    if (!value) return Date.now();
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? Date.now() : parsed;
  }

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

      await normalizeSyncMetadataTables();
      console.log('✅ Sync metadata normalized');
    } catch (error) {
      console.error('❌ Migration failed:', error);
      // Don't throw - migration failure shouldn't prevent app from working
    }
  }

  function ensureSyncMetadata(record, { isDelete = false } = {}) {
    const now = Date.now();
    return {
      ...record,
      createdAt: record.createdAt ? normalizeTimestamp(record.createdAt) : now,
      updatedAt: record.updatedAt ? normalizeTimestamp(record.updatedAt) : now,
      deleted: isDelete ? true : (record.deleted === undefined ? false : Boolean(record.deleted)),
      deviceId: record.deviceId || PairingManager.getWebPeerId()
    };
  }

  const storePrimaryKeys = {
    transactions: 'transactionID',
    categories: 'id',
    budgetHistory: 'id',
    savingsGoals: 'id',
    goalTransactions: 'id',
    recurringTransactions: 'id',
    billers: 'billerID'
  };

  async function upsertRecord(storeName, record, { operation = null, queue = true } = {}) {
    const keyField = storePrimaryKeys[storeName] || 'id';
    const table = db.table(storeName);
    const existing = record[keyField] ? await table.get(record[keyField]) : null;
    const base = existing ? { ...existing, ...record } : record;
    const withMeta = ensureSyncMetadata(base, { isDelete: base.deleted });
    await table.put(withMeta);
    const inferredOperation = operation || (existing ? 'update' : 'insert');
    if (queue && typeof autoSyncCRUD !== 'undefined') {
      autoSyncCRUD.queueChange(storeName, inferredOperation, withMeta);
    }
    return withMeta;
  }

  async function markDeleted(storeName, id, { queue = true } = {}) {
    const keyField = storePrimaryKeys[storeName] || 'id';
    const table = db.table(storeName);
    const existing = await table.get(id);
    if (!existing) return null;
    const updated = ensureSyncMetadata({ ...existing, deleted: true, updatedAt: Date.now() }, { isDelete: true });
    await table.put(updated);
    if (queue && typeof autoSyncCRUD !== 'undefined') {
      autoSyncCRUD.queueChange(storeName, 'delete', updated);
    }
    return updated;
  }

  async function getChangedRecords(storeName, sinceTimestamp) {
    const since = sinceTimestamp || 0;
    try {
      return await db.table(storeName)
        .where('updatedAt')
        .above(since)
        .toArray();
    } catch (error) {
      console.error(`Failed to get changed records for ${storeName}:`, error);
      return [];
    }
  }

  async function getSyncSnapshot(lastSync) {
    const since = lastSync || 0;
    if (!since) {
      return {
        lastSyncTimestamp: null,
        webPeerId: PairingManager.getWebPeerId(),
        transactions: await db.transactions.toArray(),
        categories: await db.categories.toArray(),
        budgetHistory: await db.budgetHistory.toArray(),
        savingsGoals: await db.savingsGoals.toArray(),
        goalTransactions: await db.goalTransactions.toArray(),
        recurringTransactions: await db.recurringTransactions.toArray(),
        billers: await db.billers.toArray()
      };
    }

    return {
      lastSyncTimestamp: since,
      webPeerId: PairingManager.getWebPeerId(),
      transactions: await getChangedRecords('transactions', since),
      categories: await getChangedRecords('categories', since),
      budgetHistory: await getChangedRecords('budgetHistory', since),
      savingsGoals: await getChangedRecords('savingsGoals', since),
      goalTransactions: await getChangedRecords('goalTransactions', since),
      recurringTransactions: await getChangedRecords('recurringTransactions', since),
      billers: await getChangedRecords('billers', since)
    };
  }

  async function normalizeSyncMetadataTables() {
    const tables = [
      'transactions',
      'categories',
      'budgetHistory',
      'savingsGoals',
      'goalTransactions',
      'recurringTransactions',
      'billers'
    ];

    const now = Date.now();

    for (const tableName of tables) {
      try {
        await db.table(tableName).toCollection().modify((record) => {
          record.createdAt = record.createdAt ? normalizeTimestamp(record.createdAt) : now;
          record.updatedAt = record.updatedAt ? normalizeTimestamp(record.updatedAt) : now;
          record.deleted = record.deleted === undefined ? false : Boolean(record.deleted);
          record.deviceId = record.deviceId || 'web';
        });
      } catch (error) {
        console.warn(`⚠️ Failed to normalize sync metadata for ${tableName}:`, error);
      }
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

      // Helper to add sync metadata to records
      const addSyncMetadata = (record, deviceId) => {
        const now = Date.now();
        return {
          ...record,
          createdAt: record.createdAt ? normalizeTimestamp(record.createdAt) : now,
          updatedAt: record.updatedAt ? normalizeTimestamp(record.updatedAt) : now,
          deleted: record.deleted === undefined ? false : Boolean(record.deleted),
          deviceId: record.deviceId || deviceId
        };
      };

      // Import all data tables
      if (data.transactions && data.transactions.length > 0) {
        // Normalize transaction amounts (convert negative to positive)
        const normalizedTransactions = data.transactions.map(t => addSyncMetadata({
          ...t,
          transactionAmount: Math.abs(t.transactionAmount)
        }, syncPayload.deviceId));
        await db.transactions.bulkAdd(normalizedTransactions);
      }

      if (data.categories && data.categories.length > 0) {
        // Normalize boolean fields (Android sends 1/0, we need true/false)
        const normalizedCategories = data.categories.map(c => addSyncMetadata({
          ...c,
          autoPropagateToNextMonth: Boolean(c.autoPropagateToNextMonth),
          budgetNotificationsEnabled: Boolean(c.budgetNotificationsEnabled || false)
        }, syncPayload.deviceId));
        await db.categories.bulkAdd(normalizedCategories);
      }

      if (data.budgetHistory && data.budgetHistory.length > 0) {
        const normalizedBudgetHistory = data.budgetHistory.map(b =>
          addSyncMetadata(b, syncPayload.deviceId)
        );
        await db.budgetHistory.bulkAdd(normalizedBudgetHistory);
      }

      if (data.savingsGoals && data.savingsGoals.length > 0) {
        // Normalize boolean fields (Android sends 1/0, we need true/false)
        const normalizedGoals = data.savingsGoals.map(g => addSyncMetadata({
          ...g,
          isActive: Boolean(g.isActive),
          notificationsEnabled: Boolean(g.notificationsEnabled || false)
        }, syncPayload.deviceId));
        await db.savingsGoals.bulkAdd(normalizedGoals);
      }

      if (data.goalTransactions && data.goalTransactions.length > 0) {
        const normalizedGoalTx = data.goalTransactions.map(gt =>
          addSyncMetadata(gt, syncPayload.deviceId)
        );
        await db.goalTransactions.bulkAdd(normalizedGoalTx);
      }

      if (data.recurringTransactions && data.recurringTransactions.length > 0) {
        const normalizedRecurring = data.recurringTransactions.map(rt =>
          addSyncMetadata(rt, syncPayload.deviceId)
        );
        await db.recurringTransactions.bulkAdd(normalizedRecurring);
      }

      if (data.billers && data.billers.length > 0) {
        const normalizedBillers = data.billers.map(b =>
          addSyncMetadata(b, syncPayload.deviceId)
        );
        await db.billers.bulkAdd(normalizedBillers);
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
    getRecurringTransactions,
    ensureSyncMetadata,
    upsertRecord,
    markDeleted,
    getChangedRecords,
    getSyncSnapshot
  };
})();
