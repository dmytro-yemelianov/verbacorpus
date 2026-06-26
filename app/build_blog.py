from __future__ import annotations
import glob, html, json, os, re, sys
import markdown

HOST = "verbacorpus.org"

_TOPBAR = '''<nav class="topbar">
    <div class="wrap topbar-inner">
      <a class="topbar-brand" href="/" aria-label="verba"><svg class="leaf" viewBox="0 0 40 64" aria-hidden="true"><path d="M20 4 C 31 22 30 46 21 60 C 12 46 11 22 20 4 Z" fill="#5e7355"/><path d="M20 11 C 23 28 22 47 21 54" stroke="#f4f1e8" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg><span>verba</span></a>
      <div class="topbar-nav">
        <a class="topbar-link" href="/about" data-i18n="nav.about">Про проєкт</a>
        <a class="topbar-link" href="/blog" data-i18n="nav.blog">Блог</a>
        <a class="topbar-link" href="/api.html" data-i18n="nav.api">API</a>
        <a class="topbar-link topbar-link-ext" href="https://t.me/verbaCorpus_bot" rel="noopener">Telegram</a>
        <a class="topbar-link topbar-link-ext" href="https://github.com/dmytro-yemelianov/verbacorpus" rel="noopener">GitHub</a>
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
            val = v.strip()
            if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
                val = val[1:-1].strip()
            meta[k.strip()] = val
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

def render_page(meta: dict, body_html: str, lang: str = "uk") -> str:
    e = html.escape
    slug = meta["slug"]
    canonical = f"https://{HOST}/blog/{slug}" if lang == "uk" else f"https://{HOST}/{lang}/blog/{slug}"
    back_url = "/blog" if lang == "uk" else f"/{lang}/blog"
    back_text = "← Блог" if lang == "uk" else "← Blog"
    return (f'<!DOCTYPE html>\n<html lang="{lang}">\n' + _head(meta.get("title", ""), meta.get("lede", ""), canonical) +
            f'\n<body>\n  {_TOPBAR}\n  <main class="wrap article">\n'
            f'    <p class="article-back"><a href="{back_url}">{back_text}</a></p>\n'
            f'    <h1 class="article-title">{e(meta.get("title", ""))}</h1>\n'
            f'    <p class="article-date">{e(meta.get("date", ""))}</p>\n'
            f'    {body_html}\n  </main>\n  {_FOOTER}\n'
            f'  <script type="module" src="/chrome.js"></script>\n</body>\n</html>\n')

def render_index(articles: list[dict], lang: str = "uk") -> str:
    e = html.escape
    prefix = "/blog" if lang == "uk" else f"/{lang}/blog"
    items = "".join(
        f'<li class="blog-card"><a href="{prefix}/{e(a["slug"])}"><span class="blog-card-date">{e(a.get("date",""))}</span>'
        f'<span class="blog-card-title">{e(a.get("title",""))}</span>'
        f'<span class="blog-card-lede">{e(a.get("lede",""))}</span></a></li>'
        for a in articles)
    canonical = f"https://{HOST}/blog" if lang == "uk" else f"https://{HOST}/{lang}/blog"
    title_text = "Блог" if lang == "uk" else "Blog"
    desc_text = "Статті про корпус українських прислів'їв verba." if lang == "uk" else "Articles about the verba Ukrainian proverbs corpus."
    return (f'<!DOCTYPE html>\n<html lang="{lang}">\n' + _head(title_text, desc_text, canonical) +
            f'\n<body>\n  {_TOPBAR}\n  <main class="wrap blog-index">\n    <h1 data-i18n="nav.blog">{title_text}</h1>\n'
            f'    <ul class="blog-list">{items}</ul>\n  </main>\n  {_FOOTER}\n'
            f'  <script type="module" src="/chrome.js"></script>\n</body>\n</html>\n')

def render_sitemap(articles_by_lang: dict[str, list[dict]], host: str) -> str:
    langs = ["", "/en", "/de", "/fr", "/es", "/pl", "/it", "/pt", "/ja", "/zh"]
    urls = [f"https://{host}/"]
    urls += [f"https://{host}{l}/" for l in langs if l]      # language roots
    urls += [f"https://{host}/about", f"https://{host}/api.html", f"https://{host}/blog"]
    for lang in articles_by_lang:
        if lang != "uk":
            urls.append(f"https://{host}/{lang}/blog")
    for lang, arts in articles_by_lang.items():
        for a in arts:
            slug = a["slug"]
            if lang == "uk":
                urls.append(f"https://{host}/blog/{slug}")
            else:
                urls.append(f"https://{host}/{lang}/blog/{slug}")
    body = "".join(f"<url><loc>{u}</loc></url>" for u in urls)
    return f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{body}</urlset>\n'

def build(content_dir: str, out_dir: str) -> dict[str, list[dict]]:
    langs_to_build = {"uk": content_dir}
    for sub in glob.glob(os.path.join(content_dir, "??")):
        if os.path.isdir(sub):
            lang = os.path.basename(sub)
            langs_to_build[lang] = sub

    articles_by_lang: dict[str, list[dict]] = {}

    for lang, path in langs_to_build.items():
        lang_out = out_dir if lang == "uk" else os.path.join(os.path.dirname(out_dir), lang, "blog")
        os.makedirs(lang_out, exist_ok=True)
        
        arts: list[dict] = []
        for f in sorted(glob.glob(os.path.join(path, "*.md"))):
            if os.path.basename(f).startswith("_"):
                continue  # skip _fixtures/_drafts
            meta, body = parse_frontmatter(open(f, encoding="utf-8").read())
            body_html = markdown.markdown(body, extensions=["extra"])
            with open(os.path.join(lang_out, meta["slug"] + ".html"), "w", encoding="utf-8") as fh:
                fh.write(render_page(meta, body_html, lang))
            arts.append(meta)
        arts.sort(key=lambda m: m.get("date", ""), reverse=True)
        latest_data = []
        for a in arts[:3]:
            latest_data.append({
                "slug": a.get("slug", ""),
                "title": a.get("title", ""),
                "date": a.get("date", ""),
                "lede": a.get("lede", "")
            })
        with open(os.path.join(lang_out, "latest.json"), "w", encoding="utf-8") as fh:
            json.dump(latest_data, fh, ensure_ascii=False, indent=2)
        with open(os.path.join(lang_out, "index.html"), "w", encoding="utf-8") as fh:
            fh.write(render_index(arts, lang))
        
        articles_by_lang[lang] = arts

    public_dir = os.path.dirname(os.path.abspath(out_dir))  # public/blog -> public
    with open(os.path.join(public_dir, "sitemap.xml"), "w", encoding="utf-8") as fh:
        fh.write(render_sitemap(articles_by_lang, HOST))
        
    return articles_by_lang

if __name__ == "__main__":
    content_dir = sys.argv[1] if len(sys.argv) > 1 else "content/blog"
    out_dir = sys.argv[2] if len(sys.argv) > 2 else "public/blog"
    n = build(content_dir, out_dir)
    total_pages = sum(len(v) for v in n.values())
    print(f"Built {total_pages} blog page(s) across {len(n)} language(s) + indexes + sitemap.xml")

