# CRUD & Bidirectional Sync Implementation Guide

> **Version:** 1.0
> **Last Updated:** 2025-12-26
> **Status:** Implementation Ready

This document provides step-by-step instructions for implementing CRUD operations in the BudgetTact web-app with full bidirectional WebRTC synchronization to the Android app.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Architecture Overview](#architecture-overview)
3. [Phase 1: Storage Layer CRUD Methods](#phase-1-storage-layer-crud-methods)
4. [Phase 2: UI CRUD Components](#phase-2-ui-crud-components)
5. [Phase 3: Web-Side Sync Orchestration](#phase-3-web-side-sync-orchestration)
6. [Phase 4: Auto-Sync Enhancement](#phase-4-auto-sync-enhancement)
7. [Phase 5: Hash Verification Parity](#phase-5-hash-verification-parity)
8. [Phase 6: Conflict Notification UI](#phase-6-conflict-notification-ui)
9. [Testing Checklist](#testing-checklist)
10. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Knowledge
- JavaScript ES6+ (async/await, classes, modules)
- IndexedDB / Dexie.js
- WebRTC concepts
- CSS Grid/Flexbox

### Files to Review Before Starting
| File | Purpose |
|------|---------|
| `js/storage.js` | IndexedDB operations via Dexie |
| `js/incremental-sync-manager.js` | Change detection and application |
| `js/webrtc.js` | WebRTC connection management |
| `js/hash-service.js` | SHA-256 hash computation |
| `js/pairing-manager.js` | Device pairing state |
| `js/auto-sync-on-crud.js` | Current (incomplete) auto-sync |

### Android Reference Files
| File | Purpose |
|------|---------|
| `lib/services/bidirectional_sync_service.dart` | Sync orchestration (lines 26-117) |
| `lib/services/incremental_sync_service.dart` | Change application with conflict resolution |
| `lib/services/data_hash_service.dart` | Hash computation (must match web) |

---

## Architecture Overview

### Current State
```
Android ────────────────────────────→ Web (Read-Only)
         Full sync via WebRTC
         Incremental sync supported
```

### Target State
```
Android ←───────────────────────────→ Web (Full CRUD)
         Bidirectional sync
         Conflict resolution
         Offline queue
```

### Sync Message Flow (Android's Expected Order)

```
┌─────────────┐                              ┌─────────────┐
│   ANDROID   │                              │     WEB     │
└──────┬──────┘                              └──────┬──────┘
       │                                            │
       │──── (1) WebRTC Connection ────────────────→│
       │                                            │
       │──── (2) Send Android metadata ────────────→│
       │                                            │
       │←─── (3) Receive web metadata ─────────────│
       │                                            │
       │←─── (4) Receive web changes ──────────────│ ★ Web sends FIRST
       │                                            │
       │     [Apply web changes locally]            │
       │                                            │
       │──── (5) Send Android changes ─────────────→│ ★ Then Android sends
       │                                            │
       │     [Wait for ack]                         │ [Apply Android changes]
       │                                            │
       │←─── (6) Receive syncComplete ─────────────│
       │                                            │
       │     [Record sync completion]               │
       ▼                                            ▼
```

---

## Phase 1: Storage Layer CRUD Methods

### Objective
Add create, update, and delete methods to `js/storage.js` that properly set sync metadata and trigger auto-sync.

### File: `js/storage.js`

#### 1.1 Add UUID Generator (after line ~20, near top of file)

```javascript
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
```

#### 1.2 Add Transaction CRUD Methods (inside Storage object)

```javascript
/**
 * Create a new transaction
 * @param {Object} data - Transaction data (without ID or sync metadata)
 * @returns {Promise<Object>} Created transaction with all fields
 */
async createTransaction(data) {
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
    currency: data.currency || (await this.getMetadata('currency')) || 'USD',
    billerName: data.billerName || null,
    ...generateSyncMetadata(true),
    data_hash: null
  };

  // Compute hash
  if (typeof DataHashService !== 'undefined') {
    transaction.data_hash = await DataHashService.computeTransactionHash(transaction);
  }

  await this.db.transactions.put(transaction);

  // Queue for sync
  if (typeof autoSyncCRUD !== 'undefined') {
    autoSyncCRUD.recordChange('transactions', 'insert', transaction);
  }

  // Dispatch event for UI update
  window.dispatchEvent(new CustomEvent('data-updated', { detail: { type: 'transaction-created' } }));

  console.log('✅ Created transaction:', transaction.transactionID);
  return transaction;
},

/**
 * Update an existing transaction
 * @param {string} transactionID - ID of transaction to update
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} Updated transaction
 */
async updateTransaction(transactionID, updates) {
  const existing = await this.db.transactions.get(transactionID);
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

  await this.db.transactions.put(updated);

  // Queue for sync
  if (typeof autoSyncCRUD !== 'undefined') {
    autoSyncCRUD.recordChange('transactions', 'update', updated);
  }

  window.dispatchEvent(new CustomEvent('data-updated', { detail: { type: 'transaction-updated' } }));

  console.log('✅ Updated transaction:', transactionID);
  return updated;
},

/**
 * Soft delete a transaction
 * @param {string} transactionID - ID of transaction to delete
 * @returns {Promise<void>}
 */
async deleteTransaction(transactionID) {
  const existing = await this.db.transactions.get(transactionID);
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

  await this.db.transactions.put(deleted);

  // Queue for sync
  if (typeof autoSyncCRUD !== 'undefined') {
    autoSyncCRUD.recordChange('transactions', 'delete', deleted);
  }

  window.dispatchEvent(new CustomEvent('data-updated', { detail: { type: 'transaction-deleted' } }));

  console.log('🗑️ Soft deleted transaction:', transactionID);
},
```

#### 1.3 Add Category CRUD Methods

```javascript
/**
 * Create a new category
 * @param {Object} data - Category data
 * @returns {Promise<Object>} Created category
 */
async createCategory(data) {
  if (!data.categoryType || data.categoryType.trim() === '') {
    throw new Error('Category name is required');
  }

  // Get next ID (categories use auto-increment integers)
  const allCategories = await this.db.categories.toArray();
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

  await this.db.categories.put(category);

  if (typeof autoSyncCRUD !== 'undefined') {
    autoSyncCRUD.recordChange('categories', 'insert', category);
  }

  window.dispatchEvent(new CustomEvent('data-updated', { detail: { type: 'category-created' } }));

  console.log('✅ Created category:', category.id, category.categoryType);
  return category;
},

/**
 * Update a category
 * @param {number} id - Category ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} Updated category
 */
async updateCategory(id, updates) {
  const existing = await this.db.categories.get(id);
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

  await this.db.categories.put(updated);

  if (typeof autoSyncCRUD !== 'undefined') {
    autoSyncCRUD.recordChange('categories', 'update', updated);
  }

  window.dispatchEvent(new CustomEvent('data-updated', { detail: { type: 'category-updated' } }));

  console.log('✅ Updated category:', id);
  return updated;
},

/**
 * Delete a category (with validation)
 * @param {number} id - Category ID
 * @returns {Promise<void>}
 */
async deleteCategory(id) {
  // Check for active transactions using this category
  const transactionCount = await this.db.transactions
    .where('transactionCategory')
    .equals(id)
    .filter(t => !t.deleted)
    .count();

  if (transactionCount > 0) {
    throw new Error(`Cannot delete category: ${transactionCount} active transaction(s) use this category`);
  }

  const existing = await this.db.categories.get(id);
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

  await this.db.categories.put(deleted);

  if (typeof autoSyncCRUD !== 'undefined') {
    autoSyncCRUD.recordChange('categories', 'delete', deleted);
  }

  window.dispatchEvent(new CustomEvent('data-updated', { detail: { type: 'category-deleted' } }));

  console.log('🗑️ Soft deleted category:', id);
},
```

#### 1.4 Add Savings Goal CRUD Methods

```javascript
/**
 * Create a new savings goal
 * @param {Object} data - Goal data
 * @returns {Promise<Object>} Created goal
 */
async createSavingsGoal(data) {
  if (!data.goalName || data.goalName.trim() === '') {
    throw new Error('Goal name is required');
  }
  if (!data.targetAmount || data.targetAmount <= 0) {
    throw new Error('Target amount must be greater than 0');
  }

  const allGoals = await this.db.savingsGoals.toArray();
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

  await this.db.savingsGoals.put(goal);

  if (typeof autoSyncCRUD !== 'undefined') {
    autoSyncCRUD.recordChange('savingsGoals', 'insert', goal);
  }

  window.dispatchEvent(new CustomEvent('data-updated', { detail: { type: 'goal-created' } }));

  console.log('✅ Created savings goal:', goal.id, goal.goalName);
  return goal;
},

/**
 * Update a savings goal
 * @param {number} id - Goal ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} Updated goal
 */
async updateSavingsGoal(id, updates) {
  const existing = await this.db.savingsGoals.get(id);
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

  await this.db.savingsGoals.put(updated);

  if (typeof autoSyncCRUD !== 'undefined') {
    autoSyncCRUD.recordChange('savingsGoals', 'update', updated);
  }

  window.dispatchEvent(new CustomEvent('data-updated', { detail: { type: 'goal-updated' } }));

  console.log('✅ Updated savings goal:', id);
  return updated;
},

/**
 * Delete a savings goal
 * @param {number} id - Goal ID
 * @returns {Promise<void>}
 */
async deleteSavingsGoal(id) {
  const existing = await this.db.savingsGoals.get(id);
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

  await this.db.savingsGoals.put(deleted);

  if (typeof autoSyncCRUD !== 'undefined') {
    autoSyncCRUD.recordChange('savingsGoals', 'delete', deleted);
  }

  window.dispatchEvent(new CustomEvent('data-updated', { detail: { type: 'goal-deleted' } }));

  console.log('🗑️ Soft deleted savings goal:', id);
},
```

#### 1.5 Add Goal Transaction Methods

```javascript
/**
 * Add a contribution or withdrawal to a goal
 * @param {Object} data - Goal transaction data
 * @returns {Promise<Object>} Created goal transaction
 */
async createGoalTransaction(data) {
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
  const goal = await this.db.savingsGoals.get(data.goalId);
  if (!goal) {
    throw new Error(`Savings goal not found: ${data.goalId}`);
  }

  const allGoalTxns = await this.db.goalTransactions.toArray();
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

  await this.db.transaction('rw', [this.db.goalTransactions, this.db.savingsGoals], async () => {
    await this.db.goalTransactions.put(goalTransaction);
    await this.updateSavingsGoal(data.goalId, { currentAmount: newCurrentAmount });
  });

  if (typeof autoSyncCRUD !== 'undefined') {
    autoSyncCRUD.recordChange('goalTransactions', 'insert', goalTransaction);
  }

  window.dispatchEvent(new CustomEvent('data-updated', { detail: { type: 'goal-transaction-created' } }));

  console.log('✅ Created goal transaction:', goalTransaction.id);
  return goalTransaction;
},

/**
 * Delete a goal transaction
 * @param {number} id - Goal transaction ID
 * @returns {Promise<void>}
 */
async deleteGoalTransaction(id) {
  const existing = await this.db.goalTransactions.get(id);
  if (!existing) {
    console.warn('Goal transaction not found for deletion:', id);
    return;
  }

  // Revert the goal's currentAmount
  const goal = await this.db.savingsGoals.get(existing.goalId);
  if (goal) {
    const amountDelta = existing.transactionType === 'contribution' ? -existing.amount : existing.amount;
    const newCurrentAmount = Math.max(0, (goal.currentAmount || 0) + amountDelta);
    await this.updateSavingsGoal(existing.goalId, { currentAmount: newCurrentAmount });
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

  await this.db.goalTransactions.put(deleted);

  if (typeof autoSyncCRUD !== 'undefined') {
    autoSyncCRUD.recordChange('goalTransactions', 'delete', deleted);
  }

  window.dispatchEvent(new CustomEvent('data-updated', { detail: { type: 'goal-transaction-deleted' } }));

  console.log('🗑️ Soft deleted goal transaction:', id);
},
```

#### 1.6 Add Generic Upsert Helper (for sync operations)

```javascript
/**
 * Upsert a record (used by sync, bypasses auto-sync queue)
 * @param {string} storeName - Table name
 * @param {Object} record - Record to upsert
 * @param {Object} options - Options { queue: false to skip sync queue }
 */
async upsertRecord(storeName, record, options = {}) {
  const table = this.db.table(storeName);
  await table.put(record);

  if (options.queue !== false && typeof autoSyncCRUD !== 'undefined') {
    autoSyncCRUD.recordChange(storeName, 'upsert', record);
  }
},
```

### Phase 1 Verification

After implementing Phase 1, verify with browser console:

```javascript
// Test transaction creation
const txn = await Storage.createTransaction({
  merchantName: 'Test Store',
  transactionDate: new Date().toISOString(),
  transactionType: 'expense',
  transactionAmount: 25.50,
  transactionCategory: 1
});
console.log('Created:', txn);

// Test update
const updated = await Storage.updateTransaction(txn.transactionID, { transactionAmount: 30.00 });
console.log('Updated:', updated);

// Test delete
await Storage.deleteTransaction(txn.transactionID);
const deleted = await Storage.db.transactions.get(txn.transactionID);
console.log('Deleted flag:', deleted.deleted); // Should be true
```

---

## Phase 2: UI CRUD Components

### Objective
Add user interface components for creating, editing, and deleting transactions, categories, and goals.

### 2.1 Create New File: `js/modals.js`

```javascript
/**
 * Modal Management System
 * Provides reusable modal dialogs for CRUD operations
 */
const Modals = (() => {
  let activeModal = null;

  /**
   * Create and show a modal
   * @param {Object} config - Modal configuration
   * @returns {HTMLElement} Modal element
   */
  function show(config) {
    // Close any existing modal
    if (activeModal) {
      close();
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.onclick = (e) => {
      if (e.target === overlay) close();
    };

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-header">
        <h2>${config.title}</h2>
        <button class="modal-close" onclick="Modals.close()">&times;</button>
      </div>
      <div class="modal-body">
        ${config.body}
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Modals.close()">Cancel</button>
        <button class="btn btn-primary" id="modal-submit">${config.submitText || 'Save'}</button>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    activeModal = overlay;

    // Focus first input
    const firstInput = modal.querySelector('input, select, textarea');
    if (firstInput) firstInput.focus();

    // Bind submit handler
    const submitBtn = modal.querySelector('#modal-submit');
    submitBtn.onclick = async () => {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Saving...';
      try {
        await config.onSubmit();
        close();
      } catch (error) {
        console.error('Modal submit error:', error);
        alert(error.message || 'An error occurred');
        submitBtn.disabled = false;
        submitBtn.textContent = config.submitText || 'Save';
      }
    };

    // Handle Enter key
    modal.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        submitBtn.click();
      }
      if (e.key === 'Escape') {
        close();
      }
    });

    return modal;
  }

  /**
   * Close the active modal
   */
  function close() {
    if (activeModal) {
      activeModal.classList.add('modal-closing');
      setTimeout(() => {
        activeModal.remove();
        activeModal = null;
      }, 200);
    }
  }

  /**
   * Show confirmation dialog
   * @param {string} message - Confirmation message
   * @param {Function} onConfirm - Callback on confirm
   */
  function confirm(message, onConfirm) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'modal modal-confirm';
    modal.innerHTML = `
      <div class="modal-body">
        <p>${message}</p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
        <button class="btn btn-danger" id="confirm-btn">Delete</button>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    modal.querySelector('#confirm-btn').onclick = async () => {
      await onConfirm();
      overlay.remove();
    };
  }

  return { show, close, confirm };
})();
```

### 2.2 Create New File: `js/crud-ui.js`

```javascript
/**
 * CRUD UI Components
 * Handles UI interactions for creating, editing, and deleting records
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
    const currency = await Storage.getMetadata('currency') || 'USD';

    const categoryOptions = categories
      .map(c => `<option value="${c.id}">${c.categoryType}</option>`)
      .join('');

    const billerOptions = billers
      .map(b => `<option value="${b.billerName}">${b.billerName}</option>`)
      .join('');

    Modals.show({
      title: 'Add Transaction',
      body: `
        <form id="transaction-form" class="crud-form">
          <div class="form-group">
            <label>Type</label>
            <div class="radio-group">
              <label class="radio-label">
                <input type="radio" name="transactionType" value="expense" checked>
                <span class="radio-text expense">Expense</span>
              </label>
              <label class="radio-label">
                <input type="radio" name="transactionType" value="income">
                <span class="radio-text income">Income</span>
              </label>
            </div>
          </div>

          <div class="form-group">
            <label for="amount">Amount (${currency})</label>
            <input type="number" id="amount" step="0.01" min="0.01" required placeholder="0.00">
          </div>

          <div class="form-group">
            <label for="merchant">Merchant/Description</label>
            <input type="text" id="merchant" required placeholder="e.g., Grocery Store">
          </div>

          <div class="form-group">
            <label for="category">Category</label>
            <select id="category" required>
              <option value="">Select category...</option>
              ${categoryOptions}
            </select>
          </div>

          <div class="form-group">
            <label for="date">Date</label>
            <input type="datetime-local" id="date" required value="${new Date().toISOString().slice(0, 16)}">
          </div>

          <div class="form-group">
            <label for="biller">Biller (optional)</label>
            <select id="biller">
              <option value="">None</option>
              ${billerOptions}
            </select>
          </div>
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
          transactionDate: new Date(document.getElementById('date').value).toISOString(),
          billerName: document.getElementById('biller').value || null
        };

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
      alert('Transaction not found');
      return;
    }

    const categories = await Storage.getActiveCategories();
    const billers = await Storage.getAllBillers();
    const currency = await Storage.getMetadata('currency') || 'USD';

    const categoryOptions = categories
      .map(c => `<option value="${c.id}" ${c.id === transaction.transactionCategory ? 'selected' : ''}>${c.categoryType}</option>`)
      .join('');

    const billerOptions = billers
      .map(b => `<option value="${b.billerName}" ${b.billerName === transaction.billerName ? 'selected' : ''}>${b.billerName}</option>`)
      .join('');

    const dateValue = new Date(transaction.transactionDate).toISOString().slice(0, 16);

    Modals.show({
      title: 'Edit Transaction',
      body: `
        <form id="transaction-form" class="crud-form">
          <div class="form-group">
            <label>Type</label>
            <div class="radio-group">
              <label class="radio-label">
                <input type="radio" name="transactionType" value="expense" ${transaction.transactionType === 'expense' ? 'checked' : ''}>
                <span class="radio-text expense">Expense</span>
              </label>
              <label class="radio-label">
                <input type="radio" name="transactionType" value="income" ${transaction.transactionType === 'income' ? 'checked' : ''}>
                <span class="radio-text income">Income</span>
              </label>
            </div>
          </div>

          <div class="form-group">
            <label for="amount">Amount (${currency})</label>
            <input type="number" id="amount" step="0.01" min="0.01" required value="${transaction.transactionAmount}">
          </div>

          <div class="form-group">
            <label for="merchant">Merchant/Description</label>
            <input type="text" id="merchant" required value="${transaction.merchantName || ''}">
          </div>

          <div class="form-group">
            <label for="category">Category</label>
            <select id="category" required>
              ${categoryOptions}
            </select>
          </div>

          <div class="form-group">
            <label for="date">Date</label>
            <input type="datetime-local" id="date" required value="${dateValue}">
          </div>

          <div class="form-group">
            <label for="biller">Biller (optional)</label>
            <select id="biller">
              <option value="">None</option>
              ${billerOptions}
            </select>
          </div>
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
          transactionDate: new Date(document.getElementById('date').value).toISOString(),
          billerName: document.getElementById('biller').value || null
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
      'Are you sure you want to delete this transaction?',
      async () => {
        await Storage.deleteTransaction(transactionID);
      }
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
      'groceries', 'dining', 'transport', 'utilities', 'entertainment',
      'shopping', 'health', 'education', 'travel', 'savings', 'default'
    ].map(icon => `<option value="${icon}">${icon}</option>`).join('');

    Modals.show({
      title: 'Add Category',
      body: `
        <form id="category-form" class="crud-form">
          <div class="form-group">
            <label for="categoryName">Category Name</label>
            <input type="text" id="categoryName" required placeholder="e.g., Groceries">
          </div>

          <div class="form-group">
            <label for="budgetAmount">Monthly Budget</label>
            <input type="number" id="budgetAmount" step="0.01" min="0" value="0" placeholder="0.00">
          </div>

          <div class="form-group">
            <label for="iconName">Icon</label>
            <select id="iconName">
              ${iconOptions}
            </select>
          </div>

          <div class="form-group">
            <label for="colorCode">Color (optional)</label>
            <input type="color" id="colorCode" value="#4A90A4">
          </div>

          <div class="form-group checkbox-group">
            <label>
              <input type="checkbox" id="autoPropagateToNextMonth" checked>
              Auto-propagate budget to next month
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
      alert('Category not found');
      return;
    }

    const iconOptions = [
      'groceries', 'dining', 'transport', 'utilities', 'entertainment',
      'shopping', 'health', 'education', 'travel', 'savings', 'default'
    ].map(icon => `<option value="${icon}" ${icon === category.iconName ? 'selected' : ''}>${icon}</option>`).join('');

    Modals.show({
      title: 'Edit Category',
      body: `
        <form id="category-form" class="crud-form">
          <div class="form-group">
            <label for="categoryName">Category Name</label>
            <input type="text" id="categoryName" required value="${category.categoryType}">
          </div>

          <div class="form-group">
            <label for="budgetAmount">Monthly Budget</label>
            <input type="number" id="budgetAmount" step="0.01" min="0" value="${category.budgetAmount || 0}">
          </div>

          <div class="form-group">
            <label for="iconName">Icon</label>
            <select id="iconName">
              ${iconOptions}
            </select>
          </div>

          <div class="form-group">
            <label for="colorCode">Color</label>
            <input type="color" id="colorCode" value="${category.colorCode || '#4A90A4'}">
          </div>

          <div class="form-group checkbox-group">
            <label>
              <input type="checkbox" id="autoPropagateToNextMonth" ${category.autoPropagateToNextMonth ? 'checked' : ''}>
              Auto-propagate budget to next month
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
      'Are you sure you want to delete this category? This cannot be undone.',
      async () => {
        try {
          await Storage.deleteCategory(categoryId);
        } catch (error) {
          alert(error.message);
        }
      }
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
        alert('Please enter a valid positive number');
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
            <input type="text" id="goalName" required placeholder="e.g., Emergency Fund">
          </div>

          <div class="form-group">
            <label for="targetAmount">Target Amount</label>
            <input type="number" id="targetAmount" step="0.01" min="0.01" required placeholder="0.00">
          </div>

          <div class="form-group">
            <label for="currentAmount">Current Amount (optional)</label>
            <input type="number" id="currentAmount" step="0.01" min="0" value="0" placeholder="0.00">
          </div>

          <div class="form-group">
            <label for="category">Category</label>
            <select id="category">
              ${categoryOptions}
            </select>
          </div>

          <div class="form-group">
            <label for="priority">Priority</label>
            <select id="priority">
              <option value="high">High</option>
              <option value="medium" selected>Medium</option>
              <option value="low">Low</option>
            </select>
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
      alert('Goal not found');
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

          <div class="form-group">
            <label for="category">Category</label>
            <select id="category">
              ${categoryOptions}
            </select>
          </div>

          <div class="form-group">
            <label for="priority">Priority</label>
            <select id="priority">
              <option value="high" ${goal.priority === 'high' ? 'selected' : ''}>High</option>
              <option value="medium" ${goal.priority === 'medium' ? 'selected' : ''}>Medium</option>
              <option value="low" ${goal.priority === 'low' ? 'selected' : ''}>Low</option>
            </select>
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
            <label>
              <input type="checkbox" id="isActive" ${goal.isActive ? 'checked' : ''}>
              Goal is active
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
              <label class="radio-label">
                <input type="radio" name="txnType" value="contribution" checked>
                <span class="radio-text income">Contribution</span>
              </label>
              <label class="radio-label">
                <input type="radio" name="txnType" value="withdrawal">
                <span class="radio-text expense">Withdrawal</span>
              </label>
            </div>
          </div>

          <div class="form-group">
            <label for="amount">Amount</label>
            <input type="number" id="amount" step="0.01" min="0.01" required placeholder="0.00">
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
      'Are you sure you want to delete this savings goal?',
      async () => {
        await Storage.deleteSavingsGoal(goalId);
      }
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
```

### 2.3 Add Modal Styles to `css/styles.css`

Add at end of file:

```css
/* ============================================
   MODAL STYLES
   ============================================ */

.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: fadeIn 0.2s ease;
}

.modal-overlay.modal-closing {
  animation: fadeOut 0.2s ease;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes fadeOut {
  from { opacity: 1; }
  to { opacity: 0; }
}

.modal {
  background: var(--card-bg);
  border-radius: 12px;
  width: 90%;
  max-width: 480px;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  animation: slideUp 0.2s ease;
}

@keyframes slideUp {
  from { transform: translateY(20px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--border-color);
}

.modal-header h2 {
  margin: 0;
  font-size: 1.25rem;
  color: var(--text-primary);
}

.modal-close {
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  color: var(--text-secondary);
  padding: 0.25rem;
  line-height: 1;
}

.modal-close:hover {
  color: var(--text-primary);
}

.modal-body {
  padding: 1.25rem;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 1rem 1.25rem;
  border-top: 1px solid var(--border-color);
}

.modal-confirm .modal-body {
  text-align: center;
  padding: 2rem 1.5rem;
}

.modal-confirm .modal-body p {
  margin: 0;
  font-size: 1rem;
  color: var(--text-primary);
}

/* Form Styles */
.crud-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.form-group label {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-secondary);
}

.form-group input,
.form-group select,
.form-group textarea {
  padding: 0.625rem 0.75rem;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  font-size: 1rem;
  background: var(--input-bg, var(--bg-primary));
  color: var(--text-primary);
  transition: border-color 0.2s, box-shadow 0.2s;
}

.form-group input:focus,
.form-group select:focus,
.form-group textarea:focus {
  outline: none;
  border-color: var(--accent-color);
  box-shadow: 0 0 0 3px rgba(74, 144, 164, 0.15);
}

.form-group input[type="color"] {
  height: 40px;
  padding: 0.25rem;
  cursor: pointer;
}

.radio-group {
  display: flex;
  gap: 1rem;
}

.radio-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
}

.radio-label input[type="radio"] {
  margin: 0;
}

.radio-text {
  font-size: 0.9375rem;
  font-weight: 500;
}

.radio-text.expense {
  color: var(--expense-color, #e74c3c);
}

.radio-text.income {
  color: var(--income-color, #27ae60);
}

.checkbox-group label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  font-size: 0.9375rem;
  color: var(--text-primary);
}

.checkbox-group input[type="checkbox"] {
  width: 18px;
  height: 18px;
  cursor: pointer;
}

/* Buttons */
.btn {
  padding: 0.625rem 1.25rem;
  border-radius: 6px;
  font-size: 0.9375rem;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: background-color 0.2s, transform 0.1s;
}

.btn:active {
  transform: scale(0.98);
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-primary {
  background: var(--accent-color);
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: var(--accent-hover, #3d7a8a);
}

.btn-secondary {
  background: var(--bg-secondary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--bg-tertiary, #e0e0e0);
}

.btn-danger {
  background: var(--expense-color, #e74c3c);
  color: white;
}

.btn-danger:hover:not(:disabled) {
  background: #c0392b;
}

/* Floating Action Button */
.fab {
  position: fixed;
  bottom: 2rem;
  right: 2rem;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--accent-color);
  color: white;
  border: none;
  font-size: 1.75rem;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  transition: transform 0.2s, box-shadow 0.2s;
  z-index: 100;
}

.fab:hover {
  transform: scale(1.05);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.25);
}

.fab:active {
  transform: scale(0.95);
}

/* Action Buttons in Lists */
.row-actions {
  display: flex;
  gap: 0.5rem;
  opacity: 0;
  transition: opacity 0.2s;
}

.transaction-item:hover .row-actions,
.category-card:hover .row-actions,
.goal-card:hover .row-actions {
  opacity: 1;
}

.action-btn {
  padding: 0.375rem 0.5rem;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.875rem;
  transition: background-color 0.2s;
}

.action-btn:hover {
  background: var(--bg-tertiary, #e0e0e0);
}

.action-btn.delete:hover {
  background: var(--expense-color, #e74c3c);
  color: white;
  border-color: transparent;
}

/* Mobile Adjustments */
@media (max-width: 600px) {
  .modal {
    width: 95%;
    max-height: 85vh;
  }

  .fab {
    bottom: 1.5rem;
    right: 1.5rem;
    width: 52px;
    height: 52px;
    font-size: 1.5rem;
  }

  .row-actions {
    opacity: 1;
  }
}
```

### 2.4 Update `index.html`

Add new script tags before closing `</body>`:

```html
<!-- CRUD Components -->
<script src="js/modals.js"></script>
<script src="js/crud-ui.js"></script>
```

### 2.5 Update `js/ui.js` - Add Action Buttons

#### 2.5.1 Add FAB to Dashboard/Transactions View

In `renderDashboard()` or main content area, add:

```javascript
// At end of dashboard render
const fab = document.createElement('button');
fab.className = 'fab';
fab.innerHTML = '+';
fab.title = 'Add Transaction';
fab.onclick = () => CrudUI.showAddTransactionModal();
document.querySelector('.main-content').appendChild(fab);
```

#### 2.5.2 Modify Transaction Row Rendering

Update the transaction item template to include action buttons:

```javascript
// In renderTransactionItem() or equivalent
function renderTransactionItem(transaction) {
  return `
    <div class="transaction-item" data-id="${transaction.transactionID}">
      <div class="transaction-info">
        <span class="merchant">${transaction.merchantName || 'Unknown'}</span>
        <span class="category">${getCategoryName(transaction.transactionCategory)}</span>
        <span class="date">${formatDate(transaction.transactionDate)}</span>
      </div>
      <div class="transaction-amount ${transaction.transactionType}">
        ${transaction.transactionType === 'expense' ? '-' : '+'}${formatCurrency(transaction.transactionAmount)}
      </div>
      <div class="row-actions">
        <button class="action-btn edit" onclick="CrudUI.showEditTransactionModal('${transaction.transactionID}')" title="Edit">
          ✏️
        </button>
        <button class="action-btn delete" onclick="CrudUI.deleteTransaction('${transaction.transactionID}')" title="Delete">
          🗑️
        </button>
      </div>
    </div>
  `;
}
```

#### 2.5.3 Modify Category Card Rendering

```javascript
function renderCategoryCard(category, spent) {
  const percentage = category.budgetAmount > 0 ?
    Math.min(100, (spent / category.budgetAmount) * 100) : 0;

  return `
    <div class="category-card" data-id="${category.id}">
      <div class="category-header">
        <span class="category-icon">${getCategoryIcon(category.iconName)}</span>
        <span class="category-name">${category.categoryType}</span>
        <div class="row-actions">
          <button class="action-btn edit" onclick="CrudUI.showEditCategoryModal(${category.id})" title="Edit">
            ✏️
          </button>
          <button class="action-btn delete" onclick="CrudUI.deleteCategory(${category.id})" title="Delete">
            🗑️
          </button>
        </div>
      </div>
      <div class="category-budget" onclick="CrudUI.quickEditBudget(${category.id}, ${category.budgetAmount})">
        Budget: ${formatCurrency(category.budgetAmount)} ✏️
      </div>
      <div class="category-spent">Spent: ${formatCurrency(spent)}</div>
      <div class="progress-bar">
        <div class="progress-fill" style="width: ${percentage}%"></div>
      </div>
    </div>
  `;
}
```

#### 2.5.4 Modify Goal Card Rendering

```javascript
function renderGoalCard(goal) {
  const percentage = goal.targetAmount > 0 ?
    Math.min(100, (goal.currentAmount / goal.targetAmount) * 100) : 0;

  return `
    <div class="goal-card" data-id="${goal.id}">
      <div class="goal-header">
        <span class="goal-name">${goal.goalName}</span>
        <span class="goal-priority ${goal.priority}">${goal.priority}</span>
        <div class="row-actions">
          <button class="action-btn" onclick="CrudUI.showAddGoalTransactionModal(${goal.id}, '${goal.goalName}')" title="Add">
            💰
          </button>
          <button class="action-btn edit" onclick="CrudUI.showEditGoalModal(${goal.id})" title="Edit">
            ✏️
          </button>
          <button class="action-btn delete" onclick="CrudUI.deleteGoal(${goal.id})" title="Delete">
            🗑️
          </button>
        </div>
      </div>
      <div class="goal-amounts">
        ${formatCurrency(goal.currentAmount)} / ${formatCurrency(goal.targetAmount)}
      </div>
      <div class="progress-bar">
        <div class="progress-fill" style="width: ${percentage}%"></div>
      </div>
      ${goal.targetDate ? `<div class="goal-deadline">Target: ${formatDate(goal.targetDate)}</div>` : ''}
    </div>
  `;
}
```

### Phase 2 Verification

1. Open the web app
2. Click the + FAB button → Add Transaction modal should appear
3. Fill form and save → Transaction should appear in list
4. Hover over transaction → Edit and delete buttons should appear
5. Click edit → Edit modal with pre-filled data should appear
6. Click delete → Confirmation dialog should appear
7. Repeat for categories and goals

---

## Phase 3: Web-Side Sync Orchestration

### Objective
Ensure the web app sends and receives data in the order Android expects.

### 3.1 Create New File: `js/bidirectional-sync.js`

```javascript
/**
 * Bidirectional Sync Orchestration
 * Matches Android's expected sync flow from bidirectional_sync_service.dart
 */
const BidirectionalSync = (() => {
  let syncInProgress = false;

  /**
   * Perform full bidirectional sync
   * Called when WebRTC connection is established
   */
  async function performSync() {
    if (syncInProgress) {
      console.log('⚠️ Sync already in progress');
      return { success: false, message: 'Sync already in progress' };
    }

    syncInProgress = true;
    console.log('🔄 Starting bidirectional sync...');

    try {
      // Step 1: Connection already established by WebRTCSync

      // Step 2: Send web metadata
      console.log('📤 Step 2: Sending web metadata...');
      const webMetadata = {
        type: 'metadata',
        deviceId: 'web',
        deviceName: PairingManager.getDeviceName() || 'Web Browser',
        lastSyncTimestamp: PairingManager.getLastSyncTime() || 0,
        conflictStrategy: PairingManager.getConflictStrategy() || 'newerWins',
        platform: 'web'
      };
      WebRTCSync.send(JSON.stringify(webMetadata));

      // Step 3: Wait for Android metadata
      console.log('📥 Step 3: Waiting for Android metadata...');
      const androidMetadata = await waitForMessage('metadata', 10000);
      console.log('📱 Received Android metadata:', androidMetadata);

      // Determine if full or incremental sync needed
      const lastPairedPeerId = PairingManager.getPairedDevice()?.deviceId;
      const isNewPairing = !lastPairedPeerId || lastPairedPeerId !== androidMetadata.deviceId;

      if (isNewPairing) {
        console.log('🆕 New pairing detected - performing full sync');
      }

      // Step 4: Send web changes FIRST (Android expects this)
      console.log('📤 Step 4: Sending web changes...');
      const webChanges = await incrementalSyncManager.getChangesSinceLastSync();
      const changesMessage = {
        type: 'changes',
        ...webChanges,
        deviceId: 'web',
        timestamp: Date.now()
      };
      WebRTCSync.send(JSON.stringify(changesMessage));
      console.log(`📤 Sent ${countChanges(webChanges)} web changes`);

      // Step 5: Wait for Android to apply our changes and send theirs
      console.log('📥 Step 5: Waiting for Android changes...');
      const androidChanges = await waitForMessage('syncData', 30000);
      console.log(`📥 Received ${countChanges(androidChanges)} Android changes`);

      // Step 6: Apply Android changes locally
      console.log('🔧 Step 6: Applying Android changes...');
      const strategy = PairingManager.getConflictStrategy() || 'newerWins';
      const applyResult = await incrementalSyncManager.applyIncomingChanges(
        androidChanges,
        strategy
      );
      console.log(`✅ Applied: ${applyResult.applied}, Conflicts: ${applyResult.conflicts}`);

      // Show conflict notification if any
      if (applyResult.conflictDetails && applyResult.conflictDetails.length > 0) {
        if (typeof ConflictNotification !== 'undefined') {
          ConflictNotification.show(applyResult.conflictDetails);
        }
      }

      // Step 7: Send syncComplete acknowledgment
      console.log('📤 Step 7: Sending syncComplete...');
      WebRTCSync.send(JSON.stringify({ type: 'syncComplete' }));

      // Step 8: Update pairing info
      PairingManager.updateLastSync();
      if (androidMetadata.deviceId) {
        PairingManager.savePairing({
          deviceId: androidMetadata.deviceId,
          deviceName: androidMetadata.deviceName || 'Android Device',
          pairedAt: Date.now()
        });
      }

      console.log('✅ Bidirectional sync completed successfully');

      // Refresh UI
      window.dispatchEvent(new CustomEvent('data-updated', {
        detail: { type: 'sync-completed' }
      }));

      return {
        success: true,
        stats: {
          webChangesSent: countChanges(webChanges),
          androidChangesReceived: countChanges(androidChanges),
          applied: applyResult.applied,
          conflicts: applyResult.conflicts
        }
      };

    } catch (error) {
      console.error('❌ Bidirectional sync failed:', error);
      return {
        success: false,
        message: error.message || 'Sync failed'
      };
    } finally {
      syncInProgress = false;
    }
  }

  /**
   * Wait for a specific message type
   * @param {string} type - Message type to wait for
   * @param {number} timeout - Timeout in milliseconds
   * @returns {Promise<Object>} Message data
   */
  function waitForMessage(type, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout waiting for ${type} message`));
      }, timeout);

      const handler = (data) => {
        try {
          const message = typeof data === 'string' ? JSON.parse(data) : data;

          // Handle different message type formats
          const messageType = message.type ||
            (message.transactions !== undefined ? 'syncData' : null);

          if (messageType === type ||
              (type === 'syncData' && message.transactions !== undefined)) {
            cleanup();
            resolve(message);
          }
        } catch (e) {
          console.error('Error parsing message:', e);
        }
      };

      const cleanup = () => {
        clearTimeout(timeoutId);
        WebRTCSync.offData(handler);
      };

      WebRTCSync.onData(handler);
    });
  }

  /**
   * Count total changes in a change set
   */
  function countChanges(changes) {
    if (!changes) return 0;
    return (changes.transactions?.length || 0) +
           (changes.categories?.length || 0) +
           (changes.savingsGoals?.length || 0) +
           (changes.budgetHistory?.length || 0) +
           (changes.goalTransactions?.length || 0) +
           (changes.recurringTransactions?.length || 0) +
           (changes.billers?.length || 0);
  }

  /**
   * Handle real-time changes from Android (during active connection)
   * @param {Object} changes - Changes message
   */
  async function handleIncomingChanges(changes) {
    console.log('📥 Received real-time changes from Android');
    const strategy = PairingManager.getConflictStrategy() || 'newerWins';
    const result = await incrementalSyncManager.applyIncomingChanges(changes, strategy);

    // Refresh UI
    window.dispatchEvent(new CustomEvent('data-updated', {
      detail: { type: 'realtime-sync' }
    }));

    return result;
  }

  return {
    performSync,
    handleIncomingChanges,
    get isInProgress() { return syncInProgress; }
  };
})();
```

### 3.2 Update `js/webrtc.js`

Add the following method to support `offData`:

```javascript
// Add to WebRTCSync object (around line 200, near onData)

/**
 * Remove a data handler
 * @param {Function} callback - Handler to remove
 */
offData(callback) {
  const index = this.dataHandlers.indexOf(callback);
  if (index > -1) {
    this.dataHandlers.splice(index, 1);
  }
},

// Make sure dataHandlers array exists in initialization:
// this.dataHandlers = [];

// In onData method, push to array:
onData(callback) {
  if (!this.dataHandlers) this.dataHandlers = [];
  this.dataHandlers.push(callback);
},
```

### 3.3 Update `js/sync.js`

Modify `initializeWebRTCSync` to use the new orchestration:

```javascript
// In initializeWebRTCSync, after connection is established:

WebRTCSync.on('connection-established', async () => {
  console.log('🔗 WebRTC connected - starting bidirectional sync');

  // Use new orchestration
  const result = await BidirectionalSync.performSync();

  if (result.success) {
    console.log('✅ Sync stats:', result.stats);
    // Navigate to dashboard or show success
  } else {
    console.error('❌ Sync failed:', result.message);
    // Show error to user
  }
});
```

### 3.4 Update `index.html`

Add script tag:

```html
<script src="js/bidirectional-sync.js"></script>
```

---

## Phase 4: Auto-Sync Enhancement

### Objective
Complete the auto-sync-on-crud implementation with offline queue persistence.

### 4.1 Replace `js/auto-sync-on-crud.js`

```javascript
/**
 * Auto-Sync on CRUD Operations
 * Queues local changes and syncs them to Android when connected
 */
class AutoSyncOnCRUD {
  constructor() {
    this.pendingChanges = [];
    this.debounceTimer = null;
    this.DEBOUNCE_MS = 2000;
    this.STORAGE_KEY = 'pendingSync';

    // Load any persisted changes
    this.loadPersistedQueue();

    // Drain queue when connection established
    if (typeof WebRTCSync !== 'undefined') {
      WebRTCSync.on('connection-established', () => {
        this.drainQueue();
      });
    }
  }

  /**
   * Record a change for syncing
   * @param {string} tableName - Table that was modified
   * @param {string} operation - 'insert', 'update', or 'delete'
   * @param {Object} record - The modified record
   */
  recordChange(tableName, operation, record) {
    const change = {
      table: tableName,
      operation: operation,
      record: record,
      timestamp: Date.now(),
      id: `${tableName}-${record.transactionID || record.id || record.billerID}-${Date.now()}`
    };

    // Check for duplicate/superseding change
    const existingIndex = this.pendingChanges.findIndex(c =>
      c.table === tableName &&
      (c.record.transactionID === record.transactionID ||
       c.record.id === record.id ||
       c.record.billerID === record.billerID)
    );

    if (existingIndex > -1) {
      // Replace with newer change
      this.pendingChanges[existingIndex] = change;
    } else {
      this.pendingChanges.push(change);
    }

    console.log(`📝 Queued ${operation} for ${tableName}:`,
      record.transactionID || record.id || record.billerID);

    // Schedule sync
    this.scheduleSend();

    // Update pending indicator
    this.updatePendingIndicator();
  }

  /**
   * Schedule sending changes (debounced)
   */
  scheduleSend() {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.sendPendingChanges();
    }, this.DEBOUNCE_MS);
  }

  /**
   * Send pending changes to Android
   */
  async sendPendingChanges() {
    if (this.pendingChanges.length === 0) {
      return;
    }

    // Check if connected
    if (typeof WebRTCSync === 'undefined' || !WebRTCSync.isConnected()) {
      console.log('📴 Not connected - persisting queue');
      await this.persistQueue();
      return;
    }

    console.log(`📤 Sending ${this.pendingChanges.length} pending changes...`);

    try {
      const message = this.formatChangesForSync(this.pendingChanges);
      WebRTCSync.send(JSON.stringify(message));

      // Clear queue after successful send
      this.pendingChanges = [];
      await this.clearPersistedQueue();
      this.updatePendingIndicator();

      console.log('✅ Pending changes sent successfully');
    } catch (error) {
      console.error('❌ Failed to send changes:', error);
      await this.persistQueue();
    }
  }

  /**
   * Drain the queue (send all pending changes)
   * Called when connection is established
   */
  async drainQueue() {
    await this.loadPersistedQueue();
    if (this.pendingChanges.length > 0) {
      console.log(`📤 Draining queue: ${this.pendingChanges.length} changes`);
      await this.sendPendingChanges();
    }
  }

  /**
   * Format changes for sync message
   * @param {Array} changes - Array of change objects
   * @returns {Object} Formatted sync message
   */
  formatChangesForSync(changes) {
    const grouped = {
      type: 'changes',
      transactions: [],
      categories: [],
      savingsGoals: [],
      budgetHistory: [],
      goalTransactions: [],
      recurringTransactions: [],
      billers: [],
      deviceId: 'web',
      timestamp: Date.now()
    };

    for (const change of changes) {
      if (grouped[change.table]) {
        grouped[change.table].push(change.record);
      }
    }

    return grouped;
  }

  /**
   * Persist queue to localStorage
   */
  async persistQueue() {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.pendingChanges));
      console.log(`💾 Persisted ${this.pendingChanges.length} changes to localStorage`);
    } catch (error) {
      console.error('Failed to persist queue:', error);
    }
  }

  /**
   * Load queue from localStorage
   */
  async loadPersistedQueue() {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Merge with current queue, avoiding duplicates
        for (const change of parsed) {
          if (!this.pendingChanges.find(c => c.id === change.id)) {
            this.pendingChanges.push(change);
          }
        }
        console.log(`📂 Loaded ${parsed.length} persisted changes`);
        this.updatePendingIndicator();
      }
    } catch (error) {
      console.error('Failed to load persisted queue:', error);
    }
  }

  /**
   * Clear persisted queue
   */
  async clearPersistedQueue() {
    localStorage.removeItem(this.STORAGE_KEY);
  }

  /**
   * Update UI indicator for pending changes
   */
  updatePendingIndicator() {
    const count = this.pendingChanges.length;
    const indicator = document.getElementById('pending-sync-count');

    if (indicator) {
      if (count > 0) {
        indicator.textContent = count;
        indicator.style.display = 'inline-flex';
      } else {
        indicator.style.display = 'none';
      }
    }

    // Also update sync status if available
    if (typeof SyncStatusManager !== 'undefined') {
      SyncStatusManager.updatePendingCount(count);
    }
  }

  /**
   * Get current pending count
   * @returns {number}
   */
  getPendingCount() {
    return this.pendingChanges.length;
  }
}

// Create singleton instance
const autoSyncCRUD = new AutoSyncOnCRUD();
```

### 4.2 Update `js/sync-status-manager.js`

Add pending count display:

```javascript
// Add to SyncStatusManager

/**
 * Update pending changes count
 * @param {number} count - Number of pending changes
 */
updatePendingCount(count) {
  const statusText = document.querySelector('.sync-status-text');
  if (statusText && count > 0) {
    statusText.textContent = `${count} pending`;
  }
},
```

---

## Phase 5: Hash Verification Parity

### Objective
Ensure web rejects corrupted data like Android does.

### 5.1 Update `js/incremental-sync-manager.js`

Modify `applyRecordChange` method (around line 152):

```javascript
async applyRecordChange(storeName, incoming, strategy) {
  const table = Storage.db.table(storeName);
  const keyField = this.storeKeyMap[storeName] || 'id';
  const incomingRecord = this.normalizeIncomingRecord(incoming, keyField, storeName);

  // Verify incoming hash - REJECT if corrupted (matching Android behavior)
  if (typeof DataHashService !== 'undefined' && incomingRecord.data_hash) {
    try {
      const hashValid = await DataHashService.verifyRecordHash(storeName, incomingRecord);
      if (!hashValid) {
        console.error(`❌ REJECTING corrupted ${storeName} record:`, incomingRecord[keyField]);
        return {
          applied: false,
          conflict: true,
          conflictDetail: {
            entity: storeName,
            id: incomingRecord[keyField],
            error: 'data_corruption',
            message: 'Record hash verification failed'
          }
        };
      }
    } catch (error) {
      console.error(`❌ Error verifying hash for ${storeName}:`, error);
      // On verification error, still reject to be safe
      return {
        applied: false,
        conflict: true,
        conflictDetail: {
          entity: storeName,
          id: incomingRecord[keyField],
          error: 'hash_verification_error',
          message: error.message
        }
      };
    }
  }

  // Rest of method continues...
  if (!incomingRecord[keyField]) {
    return { applied: false, conflict: false };
  }
  // ... existing code
}
```

### 5.2 Add Hash Verification Method to `js/hash-service.js`

```javascript
/**
 * Verify a record's hash matches its data
 * @param {string} tableName - Table name
 * @param {Object} record - Record to verify
 * @returns {Promise<boolean>} True if hash is valid
 */
async verifyRecordHash(tableName, record) {
  const storedHash = record.data_hash;
  if (!storedHash) {
    // No hash to verify - consider valid
    return true;
  }

  const computedHash = await this.computeHashForEntity(tableName, record);
  if (!computedHash) {
    console.warn(`Cannot compute hash for ${tableName} - verification skipped`);
    return true;
  }

  const isValid = storedHash === computedHash;

  if (!isValid) {
    console.error(`❌ HASH MISMATCH for ${tableName}:
      Stored:   ${storedHash}
      Computed: ${computedHash}`);
  }

  return isValid;
},
```

### 5.3 Hash Parity Test Procedure

Create a test to verify hashes match between platforms:

```javascript
// Run this in browser console after syncing with Android

async function testHashParity() {
  const testTransaction = {
    transactionID: 'test-123',
    transactionAmount: 25.50,
    transactionCategory: 1,
    transactionDate: '2024-12-26T10:30:00.000Z',
    transactionType: 'expense',
    merchantName: 'Test Store',
    deleted: false
  };

  const webHash = await DataHashService.computeTransactionHash(testTransaction);
  console.log('Web Hash:', webHash);

  // Compare this with Android's hash for the same data
  // Android should produce identical hash

  return webHash;
}

testHashParity();
```

---

## Phase 6: Conflict Notification UI

### 6.1 Create New File: `js/conflict-notification.js`

```javascript
/**
 * Conflict Notification System
 * Shows user-friendly notifications when sync conflicts are resolved
 */
const ConflictNotification = (() => {

  /**
   * Show conflict notification
   * @param {Array} conflictDetails - Array of conflict detail objects
   */
  function show(conflictDetails) {
    if (!conflictDetails || conflictDetails.length === 0) {
      return;
    }

    // Remove any existing notification
    const existing = document.querySelector('.conflict-notification');
    if (existing) existing.remove();

    const count = conflictDetails.length;
    const notification = document.createElement('div');
    notification.className = 'conflict-notification';
    notification.innerHTML = `
      <div class="conflict-icon">⚠️</div>
      <div class="conflict-message">
        <strong>${count} sync conflict${count > 1 ? 's' : ''} resolved</strong>
        <span>Tap to view details</span>
      </div>
      <button class="conflict-dismiss" onclick="this.parentElement.remove()">✕</button>
    `;

    notification.onclick = (e) => {
      if (!e.target.classList.contains('conflict-dismiss')) {
        showDetails(conflictDetails);
        notification.remove();
      }
    };

    document.body.appendChild(notification);

    // Auto-dismiss after 10 seconds
    setTimeout(() => {
      if (notification.parentElement) {
        notification.classList.add('conflict-notification-hiding');
        setTimeout(() => notification.remove(), 300);
      }
    }, 10000);
  }

  /**
   * Show detailed conflict modal
   * @param {Array} conflictDetails - Array of conflict detail objects
   */
  function showDetails(conflictDetails) {
    const groupedByEntity = {};
    for (const conflict of conflictDetails) {
      const entity = conflict.entity || 'unknown';
      if (!groupedByEntity[entity]) {
        groupedByEntity[entity] = [];
      }
      groupedByEntity[entity].push(conflict);
    }

    let detailsHtml = '';
    for (const [entity, conflicts] of Object.entries(groupedByEntity)) {
      const entityName = entity.charAt(0).toUpperCase() + entity.slice(1);
      detailsHtml += `
        <div class="conflict-group">
          <h4>${entityName} (${conflicts.length})</h4>
          <ul>
            ${conflicts.map(c => `
              <li>
                <span class="conflict-id">${c.id}</span>
                ${c.error ?
                  `<span class="conflict-error">Error: ${c.error}</span>` :
                  `<span class="conflict-winner">Winner: ${c.winner}</span>`
                }
              </li>
            `).join('')}
          </ul>
        </div>
      `;
    }

    const strategy = PairingManager?.getConflictStrategy() || 'newerWins';
    const strategyNames = {
      newerWins: 'Newer Wins',
      androidWins: 'Android Wins',
      webWins: 'Web Wins'
    };

    Modals.show({
      title: 'Sync Conflicts Resolved',
      body: `
        <div class="conflict-details">
          <p class="conflict-strategy">
            Resolution strategy: <strong>${strategyNames[strategy] || strategy}</strong>
          </p>
          ${detailsHtml}
        </div>
      `,
      submitText: 'OK',
      onSubmit: () => {} // Just closes modal
    });
  }

  return { show, showDetails };
})();
```

### 6.2 Add Conflict Notification Styles to `css/styles.css`

```css
/* ============================================
   CONFLICT NOTIFICATION STYLES
   ============================================ */

.conflict-notification {
  position: fixed;
  bottom: 5rem;
  left: 50%;
  transform: translateX(-50%);
  background: var(--warning-bg, #fff3cd);
  border: 1px solid var(--warning-border, #ffc107);
  border-radius: 8px;
  padding: 0.75rem 1rem;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 1001;
  cursor: pointer;
  animation: slideUp 0.3s ease;
  max-width: 90%;
}

.conflict-notification-hiding {
  animation: slideDown 0.3s ease forwards;
}

@keyframes slideDown {
  to {
    transform: translateX(-50%) translateY(100px);
    opacity: 0;
  }
}

.conflict-icon {
  font-size: 1.5rem;
}

.conflict-message {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.conflict-message strong {
  color: var(--warning-text, #856404);
  font-size: 0.9375rem;
}

.conflict-message span {
  color: var(--warning-text-secondary, #997a00);
  font-size: 0.8125rem;
}

.conflict-dismiss {
  background: none;
  border: none;
  font-size: 1.25rem;
  cursor: pointer;
  color: var(--warning-text, #856404);
  padding: 0.25rem;
  margin-left: auto;
}

.conflict-dismiss:hover {
  color: var(--text-primary);
}

/* Conflict Details Modal */
.conflict-details {
  max-height: 400px;
  overflow-y: auto;
}

.conflict-strategy {
  margin-bottom: 1rem;
  padding: 0.75rem;
  background: var(--bg-secondary);
  border-radius: 6px;
}

.conflict-group {
  margin-bottom: 1rem;
}

.conflict-group h4 {
  margin: 0 0 0.5rem 0;
  color: var(--text-secondary);
  font-size: 0.875rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.conflict-group ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

.conflict-group li {
  display: flex;
  justify-content: space-between;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--border-color);
  font-size: 0.875rem;
}

.conflict-group li:last-child {
  border-bottom: none;
}

.conflict-id {
  font-family: monospace;
  color: var(--text-secondary);
}

.conflict-winner {
  color: var(--income-color, #27ae60);
}

.conflict-error {
  color: var(--expense-color, #e74c3c);
}

/* Dark mode adjustments */
[data-theme="dark"] .conflict-notification {
  background: #3d3200;
  border-color: #665500;
}

[data-theme="dark"] .conflict-message strong,
[data-theme="dark"] .conflict-message span,
[data-theme="dark"] .conflict-dismiss {
  color: #ffc107;
}
```

### 6.3 Update `index.html`

Add script tag:

```html
<script src="js/conflict-notification.js"></script>
```

---

## Testing Checklist

### Phase 1: Storage Layer
- [ ] `Storage.createTransaction()` creates valid transaction with UUID and hash
- [ ] `Storage.updateTransaction()` updates and recomputes hash
- [ ] `Storage.deleteTransaction()` soft deletes with updated hash
- [ ] Same tests pass for categories, savings goals, goal transactions

### Phase 2: UI Components
- [ ] Add Transaction modal opens from FAB
- [ ] Form validation prevents invalid data
- [ ] Created transaction appears in list immediately
- [ ] Edit modal pre-fills current data
- [ ] Delete shows confirmation dialog
- [ ] Same tests pass for categories and goals
- [ ] Action buttons visible on hover (desktop) or always (mobile)

### Phase 3: Sync Orchestration
- [ ] Web sends metadata after connection
- [ ] Web sends changes before receiving Android changes
- [ ] Android changes are applied locally
- [ ] syncComplete is sent after applying
- [ ] UI refreshes after sync

### Phase 4: Auto-Sync
- [ ] Changes are queued when created/updated/deleted
- [ ] Queue persists to localStorage when offline
- [ ] Queue drains when connection established
- [ ] Pending indicator shows count

### Phase 5: Hash Verification
- [ ] Corrupted records are rejected
- [ ] Valid records are accepted
- [ ] Hashes match between web and Android for identical data

### Phase 6: Conflict Notification
- [ ] Notification appears when conflicts resolved
- [ ] Clicking notification shows details modal
- [ ] Auto-dismisses after 10 seconds

### End-to-End Tests
- [ ] Create transaction on web → syncs to Android → appears on Android
- [ ] Edit transaction on web → syncs to Android → updated on Android
- [ ] Delete transaction on web → syncs to Android → deleted on Android
- [ ] Edit same transaction on both simultaneously → conflict resolved correctly
- [ ] Create while offline → changes queued → syncs on reconnect

---

## Troubleshooting

### Common Issues

#### 1. Sync Never Completes
**Symptoms:** Sync starts but hangs
**Check:**
- WebRTC connection is established
- Android app is on sync screen
- Console for timeout errors

**Solution:** Verify message order matches Android's expectations

#### 2. Hash Mismatch
**Symptoms:** Records rejected with data_corruption error
**Check:**
- Field ordering in hash computation
- Decimal normalization (2 decimal places)
- Null handling

**Solution:** Compare hash algorithms line by line

#### 3. Changes Not Syncing
**Symptoms:** Created records don't appear on Android
**Check:**
- `autoSyncCRUD.getPendingCount()` > 0
- WebRTC connected (`WebRTCSync.isConnected()`)
- Console for send errors

**Solution:** Check `drainQueue()` is called on connection

#### 4. UI Not Updating After Sync
**Symptoms:** Data synced but not visible
**Check:**
- `data-updated` event is dispatched
- Event listener is registered
- `renderDashboard()` is called

**Solution:** Verify event handling chain

### Debug Commands

```javascript
// Check pending sync queue
console.log('Pending:', autoSyncCRUD.getPendingCount());

// Check pairing state
console.log('Paired:', PairingManager.getPairedDevice());
console.log('Last sync:', new Date(PairingManager.getLastSyncTime()));

// Check WebRTC state
console.log('Connected:', WebRTCSync.isConnected());

// Check IndexedDB data
await Storage.db.transactions.count();
await Storage.db.categories.count();

// Force hash recomputation
const txn = await Storage.db.transactions.first();
const hash = await DataHashService.computeTransactionHash(txn);
console.log('Hash:', hash, 'Stored:', txn.data_hash);
```

---

## Appendix: File Summary

### New Files
| File | Purpose |
|------|---------|
| `js/modals.js` | Reusable modal system |
| `js/crud-ui.js` | CRUD UI components |
| `js/bidirectional-sync.js` | Sync orchestration |
| `js/conflict-notification.js` | Conflict display |

### Modified Files
| File | Changes |
|------|---------|
| `js/storage.js` | Add CRUD methods |
| `js/ui.js` | Add action buttons, FAB |
| `js/auto-sync-on-crud.js` | Complete implementation |
| `js/incremental-sync-manager.js` | Reject corrupted data |
| `js/hash-service.js` | Add verification method |
| `js/webrtc.js` | Add `offData` method |
| `js/sync.js` | Integrate bidirectional sync |
| `css/styles.css` | Modal, button, notification styles |
| `index.html` | Add new script tags |

---

*End of Implementation Guide*
