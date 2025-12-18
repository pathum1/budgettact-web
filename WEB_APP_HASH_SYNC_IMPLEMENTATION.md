# Web App Hash-Based Sync Implementation Guide

## Context

You are implementing **hash-based data verification** for the BudgetTact web app sync system. The Android app has already been updated to include data hashes. Your task is to implement the matching functionality on the web side.

## Current Situation

**Problem:** The current sync only uses timestamps (`updated_at > lastSync`), which:
- Doesn't verify data integrity
- Misses changes if timestamps are wrong
- Can't detect data divergence between Android and web

**Solution:** Hybrid timestamp + hash verification approach:
1. Use timestamps as initial filter (fast)
2. Verify with content hashes (accurate)
3. Only sync records where hashes actually differ

## What's Already Done (Android Side)

✅ Database migration v20 - Added `data_hash TEXT` column to all synced tables
✅ Hash computation service - Deterministic SHA-256 hashes
✅ Modified sync to ensure hashes are computed before sending
✅ Sync payload now includes `data_hash` field for each record

## Your Tasks (Web Side)

### Task 1: Update Dexie Schema
Add `data_hash` field to all synced tables in `storage.js`.

### Task 2: Implement Hash Computation
Create matching hash functions that produce **identical hashes** to Android for the same data.

### Task 3: Update CRUD Operations
Ensure hashes are computed whenever data is modified.

### Task 4: Modify Sync Protocol
Update sync logic to use hash verification instead of trusting timestamps alone.

---

## Detailed Implementation Instructions

### TASK 1: Update Dexie Schema (storage.js)

**File:** `js/storage.js`

**Current schema:**
```javascript
const db = new Dexie('BudgetTactDB');
db.version(1).stores({
  transactions: 'id, amount, categoryId, date, type, updated_at',
  categories: 'ID, CategoryName, updated_at',
  savingsGoals: 'id, name, targetDate, updated_at',
  // ... etc
});
```

**Update to version 2 with data_hash:**
```javascript
const db = new Dexie('BudgetTactDB');

// Version 1 (existing)
db.version(1).stores({
  transactions: 'id, amount, categoryId, date, type, updated_at',
  categories: 'ID, CategoryName, updated_at',
  savingsGoals: 'id, name, targetDate, updated_at',
  budgetHistory: '++id, category_id, year_month, updated_at',
  goalTransactions: 'id, goal_id, date, updated_at',
  recurringTransactions: 'id, category_id, updated_at',
  billers: 'id, name, updated_at',
  metadata: 'key'
});

// Version 2 - Add data_hash to all tables
db.version(2).stores({
  transactions: 'id, amount, categoryId, date, type, updated_at, data_hash',
  categories: 'ID, CategoryName, updated_at, data_hash',
  savingsGoals: 'id, name, targetDate, updated_at, data_hash',
  budgetHistory: '++id, category_id, year_month, updated_at, data_hash',
  goalTransactions: 'id, goal_id, date, updated_at, data_hash',
  recurringTransactions: 'id, category_id, updated_at, data_hash',
  billers: 'id, name, updated_at, data_hash',
  metadata: 'key'
}).upgrade(tx => {
  // Existing data won't have hashes yet - they'll be computed on next sync
  console.log('✅ Upgraded to schema v2 with data_hash fields');
});
```

---

### TASK 2: Implement Hash Computation (NEW FILE)

**Create:** `js/hash-service.js`

**CRITICAL:** Hash functions MUST produce identical results to Android. Use the exact same:
- Field selection (only critical fields)
- Field normalization (number formatting, boolean conversion)
- Sorting (alphabetical by key)
- Hash algorithm (SHA-256)

```javascript
/**
 * Data Hash Service - Web Implementation
 * MUST match Android's DataHashService exactly
 */

class DataHashService {
  /**
   * Compute SHA-256 hash of a transaction
   * MUST match Android's computeTransactionHash
   */
  static computeTransactionHash(transaction) {
    const criticalFields = {
      id: String(transaction.id || ''),
      amount: this._normalizeNumber(transaction.amount),
      categoryId: String(transaction.categoryId || ''),
      description: String(transaction.description || ''),
      date: String(transaction.date || ''),
      type: String(transaction.type || ''),
      merchantName: String(transaction.merchantName || ''),
      deleted: transaction.deleted ? '1' : '0',
    };

    return this._computeHash(criticalFields);
  }

  /**
   * Compute hash for a category
   */
  static computeCategoryHash(category) {
    const criticalFields = {
      ID: String(category.ID || ''),
      CategoryName: String(category.CategoryName || ''),
      IconName: String(category.IconName || ''),
      ColorCode: String(category.ColorCode || ''),
      budgetAmount: this._normalizeNumber(category.budgetAmount),
      autoPropagateToNextMonth: category.autoPropagateToNextMonth ? '1' : '0',
      deleted: category.deleted ? '1' : '0',
    };

    return this._computeHash(criticalFields);
  }

  /**
   * Compute hash for a savings goal
   */
  static computeSavingsGoalHash(goal) {
    const criticalFields = {
      id: String(goal.id || ''),
      name: String(goal.name || ''),
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
      deleted: goal.deleted ? '1' : '0',
    };

    return this._computeHash(criticalFields);
  }

  /**
   * Compute hash for budget history
   */
  static computeBudgetHistoryHash(budgetHistory) {
    const criticalFields = {
      id: String(budgetHistory.id || ''),
      category_id: String(budgetHistory.category_id || ''),
      year_month: String(budgetHistory.year_month || ''),
      budget_amount: this._normalizeNumber(budgetHistory.budget_amount),
      deleted: budgetHistory.deleted ? '1' : '0',
    };

    return this._computeHash(criticalFields);
  }

  /**
   * Compute hash for goal transaction
   */
  static computeGoalTransactionHash(goalTransaction) {
    const criticalFields = {
      id: String(goalTransaction.id || ''),
      goal_id: String(goalTransaction.goal_id || ''),
      amount: this._normalizeNumber(goalTransaction.amount),
      type: String(goalTransaction.type || ''),
      date: String(goalTransaction.date || ''),
      note: String(goalTransaction.note || ''),
      deleted: goalTransaction.deleted ? '1' : '0',
    };

    return this._computeHash(criticalFields);
  }

  /**
   * Compute hash for recurring transaction
   */
  static computeRecurringTransactionHash(recurring) {
    const criticalFields = {
      id: String(recurring.id || ''),
      category_id: String(recurring.category_id || ''),
      amount: this._normalizeNumber(recurring.amount),
      description: String(recurring.description || ''),
      frequency: String(recurring.frequency || ''),
      start_date: String(recurring.start_date || ''),
      end_date: String(recurring.end_date || ''),
      is_active: recurring.is_active ? '1' : '0',
      deleted: recurring.deleted ? '1' : '0',
    };

    return this._computeHash(criticalFields);
  }

  /**
   * Compute hash for biller
   */
  static computeBillerHash(biller) {
    const criticalFields = {
      id: String(biller.id || ''),
      name: String(biller.name || ''),
      normalized_addresses: String(biller.normalized_addresses || ''),
      category_id: String(biller.category_id || ''),
      deleted: biller.deleted ? '1' : '0',
    };

    return this._computeHash(criticalFields);
  }

  /**
   * Normalize numeric values for consistent hashing
   * MUST match Android's _normalizeNumber
   */
  static _normalizeNumber(value) {
    if (value === null || value === undefined || value === '') return '0';

    const num = typeof value === 'number' ? value : parseFloat(value);

    if (isNaN(num)) return '0';

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
        `⚠️ Hash mismatch for ${tableName} record ${record.id}: ` +
        `stored=${storedHash}, computed=${computedHash}`
      );
    }

    return matches;
  }
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DataHashService;
}
```

**Add to index.html:**
```html
<script src="js/hash-service.js"></script>
```

---

### TASK 3: Update CRUD Operations (storage.js)

Update all functions that modify data to compute hashes:

**Example for adding a transaction:**
```javascript
async addTransaction(transaction) {
  // Compute hash before storing
  transaction.data_hash = await DataHashService.computeTransactionHash(transaction);
  transaction.updated_at = Date.now();

  await db.transactions.add(transaction);
}
```

**Update all CRUD functions:**
- `addTransaction`, `updateTransaction`
- `addCategory`, `updateCategory`
- `addSavingsGoal`, `updateSavingsGoal`
- `addBudgetHistory`, `updateBudgetHistory`
- `addGoalTransaction`, `updateGoalTransaction`
- `addRecurringTransaction`, `updateRecurringTransaction`
- `addBiller`, `updateBiller`

---

### TASK 4: Update Sync Logic (sync.js)

**Step 1: Ensure hashes before sending**

Add helper function to `sync.js`:
```javascript
/**
 * Ensure all records have hashes computed
 */
async function ensureHashesForRecords(tableName, records) {
  let hashesComputed = 0;

  for (const record of records) {
    // Skip if hash already exists
    if (record.data_hash) continue;

    // Compute hash
    const hash = await DataHashService.computeHashForEntity(tableName, record);
    if (hash) {
      record.data_hash = hash;
      hashesComputed++;

      // Update database
      const table = db[tableName];
      const idField = tableName === 'categories' ? 'ID' : 'id';
      await table.update(record[idField], { data_hash: hash });
    }
  }

  if (hashesComputed > 0) {
    console.log(`✅ Computed ${hashesComputed} hashes for ${tableName}`);
  }
}
```

**Step 2: Call before sending data**

In the sync function where you gather data to send:
```javascript
// Get changed data
const transactions = await db.transactions.where('updated_at').above(lastSyncTimestamp).toArray();
const categories = await db.categories.where('updated_at').above(lastSyncTimestamp).toArray();
// ... etc

// Ensure hashes are computed
await ensureHashesForRecords('transactions', transactions);
await ensureHashesForRecords('categories', categories);
await ensureHashesForRecords('savingsGoals', savingsGoals);
await ensureHashesForRecords('budgetHistory', budgetHistory);
await ensureHashesForRecords('goalTransactions', goalTransactions);
await ensureHashesForRecords('recurringTransactions', recurringTransactions);
await ensureHashesForRecords('billers', billers);

// Now send with hashes included
const syncData = {
  transactions,
  categories,
  savingsGoals,
  // ... etc
};
```

**Step 3: Verify incoming data**

When receiving data from Android, verify hashes:
```javascript
async function applyIncomingTransaction(transaction) {
  // Verify hash matches data
  const hashValid = await DataHashService.verifyRecordHash('transactions', transaction);

  if (!hashValid) {
    console.warn('⚠️ Hash mismatch for incoming transaction - data may be corrupted');
    // Still apply but log the issue
  }

  // Apply to database
  await db.transactions.put(transaction);
}
```

---

### TASK 5: Update WebRTC Handlers (webrtc.js)

In the bidirectional sync metadata exchange handler, ensure hashes are included:

```javascript
// When sending web changes to Android
const ourChanges = await incrementalSyncManager.getChangesSinceLastSync();

// Ensure hashes before sending
// (this should already be done in getChangesSinceLastSync, but verify)

await sendMessage({
  type: 'changes',
  data: ourChanges  // ourChanges should include data_hash for all records
});
```

---

## Testing Instructions

### Test 1: Verify Hash Computation

Create a test in browser console:
```javascript
// Test transaction hash
const testTxn = {
  id: 'test-123',
  amount: 50.00,
  categoryId: 'cat-1',
  description: 'Test',
  date: '2025-01-01',
  type: 'expense',
  merchantName: 'Test Store',
  deleted: false
};

const hash = await DataHashService.computeTransactionHash(testTxn);
console.log('Hash:', hash);
// Should produce consistent hash every time
```

### Test 2: Verify Hash Consistency

```javascript
// Same data should produce same hash
const hash1 = await DataHashService.computeTransactionHash(testTxn);
const hash2 = await DataHashService.computeTransactionHash(testTxn);
console.log('Hashes match:', hash1 === hash2); // Should be true
```

### Test 3: Full Sync Flow

1. Clear web app data (unpair)
2. Scan QR from Android app
3. Perform full sync
4. Verify in browser console:
```javascript
// Check transactions have hashes
const txns = await db.transactions.toArray();
console.log('Transactions with hashes:', txns.filter(t => t.data_hash).length);
console.log('Total transactions:', txns.length);
// Both numbers should match
```

### Test 4: Incremental Sync

1. Modify data on Android
2. Perform sync
3. Verify web receives data with hashes
4. Verify hash verification passes

---

## Important Notes

### Hash Consistency is Critical

The web and Android MUST produce identical hashes for the same data. Pay special attention to:

1. **Number formatting:** Always use `.toFixed(2)` for decimal numbers
2. **Boolean conversion:** Always convert to '1' or '0' strings
3. **Null handling:** Always convert null/undefined to empty string ''
4. **Field ordering:** Always sort keys alphabetically before hashing
5. **String conversion:** Always convert all values to strings

### Testing Hash Match with Android

To verify your web hashes match Android:
1. Create identical test record on both sides
2. Sync and compare hashes in logs
3. Hashes MUST be identical

Example:
```
Android hash: a1b2c3d4e5f6...
Web hash:     a1b2c3d4e5f6...
✅ MATCH!
```

If hashes don't match, debug field by field to find the discrepancy.

---

## Files to Modify

1. **js/storage.js**
   - Update Dexie schema to v2
   - Update all CRUD operations to compute hashes

2. **js/hash-service.js** (NEW)
   - Create this file with hash computation functions

3. **js/sync.js** or **js/incremental-sync-manager.js**
   - Add ensureHashesForRecords helper
   - Call it before sending data
   - Verify hashes when receiving data

4. **js/webrtc.js**
   - Ensure sync messages include hashes

5. **index.html**
   - Add `<script src="js/hash-service.js"></script>`

---

## Success Criteria

✅ Web app schema updated to v2 with data_hash fields
✅ Hash computation functions implemented matching Android
✅ All CRUD operations compute hashes
✅ Sync includes hashes in payload
✅ Incoming data is hash-verified
✅ Hashes match between web and Android for same data
✅ Full sync works with hash verification
✅ Incremental sync works with hash verification

---

## Questions or Issues?

If you encounter any problems:

1. Check browser console for errors
2. Verify hash functions match Android exactly
3. Test hash consistency with same input data
4. Ensure all records have hashes before syncing
5. Verify Dexie schema migration completed

Good luck with the implementation!
