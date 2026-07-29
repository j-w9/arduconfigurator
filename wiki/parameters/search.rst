.. _parameter-search:

Parameter Search
================

Type any part of a parameter name or its description title. Filtering happens in
your browser against a small prebuilt index, so it responds as you type and works
offline once the page has loaded.

.. raw:: html

   <div class="param-search">
     <input
       id="param-search-input"
       type="search"
       placeholder="e.g. BATT_ or arming or gyro rate"
       autocomplete="off"
       autocapitalize="off"
       spellcheck="false"
       aria-label="Search parameters"
     />
     <p id="param-search-status" class="param-search__status">Loading parameter index…</p>
     <ol id="param-search-results" class="param-search__results"></ol>
   </div>

   <script>
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
         meta.textContent = entry.d + (entry.u ? ' · ' + entry.u : '') + (entry.r ? ' · reboot required' : '')
         li.appendChild(meta)
         fragment.appendChild(li)
       }
       results.appendChild(fragment)
     }

     input.addEventListener('input', function () { render(input.value) })
   })()
   </script>
