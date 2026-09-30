require('dotenv').config();

const express = require('express');
const rateLimit = require('express-rate-limit');
const path = require('path');

const { run, get, all, transaction } = require('./db');
const auth = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json());

// If the app is misconfigured, say so on every request instead of letting
// routes fail in ways that look like bugs. Sits ahead of the static files so
// the diagnostic shows rather than a voting page that cannot work.
const { problems } = require('./config');
if (problems.length) {
  console.error('Startup configuration problems:\n - ' + problems.join('\n - '));
  app.use((req, res) => {
    const items = problems
      .map((p) => `<li>${p.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</li>`)
      .join('');
    res.status(503).type('html').send(
      `<!doctype html><meta charset="utf-8"><title>Not configured</title>
       <div style="font-family:system-ui,sans-serif;max-width:640px;margin:60px auto;padding:0 20px;line-height:1.6">
         <h1 style="font-size:22px">This election site is not configured yet</h1>
         <p style="color:#5b6b7c">Voting is not open. An administrator needs to set the following
         environment variables and redeploy:</p>
         <ul style="color:#b3261e">${items}</ul>
       </div>`
    );
  });
}

app.use(express.static(path.join(__dirname, 'public')));

// PRIVACY: no request logger is installed on purpose. An access log with IP +
// path + timestamp reconstructs the order people voted, which combined with
// the ballot box would undo ballot secrecy. If you add a logger for debugging,
// exclude /api/vote and /api/auth/*, or turn it off during the voting window.

// Caps requests per IP. Several parents can share one - a center's wifi, or
// two guardians on one home connection - so these are deliberately loose.
// Guessing a specific person's code is bounded separately by MAX_FAILED_ATTEMPTS.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_LOGIN || 60),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
});

// --- voter sign-in --------------------------------------------------------

app.post('/api/auth/login', loginLimiter, async (req, res) => {
  try {
    const email = auth.normalizeEmail(req.body.email);
    const code = req.body.code;

    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'bad_email' });
    }

    const voter = await get(
      `SELECT v.id, v.code, v.has_voted, v.failed_attempts, s.status
         FROM voters v JOIN sites s ON s.id = v.site_id
        WHERE v.email = ?`,
      [email]
    );

    // We say plainly that an address is not on the list. Hiding it just sends
    // parents in circles; the roster is not the secret, the ballot is.
    if (!voter) return res.status(404).json({ error: 'not_on_roster' });
    if (voter.failed_attempts >= auth.MAX_FAILED_ATTEMPTS) {
      return res.status(429).json({ error: 'locked' });
    }

    if (!auth.codesMatch(code, voter.code)) {
      await run('UPDATE voters SET failed_attempts = failed_attempts + 1 WHERE id = ?', [voter.id]);
      return res.status(401).json({ error: 'bad_code' });
    }

    // Check these only after the code is verified, so the page can't be used
    // to discover who has voted without knowing their code.
    if (voter.status !== 'open') return res.status(409).json({ error: 'not_open' });
    if (voter.has_voted) return res.status(409).json({ error: 'already_voted' });

    if (voter.failed_attempts > 0) {
      await run('UPDATE voters SET failed_attempts = 0 WHERE id = ?', [voter.id]);
    }

    auth.setSessionCookie(res, auth.issueSession({ kind: 'voter', vid: voter.id }));
    res.json({ ok: true });
  } catch (err) {
    console.error('auth/login failed:', err.message);
    res.status(500).json({ error: 'server_error' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

function requireVoter(req, res, next) {
  const session = auth.sessionFromRequest(req);
  if (!session || session.kind !== 'voter') {
    return res.status(401).json({ error: 'not_signed_in' });
  }
  req.voterId = session.vid;
  next();
}

// --- ballot ---------------------------------------------------------------

app.get('/api/ballot', requireVoter, async (req, res) => {
  try {
    const voter = await get(
      `SELECT v.id, v.full_name, v.has_voted, s.id AS site_id, s.name AS site_name,
              s.seats, s.status
         FROM voters v JOIN sites s ON s.id = v.site_id
        WHERE v.id = ?`,
      [req.voterId]
    );
    if (!voter) return res.status(401).json({ error: 'not_signed_in' });

    const candidates = await all(
      `SELECT id, name, blurb FROM candidates WHERE site_id = ? ORDER BY sort_order, name`,
      [voter.site_id]
    );

    res.json({
      voterName: voter.full_name,
      siteName: voter.site_name,
      seats: voter.seats,
      status: voter.status,
      hasVoted: voter.has_voted,
      candidates,
    });
  } catch (err) {
    console.error('ballot failed:', err.message);
    res.status(500).json({ error: 'server_error' });
  }
});

app.post('/api/vote', requireVoter, async (req, res) => {
  try {
    const choices = Array.isArray(req.body.choiceIds) ? req.body.choiceIds : [];

    const voter = await get(
      `SELECT v.id, v.site_id, v.has_voted, s.seats, s.status
         FROM voters v JOIN sites s ON s.id = v.site_id
        WHERE v.id = ?`,
      [req.voterId]
    );
    if (!voter) return res.status(401).json({ error: 'not_signed_in' });
    if (voter.status !== 'open') return res.status(409).json({ error: 'not_open' });
    if (voter.has_voted) return res.status(409).json({ error: 'already_voted' });

    const unique = [...new Set(choices)];
    if (unique.length === 0) return res.status(400).json({ error: 'no_selection' });
    if (unique.length > voter.seats) return res.status(400).json({ error: 'too_many_selections' });

    // Every choice must be a real candidate at this voter's own site.
    const placeholders = unique.map(() => '?').join(',');
    let valid;
    try {
      valid = await all(
        `SELECT id FROM candidates WHERE site_id = ? AND id IN (${placeholders})`,
        [voter.site_id, ...unique]
      );
    } catch {
      // A malformed id fails the UUID cast rather than matching nothing.
      return res.status(400).json({ error: 'invalid_choice' });
    }
    if (valid.length !== unique.length) return res.status(400).json({ error: 'invalid_choice' });

    // THE ONE PLACE identity and choice exist together, and only in memory for
    // the length of this transaction. Either both happen or neither: the
    // registry records that this parent voted, and a randomly chosen blank
    // ballot at their site is filled in. Nothing written links the two.
    const outcome = await transaction(async (tx) => {
      // FOR UPDATE so two tabs submitting at once cannot both pass the check.
      const fresh = await tx.get('SELECT has_voted FROM voters WHERE id = ? FOR UPDATE', [voter.id]);
      if (fresh.has_voted) return 'already_voted';

      await tx.run('UPDATE voters SET has_voted = TRUE WHERE id = ?', [voter.id]);

      const result = await tx.run(
        `UPDATE ballots SET filled = TRUE, choice_ids = ?
          WHERE id = (SELECT id FROM ballots
                       WHERE site_id = ? AND filled = FALSE
                       ORDER BY random() LIMIT 1
                       FOR UPDATE SKIP LOCKED)`,
        [JSON.stringify([...unique].sort()), voter.site_id]
      );
      if (result.changes !== 1) throw new Error('no blank ballot available');
      return 'ok';
    });

    if (outcome === 'already_voted') return res.status(409).json({ error: 'already_voted' });

    // End the session immediately - nothing more to do, and no reason to leave
    // an authenticated cookie sitting on a shared or family phone.
    auth.clearSessionCookie(res);
    res.json({ ok: true });
  } catch (err) {
    console.error('vote failed:', err.message);
    res.status(500).json({ error: 'vote_failed' });
  }
});

// --- admin sign-in --------------------------------------------------------

app.post('/api/admin/auth/login', loginLimiter, async (req, res) => {
  try {
    const email = auth.normalizeEmail(req.body.email);
    const admin = await get(
      'SELECT id, code, role, site_id, failed_attempts FROM admins WHERE email = ?',
      [email]
    );
    if (!admin) return res.status(404).json({ error: 'not_an_admin' });
    if (admin.failed_attempts >= auth.MAX_FAILED_ATTEMPTS) {
      return res.status(429).json({ error: 'locked' });
    }
    if (!auth.codesMatch(req.body.code, admin.code)) {
      await run('UPDATE admins SET failed_attempts = failed_attempts + 1 WHERE id = ?', [admin.id]);
      return res.status(401).json({ error: 'bad_code' });
    }
    if (admin.failed_attempts > 0) {
      await run('UPDATE admins SET failed_attempts = 0 WHERE id = ?', [admin.id]);
    }

    auth.setSessionCookie(
      res,
      auth.issueSession({ kind: 'admin', aid: admin.id, role: admin.role, site: admin.site_id })
    );
    res.json({ ok: true, role: admin.role });
  } catch (err) {
    console.error('admin login failed:', err.message);
    res.status(500).json({ error: 'server_error' });
  }
});

function requireAdmin(req, res, next) {
  const session = auth.sessionFromRequest(req);
  if (!session || session.kind !== 'admin') {
    return res.status(401).json({ error: 'not_signed_in' });
  }
  req.admin = session;
  next();
}

function requireSuper(req, res, next) {
  if (req.admin.role !== 'super') return res.status(403).json({ error: 'forbidden' });
  next();
}

// A site coordinator only ever sees their own site.
function visibleSites(admin) {
  return admin.role === 'super' ? null : [admin.site];
}

function canSeeSite(admin, siteId) {
  const only = visibleSites(admin);
  return !only || only.includes(siteId);
}

// --- admin: turnout -------------------------------------------------------

app.get('/api/admin/overview', requireAdmin, async (req, res) => {
  try {
    const only = visibleSites(req.admin);
    const filter = only ? `WHERE s.id IN (${only.map(() => '?').join(',')})` : '';
    const params = only || [];

    // COUNT() is a bigint, which node-pg hands back as a string. Cast to int
    // or the dashboard ends up doing "18" + "21" = "1821".
    const sites = await all(
      `SELECT s.id, s.name, s.seats, s.status, s.results_released,
              (SELECT COUNT(*)::int FROM voters v WHERE v.site_id = s.id) AS eligible,
              (SELECT COUNT(*)::int FROM voters v WHERE v.site_id = s.id AND v.has_voted) AS voted,
              (SELECT COUNT(*)::int FROM ballots b WHERE b.site_id = s.id AND b.filled) AS ballots_cast
         FROM sites s ${filter}
        ORDER BY s.name`,
      params
    );

    res.json({ role: req.admin.role, sites });
  } catch (err) {
    console.error('admin/overview failed:', err.message);
    res.status(500).json({ error: 'server_error' });
  }
});

app.get('/api/admin/turnout/:siteId', requireAdmin, async (req, res) => {
  try {
    if (!canSeeSite(req.admin, req.params.siteId)) return res.status(403).json({ error: 'forbidden' });

    // Ordered by name, never by anything hinting at when someone voted.
    // Codes are included only for a super admin - they are enough to vote with.
    const showCodes = req.admin.role === 'super';
    const voters = await all(
      `SELECT id, full_name, email, has_voted, failed_attempts${showCodes ? ', code' : ''}
         FROM voters WHERE site_id = ? ORDER BY full_name`,
      [req.params.siteId]
    );
    res.json({ voters, showCodes });
  } catch (err) {
    console.error('admin/turnout failed:', err.message);
    res.status(500).json({ error: 'server_error' });
  }
});

app.get('/api/admin/export/:siteId', requireAdmin, async (req, res) => {
  try {
    if (!canSeeSite(req.admin, req.params.siteId)) return res.status(403).json({ error: 'forbidden' });

    const showCodes = req.admin.role === 'super';
    const voters = await all(
      `SELECT full_name, email, has_voted${showCodes ? ', code' : ''}
         FROM voters WHERE site_id = ? ORDER BY full_name`,
      [req.params.siteId]
    );

    // Prefix anything Excel would treat as a formula. A name like "=cmd" in a
    // CSV is a well-known spreadsheet injection trick.
    const escape = (value) => {
      const text = String(value ?? '');
      const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
      return `"${safe.replace(/"/g, '""')}"`;
    };

    const header = showCodes ? ['name', 'email', 'code', 'voted'] : ['name', 'email', 'voted'];
    const rows = [
      header.join(','),
      ...voters.map((v) => {
        const cells = showCodes
          ? [v.full_name, v.email, v.code, v.has_voted ? 'yes' : 'no']
          : [v.full_name, v.email, v.has_voted ? 'yes' : 'no'];
        return cells.map(escape).join(',');
      }),
    ];

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="voters-${req.params.siteId}.csv"`);
    res.send(rows.join('\n'));
  } catch (err) {
    console.error('admin/export failed:', err.message);
    res.status(500).json({ error: 'server_error' });
  }
});

// Issues a fresh code for one parent, for "I never got mine" / "mine leaked".
app.post('/api/admin/regenerate/:voterId', requireAdmin, requireSuper, async (req, res) => {
  try {
    const voter = await get('SELECT id, has_voted FROM voters WHERE id = ?', [req.params.voterId]);
    if (!voter) return res.status(404).json({ error: 'no_such_voter' });
    if (voter.has_voted) return res.status(409).json({ error: 'already_voted' });

    const code = auth.generateCode();
    await run('UPDATE voters SET code = ?, failed_attempts = 0 WHERE id = ?', [code, voter.id]);
    res.json({ ok: true, code });
  } catch (err) {
    console.error('admin/regenerate failed:', err.message);
    res.status(500).json({ error: 'server_error' });
  }
});

// Clears a lockout after too many wrong codes, without changing the code.
app.post('/api/admin/unlock/:voterId', requireAdmin, requireSuper, async (req, res) => {
  try {
    const result = await run('UPDATE voters SET failed_attempts = 0 WHERE id = ?', [req.params.voterId]);
    if (result.changes !== 1) return res.status(404).json({ error: 'no_such_voter' });
    res.json({ ok: true });
  } catch (err) {
    console.error('admin/unlock failed:', err.message);
    res.status(500).json({ error: 'server_error' });
  }
});

// --- admin: results -------------------------------------------------------

app.get('/api/admin/results/:siteId', requireAdmin, async (req, res) => {
  try {
    if (!canSeeSite(req.admin, req.params.siteId)) return res.status(403).json({ error: 'forbidden' });

    const site = await get(
      'SELECT id, name, seats, status, results_released FROM sites WHERE id = ?',
      [req.params.siteId]
    );
    if (!site) return res.status(404).json({ error: 'no_such_site' });

    // Results stay sealed until voting closes. A running tally visible during
    // the election lets anyone watching the delta after a known parent votes
    // work out how they voted.
    if (site.status !== 'closed') return res.status(409).json({ error: 'not_closed' });
    if (!site.results_released && req.admin.role !== 'super') {
      return res.status(409).json({ error: 'not_released' });
    }

    const candidates = await all(
      'SELECT id, name FROM candidates WHERE site_id = ? ORDER BY sort_order, name',
      [req.params.siteId]
    );
    const ballots = await all(
      'SELECT choice_ids FROM ballots WHERE site_id = ? AND filled',
      [req.params.siteId]
    );

    // choice_ids is jsonb, so node-pg has already parsed it into an array.
    const tally = Object.fromEntries(candidates.map((c) => [c.id, 0]));
    for (const ballot of ballots) {
      for (const id of ballot.choice_ids || []) {
        if (id in tally) tally[id] += 1;
      }
    }

    const ranked = candidates
      .map((c) => ({ id: c.id, name: c.name, votes: tally[c.id] }))
      .sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));

    res.json({
      site: { id: site.id, name: site.name, seats: site.seats },
      ballotsCast: ballots.length,
      results: ranked,
      winners: ranked.slice(0, site.seats).map((c) => c.name),
      // A tie spanning the cutoff has to be resolved by your bylaws, not by
      // sort order, so surface it rather than quietly picking one.
      tieAtCutoff:
        ranked.length > site.seats && ranked[site.seats - 1].votes === ranked[site.seats].votes,
    });
  } catch (err) {
    console.error('admin/results failed:', err.message);
    res.status(500).json({ error: 'server_error' });
  }
});

app.post('/api/admin/release/:siteId', requireAdmin, requireSuper, async (req, res) => {
  try {
    const site = await get('SELECT status FROM sites WHERE id = ?', [req.params.siteId]);
    if (!site) return res.status(404).json({ error: 'no_such_site' });
    if (site.status !== 'closed') return res.status(409).json({ error: 'not_closed' });

    await run('UPDATE sites SET results_released = TRUE WHERE id = ?', [req.params.siteId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('admin/release failed:', err.message);
    res.status(500).json({ error: 'server_error' });
  }
});

app.get('/api/session', (req, res) => {
  const session = auth.sessionFromRequest(req);
  res.json({ kind: session ? session.kind : null, role: session ? session.role : null });
});

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// Only listen when run directly. Under Vercel the app is imported by
// api/index.js and the platform owns the listener.
if (require.main === module) {
  const listen = () =>
    app.listen(PORT, () => {
      console.log(`Parent election running on http://localhost:${PORT}`);
      console.log(`Admin console at http://localhost:${PORT}/admin`);
    });

  if (problems.length) {
    // Still serve, so the diagnostic page above can explain what is missing.
    listen();
  } else {
    // Touch the database before accepting traffic. Locally this claims the
    // PGlite directory at boot, so a script started afterwards fails with a
    // clear message instead of opening the same files alongside us.
    get('SELECT 1')
      .then(listen)
      .catch((err) => {
        console.error(`\nCould not open the database: ${err.message}\n`);
        process.exit(1);
      });
  }
}

module.exports = app;
