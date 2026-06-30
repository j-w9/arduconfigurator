# Configuration for the ArduConfigurator wiki.
#
# Built with Sphinx + the Read-the-Docs theme — the same stack as the ArduPilot
# wiki (ardupilot.org) — so the three-column layout, the left workflow nav, the
# Note/Warning/Tip callouts, breadcrumbs, prev/next, and Edit-on-GitHub all match
# closely. The RTD theme is responsive out of the box (collapsible hamburger nav
# on phones), which covers the phone-friendly requirement.

project = 'ArduConfigurator'
author = 'ArduConfigurator contributors'

extensions = [
    'sphinx_rtd_theme',
    'sphinx.ext.todo',
]

templates_path = ['_templates']
exclude_patterns = ['_build', 'Thumbs.db', '.DS_Store', 'venv', '.venv']

# -- HTML output -------------------------------------------------------------
html_theme = 'sphinx_rtd_theme'
html_theme_options = {
    'collapse_navigation': False,
    'sticky_navigation': True,
    'navigation_depth': 3,
    'titles_only': False,
    'style_external_links': True,
}
html_title = 'ArduConfigurator Wiki'
html_show_copyright = False
html_static_path = ['_static']
html_css_files = ['custom.css']

# Served under arduconfigurator.com/wiki. Sphinx emits relative asset/link URLs,
# so the build works unchanged under that subpath; html_baseurl only sets the
# canonical URL used in <link rel="canonical"> and the sitemap.
html_baseurl = 'https://arduconfigurator.com/wiki/'

# "Edit on GitHub" links (like the ArduPilot wiki), pointing back at wiki/ here.
html_context = {
    'display_github': True,
    'github_user': 'j-w9',
    'github_repo': 'arduconfigurator',
    'github_version': 'main',
    'conf_py_path': '/wiki/',
}

todo_include_todos = True
