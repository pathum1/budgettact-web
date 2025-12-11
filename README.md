# BudgetTact Web

A privacy-focused Progressive Web App (PWA) for viewing your BudgetTact budget data on any device. Built with vanilla HTML, CSS, and JavaScript.

## Features

- **100% Offline** - Works without internet connection after first load
- **Privacy-First** - All data stays in your browser (IndexedDB)
- **No Backend** - Pure client-side application
- **Responsive** - Works on mobile, tablet, and desktop
- **PWA** - Install as an app on your device
- **Read-Only** - View-only interface (Phase 1)

## Views

1. **Dashboard** - Budget overview, recent transactions, active goals
2. **Transactions** - All transactions with filtering and search
3. **Categories** - Budget vs. spent with progress bars
4. **Savings Goals** - Goal progress and target tracking

## Getting Started

### Prerequisites

- Modern web browser (Chrome, Firefox, Safari, Edge)
- BudgetTact Android app (for data export)

### Installation

#### Option 1: GitHub Pages (Recommended)

1. **Create GitHub repository:**
   ```bash
   git init
   git add .
   git commit -m "Initial commit: BudgetTact Web v1.0"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/budgettact-web.git
   git push -u origin main
   ```

2. **Enable GitHub Pages:**
   - Go to repository Settings → Pages
   - Source: Deploy from branch
   - Branch: `main` / root
   - Save

3. **Access your app:**
   - URL: `https://YOUR_USERNAME.github.io/budgettact-web/`
   - Wait 1-2 minutes for deployment

#### Option 2: Local Development

1. **Start a local server:**

   Using Python:
   ```bash
   cd /path/to/web_project
   python3 -m http.server 8000
   ```

   Using Node.js:
   ```bash
   npx http-server -p 8000
   ```

   Using PHP:
   ```bash
   php -S localhost:8000
   ```

2. **Open in browser:**
   ```
   http://localhost:8000
   ```

## How to Import Data

1. **Export from Android:**
   - Open BudgetTact Android app
   - Go to Settings → Sync/Export
   - Tap "Export Data"
   - Copy the JSON to clipboard

2. **Import to Web:**
   - Open BudgetTact Web
   - Click the Import button (download icon in header)
   - Paste the JSON data
   - Click "Import"

3. **Done!**
   - Your data is now stored locally in IndexedDB
   - Works offline
   - Persists across browser sessions

## Data Format

The app expects JSON data in the format defined in `SYNC_CONTRACT.md`. The Android app automatically exports in this format.

Example structure:
```json
{
  "version": "1.0",
  "exportedAt": "2024-12-11T14:30:00Z",
  "deviceId": "...",
  "deviceName": "My Phone",
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

## Project Structure

```
budgettact-web/
├── index.html              # Main HTML file
├── manifest.json           # PWA manifest
├── service-worker.js       # Offline functionality
├── css/
│   └── styles.css          # All styles
├── js/
│   ├── app.js              # App initialization
│   ├── storage.js          # IndexedDB operations
│   ├── sync.js             # Import/validation
│   ├── ui.js               # UI rendering
│   └── utils.js            # Helper functions
├── assets/
│   └── icons/              # PWA icons
├── README.md               # This file
├── SYNC_CONTRACT.md        # Data format specification
└── WEB_IMPLEMENTATION.md   # Implementation guide
```

## Technology Stack

- **HTML5** - Semantic structure
- **CSS3** - Modern styling (Grid, Flexbox, CSS Variables)
- **JavaScript (ES6+)** - Vanilla JS, no frameworks
- **Dexie.js** - IndexedDB wrapper
- **Service Worker** - Offline support

## Browser Compatibility

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Mobile browsers (iOS Safari, Chrome Android)

## PWA Installation

### On Desktop:
1. Open the app in Chrome/Edge
2. Look for install icon in address bar
3. Click "Install"

### On Mobile:
1. Open in Safari (iOS) or Chrome (Android)
2. Tap Share → Add to Home Screen
3. App appears on home screen

## Privacy & Security

- **No Server** - All processing happens in your browser
- **No Tracking** - No analytics or tracking scripts
- **No Accounts** - No sign-up required
- **Local Storage** - Data stays in IndexedDB on your device
- **HTTPS** - Secure connection (via GitHub Pages)

## Data Management

### Clear All Data:
Open browser DevTools (F12):
```javascript
// In Console tab:
Storage.clearAllData();
```

### View Database:
Use browser DevTools → Application → IndexedDB → BudgetTactDB

### Export/Backup:
Currently view-only. Re-import from Android app to update data.

## Troubleshooting

### Import Fails
- Check JSON format matches SYNC_CONTRACT.md
- Ensure valid JSON (no syntax errors)
- Check browser console for errors (F12)

### Data Not Persisting
- Check if IndexedDB is enabled in browser
- Ensure not in Private/Incognito mode
- Check available storage space

### Offline Not Working
- Service Worker must register first (check DevTools → Application → Service Workers)
- Visit app once online to cache files
- Clear cache and reload if issues persist

## Development

### Local Development:
```bash
# Start server
python3 -m http.server 8000

# Open browser
open http://localhost:8000

# Make changes and refresh browser
```

### Testing:
1. Import test data from Android app
2. Verify all views display correctly
3. Test filters and search
4. Test offline mode (DevTools → Network → Offline)
5. Test on mobile device

## Future Phases

**Phase 2:** Automatic sync via WebRTC
**Phase 3:** Two-way sync with editing capabilities

## Contributing

This is a personal project. Feel free to fork and customize for your needs.

## License

Personal use only. Not for distribution.

## Support

For issues or questions:
- Check `WEB_IMPLEMENTATION.md` for technical details
- Review `SYNC_CONTRACT.md` for data format
- Open issue on GitHub repository

## Version

**Current Version:** 1.0.0
**Release Date:** December 11, 2024
**Status:** Phase 1 Complete

---

Built with ❤️ using vanilla JavaScript
