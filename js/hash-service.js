/**
 * Data Hash Service - Web Implementation
 * MUST match Android's DataHashService exactly
 *
 * This service computes SHA-256 hashes for all synced entities.
 * Hash computation MUST be deterministic and match Android exactly.
 */

class DataHashService {
  /**
   * Compute SHA-256 hash of a transaction
   * MUST match Android's computeTransactionHash
   */
  static async computeTransactionHash(transaction) {
    const criticalFields = {
      transactionID: String(transaction.transactionID || ''),
      transactionAmount: this._normalizeNumber(transaction.transactionAmount),
      transactionCategory: String(transaction.transactionCategory || ''),
      merchantName: String(transaction.merchantName || ''),
      transactionDate: String(transaction.transactionDate || ''),
      transactionType: String(transaction.transactionType || ''),
      deleted: transaction.deleted ? '1' : '0',
    };

    return this._computeHash(criticalFields);
  }

  /**
   * Compute hash for a category
   */
  static async computeCategoryHash(category) {
    const criticalFields = {
      id: String(category.id || ''),
      categoryName: String(category.categoryName || ''),
      categoryType: String(category.categoryType || ''),
      iconName: String(category.iconName || ''),
      colorCode: String(category.colorCode || ''),
      budgetAmount: this._normalizeNumber(category.budgetAmount),
      autoPropagateToNextMonth: category.autoPropagateToNextMonth ? '1' : '0',
      deleted: category.deleted ? '1' : '0',
    };

    return this._computeHash(criticalFields);
  }

  /**
   * Compute hash for a savings goal
   */
  static async computeSavingsGoalHash(goal) {
    const criticalFields = {
      id: String(goal.id || ''),
      goalName: String(goal.goalName || ''),
      targetAmount: this._normalizeNumber(goal.targetAmount),
      currentAmount: this._normalizeNumber(goal.currentAmount),
      targetDate: String(goal.targetDate || ''),
      createdAt: String(goal.createdAt || ''),
      iconName: String(goal.iconName || ''),
      colorCode: String(goal.colorCode || ''),
      allocationStrategy: String(goal.allocationStrategy || ''),
      fixedAllocationAmount: this._normalizeNumber(goal.fixedAllocationAmount),
      percentageOfRemaining: this._normalizeNumber(goal.percentageOfRemaining),
      priority: String(goal.priority || ''),
      category: String(goal.category || ''),
      isActive: goal.isActive ? '1' : '0',
      deleted: goal.deleted ? '1' : '0',
    };

    return this._computeHash(criticalFields);
  }

  /**
   * Compute hash for budget history
   */
  static async computeBudgetHistoryHash(budgetHistory) {
    const criticalFields = {
      id: String(budgetHistory.id || ''),
      categoryId: String(budgetHistory.categoryId || ''),
      yearMonth: String(budgetHistory.yearMonth || ''),
      budgetAmount: this._normalizeNumber(budgetHistory.budgetAmount),
      deleted: budgetHistory.deleted ? '1' : '0',
    };

    return this._computeHash(criticalFields);
  }

  /**
   * Compute hash for goal transaction
   */
  static async computeGoalTransactionHash(goalTransaction) {
    const criticalFields = {
      id: String(goalTransaction.id || ''),
      goalId: String(goalTransaction.goalId || ''),
      transactionAmount: this._normalizeNumber(goalTransaction.transactionAmount),
      transactionType: String(goalTransaction.transactionType || ''),
      transactionDate: String(goalTransaction.transactionDate || ''),
      note: String(goalTransaction.note || ''),
      deleted: goalTransaction.deleted ? '1' : '0',
    };

    return this._computeHash(criticalFields);
  }

  /**
   * Compute hash for recurring transaction
   */
  static async computeRecurringTransactionHash(recurring) {
    const criticalFields = {
      id: String(recurring.id || ''),
      transactionID: String(recurring.transactionID || ''),
      recurringAmount: this._normalizeNumber(recurring.recurringAmount),
      merchantName: String(recurring.merchantName || ''),
      frequency: String(recurring.frequency || ''),
      startDate: String(recurring.startDate || ''),
      endDate: String(recurring.endDate || ''),
      status: String(recurring.status || ''),
      deleted: recurring.deleted ? '1' : '0',
    };

    return this._computeHash(criticalFields);
  }

  /**
   * Compute hash for biller
   */
  static async computeBillerHash(biller) {
    const criticalFields = {
      billerID: String(biller.billerID || ''),
      billerName: String(biller.billerName || ''),
      normalizedAddresses: String(biller.normalizedAddresses || ''),
      categoryId: String(biller.categoryId || ''),
      deleted: biller.deleted ? '1' : '0',
    };

    return this._computeHash(criticalFields);
  }

  /**
   * Normalize numeric values for consistent hashing
   * MUST match Android's _normalizeNumber
   */
  static _normalizeNumber(value) {
    if (value === null || value === undefined || value === '') return '0.00';

    const num = typeof value === 'number' ? value : parseFloat(value);

    if (isNaN(num)) return '0.00';

    // Round to 2 decimal places (matches Android)
    return num.toFixed(2);
  }

  /**
   * Compute SHA-256 hash from field map
   * MUST match Android's _computeHash
   */
  static async _computeHash(fields) {
    try {
      // Sort keys alphabetically (matches Android)
      const sortedKeys = Object.keys(fields).sort();

      // Build canonical string
      let canonical = '';
      for (const key of sortedKeys) {
        canonical += key + '=' + fields[key] + '&';
      }

      // Remove trailing '&'
      if (canonical.endsWith('&')) {
        canonical = canonical.slice(0, -1);
      }

      console.log('🔐 Computing hash for canonical string:', canonical);

      // Compute SHA-256
      const encoder = new TextEncoder();
      const data = encoder.encode(canonical);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);

      // Convert to hex string
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

      return hashHex;
    } catch (error) {
      console.error('❌ Failed to compute hash:', error);
      return 'error-' + Date.now();
    }
  }

  /**
   * Compute hash based on table name
   */
  static async computeHashForEntity(tableName, data) {
    switch (tableName) {
      case 'transactions':
        return this.computeTransactionHash(data);
      case 'categories':
        return this.computeCategoryHash(data);
      case 'savingsGoals':
        return this.computeSavingsGoalHash(data);
      case 'budgetHistory':
        return this.computeBudgetHistoryHash(data);
      case 'goalTransactions':
        return this.computeGoalTransactionHash(data);
      case 'recurringTransactions':
        return this.computeRecurringTransactionHash(data);
      case 'billers':
        return this.computeBillerHash(data);
      default:
        console.warn('⚠️ Unknown table for hash computation:', tableName);
        return null;
    }
  }

  /**
   * Verify a record's hash matches its data
   */
  static async verifyRecordHash(tableName, record) {
    const storedHash = record.data_hash;
    if (!storedHash) {
      // No hash yet, can't verify
      return true;
    }

    const computedHash = await this.computeHashForEntity(tableName, record);
    if (!computedHash) {
      console.warn('⚠️ Cannot verify hash for', tableName);
      return false;
    }

    const matches = storedHash === computedHash;
    if (!matches) {
      console.warn(
        `⚠️ Hash mismatch for ${tableName} record ${record.id || record.transactionID || record.billerID}: ` +
        `stored=${storedHash}, computed=${computedHash}`
      );
    }

    return matches;
  }

  /**
   * Batch verify hashes for multiple records
   */
  static async verifyBatchHashes(tableName, records) {
    let verified = 0;
    let failed = 0;
    let missing = 0;

    for (const record of records) {
      if (!record.data_hash) {
        missing++;
        continue;
      }

      const isValid = await this.verifyRecordHash(tableName, record);
      if (isValid) {
        verified++;
      } else {
        failed++;
      }
    }

    return {
      total: records.length,
      verified,
      failed,
      missing
    };
  }
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DataHashService;
}
