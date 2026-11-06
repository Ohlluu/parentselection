(function () {
  'use strict';

  var STRINGS = {
    en: {
      appTitle: 'Parent Election',
      appSub: 'Vote for your site representative',
      loginHeading: 'Sign in to vote',
      loginLede: 'Enter your email address and the voting code your center sent you.',
      emailLabel: 'Email address',
      codeLabel: 'Voting code',
      loginButton: 'Sign in',
      loginWorking: 'Checking...',
      loginHelp: 'Lost your code? Contact your center and they can send you a new one.',
      ballotButton: 'Cast my vote',
      ballotSending: 'Recording your vote...',
      ballotPrivacy: 'Your choice is stored separately from your name. Your center can see that you voted, but not who you voted for.',
      doneHeading: 'Your vote has been recorded',
      doneLede: 'Thank you. You can close this page now. You cannot vote again, and no one can see how you voted.',
      pickOne: 'Choose one.',
      selectedFor: 'Selected for {position}',
      uniqueHint: 'Choose a different person for each position.',
      flexibleHint: 'Choose three different people for any three positions. Leave one position unanswered.',
      clearSelection: 'Clear selection',
      errThree: 'Choose three different people across three positions, leaving one position unanswered.',
      errDuplicate: 'Please choose a different person for each position.',
      pickOneEach: 'There are {n} positions. Choose one candidate for each.',
      votingAt: 'Voting at {site}',
      languageLabel: 'Language',
      chairTitle: 'Chairperson',
      viceChairTitle: 'Vice Chairperson',
      secretaryTitle: 'Secretary',
      communityTitle: 'Community Rep',
      errCodeRequired: 'Please enter your voting code.',
      welcomeLabel: 'Your parent election',
      welcomeName: 'Welcome, {name}!',
      welcomeCenter: 'Your center: {site}',
      welcomeMessage: 'Your voice matters. Choose your representatives below, then cast your vote.',
      errBadEmail: 'Please enter a valid email address.',
      errNotOnRoster: 'That email is not on the voter list. Please check the spelling, or contact your center to have it added.',
      errBadCode: 'That code is not correct. Please check the message your center sent you.',
      errLocked: 'Too many incorrect codes. Contact your center to unlock your account.',
      errNotOpen: 'Voting is not open at your site right now.',
      errAlreadyVoted: 'Our records show you have already voted. Each parent can vote once.',
      errNoSelection: 'Please choose a candidate before voting.',
      errIncomplete: 'Please choose a candidate for every position. Still needed: {list}.',
      errTooMany: 'You have selected more candidates than there are seats.',
      errInvalidChoice: 'That candidate is not on your ballot. Please reload the page.',
      errSignedOut: 'Your session has ended. Please sign in again.',
      errGeneric: 'Something went wrong. Please try again.',
      errOffline: 'Could not reach the server. Check your connection and try again.'
    },
    es: {
      appTitle: 'Elección de Padres',
      appSub: 'Vote por su representante del centro',
      loginHeading: 'Inicie sesión para votar',
      loginLede: 'Ingrese su correo electrónico y el código de votación que su centro le envió.',
      emailLabel: 'Correo electrónico',
      codeLabel: 'Código de votación',
      loginButton: 'Iniciar sesión',
      loginWorking: 'Verificando...',
      loginHelp: '¿Perdió su código? Comuníquese con su centro y le enviarán uno nuevo.',
      ballotButton: 'Emitir mi voto',
      ballotSending: 'Registrando su voto...',
      ballotPrivacy: 'Su selección se guarda por separado de su nombre. Su centro puede ver que usted votó, pero no por quién votó.',
      doneHeading: 'Su voto ha sido registrado',
      doneLede: 'Gracias. Puede cerrar esta página. No puede votar otra vez, y nadie puede ver por quién votó.',
      pickOne: 'Elija uno.',
      selectedFor: 'Seleccionado para {position}',
      uniqueHint: 'Elija una persona diferente para cada puesto.',
      flexibleHint: 'Elija tres personas diferentes para tres puestos. Deje un puesto sin responder.',
      clearSelection: 'Borrar selección',
      errThree: 'Elija tres personas diferentes para tres puestos y deje uno sin responder.',
      errDuplicate: 'Elija una persona diferente para cada puesto.',
      pickOneEach: 'Hay {n} puestos. Elija un candidato para cada uno.',
      votingAt: 'Votando en {site}',
      languageLabel: 'Idioma',
      chairTitle: 'Presidente/a',
      viceChairTitle: 'Vicepresidente/a',
      secretaryTitle: 'Secretario/a',
      communityTitle: 'Representante de la comunidad',
      errCodeRequired: 'Ingrese su código de votación.',
      welcomeLabel: 'Su elección de padres',
      welcomeName: '¡Le damos la bienvenida, {name}!',
      welcomeCenter: 'Su centro: {site}',
      welcomeMessage: 'Su voz cuenta. Elija a sus representantes a continuación y luego emita su voto.',
      errBadEmail: 'Ingrese un correo electrónico válido.',
      errNotOnRoster: 'Ese correo electrónico no está en la lista de votantes. Verifique la ortografía o comuníquese con su centro.',
      errBadCode: 'Ese código no es correcto. Revise el mensaje que le envió su centro.',
      errLocked: 'Demasiados códigos incorrectos. Comuníquese con su centro para desbloquear su cuenta.',
      errNotOpen: 'La votación no está abierta en su centro en este momento.',
      errAlreadyVoted: 'Nuestros registros muestran que usted ya votó. Cada padre puede votar una vez.',
      errNoSelection: 'Elija un candidato antes de votar.',
      errIncomplete: 'Elija un candidato para cada puesto. Todavía falta: {list}.',
      errTooMany: 'Ha seleccionado más candidatos que puestos disponibles.',
      errInvalidChoice: 'Ese candidato no está en su boleta. Vuelva a cargar la página.',
      errSignedOut: 'Su sesión ha terminado. Inicie sesión de nuevo.',
      errGeneric: 'Algo salió mal. Inténtelo de nuevo.',
      errOffline: 'No se pudo conectar con el servidor. Revise su conexión e inténtelo de nuevo.'
    }
  };

  var ERROR_KEYS = {
    bad_email: 'errBadEmail',
    code_required: 'errCodeRequired',
    not_on_roster: 'errNotOnRoster',
    bad_code: 'errBadCode',
    locked: 'errLocked',
    not_open: 'errNotOpen',
    already_voted: 'errAlreadyVoted',
    no_selection: 'errNoSelection',
    incomplete_ballot: 'errIncomplete',
    invalid_choice: 'errInvalidChoice',
    duplicate_candidate: 'errDuplicate',
    three_selections_required: 'errThree',
    not_signed_in: 'errSignedOut'
  };

  var lang = (localStorage.getItem('pe_lang') === 'es') ? 'es' : 'en';
  var state = { positions: [], choices: {} };

  var $ = function (id) { return document.getElementById(id); };

  function t(key, vars) {
    var text = (STRINGS[lang] && STRINGS[lang][key]) || STRINGS.en[key] || key;
    if (vars) {
      Object.keys(vars).forEach(function (k) { text = text.replace('{' + k + '}', vars[k]); });
    }
    return text;
  }

  function positionLabel(position) {
    var keys = { chair: 'chairTitle', chairperson: 'chairTitle', 'vice chair': 'viceChairTitle', 'vice chairperson': 'viceChairTitle', secretary: 'secretaryTitle', 'community rep': 'communityTitle', 'community representative': 'communityTitle' };
    var key = keys[String(position).trim().toLowerCase()];
    return key ? t(key) : position;
  }

  function applyLanguage() {
    document.documentElement.lang = lang;
    document.title = t('appTitle');
    var nodes = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].textContent = t(nodes[i].getAttribute('data-i18n'));
    }
    var buttons = document.querySelectorAll('.lang button');
    for (var j = 0; j < buttons.length; j++) {
      buttons[j].setAttribute('aria-pressed', String(buttons[j].getAttribute('data-lang') === lang));
    }
    document.querySelector('.lang').setAttribute('aria-label', t('languageLabel'));
    document.querySelectorAll('.contest').forEach(function (block) {
      block.querySelector('h3').textContent = positionLabel(block.getAttribute('data-position'));
      block.querySelector('.contest-hint').textContent = t('pickOne');
    });
    updateBallotGreeting();
    if (state.error) showError(state.error);
  }

  function updateBallotGreeting() {
    if (!state.voterName) return;
    $('welcome-heading').textContent = t('welcomeName', { name: state.voterName });
    $('welcome-center').textContent = t('welcomeCenter', { site: state.siteName });
    $('ballot-heading').textContent = t('votingAt', { site: state.siteName });
    $('ballot-lede').textContent = state.flexible ? t('flexibleHint') : t('pickOneEach', { n: state.positions.length }) + (state.uniqueCandidates ? ' ' + t('uniqueHint') : '');
  }

  function updateAvailability() {
    var selected = {};
    document.querySelectorAll('#contests input:checked').forEach(function (input) {
      selected[input.dataset.person] = input.dataset.position;
    });
    document.querySelectorAll('#contests input').forEach(function (input) {
      var position = selected[input.dataset.person];
      var disabled = state.uniqueCandidates && position && position !== input.dataset.position;
      input.disabled = Boolean(disabled);
      var label = input.closest('.choice');
      label.classList.toggle('unavailable', Boolean(disabled));
      label.querySelector('.selection-note').textContent = disabled ? t('selectedFor', { position: positionLabel(position) }) : '';
    });
  }

  function showStep(id) {
    ['step-login', 'step-ballot', 'step-done'].forEach(function (step) {
      $(step).classList.toggle('hidden', step !== id);
    });
    window.scrollTo(0, 0);
  }

  function banner(message, kind) {
    state.error = null;
    var el = $('banner');
    if (!message) { el.classList.add('hidden'); return; }
    el.textContent = message;
    el.className = 'notice notice--' + (kind || 'error');
  }

  function errorText(payload) {
    var key = payload && payload.error && ERROR_KEYS[payload.error];
    if (payload && payload.offline) return t('errOffline');
    if (payload && payload.error === 'incomplete_ballot') return t('errIncomplete', { list: (payload.missing || []).map(positionLabel).join(', ') });
    return key ? t(key) : t('errGeneric');
  }

  function showError(payload) {
    banner(errorText(payload));
    state.error = payload;
  }

  async function api(url, body) {
    var response;
    try {
      response = await fetch(url, {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        credentials: 'same-origin'
      });
    } catch (err) {
      throw { offline: true };
    }
    var payload = {};
    try { payload = await response.json(); } catch (err) { /* empty body */ }
    if (!response.ok) throw payload;
    return payload;
  }

  function withButton(button, labelKey, work) {
    var original = button.textContent;
    button.disabled = true;
    button.textContent = t(labelKey);
    return work().finally(function () {
      button.disabled = false;
      button.textContent = button.dataset.i18n ? t(button.dataset.i18n) : original;
    });
  }

  // --- sign in ------------------------------------------------------------

  $('form-login').addEventListener('submit', function (event) {
    event.preventDefault();
    banner('');

    var email = $('email').value.trim();
    var code = $('code').value.trim();
    if (!$('email').validity.valid || !email) return showError({ error: 'bad_email' });
    if (!code) return showError({ error: 'code_required' });

    withButton(this.querySelector('button'), 'loginWorking', async function () {
      try {
        await api('/api/auth/login', { email: email, code: code });
        await loadBallot();
      } catch (payload) {
        if (payload && payload.error === 'already_voted') {
          banner('');
          showStep('step-done');
          return;
        }
        showError(payload);
      }
    });
  });

  // Codes are typed off a phone screen, so be forgiving about case and
  // punctuation and re-insert the dash as they type.
  $('code').addEventListener('input', function () {
    var raw = this.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 10);
    this.value = raw.length > 4 ? raw.slice(0, 4) + '-' + raw.slice(4) : raw;
  });

  // --- ballot -------------------------------------------------------------

  async function loadBallot() {
    var ballot = await api('/api/ballot');

    if (ballot.hasVoted) {
      banner('');
      showStep('step-done');
      return;
    }

    state.positions = ballot.contests.map(function (c) { return c.position; });
    state.choices = {};
    state.uniqueCandidates = ballot.uniqueCandidates;
    state.requiredSelections = ballot.requiredSelections ?? state.positions.length;
    state.flexible = state.requiredSelections < state.positions.length;

    state.voterName = ballot.voterName;
    state.siteName = ballot.siteName;
    updateBallotGreeting();

    var container = $('contests');
    container.innerHTML = '';

    ballot.contests.forEach(function (contest) {
      var block = document.createElement('section');
      block.className = 'contest';
      block.setAttribute('data-position', contest.position);

      var title = document.createElement('h3');
      title.textContent = positionLabel(contest.position);

      var hint = document.createElement('p');
      hint.className = 'contest-hint';
      hint.textContent = t('pickOne');

      var choices = document.createElement('div');
      choices.className = 'choices';

      contest.candidates.forEach(function (candidate) {
        var label = document.createElement('label');
        label.className = 'choice';

        var input = document.createElement('input');
        input.type = 'radio';
        // Grouping by position is what keeps the four contests independent.
        input.name = 'contest:' + contest.position;
        input.value = candidate.id;
        input.dataset.person = candidate.name.trim().toLowerCase();
        input.dataset.position = contest.position;

        var text = document.createElement('div');
        var name = document.createElement('div');
        name.className = 'name';
        name.textContent = candidate.name;
        text.appendChild(name);

        if (candidate.blurb) {
          var blurb = document.createElement('p');
          blurb.className = 'blurb';
          blurb.textContent = candidate.blurb;
          text.appendChild(blurb);
        }

        var note = document.createElement('p');
        note.className = 'selection-note';
        note.setAttribute('aria-live', 'polite');
        text.appendChild(note);
        label.appendChild(input);
        label.appendChild(text);
        choices.appendChild(label);

        input.addEventListener('change', function () {
          state.choices[contest.position] = candidate.id;
          block.classList.remove('needs-answer');
          updateAvailability();
          var siblings = choices.querySelectorAll('.choice');
          for (var i = 0; i < siblings.length; i++) {
            siblings[i].classList.toggle('selected', siblings[i].contains(input) && input.checked);
          }
        });
      });

      block.appendChild(title);
      block.appendChild(hint);
      block.appendChild(choices);
      if (state.flexible) {
        var clear = document.createElement('button');
        clear.type = 'button';
        clear.className = 'link';
        clear.dataset.i18n = 'clearSelection';
        clear.textContent = t('clearSelection');
        clear.addEventListener('click', function () {
          delete state.choices[contest.position];
          choices.querySelectorAll('input').forEach(function (input) { input.checked = false; });
          choices.querySelectorAll('.choice').forEach(function (label) { label.classList.remove('selected'); });
          updateAvailability();
        });
        block.appendChild(clear);
      }
      container.appendChild(block);
    });

    banner('');
    showStep('step-ballot');
  }

  $('form-ballot').addEventListener('submit', function (event) {
    event.preventDefault();
    banner('');

    // A parent votes once, so an unanswered contest is a forfeited vote
    // rather than a skipped question. Mark the gaps and stop.
    var missing = state.positions.filter(function (p) { return !state.choices[p]; });
    if (state.flexible && state.positions.length - missing.length !== state.requiredSelections) {
      showError({ error: 'three_selections_required' });
      return;
    }
    if (!state.flexible && missing.length) {
      var blocks = document.querySelectorAll('.contest');
      for (var i = 0; i < blocks.length; i++) {
        blocks[i].classList.toggle('needs-answer', missing.indexOf(blocks[i].getAttribute('data-position')) !== -1);
      }
      showError({ error: 'incomplete_ballot', missing: missing });
      document.querySelector('.contest.needs-answer').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    withButton($('submit-vote'), 'ballotSending', async function () {
      try {
        await api('/api/vote', { choices: state.choices });
        banner('');
        showStep('step-done');
      } catch (payload) {
        if (payload && payload.error === 'already_voted') {
          banner('');
          showStep('step-done');
          return;
        }
        showError(payload);
      }
    });
  });

  // --- language -----------------------------------------------------------

  var langButtons = document.querySelectorAll('.lang button');
  for (var i = 0; i < langButtons.length; i++) {
    langButtons[i].addEventListener('click', function () {
      lang = this.getAttribute('data-lang');
      localStorage.setItem('pe_lang', lang);
      applyLanguage();
      updateAvailability();
    });
  }

  applyLanguage();
})();
