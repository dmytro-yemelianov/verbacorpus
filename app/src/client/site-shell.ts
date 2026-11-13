(() => {
  const root = document.documentElement;
  const media = matchMedia('(prefers-color-scheme: dark)');
  const valid = (value: string | null | undefined) => value === 'dark' || value === 'light' ? value : undefined;
  const preference = () => {
    // A non-sensitive preference shared by the umbrella and its subdomains.
    let cookie: 'dark' | 'light' | undefined;
    try { cookie = valid(document.cookie.match(/(?:^|;\s*)verba_theme=(dark|light)(?:;|$)/)?.[1]); } catch { /* Cookies may be blocked. */ }
    try { return cookie ?? valid(localStorage.getItem('theme')); } catch { return cookie; }
  };
  function apply(theme: 'dark' | 'light', persist = false) {
    root.dataset.theme = theme;
    if (persist) {
      try { localStorage.setItem('theme', theme); } catch { /* Private storage may be disabled. */ }
      if (location.hostname === 'verbacorpus.org' || location.hostname.endsWith('.verbacorpus.org')) {
        try { document.cookie = `verba_theme=${theme}; Domain=verbacorpus.org; Path=/; Max-Age=31536000; SameSite=Lax; Secure`; } catch { /* The local preference still works. */ }
      }
    }
    document.querySelectorAll<HTMLButtonElement>('[data-verba-theme]').forEach(button => {
      const label = document.documentElement.lang === 'uk' ? (theme === 'dark' ? 'Світла тема' : 'Темна тема') : (theme === 'dark' ? 'Light theme' : 'Dark theme');
      button.setAttribute('aria-label', label); button.title = label;
      button.setAttribute('aria-pressed', String(theme === 'dark'));
    });
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta) meta.content = theme === 'dark' ? '#191c16' : '#f4f1e8';
    document.dispatchEvent(new Event('verba-theme'));
  }
  apply(preference() ?? (media.matches ? 'dark' : 'light'));
  document.addEventListener('DOMContentLoaded', () => {
    apply(preference() ?? (media.matches ? 'dark' : 'light'));
    document.querySelector('[data-verba-theme]')?.addEventListener('click', () => apply(root.dataset.theme === 'dark' ? 'light' : 'dark', true));
    // Visitors arriving from the old proverb homepage may still have its worker.
    if ('serviceWorker' in navigator) void navigator.serviceWorker.getRegistration('/').then(registration => registration?.update()).catch(() => {});
  });
  addEventListener('storage', event => { if (event.key === 'theme') apply(preference() ?? (media.matches ? 'dark' : 'light')); });
  media.addEventListener('change', () => { if (!preference()) apply(media.matches ? 'dark' : 'light'); });
})();
