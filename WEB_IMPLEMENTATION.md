# BudgetTact Web - Implementation Guide

## Project Context

**Project Name:** BudgetTact Web  
**Type:** Progressive Web App (PWA)  
**Tech Stack:** Vanilla HTML, CSS, JavaScript  
**Purpose:** Read-only web viewer for BudgetTact budget data  
**Database:** IndexedDB (via Dexie.js)  
**Status:** Starting from scratch (NEW PROJECT)

**Counterpart Project:** BudgetTact Android (data source)

---

## What We're Building

A **privacy-focused, offline-capable web application** that displays budget data exported from the BudgetTact Android app. Users can view their budget on any browser without sending data to cloud servers.

**Key Features:**
- 🔒 100% offline after first load (PWA)
- 📊 Display transactions, categories, budgets, savings goals
- 📱 Responsive design (mobile & desktop)
- 🎨 Clean, modern UI
- ⚡ Fast performance with IndexedDB
- 🔄 Manual sync import (Phase 1)

**Key Non-Features (for now):**
- ❌ No editing capability (read-only)
- ❌ No cloud sync
- ❌ No user accounts
- ❌ No real-time updates

---

## Project Structure

Create this exact structure:

```
budgettact-web/
├── index.html                 # Main app page
├── manifest.json              # PWA manifest
├── service-worker.js          # Offline functionality
├── css/
│   └── styles.css             # All styles
├── js/
│   ├── app.js                 # Main app initialization
│   ├── storage.js             # IndexedDB operations
│   ├── sync.js                # Import sync data
│   ├── ui.js                  # UI rendering
│   └── utils.js               # Helper functions
├── assets/
│   ├── icons/                 # PWA icons (multiple sizes)
│   └── logo.png              # App logo
├── SYNC_CONTRACT.md           # Copy from Android project
├── WEB_IMPLEMENTATION.md      # This file
├── SYNC_STATUS.md             # Shared progress tracker
└── README.md                  # Setup instructions
```

---

## GitHub Pages Setup

### Repository Setup

1. **Create new GitHub repository:**
   - Name: `budgettact-web`
   - Public (required for GitHub Pages)
   - Initialize with README

2. **Enable GitHub Pages:**
   - Go to Settings → Pages
   - Source: Deploy from branch
   - Branch: `main` / root
   - URL will be: `https://[username].github.io/budgettact-web/`

3. **Custom Domain (Optional, Later):**
   - Can add custom domain later for professional URL
   - Not required for Phase 1

### Deployment Workflow

```bash
# Make changes
git add .
git commit -m "Add feature X"
git push origin main

# GitHub automatically deploys to Pages (takes 1-2 minutes)
```

---

## Technology Stack

### Core Technologies

**HTML5:**
- Semantic HTML elements
- No frameworks needed
- Keep it simple and accessible

**CSS3:**
- Modern CSS (Grid, Flexbox)
- CSS Variables for theming
- Mobile-first responsive design
- No preprocessors needed

**JavaScript (ES6+):**
- Async/await for all operations
- Modern module patterns
- No build step required
- No frameworks (React, Vue, etc.)

### Key Libraries

**Dexie.js** (IndexedDB wrapper):
- Version: 3.x (latest)
- CDN: `https://unpkg.com/dexie@3/dist/dexie.min.js`
- Purpose: Simplified IndexedDB operations
- Why: IndexedDB API is complex, Dexie makes it easy

**Chart.js** (optional for future):
- For budget visualizations
- Not required for Phase 1

---

## IndexedDB Schema (via Dexie)

Define database structure:

```javascript
const db = new Dexie('BudgetTactDB');

db.version(1).stores({
  metadata: 'key',                           // Sync metadata
  transactions: 'transactionID, transactionDate, transactionCategory, transactionType',
  categories: '++id, categoryType',
  budgetHistory: '++id, [categoryId+yearMonth]',
  savingsGoals: '++id, isActive, category',
  goalTransactions: '++id, goalId, transactionDate',
  recurringTransactions: 'id, transactionID, nextDueDate, status',
  billers: 'billerID'
});
```

**Index Strategy:**
- Primary keys: Match SYNC_CONTRACT.md
- Compound indexes: For common queries
- Date fields: For filtering/sorting

---

## Core Features Implementation

### Feature 1: Data Import (Priority 1)

**File:** `js/sync.js`

**Functionality:**
1. Accept JSON payload (manual paste for Phase 1)
2. Validate against SYNC_CONTRACT.md
3. Clear old data (or merge strategy)
4. Insert new data into IndexedDB
5. Update sync metadata
6. Show success/error messages

**UI Flow:**
```
User clicks "Import Data" 
→ Modal with textarea appears
→ User pastes JSON from Android app
→ Click "Import"
→ Validation runs
→ Data stored in IndexedDB
→ Success message + redirect to dashboard
```

### Feature 2: Dashboard View (Priority 1)

**File:** `js/ui.js` + `index.html`

**Display:**
- Total budget vs. spent this month
- Category breakdown (pie/bar chart or list)
- Recent transactions (last 10-20)
- Savings goals progress
- Quick stats cards

### Feature 3: Transactions List (Priority 2)

**View all transactions with:**
- Date sorting
- Category filtering
- Search by merchant
- Transaction type filter (income/expense)
- Pagination (50 per page)

### Feature 4: Categories View (Priority 2)

**Display categories with:**
- Budget amount
- Spent amount
- Remaining amount
- Progress bar
- Monthly history (from budgetHistory)

### Feature 5: Savings Goals View (Priority 2)

**Show goals with:**
- Target amount
- Current amount
- Progress percentage
- Target date countdown
- Goal transactions history

---

## UI/UX Guidelines

### Design Principles

1. **Mobile-First:** Design for phone screens first
2. **Minimalist:** Clean, uncluttered interface
3. **Fast:** Instant page loads, smooth transitions
4. **Accessible:** Proper contrast, keyboard navigation
5. **Consistent:** Match Android app's color scheme

### Color Scheme

Use CSS variables for theming:

```css
:root {
  --primary-color: #2196F3;      /* Blue */
  --secondary-color: #4CAF50;    /* Green */
  --danger-color: #F44336;       /* Red */
  --warning-color: #FF9800;      /* Orange */
  --bg-color: #FAFAFA;           /* Light gray */
  --text-color: #212121;         /* Dark gray */
  --card-bg: #FFFFFF;
}

/* Dark mode (future) */
[data-theme="dark"] {
  --bg-color: #121212;
  --card-bg: #1E1E1E;
  --text-color: #E0E0E0;
}
```

### Layout Structure

```html
<!-- Main Layout -->
<body>
  <header>
    <!-- App title, sync button, menu -->
  </header>
  
  <nav>
    <!-- Bottom nav bar (mobile) or sidebar (desktop) -->
    <!-- Dashboard | Transactions | Categories | Goals -->
  </nav>
  
  <main>
    <!-- Current view content -->
  </main>
  
  <footer>
    <!-- Sync status, last updated -->
  </footer>
</body>
```

---

## JavaScript Architecture

### Module Pattern

Use ES6 modules or IIFE pattern:

```javascript
// storage.js
const Storage = (() => {
  // Private methods
  const _validateData = (data) => { ... };
  
  // Public API
  return {
    async getAllTransactions() { ... },
    async getCategories() { ... },
    async importSyncData(jsonData) { ... }
  };
})();
```

### Async/Await Pattern

All IndexedDB operations must be async:

```javascript
// CORRECT
async function loadTransactions() {
  try {
    const transactions = await db.transactions.toArray();
    renderTransactions(transactions);
  } catch (error) {
    console.error('Failed to load transactions:', error);
    showError('Could not load data');
  }
}

// INCORRECT - Don't use promises directly
db.transactions.toArray().then(data => { ... });
```

### Error Handling

Always handle errors gracefully:

```javascript
try {
  // Operation
} catch (error) {
  console.error('Operation failed:', error);
  
  // Show user-friendly message
  showNotification('Something went wrong. Please try again.', 'error');
  
  // Optional: Log to analytics (future)
}
```

---

## PWA Implementation

### Manifest.json

```json
{
  "name": "BudgetTact Web",
  "short_name": "BudgetTact",
  "description": "View your BudgetTact budget data",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#FAFAFA",
  "theme_color": "#2196F3",
  "icons": [
    {
      "src": "assets/icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "assets/icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ]
}
```

### Service Worker Basics

Cache strategy for offline support:

```javascript
// service-worker.js
const CACHE_NAME = 'budgettact-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/app.js',
  '/js/storage.js',
  '/js/sync.js',
  '/js/ui.js'
];

// Cache on install
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

// Serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});
```

---

## Data Validation

### Import Validation Checklist

When importing sync data, validate:

```javascript
function validateSyncData(data) {
  // 1. Check structure
  if (!data.version || !data.data) {
    throw new Error('Invalid sync data structure');
  }
  
  // 2. Check version compatibility
  if (data.version !== '1.0') {
    throw new Error('Unsupported data version');
  }
  
  // 3. Validate required arrays
  const required = ['transactions', 'categories', 'savingsGoals'];
  for (const key of required) {
    if (!Array.isArray(data.data[key])) {
      throw new Error(`Missing or invalid ${key} data`);
    }
  }
  
  // 4. Validate date formats
  // 5. Validate enums
  // 6. Check foreign key references
  
  return true;
}
```

---

## Performance Guidelines

1. **Virtual Scrolling:** For long transaction lists (1000+ items)
2. **Lazy Loading:** Load data as needed, not all at once
3. **Debouncing:** For search inputs (wait 300ms before filtering)
4. **Caching:** Cache computed values (e.g., category totals)
5. **Pagination:** Max 50-100 items per page

---

## Testing Strategy

### Manual Testing Checklist

**Data Import:**
- [ ] Valid JSON imports successfully
- [ ] Invalid JSON shows error message
- [ ] Old data is replaced correctly
- [ ] Sync metadata is updated

**Display:**
- [ ] All transactions shown correctly
- [ ] Categories display with correct budgets
- [ ] Savings goals show progress
- [ ] Dates formatted properly

**Responsive:**
- [ ] Works on mobile (320px width)
- [ ] Works on tablet (768px width)
- [ ] Works on desktop (1920px width)

**PWA:**
- [ ] App installs correctly
- [ ] Works offline after first load
- [ ] Service worker caches resources

**Browser Compatibility:**
- [ ] Chrome/Edge (Chromium)
- [ ] Firefox
- [ ] Safari (iOS and macOS)

---

## Phase 1 Scope

**IN SCOPE:**
- ✅ Complete project setup
- ✅ GitHub Pages deployment
- ✅ Manual JSON import
- ✅ Basic dashboard view
- ✅ Transactions list
- ✅ Categories view
- ✅ Savings goals view
- ✅ PWA installation
- ✅ Offline support

**OUT OF SCOPE (Future):**
- ❌ WebRTC sync
- ❌ Data editing
- ❌ Charts/visualizations
- ❌ Dark mode
- ❌ Export functionality
- ❌ User accounts

---

## Success Criteria

Phase 1 is complete when:

1. ✅ GitHub Pages site is live
2. ✅ Can import JSON from Android app
3. ✅ Dashboard displays all data correctly
4. ✅ Can navigate all views
5. ✅ Works offline as PWA
6. ✅ Mobile responsive
7. ✅ No console errors
8. ✅ Data persists across sessions

---

## Development Workflow

```bash
# Initial setup
git clone [repo-url]
cd budgettact-web

# Development
# (Use Live Server extension in VS Code or python -m http.server)

# Testing
# Open index.html in browser
# Import test JSON data
# Verify all features work

# Deployment
git add .
git commit -m "Feature: Add X"
git push origin main
# Wait 1-2 minutes for GitHub Pages to rebuild
```

---

## Reference Documents

- **Data Format:** `SYNC_CONTRACT.md` (copy from Android project)
- **Progress Tracking:** `SYNC_STATUS.md` (shared with Android)
- **Android Counterpart:** `ANDROID_IMPLEMENTATION.md` (in Android project)

---

## Important Notes

1. **No Backend:** This is 100% client-side - no servers
2. **Privacy First:** All data stays in browser's IndexedDB
3. **Single User:** No multi-user support needed
4. **GitHub Pages Limitations:** Static site only, no server-side code
5. **Browser Support:** Modern browsers only (ES6+ required)
6. **Data Size:** IndexedDB can handle 10,000+ transactions easily

---

## Questions for Claude Code

When starting this project, Claude Code should:
- Create entire project structure from scratch
- Reference SYNC_CONTRACT.md for all data handling
- Follow this guide for architecture decisions
- Start with MVP features (import + display)
- Update SYNC_STATUS.md as features complete
- Ask for clarification if requirements are unclear
