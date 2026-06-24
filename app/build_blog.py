from __future__ import annotations
import glob, html, os, re, sys
import markdown

HOST = "verbacorpus.org"

_TOPBAR = '''<nav class="topbar">
    <div class="wrap topbar-inner">
      <a class="topbar-brand" href="/" aria-label="verba"><svg class="leaf" viewBox="0 0 40 64" aria-hidden="true"><path d="M20 4 C 31 22 30 46 21 60 C 12 46 11 22 20 4 Z" fill="#5e7355"/><path d="M20 11 C 23 28 22 47 21 54" stroke="#f4f1e8" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg><span>verba</span></a>
      <div class="topbar-nav">
        <a class="topbar-link" href="/about" data-i18n="nav.about">Про проєкт</a>
        <a class="topbar-link" href="/blog" data-i18n="nav.blog">Блог</a>
        <a class="topbar-link" href="/api.html" data-i18n="nav.api">API</a>
        <a class="topbar-link" href="https://github.com/dmytro-yemelianov/verbacorpus" rel="noopener">GitHub</a>
        <div id="langSwitch" class="lang-switch"></div>
        <button id="themeToggle" class="theme-toggle-btn" type="button" aria-label="Перемкнути тему" data-i18n-attr="aria-label:ui.themeToggle">☾</button>
      </div>
    </div>
  </nav>'''

_THEME = '''<script>(function(){var d=document.documentElement;try{var t=localStorage.getItem("theme");if(t==="dark"||t==="light")d.setAttribute("data-theme",t);}catch(e){}function cur(){return d.getAttribute("data-theme")||(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");}function meta(){var m=document.querySelector('meta[name="theme-color"]');if(m)m.content=cur()==="dark"?"#191c16":"#5E7355";}addEventListener("DOMContentLoaded",function(){meta();var b=document.getElementById("themeToggle");if(!b)return;function sync(){b.textContent=cur()==="dark"?"☀":"☾";}sync();b.addEventListener("click",function(){var n=cur()==="dark"?"light":"dark";d.setAttribute("data-theme",n);try{localStorage.setItem("theme",n);}catch(e){}sync();meta();});});})();</script>'''

def parse_frontmatter(text: str):
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n(.*)$", text, re.S)
    if not m:
        return {}, text
    meta = {}
    for line in m.group(1).splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            meta[k.strip()] = v.strip()
    return meta, m.group(2)

def _head(title: str, desc: str, canonical: str) -> str:
    e = html.escape
    return f'''<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="theme-color" content="#5E7355" />
<meta name="description" content="{e(desc)}" />
<title>{e(title)} — verba</title>
<meta property="og:type" content="article" />
<meta property="og:title" content="{e(title)}" />
<meta property="og:description" content="{e(desc)}" />
<meta property="og:image" content="https://{HOST}/card/daily.png" />
<meta name="twitter:card" content="summary_large_image" />
<link rel="canonical" href="{e(canonical)}" />
<link rel="stylesheet" href="/fonts/spectral.css" />
<link rel="stylesheet" href="/styles.css" />
{_THEME}
</head>'''

_FOOTER = '''<footer class="colophon"><div class="wrap"><p class="col-note"><a href="/">← verba</a> · <a href="/about" data-i18n="nav.about">Про проєкт</a> · <a href="/api.html" data-i18n="nav.api">API</a></p></div></footer>'''

def render_page(meta: dict, body_html: str) -> str:
    e = html.escape
    slug = meta["slug"]
    canonical = f"https://{HOST}/blog/{slug}"
    return (f'<!DOCTYPE html>\n<html lang="uk">\n' + _head(meta.get("title", ""), meta.get("lede", ""), canonical) +
            f'\n<body>\n  {_TOPBAR}\n  <main class="wrap article">\n'
            f'    <p class="article-back"><a href="/blog">← Блог</a></p>\n'
            f'    <h1 class="article-title">{e(meta.get("title", ""))}</h1>\n'
            f'    <p class="article-date">{e(meta.get("date", ""))}</p>\n'
            f'    {body_html}\n  </main>\n  {_FOOTER}\n'
            f'  <script type="module" src="/chrome.js"></script>\n</body>\n</html>\n')

def render_index(articles: list[dict]) -> str:
    e = html.escape
    items = "".join(
        f'<li class="blog-card"><a href="/blog/{e(a["slug"])}"><span class="blog-card-date">{e(a.get("date",""))}</span>'
        f'<span class="blog-card-title">{e(a.get("title",""))}</span>'
        f'<span class="blog-card-lede">{e(a.get("lede",""))}</span></a></li>'
        for a in articles)
    canonical = f"https://{HOST}/blog"
    return (f'<!DOCTYPE html>\n<html lang="uk">\n' + _head("Блог", "Статті про корпус українських прислів'їв verba.", canonical) +
            f'\n<body>\n  {_TOPBAR}\n  <main class="wrap blog-index">\n    <h1 data-i18n="nav.blog">Блог</h1>\n'
            f'    <ul class="blog-list">{items}</ul>\n  </main>\n  {_FOOTER}\n'
            f'  <script type="module" src="/chrome.js"></script>\n</body>\n</html>\n')

def render_sitemap(slugs: list[str], host: str) -> str:
    langs = ["", "/en", "/de", "/fr", "/es", "/pl", "/it", "/pt", "/ja", "/zh"]
    urls = [f"https://{host}/"]
    urls += [f"https://{host}{l}/" for l in langs if l]      # language roots
    urls += [f"https://{host}/about", f"https://{host}/api.html", f"https://{host}/blog"]
    urls += [f"https://{host}/blog/{s}" for s in slugs]
    body = "".join(f"<url><loc>{u}</loc></url>" for u in urls)
    return f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{body}</urlset>\n'

def build(content_dir: str, out_dir: str) -> list[dict]:
    os.makedirs(out_dir, exist_ok=True)
    arts: list[dict] = []
    for f in sorted(glob.glob(os.path.join(content_dir, "*.md"))):
        if os.path.basename(f).startswith("_"):
            continue  # skip _fixtures/_drafts
        meta, body = parse_frontmatter(open(f, encoding="utf-8").read())
        body_html = markdown.markdown(body, extensions=["extra"])
        with open(os.path.join(out_dir, meta["slug"] + ".html"), "w", encoding="utf-8") as fh:
            fh.write(render_page(meta, body_html))
        arts.append(meta)
    arts.sort(key=lambda m: m.get("date", ""), reverse=True)
    with open(os.path.join(out_dir, "index.html"), "w", encoding="utf-8") as fh:
        fh.write(render_index(arts))
    public_dir = os.path.dirname(os.path.abspath(out_dir))  # public/blog -> public
    with open(os.path.join(public_dir, "sitemap.xml"), "w", encoding="utf-8") as fh:
        fh.write(render_sitemap([a["slug"] for a in arts], HOST))
    return arts

if __name__ == "__main__":
    content_dir = sys.argv[1] if len(sys.argv) > 1 else "content/blog"
    out_dir = sys.argv[2] if len(sys.argv) > 2 else "public/blog"
    n = build(content_dir, out_dir)
    print(f"Built {len(n)} blog page(s) + index + sitemap.xml")
