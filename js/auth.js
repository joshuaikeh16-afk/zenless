const Auth = (() => {
  function isLoggedIn() {
    return sessionStorage.getItem(CONFIG.admin.sessionKey) === 'true';
  }
 
  function login(password) {
    if (password === CONFIG.admin.password) {
      sessionStorage.setItem(CONFIG.admin.sessionKey, 'true');
      return true;
    }
    return false;
  }
 
  function logout() {
    sessionStorage.removeItem(CONFIG.admin.sessionKey);
    window.location.href = 'login.html';
  }
 
  function requireAuth() {
    if (!isLoggedIn()) {
      window.location.href = 'login.html';
    }
  }
 
  return { isLoggedIn, login, logout, requireAuth };
})();
 