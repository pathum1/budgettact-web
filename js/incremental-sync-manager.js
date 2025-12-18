class IncrementalSyncManager {
  constructor() {
    this.storeKeyMap = {
      transactions: 'transactionID',
      categories: 'id',
      budgetHistory: 'id',
      savingsGoals: 'id',
      goalTransactions: 'id',
      recurringTransactions: 'id',
      billers: 'billerID'
    };
  }

  async getChangesSinceLastSync() {
    const lastSync = PairingManager.getLastSyncTime();
    console.log(lastSync ? `📦 Incremental sync since ${new Date(lastSync).toISOString()}` : '📦 First-time sync - sending all data');
    const snapshot = await Storage.getSyncSnapshot(lastSync);

    // Ensure all records have hashes before sending
    await this.ensureHashesForSnapshot(snapshot);

    return snapshot;
  }

  /**
   * Ensure all records in snapshot have hashes computed
   */
  async ensureHashesForSnapshot(snapshot) {
    const tables = ['transactions', 'categories', 'budgetHistory', 'savingsGoals', 'goalTransactions', 'recurringTransactions', 'billers'];

    for (const tableName of tables) {
      if (snapshot[tableName] && snapshot[tableName].length > 0) {
        await this.ensureHashesForRecords(tableName, snapshot[tableName]);
      }
    }
  }

  /**
   * Ensure all records have hashes computed
   */
  async ensureHashesForRecords(tableName, records) {
    if (typeof DataHashService === 'undefined') {
      console.warn('⚠️ DataHashService not available, skipping hash computation');
      return;
    }

    let hashesComputed = 0;
    let hashesPreserved = 0;

    for (const record of records) {
      // Skip if hash already exists
      if (record.data_hash) {
        hashesPreserved++;
        continue;
      }

      // Compute hash
      try {
        const hash = await DataHashService.computeHashForEntity(tableName, record);
        if (hash) {
          record.data_hash = hash;
          hashesComputed++;

          // Update database with the new hash
          const table = Storage.db[tableName];
          const keyField = this.storeKeyMap[tableName];
          const recordId = record[keyField];

          if (recordId && table) {
            await table.update(recordId, { data_hash: hash });
          }
        }
      } catch (error) {
        console.error(`❌ Failed to compute hash for ${tableName}:`, error);
      }
    }

    if (hashesComputed > 0 || hashesPreserved > 0) {
      console.log(`🔐 Hashes for ${tableName}: ${hashesComputed} computed, ${hashesPreserved} preserved`);
    }
  }

  async applyIncomingChanges(incomingChanges, strategy = null) {
    strategy = strategy || PairingManager.getConflictStrategy();

    let applied = 0;
    let conflicts = 0;
    const conflictDetails = [];

    // Handle missing or null arrays gracefully - default to empty array
    const transactions = incomingChanges.transactions || [];
    const categories = incomingChanges.categories || [];
    const budgetHistory = incomingChanges.budgetHistory || [];
    const savingsGoals = incomingChanges.savingsGoals || [];
    const goalTransactions = incomingChanges.goalTransactions || [];
    const recurringTransactions = incomingChanges.recurringTransactions || [];
    const billers = incomingChanges.billers || [];

    console.log('📥 Applying incoming changes:', {
      transactions: transactions.length,
      categories: categories.length,
      budgetHistory: budgetHistory.length,
      savingsGoals: savingsGoals.length,
      goalTransactions: goalTransactions.length,
      recurringTransactions: recurringTransactions.length,
      billers: billers.length
    });

    const applyResults = await Promise.all([
      this.applyStoreChanges('transactions', transactions, strategy),
      this.applyStoreChanges('categories', categories, strategy),
      this.applyStoreChanges('budgetHistory', budgetHistory, strategy),
      this.applyStoreChanges('savingsGoals', savingsGoals, strategy),
      this.applyStoreChanges('goalTransactions', goalTransactions, strategy),
      this.applyStoreChanges('recurringTransactions', recurringTransactions, strategy),
      this.applyStoreChanges('billers', billers, strategy)
    ]);

    applyResults.forEach((result) => {
      applied += result.applied;
      conflicts += result.conflicts;
      conflictDetails.push(...result.conflictDetails);
    });

    PairingManager.updateLastSync();
    console.log(`✅ Applied ${applied} changes (${conflicts} conflicts)`);

    return { applied, conflicts, conflictDetails };
  }

  async applyStoreChanges(storeName, records = [], strategy) {
    if (!records || records.length === 0) {
      return { applied: 0, conflicts: 0, conflictDetails: [] };
    }

    let applied = 0;
    let conflicts = 0;
    const conflictDetails = [];

    for (const record of records) {
      const result = await this.applyRecordChange(storeName, record, strategy);
      if (result.applied) applied++;
      if (result.conflict) {
        conflicts++;
        if (result.conflictDetail) conflictDetails.push(result.conflictDetail);
      }
    }

    return { applied, conflicts, conflictDetails };
  }

  async applyRecordChange(storeName, incoming, strategy) {
    const table = Storage.db.table(storeName);
    const keyField = this.storeKeyMap[storeName] || 'id';
    const incomingRecord = this.normalizeIncomingRecord(incoming, keyField, storeName);

    // Verify incoming hash if DataHashService is available
    if (typeof DataHashService !== 'undefined' && incomingRecord.data_hash) {
      try {
        const hashValid = await DataHashService.verifyRecordHash(storeName, incomingRecord);
        if (!hashValid) {
          console.warn(`⚠️ Hash verification failed for ${storeName} record ${incomingRecord[keyField]} - data may be corrupted but will still be applied`);
        }
      } catch (error) {
        console.error(`❌ Error verifying hash for ${storeName}:`, error);
      }
    }

    if (!incomingRecord[keyField]) {
      return { applied: false, conflict: false };
    }

    const existing = await table.get(incomingRecord[keyField]);
    const lastSync = PairingManager.getLastSyncTime() || 0;
    const incomingUpdated = incomingRecord.updatedAt || 0;
    const localUpdated = existing ? this.normalizeTimestamp(existing.updatedAt) : 0;
    const localModified = existing && localUpdated > lastSync;
    const incomingModified = incomingUpdated > lastSync;

    if (!existing) {
      if (incomingRecord.deleted) {
        return { applied: false, conflict: false };
      }
      await Storage.upsertRecord(storeName, incomingRecord, { queue: false });
      return { applied: true, conflict: false };
    }

    if (localModified && incomingModified) {
      return this.resolveConflict(storeName, existing, incomingRecord, strategy, table, keyField);
    }

    if (incomingModified) {
      await Storage.upsertRecord(storeName, incomingRecord, { queue: false });
      return { applied: true, conflict: false };
    }

    return { applied: false, conflict: false };
  }

  async resolveConflict(storeName, local, incoming, strategy, table, keyField) {
    console.warn(`⚠️ Conflict detected in ${storeName}:`, incoming[keyField]);

    let winner = incoming;
    switch (strategy) {
      case 'androidWins':
        winner = incoming;
        break;
      case 'webWins':
        winner = local;
        break;
      case 'newerWins':
      default:
        winner = (incoming.updatedAt || 0) > (this.normalizeTimestamp(local.updatedAt) || 0) ? incoming : local;
    }

    if (winner === incoming) {
      await Storage.upsertRecord(storeName, incoming, { queue: false });
      return {
        applied: true,
        conflict: true,
        conflictDetail: {
          entity: storeName,
          id: incoming[keyField],
          resolution: strategy,
          winner: 'android'
        }
      };
    }

    return {
      applied: false,
      conflict: true,
      conflictDetail: {
        entity: storeName,
        id: incoming[keyField],
        resolution: strategy,
        winner: 'web'
      }
    };
  }

  normalizeIncomingRecord(record, keyField, storeName) {
    const now = Date.now();

    // Normalize field names for categories (Android sends 'ID', web expects 'id')
    let normalizedRecord = { ...record };
    if (storeName === 'categories' && !normalizedRecord.id && normalizedRecord.ID) {
      normalizedRecord.id = normalizedRecord.ID;
    }

    return {
      ...normalizedRecord,
      [keyField]: normalizedRecord[keyField] || record[keyField.toUpperCase()],
      createdAt: this.normalizeTimestamp(normalizedRecord.createdAt) || now,
      updatedAt: this.normalizeTimestamp(normalizedRecord.updatedAt) || now,
      deleted: normalizedRecord.deleted === undefined ? false : Boolean(normalizedRecord.deleted),
      deviceId: normalizedRecord.deviceId || 'android'
    };
  }

  normalizeTimestamp(value) {
    // Handle integer milliseconds (from Android)
    if (typeof value === 'number') {
      return value > 0 ? value : Date.now();
    }

    // Handle null/undefined
    if (!value) return Date.now();

    // Handle ISO string (from Android or web)
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      return Number.isNaN(parsed) ? Date.now() : parsed;
    }

    // Fallback for unknown types
    console.warn('⚠️ Unknown timestamp type:', typeof value, value);
    return Date.now();
  }
}

const incrementalSyncManager = new IncrementalSyncManager();
