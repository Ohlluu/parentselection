(function () {
  'use strict';
  var token = new URLSearchParams(window.location.hash.slice(1)).get('token');
  var container = document.getElementById('shared-centers');
  var message = document.getElementById('results-message');
  var refresh = document.getElementById('refresh-results');
  var print = document.getElementById('print-results');
  function el(tag, text, className) {
    var node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  async function load() {
    refresh.disabled = true;
    print.disabled = true;
    message.textContent = 'Loading results…';
    try {
      if (!token) throw new Error('This results link is incomplete. Ask an admin for a new Share results link.');
      var response = await fetch('/api/shared-results', { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store', credentials: 'omit' });
      if (response.status === 401) throw new Error('This results link is invalid or expired. Ask an admin for a new Share results link.');
      if (!response.ok) throw new Error('Could not load results. Please try Refresh.');
      var data = await response.json();
      container.innerHTML = '';
      data.sites.forEach(function (site) {
        var card = el('article', undefined, 'site-card');
        card.appendChild(el('h3', site.name));
        card.appendChild(el('p', site.status === 'open' ? 'Voting is open · current weighted votes' : site.status === 'closed' ? 'Voting is closed · weighted vote totals' : 'Voting has not opened', 'meta'));
        site.candidateContests.forEach(function (contest) {
          var table = el('table', undefined, 'candidate-tally');
          table.appendChild(el('caption', contest.position + (contest.hasVotes ? '' : ' · No votes yet')));
          var head = el('thead');
          var headings = el('tr');
          ['Candidate', 'Votes'].forEach(function (label) { var th = el('th', label); th.scope = 'col'; headings.appendChild(th); });
          head.appendChild(headings);
          table.appendChild(head);
          var body = el('tbody');
          contest.candidates.forEach(function (candidate) {
            var row = el('tr');
            var name = el('td');
            if (candidate.leading) {
              name.appendChild(el('span', candidate.tied ? 'Tied for first' : site.status === 'closed' ? 'Highest votes' : 'Leading', 'candidate-leader' + (candidate.tied ? ' candidate-leader--tie' : '')));
            }
            name.appendChild(document.createTextNode(candidate.name));
            row.appendChild(name);
            row.appendChild(el('td', String(candidate.votes)));
            body.appendChild(row);
          });
          table.appendChild(body);
          card.appendChild(table);
        });
        if (!site.candidateContests.length) card.appendChild(el('p', 'No candidates added yet.', 'meta'));
        container.appendChild(card);
      });
      document.getElementById('results-updated').textContent = 'Updated ' + new Date().toLocaleString();
      message.textContent = '';
      print.disabled = false;
    } catch (error) {
      container.innerHTML = '';
      document.getElementById('results-updated').textContent = '';
      message.textContent = error.message || 'Could not load results. Please try Refresh.';
    } finally { refresh.disabled = false; }
  }
  refresh.addEventListener('click', load);
  print.addEventListener('click', function () { window.print(); });
  load();
})();
