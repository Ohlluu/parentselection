(function () {
  'use strict';

  var state = { role: null, sites: [], currentSite: null };

  var $ = function (id) { return document.getElementById(id); };

  function banner(message, kind) {
    var el = $('banner');
    if (!message) { el.classList.add('hidden'); return; }
    el.textContent = message;
    el.className = 'notice notice--' + (kind || 'error');
  }

  function show(id) {
    ['admin-login', 'admin-overview', 'admin-roster', 'admin-results'].forEach(function (section) {
      $(section).classList.toggle('hidden', section !== id);
    });
    window.scrollTo(0, 0);
  }

  async function api(url, body) {
    var response = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin'
    });
    var payload = {};
    try { payload = await response.json(); } catch (err) { /* empty body */ }
    if (!response.ok) throw payload;
    return payload;
  }

  var MESSAGES = {
    not_an_admin: 'That email is not registered as an admin.',
    bad_code: 'That access code is not correct.',
    locked: 'Too many incorrect codes. This account is locked.',
    not_closed: 'Voting is still open at this site. Results stay sealed until it closes.',
    not_released: 'Results have not been released yet.',
    forbidden: 'You do not have access to that.',
    already_voted: 'That parent has already voted, so their code cannot be changed.',
    not_signed_in: 'Your session has ended. Please sign in again.'
  };

  function messageFor(payload) {
    return (payload && MESSAGES[payload.error]) || 'Something went wrong.';
  }

  // --- sign in ------------------------------------------------------------

  $('form-admin-login').addEventListener('submit', async function (event) {
    event.preventDefault();
    banner('');
    try {
      var result = await api('/api/admin/auth/login', {
        email: $('admin-email').value.trim(),
        code: $('admin-code').value.trim()
      });
      state.role = result.role;
      await loadOverview();
    } catch (payload) {
      banner(messageFor(payload));
    }
  });

  $('admin-code').addEventListener('input', function () {
    var raw = this.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 10);
    this.value = raw.length > 4 ? raw.slice(0, 4) + '-' + raw.slice(4) : raw;
  });

  // --- overview -----------------------------------------------------------

  function statTile(label, value, note) {
    var card = document.createElement('div');
    card.className = 'site-card';

    var heading = document.createElement('p');
    heading.className = 'meta';
    heading.style.margin = '0 0 4px';
    heading.textContent = label;

    var figure = document.createElement('div');
    figure.className = 'turnout-figure';
    var count = document.createElement('span');
    count.className = 'count';
    count.textContent = value;
    figure.appendChild(count);

    card.appendChild(heading);
    card.appendChild(figure);

    var noteEl = document.createElement('p');
    noteEl.className = 'meta';
    noteEl.style.margin = '0';
    noteEl.textContent = note || ' ';
    card.appendChild(noteEl);

    return card;
  }

  function siteCard(site) {
    var card = document.createElement('div');
    card.className = 'site-card';

    var title = document.createElement('h3');
    title.textContent = site.name;

    var pill = document.createElement('span');
    pill.className = 'pill pill--' + site.status;
    pill.textContent = site.status;

    var meta = document.createElement('p');
    meta.className = 'meta';
    meta.appendChild(pill);
    meta.appendChild(document.createTextNode(' · ' + site.seats + ' seat' + (site.seats === 1 ? '' : 's')));

    var complete = site.eligible > 0 && site.voted === site.eligible;

    var figure = document.createElement('div');
    figure.className = 'turnout-figure';
    var count = document.createElement('span');
    count.className = 'count';
    count.textContent = String(site.voted);
    var of = document.createElement('span');
    of.className = 'of';
    of.textContent = 'of ' + site.eligible + ' voted' + (complete ? ' · all voted' : '');
    figure.appendChild(count);
    figure.appendChild(of);

    var meter = document.createElement('div');
    meter.className = 'meter' + (complete ? ' is-complete' : '');
    meter.setAttribute('role', 'meter');
    meter.setAttribute('aria-valuemin', '0');
    meter.setAttribute('aria-valuemax', String(site.eligible));
    meter.setAttribute('aria-valuenow', String(site.voted));
    meter.setAttribute('aria-label', site.name + ' turnout');
    var fill = document.createElement('span');
    fill.style.width = (site.eligible ? (site.voted / site.eligible) * 100 : 0) + '%';
    meter.appendChild(fill);

    card.appendChild(title);
    card.appendChild(meta);
    card.appendChild(figure);
    card.appendChild(meter);

    // The registry and the ballot box are written in one transaction, so these
    // two counts must always agree. If they ever don't, say so loudly.
    if (site.voted !== site.ballots_cast) {
      var warning = document.createElement('p');
      warning.className = 'meta';
      warning.style.color = 'var(--status-critical)';
      warning.style.marginTop = '10px';
      warning.textContent = 'Mismatch: ' + site.voted + ' marked voted but ' + site.ballots_cast + ' ballots cast.';
      card.appendChild(warning);
    }

    var actions = document.createElement('div');
    actions.className = 'row-actions';

    var rosterButton = document.createElement('button');
    rosterButton.type = 'button';
    rosterButton.textContent = state.role === 'super' ? 'Parents & codes' : 'Who has voted';
    rosterButton.addEventListener('click', function () { loadRoster(site); });
    actions.appendChild(rosterButton);

    var exportLink = document.createElement('a');
    exportLink.href = '/api/admin/export/' + encodeURIComponent(site.id);
    exportLink.textContent = 'Export CSV';
    actions.appendChild(exportLink);

    if (site.status === 'closed') {
      var resultsButton = document.createElement('button');
      resultsButton.type = 'button';
      resultsButton.textContent = 'Results';
      resultsButton.addEventListener('click', function () { loadResults(site); });
      actions.appendChild(resultsButton);

      if (state.role === 'super' && !site.results_released) {
        var releaseButton = document.createElement('button');
        releaseButton.type = 'button';
        releaseButton.textContent = 'Release to site';
        releaseButton.addEventListener('click', async function () {
          try {
            await api('/api/admin/release/' + encodeURIComponent(site.id), {});
            await loadOverview();
          } catch (payload) {
            banner(messageFor(payload));
          }
        });
        actions.appendChild(releaseButton);
      }
    }

    card.appendChild(actions);
    return card;
  }

  async function loadOverview() {
    var data;
    try {
      data = await api('/api/admin/overview');
    } catch (payload) {
      banner(messageFor(payload));
      show('admin-login');
      return;
    }

    state.role = data.role;
    state.sites = data.sites;

    var eligible = data.sites.reduce(function (sum, s) { return sum + s.eligible; }, 0);
    var voted = data.sites.reduce(function (sum, s) { return sum + s.voted; }, 0);
    var outstanding = eligible - voted;

    var kpi = $('kpi-row');
    kpi.innerHTML = '';
    kpi.appendChild(statTile('Eligible parents', String(eligible), data.sites.length + ' site(s)'));
    kpi.appendChild(statTile('Voted', String(voted), eligible ? Math.round((voted / eligible) * 100) + '% turnout' : ''));
    kpi.appendChild(statTile('Still to vote', String(outstanding), outstanding === 0 ? 'Everyone has voted' : ''));

    var grid = $('site-grid');
    grid.innerHTML = '';
    data.sites.forEach(function (site) { grid.appendChild(siteCard(site)); });

    $('admin-sub').textContent = data.role === 'super' ? 'All sites' : 'Your site';
    renderHeaderActions(true);
    banner('');
    show('admin-overview');
  }

  function renderHeaderActions(signedIn) {
    var container = $('header-actions');
    container.innerHTML = '';
    if (!signedIn) return;

    var back = document.createElement('button');
    back.type = 'button';
    back.textContent = 'Overview';
    back.addEventListener('click', loadOverview);
    container.appendChild(back);

    var out = document.createElement('button');
    out.type = 'button';
    out.textContent = 'Sign out';
    out.addEventListener('click', async function () {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
      state.role = null;
      renderHeaderActions(false);
      show('admin-login');
    });
    container.appendChild(out);
  }

  // --- roster & codes -----------------------------------------------------

  function cell(row, text, className) {
    var td = document.createElement('td');
    td.textContent = text;
    if (className) td.className = className;
    row.appendChild(td);
    return td;
  }

  async function loadRoster(site) {
    banner('');
    state.currentSite = site;

    var data;
    try {
      data = await api('/api/admin/turnout/' + encodeURIComponent(site.id));
    } catch (payload) {
      banner(messageFor(payload));
      return;
    }

    var outstanding = data.voters.filter(function (v) { return !v.has_voted; }).length;
    $('roster-title').textContent = site.name;
    $('roster-lede').textContent = outstanding === 0
      ? 'All ' + data.voters.length + ' parents have voted.'
      : outstanding + ' of ' + data.voters.length + ' parents still to vote.';

    var headRow = document.createElement('tr');
    ['Name', 'Email'].concat(data.showCodes ? ['Code'] : []).concat(['Voted'])
      .concat(data.showCodes ? [''] : [])
      .forEach(function (label) {
        var th = document.createElement('th');
        th.textContent = label;
        headRow.appendChild(th);
      });
    $('roster-head').innerHTML = '';
    $('roster-head').appendChild(headRow);

    var body = $('roster-body');
    body.innerHTML = '';

    data.voters.forEach(function (voter) {
      var tr = document.createElement('tr');
      cell(tr, voter.full_name);
      cell(tr, voter.email);

      if (data.showCodes) {
        var codeCell = cell(tr, voter.code || '');
        codeCell.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, monospace';
        codeCell.style.letterSpacing = '0.04em';
      }

      var locked = voter.failed_attempts >= 10;
      cell(tr, voter.has_voted ? 'Voted' : (locked ? 'Locked' : 'Not yet'),
           voter.has_voted ? 'status-yes' : 'status-no');

      if (data.showCodes) {
        var actionCell = document.createElement('td');
        if (!voter.has_voted) {
          var newCode = document.createElement('button');
          newCode.type = 'button';
          newCode.textContent = 'New code';
          newCode.style.font = 'inherit';
          newCode.style.fontSize = '13px';
          newCode.style.padding = '4px 10px';
          newCode.style.cursor = 'pointer';
          newCode.addEventListener('click', async function () {
            try {
              await api('/api/admin/regenerate/' + encodeURIComponent(voter.id), {});
              banner('New code issued for ' + voter.full_name + '. Send it to them.', 'good');
              await loadRoster(site);
            } catch (payload) {
              banner(messageFor(payload));
            }
          });
          actionCell.appendChild(newCode);
        }
        tr.appendChild(actionCell);
      }

      body.appendChild(tr);
    });

    show('admin-roster');
  }

  // --- results ------------------------------------------------------------

  async function loadResults(site) {
    banner('');
    var data;
    try {
      data = await api('/api/admin/results/' + encodeURIComponent(site.id));
    } catch (payload) {
      banner(messageFor(payload));
      return;
    }

    $('results-title').textContent = data.site.name + ' — votes per candidate';
    $('results-lede').textContent =
      data.ballotsCast + ' ballots cast for ' + data.site.seats + ' seat' + (data.site.seats === 1 ? '' : 's') + '.';

    var max = data.results.reduce(function (m, c) { return Math.max(m, c.votes); }, 0) || 1;

    var body = $('results-body');
    body.innerHTML = '';

    data.results.forEach(function (candidate, index) {
      var elected = index < data.site.seats;

      var li = document.createElement('li');
      if (elected) li.className = 'is-elected';

      var label = document.createElement('div');
      label.className = 'bar-label';

      var name = document.createElement('span');
      if (elected) name.className = 'elected';
      name.textContent = candidate.name + (elected ? ' — elected' : '');

      // Value at the tip of the bar, in a text token rather than the mark color.
      var votes = document.createElement('span');
      votes.className = 'votes';
      votes.textContent = candidate.votes;

      label.appendChild(name);
      label.appendChild(votes);

      var track = document.createElement('div');
      track.className = 'bar-track';
      var fill = document.createElement('span');
      fill.className = 'bar-fill';
      fill.style.width = ((candidate.votes / max) * 100) + '%';
      track.appendChild(fill);

      li.appendChild(label);
      li.appendChild(track);
      body.appendChild(li);
    });

    $('results-key').textContent = data.tieAtCutoff
      ? 'There is a tie at the cutoff for the last seat. Resolve it under your bylaws — the ordering here does not decide it.'
      : '';

    show('admin-results');
  }

  // --- boot ---------------------------------------------------------------

  (async function boot() {
    try {
      var session = await api('/api/session');
      if (session.kind === 'admin') {
        await loadOverview();
        return;
      }
    } catch (err) { /* fall through to sign-in */ }
    renderHeaderActions(false);
    show('admin-login');
  })();
})();
