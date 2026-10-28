// Apply the saved theme before styles load to avoid a flash on reload.
(() => {
  const colors = {dark:'#0c1116',light:'#f5f7f8',mint:'#FFFFFF',ocean:'#0D1F2D'};
  function apply(value, persist = false) {
    const theme = Object.hasOwn(colors,value) ? value : 'dark';
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]').content = colors[theme];
    if (persist) { try { localStorage.setItem('task-graph-theme',theme); } catch {} }
    return theme;
  }
  window.taskGraphTheme = Object.freeze({apply});
  let saved = 'dark';
  try { saved = localStorage.getItem('task-graph-theme'); } catch {}
  apply(saved);
  let sidebar = 'expanded';
  try { if (localStorage.getItem('task-graph-sidebar-collapsed') === 'true') sidebar = 'collapsed'; } catch {}
  document.documentElement.dataset.sidebar = sidebar;
})();
