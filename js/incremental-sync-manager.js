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
    return Storage.getSyncSnapshot(lastSync);
  }

  async applyIncomingChanges(incomingChanges, strategy = null) {
    strategy = strategy || PairingManager.getConflictStrategy();

    let applied = 0;
    let conflicts = 0;
    const conflictDetails = [];

    const applyResults = await Promise.all([
      this.applyStoreChanges('transactions', incomingChanges.transactions, strategy),
      this.applyStoreChanges('categories', incomingChanges.categories, strategy),
      this.applyStoreChanges('budgetHistory', incomingChanges.budgetHistory, strategy),
      this.applyStoreChanges('savingsGoals', incomingChanges.savingsGoals, strategy),
      this.applyStoreChanges('goalTransactions', incomingChanges.goalTransactions, strategy),
      this.applyStoreChanges('recurringTransactions', incomingChanges.recurringTransactions, strategy),
      this.applyStoreChanges('billers', incomingChanges.billers, strategy)
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
    const incomingRecord = this.normalizeIncomingRecord(incoming, keyField);

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

  normalizeIncomingRecord(record, keyField) {
    const now = Date.now();
    return {
      ...record,
      [keyField]: record[keyField],
      createdAt: this.normalizeTimestamp(record.createdAt) || now,
      updatedAt: this.normalizeTimestamp(record.updatedAt) || now,
      deleted: record.deleted === undefined ? false : Boolean(record.deleted),
      deviceId: record.deviceId || 'android'
    };
  }

  normalizeTimestamp(value) {
    if (typeof value === 'number') return value;
    if (!value) return 0;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
}

const incrementalSyncManager = new IncrementalSyncManager();
