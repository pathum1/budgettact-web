const Utils = (() => {
  /**
   * Format currency amount
   * @param {number} amount - The amount to format
   * @param {string} currency - Currency code (default: USD)
   * @returns {string} Formatted currency string
   */
  function formatCurrency(amount, currency = 'USD') {
    try {
      // Normalize currency code (handle both 3-letter codes and symbols)
      const currencyCode = currency?.toUpperCase() || 'USD';

      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currencyCode
      }).format(amount);
    } catch (error) {
      console.warn('Currency formatting error:', error, 'Currency:', currency);
      // Fallback: try to get symbol from common currencies
      const symbolMap = {
        'USD': '$',
        'EUR': '€',
        'GBP': '£',
        'INR': '₹',
        'JPY': '¥',
        'CNY': '¥',
        'AUD': 'A$',
        'CAD': 'C$',
        'CHF': 'Fr',
        'SEK': 'kr',
        'NZD': 'NZ$',
        'ZAR': 'R',
        'BRL': 'R$',
        'MXN': 'Mex$',
        'SGD': 'S$',
        'HKD': 'HK$',
        'NOK': 'kr',
        'KRW': '₩',
        'TRY': '₺',
        'RUB': '₽',
        'THB': '฿',
        'PLN': 'zł',
        'DKK': 'kr',
        'MYR': 'RM',
        'IDR': 'Rp',
        'PHP': '₱',
        'CZK': 'Kč',
        'ILS': '₪',
        'CLP': '$',
        'TWD': 'NT$',
        'AED': 'د.إ',
        'SAR': '﷼',
        'EGP': 'E£'
      };
      const symbol = symbolMap[currency?.toUpperCase()] || currency || '$';
      return `${symbol}${amount.toFixed(2)}`;
    }
  }

  /**
   * Format ISO date string to readable format
   * @param {string} isoString - ISO 8601 date string
   * @param {string} format - Format type: 'short', 'long', 'time'
   * @returns {string} Formatted date string
   */
  function formatDate(isoString, format = 'short') {
    if (!isoString) return 'N/A';

    try {
      const date = new Date(isoString);

      if (format === 'short') {
        return date.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        });
      } else if (format === 'long') {
        return date.toLocaleDateString('en-US', {
          month: 'long',
          day: 'numeric',
          year: 'numeric'
        });
      } else if (format === 'time') {
        return date.toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
      }

      return date.toLocaleDateString();
    } catch (error) {
      return 'Invalid date';
    }
  }

  /**
   * Format date as relative time (Today, Yesterday, etc.)
   * @param {string} isoString - ISO 8601 date string
   * @returns {string} Relative date string
   */
  function formatRelativeDate(isoString) {
    if (!isoString) return 'N/A';

    try {
      const date = new Date(isoString);
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      const dateStr = date.toDateString();
      const todayStr = today.toDateString();
      const yesterdayStr = yesterday.toDateString();

      if (dateStr === todayStr) {
        return 'Today';
      } else if (dateStr === yesterdayStr) {
        return 'Yesterday';
      } else {
        return formatDate(isoString, 'short');
      }
    } catch (error) {
      return 'Invalid date';
    }
  }

  /**
   * Get month and year from ISO date string
   * @param {string} isoString - ISO 8601 date string
   * @returns {string} Month-year string (YYYY-MM)
   */
  function getMonthYear(isoString) {
    if (!isoString) return null;

    try {
      const date = new Date(isoString);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      return `${year}-${month}`;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get current month-year string
   * @returns {string} Current month-year (YYYY-MM)
   */
  function getCurrentMonthYear() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  /**
   * Debounce function for search inputs
   * @param {Function} fn - Function to debounce
   * @param {number} delay - Delay in milliseconds
   * @returns {Function} Debounced function
   */
  function debounce(fn, delay = 300) {
    let timeoutId;
    return function(...args) {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  /**
   * Show notification toast
   * @param {string} message - Message to display
   * @param {string} type - Type: 'success', 'error', 'info'
   * @param {number} duration - Duration in milliseconds
   */
  function showNotification(message, type = 'info', duration = 3000) {
    const notification = document.getElementById('notification');
    if (!notification) return;

    notification.textContent = message;
    notification.className = `notification ${type} active`;

    setTimeout(() => {
      notification.classList.remove('active');
    }, duration);
  }

  /**
   * Calculate days until target date
   * @param {string} targetDateStr - ISO 8601 date string
   * @returns {number|null} Days remaining (negative if past)
   */
  function daysUntil(targetDateStr) {
    if (!targetDateStr) return null;

    try {
      const target = new Date(targetDateStr);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      target.setHours(0, 0, 0, 0);

      const diffTime = target - today;
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      return diffDays;
    } catch (error) {
      return null;
    }
  }

  /**
   * Format days until as readable string
   * @param {string} targetDateStr - ISO 8601 date string
   * @returns {string} Formatted string
   */
  function formatDaysUntil(targetDateStr) {
    const days = daysUntil(targetDateStr);

    if (days === null) return '';
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    if (days === -1) return 'Yesterday';
    if (days > 0) return `${days} days left`;
    return `${Math.abs(days)} days ago`;
  }

  /**
   * Calculate percentage
   * @param {number} current - Current value
   * @param {number} total - Total value
   * @returns {number} Percentage (0-100+)
   */
  function calculatePercentage(current, total) {
    if (total === 0) return 0;
    return (current / total) * 100;
  }

  /**
   * Escape HTML to prevent XSS
   * @param {string} str - String to escape
   * @returns {string} Escaped string
   */
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * Group array by key
   * @param {Array} array - Array to group
   * @param {string|Function} key - Key or function to group by
   * @returns {Object} Grouped object
   */
  function groupBy(array, key) {
    return array.reduce((result, item) => {
      const group = typeof key === 'function' ? key(item) : item[key];
      (result[group] = result[group] || []).push(item);
      return result;
    }, {});
  }

  /**
   * Sort array by multiple criteria
   * @param {Array} array - Array to sort
   * @param {string} key - Key to sort by
   * @param {string} order - 'asc' or 'desc'
   * @returns {Array} Sorted array
   */
  function sortBy(array, key, order = 'asc') {
    return [...array].sort((a, b) => {
      const aVal = a[key];
      const bVal = b[key];

      if (aVal < bVal) return order === 'asc' ? -1 : 1;
      if (aVal > bVal) return order === 'asc' ? 1 : -1;
      return 0;
    });
  }

  /**
   * Get category emoji icon from iconName
   * @param {string|null} iconName - Icon name from category data
   * @returns {string} Emoji icon
   */
  function getCategoryIcon(iconName) {
    const iconMap = {
      'coffee': '☕',
      'gift': '🎁',
      'groceries': '🛒',
      'food': '🍽️',
      'junk_food': '🍕',
      'online_purchase': '🛍️',
      'utilities': '💡',
      'telecommunications': '☎️',
      'credit_card': '💳',
      'internet': '🌐',
      'mobile': '📱',
      'subscription': '🎬',
      'education': '🎓',
      'repairs': '🔧',
      'housing': '🏠',
      'religious': '🙏',
      'alcohol': '🍺',
      'children': '👶',
      'social': '👥',
      'cigarettes': '🚬',
      'pets': '🐾',
      'snacks': '🍿',
      'vegetables': '🥬',
      'fruits': '🍎',
      'healthcare': '🏥',
      'beauty': '💄',
      'transport': '🚌',
      'domestic_help': '🧹',
      'electronics': '📺',
      'miscellaneous': '🔀'
    };
    return iconMap[iconName] || '💰';
  }

  // Public API
  return {
    formatCurrency,
    formatDate,
    formatRelativeDate,
    getMonthYear,
    getCurrentMonthYear,
    debounce,
    showNotification,
    daysUntil,
    formatDaysUntil,
    calculatePercentage,
    escapeHtml,
    groupBy,
    sortBy,
    getCategoryIcon
  };
})();
