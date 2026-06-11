// Follower Brief v2 — client-side search engine.
// Expects window.SEARCH_DATA (loaded lazily from search-data.js).
(function () {
    var input = document.getElementById('globalSearch');
    var content = document.getElementById('content');
    var meta = document.getElementById('searchMeta');
    var hero = document.getElementById('hero');
    if (!input || !content) return;

    var originalHTML = content.innerHTML;
    var dataState = 'idle'; // idle -> loading -> ready
    var pendingQuery = null;
    var debounceTimer = null;

    function ensureData(cb) {
        if (dataState === 'ready') { cb(); return; }
        if (dataState === 'loading') { return; } // pendingQuery re-runs on load
        dataState = 'loading';
        var s = document.createElement('script');
        s.src = 'search-data.js';
        s.onload = function () {
            (window.SEARCH_DATA || []).forEach(function (v) {
                v._title = (v.title || '').toLowerCase();
                v._people = (v.people || []).join(' ').toLowerCase();
                v._channel = (v.channel || '').toLowerCase();
                v._tldr = (v.tldr || '').toLowerCase();
                v._summary = (v.summary || '').toLowerCase();
            });
            dataState = 'ready';
            cb();
        };
        s.onerror = function () {
            dataState = 'idle';
            content.innerHTML = originalHTML;
            if (meta) meta.hidden = true;
            if (hero) hero.style.display = '';
        };
        document.head.appendChild(s);
    }

    function parseQuery(q) {
        var terms = [];
        q.toLowerCase().replace(/"([^"]+)"|(\S+)/g, function (m, phrase, word) {
            var t = (phrase || word || '').trim();
            if (t) terms.push(t);
            return '';
        });
        return terms;
    }

    function doSearch(query) {
        var q = query.trim();
        if (!q) { clearSearch(false); return; }
        pendingQuery = q;
        ensureData(function () { if (pendingQuery) renderSearch(pendingQuery); });
        if (dataState !== 'ready') {
            content.innerHTML = '<div class="no-results">Loading search index…</div>';
        }
    }

    function clearSearch(resetInput) {
        pendingQuery = null;
        if (resetInput !== false) input.value = '';
        content.innerHTML = originalHTML;
        if (meta) meta.hidden = true;
        if (hero) hero.style.display = '';
        try { history.replaceState(null, '', location.pathname); } catch (e) {}
    }

    function renderSearch(q) {
        var terms = parseQuery(q);
        if (!terms.length) { clearSearch(false); return; }

        var scored = [];
        (window.SEARCH_DATA || []).forEach(function (v) {
            var score = 0;
            var matchedIn = [];
            for (var i = 0; i < terms.length; i++) {
                var t = terms[i];
                var ts = 0;
                if (v._people.indexOf(t) !== -1) { ts += 100; if (matchedIn.indexOf('people') < 0) matchedIn.push('people'); }
                if (v._title.indexOf(t) !== -1) { ts += 50; if (matchedIn.indexOf('title') < 0) matchedIn.push('title'); }
                if (v._channel.indexOf(t) !== -1) { ts += 30; if (matchedIn.indexOf('channel') < 0) matchedIn.push('channel'); }
                if (v._tldr.indexOf(t) !== -1) { ts += 20; if (matchedIn.indexOf('tldr') < 0) matchedIn.push('tldr'); }
                if (v._summary.indexOf(t) !== -1) { ts += 10; if (matchedIn.indexOf('summary') < 0) matchedIn.push('summary'); }
                if (ts === 0) { score = 0; matchedIn = []; break; }
                score += ts;
            }
            if (score > 0) scored.push({ v: v, score: score, matchedIn: matchedIn });
        });
        scored.sort(function (a, b) { return b.score - a.score || (a.v.date < b.v.date ? 1 : -1); });

        if (hero) hero.style.display = 'none';
        if (meta) {
            meta.hidden = false;
            document.getElementById('resultCount').textContent = scored.length;
        }
        try { history.replaceState(null, '', location.pathname + '?q=' + encodeURIComponent(q)); } catch (e) {}

        if (!scored.length) {
            content.innerHTML = '<div class="no-results">No results for <span class="nr-q">&ldquo;' + escapeHtml(q) + '&rdquo;</span></div>';
            return;
        }

        var byDate = {};
        scored.forEach(function (r) {
            (byDate[r.v.date] = byDate[r.v.date] || []).push(r);
        });
        var dates = Object.keys(byDate).sort().reverse();

        var html = '<ul class="day-list">';
        dates.forEach(function (d) {
            var rs = byDate[d];
            html += '<li class="day-card"><div class="day-head"><span class="day-date">' + formatDate(d) +
                '</span><span class="day-count">' + rs.length + (rs.length > 1 ? ' matches' : ' match') +
                '</span></div><div class="day-previews">';
            rs.forEach(function (r) { html += renderResult(r, terms); });
            html += '</div></li>';
        });
        html += '</ul>';
        content.innerHTML = html;
    }

    function renderResult(r, terms) {
        var v = r.v;
        var link = v.link || v.url;
        var pill = '';
        if (v.icon) {
            var subs = v.subs ? '<span class="subs">(' + escapeHtml(v.subs) + ')</span>' : '';
            pill = '<span class="pill"><img src="' + escapeHtml(v.icon) + '" alt="" loading="lazy"><b>' + escapeHtml(v.channel) + '</b>' + subs + '</span>';
        } else if (v.channel) {
            pill = '<span>' + escapeHtml(v.channel) + '</span>';
        }
        var parts = [];
        if (v.duration) parts.push(v.duration);
        if (v.views) parts.push(v.views);
        var details = parts.length ? '<span>' + escapeHtml(parts.join(' · ')) + '</span>' : '';
        var chips = (v.people || []).map(function (p) {
            return '<span class="chip chip-sm">' + highlightText(p, terms) + '</span>';
        }).join(' ');
        var title = v.title.length > 160 ? v.title.slice(0, 157) + '…' : v.title;
        var tldr = '';
        if (v.tldr) {
            var t = v.tldr.length > 180 ? v.tldr.slice(0, 177) + '…' : v.tldr;
            tldr = '<span class="p-tldr">' + highlightText(t, terms) + '</span>';
        }
        var excerpt = '';
        if (r.matchedIn.indexOf('summary') !== -1 && v.summary) {
            var ex = extractExcerpt(v.summary, terms);
            // suppress the excerpt when it just repeats the TL;DR shown above
            if (ex && v.tldr) {
                var exN = ex.replace(/[^A-Za-z0-9]+/g, '').toLowerCase();
                var tlN = v.tldr.replace(/[^A-Za-z0-9]+/g, '').toLowerCase();
                if (tlN && (exN.indexOf(tlN.slice(0, 60)) !== -1 || tlN.indexOf(exN.slice(0, 60)) !== -1)) ex = '';
            }
            if (ex) excerpt = '<span class="p-excerpt"><span class="excerpt-label">From summary&ensp;</span>' + highlightText(ex, terms) + '</span>';
        }
        return '<a class="preview" href="' + escapeHtml(link) + '">' +
            '<span class="p-title">' + highlightText(title, terms) + '</span>' +
            '<span class="p-meta">' + pill + details + chips + '</span>' +
            tldr + excerpt + '</a>';
    }

    function extractExcerpt(summary, terms) {
        var sentences = summary.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) || [summary];
        var best = '', bestScore = 0;
        for (var i = 0; i < sentences.length; i++) {
            var sLow = sentences[i].toLowerCase();
            var sc = 0;
            for (var j = 0; j < terms.length; j++) {
                if (sLow.indexOf(terms[j]) !== -1) sc++;
            }
            if (sc > bestScore) { bestScore = sc; best = sentences[i]; }
        }
        if (!best) return '';
        if (best.length > 240) {
            var idx = best.toLowerCase().indexOf(terms[0]);
            if (idx > 80) {
                var cut = best.substring(idx - 60);
                var sp = cut.indexOf(' ');
                if (sp > 0 && sp < 20) cut = cut.slice(sp + 1); // snap to a word boundary
                best = '…' + cut;
            }
            if (best.length > 240) best = best.substring(0, 237).replace(/\s+\S*$/, '') + '…';
        }
        return best;
    }

    // Highlight on RAW text, escaping each segment — never regex-replace into
    // an HTML string (a term matching inside <mark> tags or entities would
    // corrupt the markup).
    function highlightText(raw, terms) {
        if (!raw) return '';
        var parts = terms.filter(function (t) { return t.length >= 2; })
            .map(function (t) { return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); });
        if (!parts.length) return escapeHtml(raw);
        var re = new RegExp(parts.join('|'), 'gi');
        var out = '', last = 0, m;
        while ((m = re.exec(raw)) !== null) {
            out += escapeHtml(raw.slice(last, m.index)) + '<mark>' + escapeHtml(m[0]) + '</mark>';
            last = m.index + m[0].length;
            if (re.lastIndex === m.index) re.lastIndex++;
        }
        // merge marks separated only by whitespace ("Jensen" + "Huang" -> one box)
        return (out + escapeHtml(raw.slice(last))).replace(/<\/mark>(\s+)<mark>/g, '$1');
    }

    function escapeHtml(s) {
        if (!s) return '';
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function formatDate(d) {
        var months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        var p = d.split('-');
        return months[parseInt(p[1], 10) - 1] + ' ' + parseInt(p[2], 10) + ', ' + p[0];
    }

    input.addEventListener('input', function () {
        clearTimeout(debounceTimer);
        var val = this.value;
        debounceTimer = setTimeout(function () { doSearch(val); }, 160);
    });

    input.form && input.form.addEventListener('submit', function (e) {
        e.preventDefault();
        doSearch(input.value);
    });

    var clearBtn = document.getElementById('searchClear');
    if (clearBtn) clearBtn.addEventListener('click', function () { clearSearch(); input.focus(); });

    // Deep-linked search: index.html?q=...
    var m = location.search.match(/[?&]q=([^&]*)/);
    if (m && m[1]) {
        var q = decodeURIComponent(m[1].replace(/\+/g, ' '));
        input.value = q;
        doSearch(q);
    }
})();
