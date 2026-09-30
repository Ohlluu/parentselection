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
      pickOne: 'Choose one candidate.',
      pickUpTo: 'Choose up to {n} candidates.',
      votingAt: 'Voting at {site}',
      errBadEmail: 'Please enter a valid email address.',
      errNotOnRoster: 'That email is not on the voter list. Please check the spelling, or contact your center to have it added.',
      errBadCode: 'That code is not correct. Please check the message your center sent you.',
      errLocked: 'Too many incorrect codes. Contact your center to unlock your account.',
      errNotOpen: 'Voting is not open at your site right now.',
      errAlreadyVoted: 'Our records show you have already voted. Each parent can vote once.',
      errNoSelection: 'Please choose a candidate before voting.',
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
      pickOne: 'Elija un candidato.',
      pickUpTo: 'Elija hasta {n} candidatos.',
      votingAt: 'Votando en {site}',
      errBadEmail: 'Ingrese un correo electrónico válido.',
      errNotOnRoster: 'Ese correo electrónico no está en la lista de votantes. Verifique la ortografía o comuníquese con su centro.',
      errBadCode: 'Ese código no es correcto. Revise el mensaje que le envió su centro.',
      errLocked: 'Demasiados códigos incorrectos. Comuníquese con su centro para desbloquear su cuenta.',
      errNotOpen: 'La votación no está abierta en su centro en este momento.',
      errAlreadyVoted: 'Nuestros registros muestran que usted ya votó. Cada padre puede votar una vez.',
      errNoSelection: 'Elija un candidato antes de votar.',
      errTooMany: 'Ha seleccionado más candidatos que puestos disponibles.',
      errInvalidChoice: 'Ese candidato no está en su boleta. Vuelva a cargar la página.',
      errSignedOut: 'Su sesión ha terminado. Inicie sesión de nuevo.',
      errGeneric: 'Algo salió mal. Inténtelo de nuevo.',
      errOffline: 'No se pudo conectar con el servidor. Revise su conexión e inténtelo de nuevo.'
    }
  };

  var ERROR_KEYS = {
    bad_email: 'errBadEmail',
    not_on_roster: 'errNotOnRoster',
    bad_code: 'errBadCode',
    locked: 'errLocked',
    not_open: 'errNotOpen',
    already_voted: 'errAlreadyVoted',
    no_selection: 'errNoSelection',
    too_many_selections: 'errTooMany',
    invalid_choice: 'errInvalidChoice',
    not_signed_in: 'errSignedOut'
  };

  var lang = (localStorage.getItem('pe_lang') === 'es') ? 'es' : 'en';
  var state = { seats: 1, selected: [] };

  var $ = function (id) { return document.getElementById(id); };

  function t(key, vars) {
    var text = (STRINGS[lang] && STRINGS[lang][key]) || STRINGS.en[key] || key;
    if (vars) {
      Object.keys(vars).forEach(function (k) { text = text.replace('{' + k + '}', vars[k]); });
    }
    return text;
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
  }

  function showStep(id) {
    ['step-login', 'step-ballot', 'step-done'].forEach(function (step) {
      $(step).classList.toggle('hidden', step !== id);
    });
    window.scrollTo(0, 0);
  }

  function banner(message, kind) {
    var el = $('banner');
    if (!message) { el.classList.add('hidden'); return; }
    el.textContent = message;
    el.className = 'notice notice--' + (kind || 'error');
  }

  function errorText(payload) {
    var key = payload && payload.error && ERROR_KEYS[payload.error];
    return key ? t(key) : t('errGeneric');
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
      button.textContent = original;
    });
  }

  // --- sign in ------------------------------------------------------------

  $('form-login').addEventListener('submit', function (event) {
    event.preventDefault();
    banner('');

    var email = $('email').value.trim();
    var code = $('code').value.trim();
    if (!email || !code) return;

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
        banner(payload.offline ? t('errOffline') : errorText(payload));
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

    state.seats = ballot.seats;
    state.selected = [];

    $('ballot-heading').textContent = t('votingAt', { site: ballot.siteName });
    $('ballot-lede').textContent = ballot.seats === 1 ? t('pickOne') : t('pickUpTo', { n: ballot.seats });

    var container = $('choices');
    container.innerHTML = '';

    ballot.candidates.forEach(function (candidate) {
      var label = document.createElement('label');
      label.className = 'choice';

      var input = document.createElement('input');
      input.type = ballot.seats === 1 ? 'radio' : 'checkbox';
      input.name = 'candidate';
      input.value = candidate.id;

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

      label.appendChild(input);
      label.appendChild(text);
      container.appendChild(label);

      input.addEventListener('change', function () { syncSelection(ballot.seats); });
    });

    banner('');
    showStep('step-ballot');
  }

  function syncSelection(seats) {
    var inputs = $('choices').querySelectorAll('input');
    state.selected = [];

    for (var i = 0; i < inputs.length; i++) {
      if (inputs[i].checked) state.selected.push(inputs[i].value);
    }

    // With more than one seat, stop the parent at the limit rather than
    // letting them submit a ballot the server will reject.
    var atLimit = seats > 1 && state.selected.length >= seats;
    for (var j = 0; j < inputs.length; j++) {
      inputs[j].disabled = atLimit && !inputs[j].checked;
      inputs[j].closest('.choice').classList.toggle('selected', inputs[j].checked);
    }
  }

  $('form-ballot').addEventListener('submit', function (event) {
    event.preventDefault();
    banner('');

    if (state.selected.length === 0) {
      banner(t('errNoSelection'));
      return;
    }

    withButton($('submit-vote'), 'ballotSending', async function () {
      try {
        await api('/api/vote', { choiceIds: state.selected });
        banner('');
        showStep('step-done');
      } catch (payload) {
        if (payload && payload.error === 'already_voted') {
          banner('');
          showStep('step-done');
          return;
        }
        banner(payload.offline ? t('errOffline') : errorText(payload));
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
    });
  }

  applyLanguage();
})();
