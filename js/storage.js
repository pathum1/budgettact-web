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

  // Version 4: Add data_hash field for hash-based sync verification
  db.version(4).stores({
    metadata: 'key',
    transactions: 'transactionID, updatedAt, deleted, deviceId, data_hash, transactionDate, transactionCategory, transactionType',
    categories: 'id, updatedAt, deleted, deviceId, data_hash, categoryType',
    budgetHistory: '++id, [categoryId+yearMonth], updatedAt, deleted, deviceId, data_hash',
    savingsGoals: 'id, isActive, category, updatedAt, deleted, deviceId, data_hash',
    goalTransactions: '++id, goalId, transactionDate, updatedAt, deleted, deviceId, data_hash',
    recurringTransactions: 'id, transactionID, nextDueDate, status, updatedAt, deleted, deviceId, data_hash',
    billers: 'billerID, updatedAt, deleted, deviceId, data_hash'
  }).upgrade(async (tx) => {
    console.log('🔄 Upgrading database to v4: Adding data_hash fields...');
    console.log('ℹ️ Existing data will have hashes computed on next sync or CRUD operation');
    console.log('✅ Database upgraded to v4 successfully');
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
      deviceId: record.deviceId || PairingManager.getWebPeerId(),
      // data_hash will be computed separately in upsertRecord
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
    const startTime = Date.now();
    const keyField = storePrimaryKeys[storeName] || 'id';
    const recordId = record[keyField];

    // Use persistent diagnostics if available
    const logDB = (msg, data) => {
      if (typeof SyncDiagnostics !== 'undefined') {
        SyncDiagnostics.logDB(msg, data);
      } else {
        console.log(`📝 [STORAGE] ${msg}`, data || '');
      }
    };

    const table = db.table(storeName);
    const existing = recordId ? await table.get(recordId) : null;
    const base = existing ? { ...existing, ...record } : record;
    const withMeta = ensureSyncMetadata(base, { isDelete: base.deleted });

    // Compute hash before saving (if DataHashService is available)
    if (typeof DataHashService !== 'undefined') {
      try {
        const hash = await DataHashService.computeHashForEntity(storeName, withMeta);
        if (hash) {
          withMeta.data_hash = hash;
        }
      } catch (error) {
        console.warn(`⚠️ Failed to compute hash for ${storeName}:`, error);
        // Continue without hash - it will be computed on next sync
      }
    }

    try {
      await table.put(withMeta);
      const elapsed = Date.now() - startTime;

      // Only log every 10th record to avoid log spam during bulk operations
      if (Math.random() < 0.1) {
        logDB(`upsertRecord: ${storeName}`, { id: recordId, elapsed });
      }
    } catch (putError) {
      logDB(`upsertRecord FAILED: ${storeName}`, { id: recordId, error: putError.message });
      throw putError;
    }

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

    // Compute hash for deleted record (if DataHashService is available)
    if (typeof DataHashService !== 'undefined') {
      try {
        const hash = await DataHashService.computeHashForEntity(storeName, updated);
        if (hash) {
          updated.data_hash = hash;
        }
      } catch (error) {
        console.warn(`⚠️ Failed to compute hash for ${storeName}:`, error);
      }
    }

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
      console.log('📥 Starting data import...', {
        version: syncPayload.version,
        deviceId: syncPayload.deviceId,
        deviceName: syncPayload.deviceName,
        hasData: !!syncPayload.data
      });

      // Clear existing data
      console.log('🗑️ Clearing existing data...');
      await clearAllData();
      console.log('✅ Existing data cleared');

      const { data } = syncPayload;

      if (!data) {
        throw new Error('Sync payload missing data object');
      }

      // Determine currency - try from payload, then from first transaction, default to USD
      console.log('🔍 Checking currency in sync payload...');
      console.log('   - syncPayload.currency:', syncPayload.currency);
      console.log('   - First transaction currency:', data.transactions?.[0]?.currency);
      console.log('   - Sample transaction:', data.transactions?.[0]);

      let currency = syncPayload.currency;
      if (!currency && data.transactions && data.transactions.length > 0) {
        currency = data.transactions[0].currency;
        console.log('📝 Currency extracted from transaction:', currency);
      }
      if (!currency) {
        currency = 'USD';
        console.warn('⚠️ No currency found in payload or transactions, defaulting to USD');
      }
      console.log('✅ Final currency to store:', currency);

      // Store metadata
      console.log('💾 Storing metadata...');
      await db.metadata.put({
        key: 'lastSync',
        exportedAt: syncPayload.exportedAt,
        deviceId: syncPayload.deviceId,
        deviceName: syncPayload.deviceName,
        currency: currency,
        monthlyIncome: syncPayload.monthlyIncome || 0,
        version: syncPayload.version,
        importedAt: new Date().toISOString()
      });
      console.log('✅ Metadata stored with currency:', currency);

      // Helper to add sync metadata to records
      const addSyncMetadata = (record, deviceId) => {
        const now = Date.now();
        return {
          ...record,
          createdAt: record.createdAt ? normalizeTimestamp(record.createdAt) : now,
          updatedAt: record.updatedAt ? normalizeTimestamp(record.updatedAt) : now,
          deleted: record.deleted === undefined ? false : Boolean(record.deleted),
          deviceId: record.deviceId || deviceId,
          // Keep data_hash if provided by Android, otherwise it will be computed later
          data_hash: record.data_hash || null
        };
      };

      // Import all data tables with detailed logging
      console.log('📦 Importing data tables...');

      if (data.transactions && data.transactions.length > 0) {
        console.log(`💾 Importing ${data.transactions.length} transactions...`);
        // Normalize transaction amounts (convert negative to positive)
        const normalizedTransactions = data.transactions.map(t => addSyncMetadata({
          ...t,
          transactionAmount: Math.abs(t.transactionAmount)
        }, syncPayload.deviceId));
        await db.transactions.bulkAdd(normalizedTransactions);
        console.log(`✅ Imported ${data.transactions.length} transactions`);
      } else {
        console.log('ℹ️ No transactions to import');
      }

      if (data.categories && data.categories.length > 0) {
        console.log(`💾 Importing ${data.categories.length} categories...`);
        // Normalize boolean fields (Android sends 1/0, we need true/false)
        // Normalize field names (Android sends 'ID' uppercase, web expects 'id' lowercase)
        const normalizedCategories = data.categories.map(c => addSyncMetadata({
          ...c,
          id: c.id || c.ID,  // Normalize ID field name
          autoPropagateToNextMonth: Boolean(c.autoPropagateToNextMonth),
          budgetNotificationsEnabled: Boolean(c.budgetNotificationsEnabled || false)
        }, syncPayload.deviceId));
        await db.categories.bulkAdd(normalizedCategories);
        console.log(`✅ Imported ${data.categories.length} categories`);
      } else {
        console.log('ℹ️ No categories to import');
      }

      if (data.budgetHistory && data.budgetHistory.length > 0) {
        console.log(`💾 Importing ${data.budgetHistory.length} budget history records...`);
        const normalizedBudgetHistory = data.budgetHistory.map(b =>
          addSyncMetadata(b, syncPayload.deviceId)
        );
        await db.budgetHistory.bulkAdd(normalizedBudgetHistory);
        console.log(`✅ Imported ${data.budgetHistory.length} budget history records`);
      } else {
        console.log('ℹ️ No budget history to import');
      }

      if (data.savingsGoals && data.savingsGoals.length > 0) {
        console.log(`💾 Importing ${data.savingsGoals.length} savings goals...`);
        // Normalize boolean fields (Android sends 1/0, we need true/false)
        const normalizedGoals = data.savingsGoals.map(g => addSyncMetadata({
          ...g,
          isActive: Boolean(g.isActive),
          notificationsEnabled: Boolean(g.notificationsEnabled || false)
        }, syncPayload.deviceId));
        await db.savingsGoals.bulkAdd(normalizedGoals);
        console.log(`✅ Imported ${data.savingsGoals.length} savings goals`);
      } else {
        console.log('ℹ️ No savings goals to import');
      }

      if (data.goalTransactions && data.goalTransactions.length > 0) {
        console.log(`💾 Importing ${data.goalTransactions.length} goal transactions...`);
        const normalizedGoalTx = data.goalTransactions.map(gt =>
          addSyncMetadata(gt, syncPayload.deviceId)
        );
        await db.goalTransactions.bulkAdd(normalizedGoalTx);
        console.log(`✅ Imported ${data.goalTransactions.length} goal transactions`);
      } else {
        console.log('ℹ️ No goal transactions to import');
      }

      if (data.recurringTransactions && data.recurringTransactions.length > 0) {
        console.log(`💾 Importing ${data.recurringTransactions.length} recurring transactions...`);
        const normalizedRecurring = data.recurringTransactions.map(rt =>
          addSyncMetadata(rt, syncPayload.deviceId)
        );
        await db.recurringTransactions.bulkAdd(normalizedRecurring);
        console.log(`✅ Imported ${data.recurringTransactions.length} recurring transactions`);
      } else {
        console.log('ℹ️ No recurring transactions to import');
      }

      if (data.billers && data.billers.length > 0) {
        console.log(`💾 Importing ${data.billers.length} billers...`);
        const normalizedBillers = data.billers.map(b =>
          addSyncMetadata(b, syncPayload.deviceId)
        );
        await db.billers.bulkAdd(normalizedBillers);
        console.log(`✅ Imported ${data.billers.length} billers`);
      } else {
        console.log('ℹ️ No billers to import');
      }

      console.log('✅ Data imported successfully');
      return true;
    } catch (error) {
      console.error('❌ Failed to import data:', error);
      console.error('❌ Error details:', {
        name: error.name,
        message: error.message,
        stack: error.stack
      });

      // Provide more context about which operation failed
      if (error.name === 'ConstraintError') {
        console.error('❌ Database constraint violation - possible duplicate key');
      } else if (error.name === 'DataError') {
        console.error('❌ Invalid data provided to database');
      } else if (error.name === 'QuotaExceededError') {
        console.error('❌ Storage quota exceeded');
      }

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

      // Return absolute value since transaction amounts are stored as negative for expenses
      const total = categoryTransactions.reduce((sum, t) => sum + t.transactionAmount, 0);
      return Math.abs(total);
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

  // ============================================
  // CRUD OPERATIONS
  // ============================================

  /**
   * Generate a unique ID for web-originated records
   * Format: web-{timestamp}-{random}
   */
  function generateWebId() {
    const timestamp = Date.now();
    const random = crypto.randomUUID ?
      crypto.randomUUID().slice(0, 8) :
      Math.random().toString(36).substring(2, 10);
    return `web-${timestamp}-${random}`;
  }

  /**
   * Generate sync metadata for new/updated records
   */
  function generateSyncMetadata(isNew = false) {
    const now = Date.now();
    return {
      createdAt: isNew ? now : undefined,  // Only set on create
      updatedAt: now,
      deviceId: 'web',
      deleted: false
    };
  }

  /**
   * Get active categories (not deleted)
   */
  async function getActiveCategories() {
    try {
      return await db.categories.filter(c => !c.deleted).toArray();
    } catch (error) {
      console.error('Failed to get active categories:', error);
      return [];
    }
  }

  // ============================================
  // TRANSACTION CRUD
  // ============================================

  /**
   * Create a new transaction
   * @param {Object} data - Transaction data (without ID or sync metadata)
   * @returns {Promise<Object>} Created transaction with all fields
   */
  async function createTransaction(data) {
    // Validate required fields
    if (!data.transactionAmount || data.transactionAmount <= 0) {
      throw new Error('Transaction amount must be greater than 0');
    }
    if (!data.transactionCategory) {
      throw new Error('Transaction category is required');
    }
    if (!data.transactionType || !['expense', 'income'].includes(data.transactionType)) {
      throw new Error('Transaction type must be "expense" or "income"');
    }
    if (!data.transactionDate) {
      throw new Error('Transaction date is required');
    }

    const transaction = {
      transactionID: generateWebId(),
      merchantName: data.merchantName || '',
      transactionDate: data.transactionDate,
      transactionType: data.transactionType,
      transactionAmount: parseFloat(data.transactionAmount),
      transactionCategory: parseInt(data.transactionCategory),
      currency: data.currency || (await getMetadata('currency')) || 'USD',
      billerName: data.billerName || null,
      ...generateSyncMetadata(true),
      data_hash: null
    };

    // Compute hash
    if (typeof DataHashService !== 'undefined') {
      transaction.data_hash = await DataHashService.computeTransactionHash(transaction);
    }

    await db.transactions.put(transaction);

    // Queue for sync
    if (typeof autoSyncCRUD !== 'undefined') {
      autoSyncCRUD.recordChange('transactions', 'insert', transaction);
    }

    // Dispatch event for UI update
    window.dispatchEvent(new CustomEvent('data-updated', { detail: { type: 'transaction-created' } }));

    console.log('✅ Created transaction:', transaction.transactionID);
    return transaction;
  }

  /**
   * Update an existing transaction
   * @param {string} transactionID - ID of transaction to update
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated transaction
   */
  async function updateTransaction(transactionID, updates) {
    const existing = await db.transactions.get(transactionID);
    if (!existing) {
      throw new Error(`Transaction not found: ${transactionID}`);
    }

    // Validate updates if provided
    if (updates.transactionAmount !== undefined && updates.transactionAmount <= 0) {
      throw new Error('Transaction amount must be greater than 0');
    }
    if (updates.transactionType && !['expense', 'income'].includes(updates.transactionType)) {
      throw new Error('Transaction type must be "expense" or "income"');
    }

    const updated = {
      ...existing,
      ...updates,
      updatedAt: Date.now(),
      deviceId: 'web',
      data_hash: null
    };

    // Recompute hash
    if (typeof DataHashService !== 'undefined') {
      updated.data_hash = await DataHashService.computeTransactionHash(updated);
    }

    await db.transactions.put(updated);

    // Queue for sync
    if (typeof autoSyncCRUD !== 'undefined') {
      autoSyncCRUD.recordChange('transactions', 'update', updated);
    }

    window.dispatchEvent(new CustomEvent('data-updated', { detail: { type: 'transaction-updated' } }));

    console.log('✅ Updated transaction:', transactionID);
    return updated;
  }

  /**
   * Soft delete a transaction
   * @param {string} transactionID - ID of transaction to delete
   * @returns {Promise<void>}
   */
  async function deleteTransaction(transactionID) {
    const existing = await db.transactions.get(transactionID);
    if (!existing) {
      console.warn('Transaction not found for deletion:', transactionID);
      return;
    }

    const deleted = {
      ...existing,
      deleted: true,
      updatedAt: Date.now(),
      deviceId: 'web',
      data_hash: null
    };

    // Recompute hash
    if (typeof DataHashService !== 'undefined') {
      deleted.data_hash = await DataHashService.computeTransactionHash(deleted);
    }

    await db.transactions.put(deleted);

    // Queue for sync
    if (typeof autoSyncCRUD !== 'undefined') {
      autoSyncCRUD.recordChange('transactions', 'delete', deleted);
    }

    window.dispatchEvent(new CustomEvent('data-updated', { detail: { type: 'transaction-deleted' } }));

    console.log('🗑️ Soft deleted transaction:', transactionID);
  }

  // ============================================
  // CATEGORY CRUD
  // ============================================

  /**
   * Create a new category
   * @param {Object} data - Category data
   * @returns {Promise<Object>} Created category
   */
  async function createCategory(data) {
    if (!data.categoryType || data.categoryType.trim() === '') {
      throw new Error('Category name is required');
    }

    // Get next ID (categories use auto-increment integers)
    const allCategories = await db.categories.toArray();
    const maxId = allCategories.reduce((max, c) => Math.max(max, c.id || 0), 0);

    const category = {
      id: maxId + 1,
      categoryType: data.categoryType.trim(),
      budgetAmount: parseFloat(data.budgetAmount) || 0,
      iconName: data.iconName || 'default',
      colorCode: data.colorCode || null,
      autoPropagateToNextMonth: data.autoPropagateToNextMonth !== false,
      budgetNotificationsEnabled: data.budgetNotificationsEnabled || false,
      ...generateSyncMetadata(true),
      data_hash: null
    };

    if (typeof DataHashService !== 'undefined') {
      category.data_hash = await DataHashService.computeCategoryHash(category);
    }

    await db.categories.put(category);

    if (typeof autoSyncCRUD !== 'undefined') {
      autoSyncCRUD.recordChange('categories', 'insert', category);
    }

    window.dispatchEvent(new CustomEvent('data-updated', { detail: { type: 'category-created' } }));

    console.log('✅ Created category:', category.id, category.categoryType);
    return category;
  }

  /**
   * Update a category
   * @param {number} id - Category ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated category
   */
  async function updateCategory(id, updates) {
    const existing = await db.categories.get(id);
    if (!existing) {
      throw new Error(`Category not found: ${id}`);
    }

    const updated = {
      ...existing,
      ...updates,
      updatedAt: Date.now(),
      deviceId: 'web',
      data_hash: null
    };

    if (typeof DataHashService !== 'undefined') {
      updated.data_hash = await DataHashService.computeCategoryHash(updated);
    }

    await db.categories.put(updated);

    if (typeof autoSyncCRUD !== 'undefined') {
      autoSyncCRUD.recordChange('categories', 'update', updated);
    }

    window.dispatchEvent(new CustomEvent('data-updated', { detail: { type: 'category-updated' } }));

    console.log('✅ Updated category:', id);
    return updated;
  }

  /**
   * Delete a category (with validation)
   * @param {number} id - Category ID
   * @returns {Promise<void>}
   */
  async function deleteCategory(id) {
    // Check for active transactions using this category
    const transactionCount = await db.transactions
      .where('transactionCategory')
      .equals(id)
      .filter(t => !t.deleted)
      .count();

    if (transactionCount > 0) {
      throw new Error(`Cannot delete category: ${transactionCount} active transaction(s) use this category`);
    }

    const existing = await db.categories.get(id);
    if (!existing) {
      console.warn('Category not found for deletion:', id);
      return;
    }

    const deleted = {
      ...existing,
      deleted: true,
      updatedAt: Date.now(),
      deviceId: 'web',
      data_hash: null
    };

    if (typeof DataHashService !== 'undefined') {
      deleted.data_hash = await DataHashService.computeCategoryHash(deleted);
    }

    await db.categories.put(deleted);

    if (typeof autoSyncCRUD !== 'undefined') {
      autoSyncCRUD.recordChange('categories', 'delete', deleted);
    }

    window.dispatchEvent(new CustomEvent('data-updated', { detail: { type: 'category-deleted' } }));

    console.log('🗑️ Soft deleted category:', id);
  }

  // ============================================
  // SAVINGS GOAL CRUD
  // ============================================

  /**
   * Create a new savings goal
   * @param {Object} data - Goal data
   * @returns {Promise<Object>} Created goal
   */
  async function createSavingsGoal(data) {
    if (!data.goalName || data.goalName.trim() === '') {
      throw new Error('Goal name is required');
    }
    if (!data.targetAmount || data.targetAmount <= 0) {
      throw new Error('Target amount must be greater than 0');
    }

    const allGoals = await db.savingsGoals.toArray();
    const maxId = allGoals.reduce((max, g) => Math.max(max, g.id || 0), 0);

    const now = new Date().toISOString();
    const goal = {
      id: maxId + 1,
      goalName: data.goalName.trim(),
      targetAmount: parseFloat(data.targetAmount),
      currentAmount: parseFloat(data.currentAmount) || 0,
      description: data.description || '',
      iconName: data.iconName || 'savings',
      customColor: data.customColor || null,
      createdDate: now,
      targetDate: data.targetDate || null,
      priority: data.priority || 'medium',
      isActive: data.isActive !== false ? 1 : 0,
      category: data.category || 'custom',
      allocationStrategy: data.allocationStrategy || 'manual',
      fixedAllocationAmount: parseFloat(data.fixedAllocationAmount) || 0,
      percentageOfRemaining: parseFloat(data.percentageOfRemaining) || 0,
      createdAt: now,
      updatedAt: now,
      deleted: 0,
      deviceId: 'web',
      data_hash: null
    };

    if (typeof DataHashService !== 'undefined') {
      goal.data_hash = await DataHashService.computeSavingsGoalHash(goal);
    }

    await db.savingsGoals.put(goal);

    if (typeof autoSyncCRUD !== 'undefined') {
      autoSyncCRUD.recordChange('savingsGoals', 'insert', goal);
    }

    window.dispatchEvent(new CustomEvent('data-updated', { detail: { type: 'goal-created' } }));

    console.log('✅ Created savings goal:', goal.id, goal.goalName);
    return goal;
  }

  /**
   * Update a savings goal
   * @param {number} id - Goal ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated goal
   */
  async function updateSavingsGoal(id, updates) {
    const existing = await db.savingsGoals.get(id);
    if (!existing) {
      throw new Error(`Savings goal not found: ${id}`);
    }

    const updated = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
      deviceId: 'web',
      data_hash: null
    };

    if (typeof DataHashService !== 'undefined') {
      updated.data_hash = await DataHashService.computeSavingsGoalHash(updated);
    }

    await db.savingsGoals.put(updated);

    if (typeof autoSyncCRUD !== 'undefined') {
      autoSyncCRUD.recordChange('savingsGoals', 'update', updated);
    }

    window.dispatchEvent(new CustomEvent('data-updated', { detail: { type: 'goal-updated' } }));

    console.log('✅ Updated savings goal:', id);
    return updated;
  }

  /**
   * Delete a savings goal
   * @param {number} id - Goal ID
   * @returns {Promise<void>}
   */
  async function deleteSavingsGoal(id) {
    const existing = await db.savingsGoals.get(id);
    if (!existing) {
      console.warn('Savings goal not found for deletion:', id);
      return;
    }

    const deleted = {
      ...existing,
      deleted: 1,
      isActive: 0,
      updatedAt: new Date().toISOString(),
      deviceId: 'web',
      data_hash: null
    };

    if (typeof DataHashService !== 'undefined') {
      deleted.data_hash = await DataHashService.computeSavingsGoalHash(deleted);
    }

    await db.savingsGoals.put(deleted);

    if (typeof autoSyncCRUD !== 'undefined') {
      autoSyncCRUD.recordChange('savingsGoals', 'delete', deleted);
    }

    window.dispatchEvent(new CustomEvent('data-updated', { detail: { type: 'goal-deleted' } }));

    console.log('🗑️ Soft deleted savings goal:', id);
  }

  // ============================================
  // GOAL TRANSACTION CRUD
  // ============================================

  /**
   * Add a contribution or withdrawal to a goal
   * @param {Object} data - Goal transaction data
   * @returns {Promise<Object>} Created goal transaction
   */
  async function createGoalTransaction(data) {
    if (!data.goalId) {
      throw new Error('Goal ID is required');
    }
    if (!data.amount || data.amount <= 0) {
      throw new Error('Amount must be greater than 0');
    }
    if (!data.transactionType || !['contribution', 'withdrawal'].includes(data.transactionType)) {
      throw new Error('Transaction type must be "contribution" or "withdrawal"');
    }

    // Verify goal exists
    const goal = await db.savingsGoals.get(data.goalId);
    if (!goal) {
      throw new Error(`Savings goal not found: ${data.goalId}`);
    }

    const allGoalTxns = await db.goalTransactions.toArray();
    const maxId = allGoalTxns.reduce((max, t) => Math.max(max, t.id || 0), 0);

    const now = Date.now();
    const goalTransaction = {
      id: maxId + 1,
      goalId: parseInt(data.goalId),
      amount: parseFloat(data.amount),
      transactionType: data.transactionType,
      transactionDate: data.transactionDate || new Date().toISOString(),
      description: data.description || '',
      sourceTransactionId: data.sourceTransactionId || null,
      sourceTransactionType: data.sourceTransactionType || null,
      createdAt: now,
      updated_at: now,
      deleted: 0,
      deviceId: 'web',
      data_hash: null
    };

    if (typeof DataHashService !== 'undefined') {
      goalTransaction.data_hash = await DataHashService.computeGoalTransactionHash(goalTransaction);
    }

    // Update goal's currentAmount
    const amountDelta = data.transactionType === 'contribution' ? data.amount : -data.amount;
    const newCurrentAmount = Math.max(0, (goal.currentAmount || 0) + amountDelta);

    await db.transaction('rw', [db.goalTransactions, db.savingsGoals], async () => {
      await db.goalTransactions.put(goalTransaction);
      await updateSavingsGoal(data.goalId, { currentAmount: newCurrentAmount });
    });

    if (typeof autoSyncCRUD !== 'undefined') {
      autoSyncCRUD.recordChange('goalTransactions', 'insert', goalTransaction);
    }

    window.dispatchEvent(new CustomEvent('data-updated', { detail: { type: 'goal-transaction-created' } }));

    console.log('✅ Created goal transaction:', goalTransaction.id);
    return goalTransaction;
  }

  /**
   * Delete a goal transaction
   * @param {number} id - Goal transaction ID
   * @returns {Promise<void>}
   */
  async function deleteGoalTransaction(id) {
    const existing = await db.goalTransactions.get(id);
    if (!existing) {
      console.warn('Goal transaction not found for deletion:', id);
      return;
    }

    // Revert the goal's currentAmount
    const goal = await db.savingsGoals.get(existing.goalId);
    if (goal) {
      const amountDelta = existing.transactionType === 'contribution' ? -existing.amount : existing.amount;
      const newCurrentAmount = Math.max(0, (goal.currentAmount || 0) + amountDelta);
      await updateSavingsGoal(existing.goalId, { currentAmount: newCurrentAmount });
    }

    const deleted = {
      ...existing,
      deleted: 1,
      updated_at: Date.now(),
      deviceId: 'web',
      data_hash: null
    };

    if (typeof DataHashService !== 'undefined') {
      deleted.data_hash = await DataHashService.computeGoalTransactionHash(deleted);
    }

    await db.goalTransactions.put(deleted);

    if (typeof autoSyncCRUD !== 'undefined') {
      autoSyncCRUD.recordChange('goalTransactions', 'delete', deleted);
    }

    window.dispatchEvent(new CustomEvent('data-updated', { detail: { type: 'goal-transaction-deleted' } }));

    console.log('🗑️ Soft deleted goal transaction:', id);
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
    getActiveCategories,
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
    getSyncSnapshot,
    // CRUD operations
    createTransaction,
    updateTransaction,
    deleteTransaction,
    createCategory,
    updateCategory,
    deleteCategory,
    createSavingsGoal,
    updateSavingsGoal,
    deleteSavingsGoal,
    createGoalTransaction,
    deleteGoalTransaction
  };
})();
