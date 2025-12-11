# BudgetTact Sync Contract v1.0

## Overview
This document defines the JSON data format for syncing between BudgetTact Android app and BudgetTact Web. Both projects MUST follow this exact format.

**Last Updated:** 2024-12-11  
**Version:** 1.0  
**Status:** Initial Specification

---

## Full Sync Payload Structure

```json
{
  "version": "1.0",
  "exportedAt": "2024-12-11T14:30:00Z",
  "deviceId": "android-device-uuid",
  "deviceName": "User's Phone",
  "currency": "USD",
  "data": {
    "transactions": [...],
    "categories": [...],
    "budgetHistory": [...],
    "savingsGoals": [...],
    "goalTransactions": [...],
    "recurringTransactions": [...],
    "billers": [...]
  }
}
```

---

## Data Models

### 1. Transaction

**Purpose:** Individual income/expense transactions

```json
{
  "transactionID": "uuid-string",
  "billerName": "Bank Name" | null,
  "merchantName": "Merchant or Payee Name",
  "transactionDate": "2024-12-10T14:30:00Z",
  "transactionType": "expense" | "income",
  "transactionAmount": 1234.56,
  "transactionCategory": 5,
  "currency": "USD"
}
```

**Field Specifications:**
- `transactionID`: String, UUID format, primary key
- `billerName`: String or null, optional bank/biller identifier
- `merchantName`: String, required
- `transactionDate`: String, ISO 8601 DateTime format
- `transactionType`: String, enum ["expense", "income"]
- `transactionAmount`: Number (double), always positive (negative values auto-converted during import)
- `transactionCategory`: Integer, foreign key to Category ID
- `currency`: String, 3-letter ISO currency code (default: "USD")

---

### 2. Category

**Purpose:** Budget categories with spending limits

```json
{
  "id": 1,
  "categoryType": "Groceries",
  "budgetAmount": 500.00,
  "iconName": "shopping_cart" | null,
  "autoPropagateToNextMonth": true,
  "budgetNotificationsEnabled": true
}
```

**Field Specifications:**
- `id`: Integer, primary key (nullable in DB, but always present in export)
- `categoryType`: String, category name
- `budgetAmount`: Number (double), current month budget
- `iconName`: String or null, icon identifier
- `autoPropagateToNextMonth`: Boolean, whether budget carries forward
- `budgetNotificationsEnabled`: Boolean, notification preference

---

### 3. BudgetHistory

**Purpose:** Historical budget amounts per category per month

```json
{
  "id": 1,
  "categoryId": 5,
  "yearMonth": "2024-12",
  "budgetAmount": 500.00,
  "createdAt": "2024-12-01T00:00:00Z"
}
```

**Field Specifications:**
- `id`: Integer, primary key (nullable in DB)
- `categoryId`: Integer, foreign key to Category
- `yearMonth`: String, format "YYYY-MM"
- `budgetAmount`: Number (double)
- `createdAt`: String, ISO 8601 DateTime

---

### 4. SavingsGoal

**Purpose:** User-defined savings goals with targets

```json
{
  "id": 1,
  "goalName": "Emergency Fund",
  "targetAmount": 5000.00,
  "currentAmount": 2500.00,
  "description": "6 months expenses" | null,
  "iconName": "piggy_bank" | null,
  "customColorValue": 4294198070 | null,
  "createdDate": "2024-01-01T00:00:00Z",
  "targetDate": "2025-12-31T23:59:59Z" | null,
  "priority": "high" | "medium" | "low",
  "isActive": true,
  "category": "emergency" | "vacation" | "vehicle" | "investment" | "home" | "education" | "custom",
  "autoAllocateType": "manual" | "income_percent" | "budget_leftover",
  "autoAllocateValue": 10.0,
  "allocationStrategy": "manual" | "automatic" | "hybrid",
  "autoAllocationPercentage": 5.0,
  "monthEndDate": 25 | null,
  "requireApprovalBeforeAllocation": false,
  "createdAt": "2024-01-01T00:00:00Z",
  "updatedAt": "2024-12-10T14:30:00Z"
}
```

**Field Specifications:**
- `id`: Integer, primary key (nullable in DB)
- `goalName`: String, required
- `targetAmount`: Number (double), goal target
- `currentAmount`: Number (double), current progress
- `description`: String or null
- `iconName`: String or null
- `customColorValue`: Integer or null, Color.value from Flutter
- `createdDate`: String, ISO 8601 DateTime
- `targetDate`: String or null, ISO 8601 DateTime
- `priority`: String, enum ["high", "medium", "low"]
- `isActive`: Boolean
- `category`: String, enum (see above)
- `autoAllocateType`: String, enum (see above)
- `autoAllocateValue`: Number (double), percentage or category ID
- `allocationStrategy`: String, enum (see above)
- `autoAllocationPercentage`: Number (double), 0-100
- `monthEndDate`: Integer or null, day of month 1-31
- `requireApprovalBeforeAllocation`: Boolean
- `createdAt`: String, ISO 8601 DateTime
- `updatedAt`: String, ISO 8601 DateTime

---

### 5. GoalTransaction

**Purpose:** Contributions and withdrawals for savings goals

```json
{
  "id": 1,
  "goalId": 3,
  "amount": 100.00,
  "transactionType": "contribution" | "withdrawal" | "auto_income" | "auto_leftover",
  "transactionDate": "2024-12-10T14:30:00Z",
  "description": "Monthly savings" | null,
  "sourceTransactionId": "uuid-string" | null,
  "sourceTransactionType": "income" | "expense_leftover" | null,
  "createdAt": "2024-12-10T14:30:00Z"
}
```

**Field Specifications:**
- `id`: Integer, primary key (nullable in DB)
- `goalId`: Integer, foreign key to SavingsGoal
- `amount`: Number (double), always positive
- `transactionType`: String, enum (see above)
- `transactionDate`: String, ISO 8601 DateTime
- `description`: String or null
- `sourceTransactionId`: String or null, links to Transaction.transactionID
- `sourceTransactionType`: String or null, enum (see above)
- `createdAt`: String, ISO 8601 DateTime

---

### 6. RecurringTransaction

**Purpose:** Recurring transaction patterns and schedules

```json
{
  "id": "recur-uuid-1",
  "transactionID": "trans-uuid-1",
  "recurrenceType": "weekly" | "monthly" | "yearly",
  "recurrenceInterval": "weekly" | "biWeekly" | "everyOtherWeek" | "monthly" | "quarterly" | "biannually" | "yearly",
  "startDate": "2024-01-01T00:00:00Z",
  "endDate": "2025-12-31T23:59:59Z" | null,
  "dayOfWeek": 1 | null,
  "dayOfMonth": 15 | null,
  "specificDate": "2024-06-15T00:00:00Z" | null,
  "lastProcessedDate": "2024-12-01T00:00:00Z" | null,
  "nextDueDate": "2024-12-15T00:00:00Z",
  "status": "active" | "paused" | "completed"
}
```

**Field Specifications:**
- `id`: String, UUID, primary key
- `transactionID`: String, UUID, foreign key to Transaction
- `recurrenceType`: String, enum (see above)
- `recurrenceInterval`: String, enum (see above)
- `startDate`: String, ISO 8601 DateTime
- `endDate`: String or null, ISO 8601 DateTime
- `dayOfWeek`: Integer or null, 1-7 (Monday-Sunday)
- `dayOfMonth`: Integer or null, 1-31
- `specificDate`: String or null, ISO 8601 DateTime
- `lastProcessedDate`: String or null, ISO 8601 DateTime
- `nextDueDate`: String, ISO 8601 DateTime
- `status`: String, enum (see above)

---

### 7. Biller

**Purpose:** Bank/biller information for transactions

```json
{
  "billerID": "uuid-string",
  "billerName": "My Bank",
  "billerActualName": "Bank Official Name"
}
```

**Field Specifications:**
- `billerID`: String, UUID, primary key
- `billerName`: String, user-friendly name
- `billerActualName`: String, official/legal name

---

## Date Format Standard

**All dates and timestamps MUST use ISO 8601 format:**
- Format: `YYYY-MM-DDTHH:mm:ssZ`
- Timezone: Always UTC (Z suffix)
- Example: `2024-12-11T14:30:00Z`

**Year-Month fields (budgetHistory):**
- Format: `YYYY-MM`
- Example: `2024-12`

---

## Data Type Standards

| Type | JSON Type | Notes |
|------|-----------|-------|
| String | string | UTF-8 encoded |
| Integer | number | No decimals |
| Double | number | Decimals allowed |
| Boolean | boolean | `true` or `false` |
| DateTime | string | ISO 8601 format |
| Null | null | Explicit null, not undefined |

---

## Validation Rules

1. **Required Fields:** All non-nullable fields must be present
2. **UUID Format:** All UUIDs must follow standard UUID format
3. **Enums:** String enums must match exactly (case-sensitive)
4. **Amounts:** Always positive numbers, use transaction type to indicate direction
5. **Foreign Keys:** Must reference valid IDs in related tables
6. **Dates:** Must be valid ISO 8601 format, UTC timezone

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2024-12-11 | Initial specification |

---

## Notes for Implementers

### Android (Dart/Flutter)
- Convert DateTime objects using `.toIso8601String()`
- Convert bool to actual boolean (not 1/0)
- Ensure all nullable fields are explicitly null in JSON
- Use `jsonEncode()` for final payload

### Web (JavaScript)
- Parse dates using `new Date(isoString)`
- Store in IndexedDB with proper indexes
- Validate enum values before storage
- Handle null vs undefined correctly

---

## Testing Checklist

- [ ] All required fields present
- [ ] Date formats are ISO 8601
- [ ] Enums match exactly
- [ ] Foreign key references valid
- [ ] Amounts are positive
- [ ] Booleans are true/false not 1/0
- [ ] Nulls are explicit
- [ ] JSON is valid and parseable
