// Apply the saved appearance before rendering to avoid a light flash in dark mode.
(function () {
  var theme = 'light';
  try {
    var saved = localStorage.getItem('theme');
    if (saved === 'dark' || (saved === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) theme = 'dark';
  } catch (_) {}
  document.documentElement.classList.add(theme);
  document.documentElement.style.colorScheme = theme;
})();
