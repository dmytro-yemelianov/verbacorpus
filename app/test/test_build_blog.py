import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # app/
from build_blog import parse_frontmatter, render_page, render_index, render_sitemap

FM = """---
title: Тест
slug: test-article
date: 2026-06-24
lede: Опис статті.
---
## Заголовок

Текст із [посиланням](/s/126)."""

def test_parse_frontmatter():
    meta, body = parse_frontmatter(FM)
    assert meta["title"] == "Тест" and meta["slug"] == "test-article"
    assert meta["date"] == "2026-06-24" and meta["lede"] == "Опис статті."
    assert body.lstrip().startswith("## Заголовок")

def test_render_page():
    meta, body = parse_frontmatter(FM)
    import markdown
    html = render_page(meta, markdown.markdown(body, extensions=["extra"]))
    assert "<title>Тест" in html
    assert '<h2>Заголовок</h2>' in html
    assert 'class="topbar"' in html and '/chrome.js' in html
    assert 'rel="canonical"' in html and 'verbacorpus.org/blog/test-article' in html
    assert 'data-i18n="nav.blog"' in html  # the Блог nav link
    assert 'Опис статті.' in html  # lede in meta description

def test_render_index():
    html = render_index([{"title": "A", "slug": "a", "date": "2026-06-02", "lede": "la"},
                          {"title": "B", "slug": "b", "date": "2026-06-01", "lede": "lb"}])
    assert html.index("/blog/a") < html.index("/blog/b")  # newest first (caller pre-sorts)
    assert "class=\"topbar\"" in html

def test_render_sitemap():
    xml = render_sitemap({"uk": [{"slug": "a"}], "en": [{"slug": "b"}]}, "verbacorpus.org")
    assert xml.startswith("<?xml")
    assert "https://verbacorpus.org/blog/a" in xml and "https://verbacorpus.org/en/blog/b" in xml
    assert "https://verbacorpus.org/" in xml and "https://verbacorpus.org/about" in xml
    assert "/p/" not in xml  # must NOT enumerate proverbs

