// profile.js — sidebar renderer for pages that use this file directly
// NOTE: app.js has the canonical renderSidebar with mobile support.
// This file just re-exports it so pages that load profile.js (not app.js) still work.
// If app.js is loaded first, this is a no-op.
if (typeof renderSidebar === 'undefined') {
  // Fallback: define a minimal renderSidebar that delegates to app.js patterns
  // This shouldn't happen since all pages load app.js before profile.js
  console.warn('[profile.js] app.js not loaded — sidebar may not render correctly');
}