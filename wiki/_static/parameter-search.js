// Parameter search for the wiki's ArduPilot parameter reference.
//
// EXTERNAL, not inline: the app and the wiki share an origin, so the app's
// Content-Security-Policy (script-src 'self') applies to /wiki/* too and blocks
// inline <script>. As an inline block this ran nowhere in production — the
// search box rendered and did nothing. Loaded via html_js_files in conf.py, so
// it is same-origin and allowed.
//
// Loads on every wiki page; it early-returns unless the search elements exist.

(function () {
  var input = document.getElementById('param-search-input')
  var status = document.getElementById('param-search-status')
  var results = document.getElementById('param-search-results')
  if (!input || !status || !results) return

  var params = []
  var MAX_RESULTS = 60

  // The index lives next to the other static assets. Resolve it relative to
  // this page so the reference works at any deploy prefix (/wiki/, a preview
  // path, or a local file build) rather than assuming a site root.
  var root = (window.DOCUMENTATION_OPTIONS && window.DOCUMENTATION_OPTIONS.URL_ROOT) || '../'

  fetch(root + '_static/parameter-index.json')
    .then(function (response) { return response.json() })
    .then(function (payload) {
      params = payload.params || []
      status.textContent = params.length + ' parameters indexed (' +
        (payload.vehicle || '') + ' ' + (payload.firmware || '') + '). Start typing.'
      render(input.value)
    })
    .catch(function () {
      status.textContent = 'Could not load the parameter index.'
    })

  function scoreOf(entry, needle) {
    var name = entry.n.toLowerCase()
    var display = (entry.d || '').toLowerCase()
    // Rank exact and prefix name matches first: people search by parameter
    // name far more often than by prose, and a substring hit deep in a
    // description should never outrank the parameter actually named.
    if (name === needle) return 0
    if (name.indexOf(needle) === 0) return 1
    if (name.indexOf(needle) !== -1) return 2
    if (display.indexOf(needle) !== -1) return 3
    // Descriptions are in the index now, so a prose search finds things a name
    // search cannot — ranked last so a named parameter always wins.
    if ((entry.x || '').toLowerCase().indexOf(needle) !== -1) return 4
    return -1
  }

  function render(rawQuery) {
    var needle = (rawQuery || '').trim().toLowerCase()
    results.innerHTML = ''
    if (!needle) {
      if (params.length) {
        status.textContent = params.length + ' parameters indexed. Start typing.'
      }
      return
    }

    var matches = []
    for (var i = 0; i < params.length; i += 1) {
      var score = scoreOf(params[i], needle)
      if (score >= 0) matches.push({ entry: params[i], score: score })
    }
    matches.sort(function (a, b) {
      if (a.score !== b.score) return a.score - b.score
      return a.entry.n < b.entry.n ? -1 : a.entry.n > b.entry.n ? 1 : 0
    })

    status.textContent = matches.length === 0
      ? 'No parameter matches "' + rawQuery + '".'
      : matches.length + ' match' + (matches.length === 1 ? '' : 'es') +
        (matches.length > MAX_RESULTS ? ' (showing the first ' + MAX_RESULTS + ')' : '')

    var shown = matches.slice(0, MAX_RESULTS)
    var fragment = document.createDocumentFragment()
    for (var j = 0; j < shown.length; j += 1) {
      var entry = shown[j].entry
      var li = document.createElement('li')
      var link = document.createElement('a')
      // docutils normalises underscores to hyphens when it builds element
      // ids, so the anchor for BATT_MONITOR is #param-batt-monitor. Matching
      // that here is what makes a search result actually land on the
      // parameter rather than the top of the page.
      link.href = root + 'parameters/group-' + entry.g + '.html#param-' +
        entry.n.toLowerCase().replace(/_/g, '-')
      link.textContent = entry.n
      li.appendChild(link)
      var meta = document.createElement('span')
      meta.className = 'param-search__meta'
      var facts = [entry.d]
      if (entry.u) facts.push(entry.u)
      if (entry.rg) facts.push('range ' + entry.rg)
      if (entry.lv) facts.push(entry.lv)
      if (entry.r) facts.push('reboot required')
      if (entry.opt) facts.push('has value list')
      meta.textContent = facts.join(' · ')
      li.appendChild(meta)

      // The full upstream description, inline. Answering "what does this do" in
      // the results list is the point of searching; making the operator open a
      // page to read one sentence defeats it.
      if (entry.x) {
        var desc = document.createElement('span')
        desc.className = 'param-search__desc'
        desc.textContent = entry.x
        li.appendChild(desc)
      }
      fragment.appendChild(li)
    }
    results.appendChild(fragment)
  }

  input.addEventListener('input', function () { render(input.value) })
})()
