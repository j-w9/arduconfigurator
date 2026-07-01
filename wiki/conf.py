# Configuration for the ArduConfigurator wiki.
#
# Built with Sphinx + the Furo theme — a clean, modern, responsive docs theme
# (light/dark mode toggle, collapsible mobile nav, Note/Warning/Tip callouts,
# prev/next, and Edit-this-page links) served under arduconfigurator.com/wiki.

project = 'ArduConfigurator'
author = 'ArduConfigurator contributors'

extensions = [
    'sphinx.ext.todo',
]

templates_path = ['_templates']
exclude_patterns = ['_build', 'Thumbs.db', '.DS_Store', 'venv', '.venv']

# -- HTML output -------------------------------------------------------------
html_theme = 'furo'
html_theme_options = {
    # "Edit this page" links back to wiki/ on GitHub — Furo's built-in mechanism,
    # replacing the RTD html_context github_* config.
    'source_repository': 'https://github.com/j-w9/arduconfigurator/',
    'source_branch': 'main',
    'source_directory': 'wiki/',
}
html_title = 'ArduConfigurator Wiki'
html_show_copyright = False
html_static_path = ['_static']
html_css_files = ['custom.css']

# Served under arduconfigurator.com/wiki. Sphinx emits relative asset/link URLs,
# so the build works unchanged under that subpath; html_baseurl only sets the
# canonical URL used in <link rel="canonical"> and the sitemap.
html_baseurl = 'https://arduconfigurator.com/wiki/'

todo_include_todos = True
