const Sync = (() => {
  /**
   * Validate sync payload against SYNC_CONTRACT.md
   * @param {Object} payload - Parsed JSON payload
   * @returns {Object} { valid: boolean, errors: string[] }
   */
  function validateSyncPayload(payload) {
    const errors = [];

    // Check root structure
    if (!payload || typeof payload !== 'object') {
      errors.push('Invalid payload: must be a JSON object');
      return { valid: false, errors };
    }

    // Check version
    if (!payload.version) {
      errors.push('Missing required field: version');
    } else if (payload.version !== '1.0') {
      errors.push(`Unsupported version: ${payload.version} (expected 1.0)`);
    }

    // Check required root fields
    if (!payload.exportedAt) {
      errors.push('Missing required field: exportedAt');
    }

    if (!payload.deviceId) {
      errors.push('Missing required field: deviceId');
    }

    if (!payload.currency) {
      errors.push('Missing required field: currency');
    }

    // Check data object
    if (!payload.data || typeof payload.data !== 'object') {
      errors.push('Missing or invalid data object');
      return { valid: false, errors };
    }

    const { data } = payload;

    // Check required arrays exist
    const requiredArrays = [
      'transactions',
      'categories',
      'budgetHistory',
      'savingsGoals',
      'goalTransactions',
      'recurringTransactions',
      'billers'
    ];

    for (const arrayName of requiredArrays) {
      if (!Array.isArray(data[arrayName])) {
        errors.push(`Missing or invalid array: data.${arrayName}`);
      }
    }

    // Stop here if basic structure is invalid
    if (errors.length > 0) {
      return { valid: false, errors };
    }

    // Validate transactions
    if (data.transactions.length > 0) {
      const transactionErrors = validateTransactions(data.transactions);
      errors.push(...transactionErrors);
    }

    // Validate categories
    if (data.categories.length > 0) {
      const categoryErrors = validateCategories(data.categories);
      errors.push(...categoryErrors);
    }

    // Validate savings goals
    if (data.savingsGoals.length > 0) {
      const goalErrors = validateSavingsGoals(data.savingsGoals);
      errors.push(...goalErrors);
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate transactions array
   */
  function validateTransactions(transactions) {
    const errors = [];
    const validTypes = ['expense', 'income'];

    // Sample validation (check first few items)
    const sampleSize = Math.min(5, transactions.length);

    for (let i = 0; i < sampleSize; i++) {
      const t = transactions[i];

      if (!t.transactionID) {
        errors.push(`Transaction ${i}: missing transactionID`);
      }

      if (!t.merchantName) {
        errors.push(`Transaction ${i}: missing merchantName`);
      }

      if (!t.transactionDate) {
        errors.push(`Transaction ${i}: missing transactionDate`);
      } else if (!isValidISODate(t.transactionDate)) {
        errors.push(`Transaction ${i}: invalid date format`);
      }

      if (!t.transactionType) {
        errors.push(`Transaction ${i}: missing transactionType`);
      } else if (!validTypes.includes(t.transactionType)) {
        errors.push(`Transaction ${i}: invalid transactionType (must be 'expense' or 'income')`);
      }

      if (typeof t.transactionAmount !== 'number') {
        errors.push(`Transaction ${i}: invalid transactionAmount (must be number)`);
      }

      if (typeof t.transactionCategory !== 'number') {
        errors.push(`Transaction ${i}: invalid transactionCategory (must be number)`);
      }
    }

    return errors;
  }

  /**
   * Validate categories array
   */
  function validateCategories(categories) {
    const errors = [];

    for (let i = 0; i < Math.min(5, categories.length); i++) {
      const c = categories[i];

      if (typeof c.id !== 'number') {
        errors.push(`Category ${i}: missing or invalid id`);
      }

      if (!c.categoryType) {
        errors.push(`Category ${i}: missing categoryType`);
      }

      if (typeof c.budgetAmount !== 'number') {
        errors.push(`Category ${i}: invalid budgetAmount`);
      }

      if (typeof c.autoPropagateToNextMonth !== 'boolean') {
        errors.push(`Category ${i}: invalid autoPropagateToNextMonth (must be boolean)`);
      }

      if (typeof c.budgetNotificationsEnabled !== 'boolean') {
        errors.push(`Category ${i}: invalid budgetNotificationsEnabled (must be boolean)`);
      }
    }

    return errors;
  }

  /**
   * Validate savings goals array
   */
  function validateSavingsGoals(goals) {
    const errors = [];
    const validPriorities = ['high', 'medium', 'low'];
    const validCategories = ['emergency', 'vacation', 'vehicle', 'investment', 'home', 'education', 'custom'];

    for (let i = 0; i < Math.min(5, goals.length); i++) {
      const g = goals[i];

      if (typeof g.id !== 'number') {
        errors.push(`Goal ${i}: missing or invalid id`);
      }

      if (!g.goalName) {
        errors.push(`Goal ${i}: missing goalName`);
      }

      if (typeof g.targetAmount !== 'number') {
        errors.push(`Goal ${i}: invalid targetAmount`);
      }

      if (typeof g.currentAmount !== 'number') {
        errors.push(`Goal ${i}: invalid currentAmount`);
      }

      if (g.priority && !validPriorities.includes(g.priority)) {
        errors.push(`Goal ${i}: invalid priority`);
      }

      if (g.category && !validCategories.includes(g.category)) {
        errors.push(`Goal ${i}: invalid category`);
      }

      if (typeof g.isActive !== 'boolean') {
        errors.push(`Goal ${i}: invalid isActive (must be boolean)`);
      }
    }

    return errors;
  }

  /**
   * Check if string is valid ISO 8601 date
   */
  function isValidISODate(dateString) {
    if (typeof dateString !== 'string') return false;

    try {
      const date = new Date(dateString);
      return date.toISOString() === dateString || !isNaN(date.getTime());
    } catch {
      return false;
    }
  }

  /**
   * Import sync data (parse JSON and validate)
   * @param {string} jsonString - JSON string from Android app
   * @returns {Promise<Object>} { success: boolean, message: string, stats?: Object }
   */
  async function importSyncData(jsonString) {
    try {
      // Step 1: Parse JSON
      let payload;
      try {
        payload = JSON.parse(jsonString);
      } catch (error) {
        return {
          success: false,
          message: 'Invalid JSON format. Please check the exported data.'
        };
      }

      // Step 2: Validate structure
      const validation = validateSyncPayload(payload);

      if (!validation.valid) {
        return {
          success: false,
          message: 'Data validation failed',
          errors: validation.errors
        };
      }

      // Step 3: Import to IndexedDB
      try {
        await Storage.importData(payload);
      } catch (error) {
        console.error('Import error:', error);
        return {
          success: false,
          message: 'Failed to save data to database. Please try again.'
        };
      }

      // Step 4: Calculate stats
      const stats = {
        transactions: payload.data.transactions.length,
        categories: payload.data.categories.length,
        goals: payload.data.savingsGoals.length,
        exportedAt: payload.exportedAt,
        deviceName: payload.deviceName || 'Unknown Device'
      };

      return {
        success: true,
        message: 'Data imported successfully!',
        stats
      };
    } catch (error) {
      console.error('Unexpected error during import:', error);
      return {
        success: false,
        message: 'An unexpected error occurred. Please try again.'
      };
    }
  }

  /**
   * Get import summary stats
   */
  async function getImportStats() {
    try {
      const metadata = await Storage.getMetadata();
      if (!metadata) return null;

      const [transactions, categories, goals] = await Promise.all([
        Storage.db.transactions.count(),
        Storage.db.categories.count(),
        Storage.db.savingsGoals.count()
      ]);

      return {
        transactions,
        categories,
        goals,
        lastSync: metadata.exportedAt,
        deviceName: metadata.deviceName,
        importedAt: metadata.importedAt
      };
    } catch (error) {
      console.error('Failed to get import stats:', error);
      return null;
    }
  }

  // Public API
  return {
    validateSyncPayload,
    importSyncData,
    getImportStats
  };
})();
