# Parent Election

A secret-ballot online election for parents across several sites. Each site
elects its own representative. The center can see **that** every parent voted,
and cannot see **who** they voted for.

Parents sign in with their email address plus a voting code you send them.
The app sends no email itself — you export the codes and distribute them
however you already reach parents (a mail merge from your own account works
well, and avoids spam filters better than an unfamiliar sender).

## How the privacy works

Two tables, no link between them:

- **`voters`** — the registry. Name, email, code, and a `has_voted` flag.
  This answers "did everyone vote?" and "who do we still need to chase?"
- **`ballots`** — the ballot box. Site and choice. No voter id, no timestamp,
  nothing pointing back at a person.

When a parent submits, one transaction flips their `has_voted` flag and fills
in a ballot. The two facts exist together only in memory, for the length of
that request. Nothing written to disk connects them.

Several details are load-bearing rather than cosmetic. Changing them quietly
breaks ballot secrecy:

- **No timestamps.** Not `created_at`, not `updated_at`, not `voted_at`. A
  timestamp on `voters` is a login-order log, and a login-order log next to
  the ballot box de-anonymizes it. If you add an ORM later, turn its automatic
  timestamp columns off.
- **Pre-seeded ballot box.** `election.js open` inserts one blank ballot per
  eligible parent before voting starts. Casting a vote *updates* a blank row
  chosen at random rather than appending, so insertion order says nothing.
- **`finalize` rewrites the ballot box.** Postgres stamps every row with the
  transaction that last wrote it (the hidden `xmin` column), so update order —
  which is vote order — is otherwise recoverable by anyone who can query the
  database. Rebuilding the table from a randomly ordered `SELECT` destroys it.
- **Sessions are a signed cookie, not a table.** The server keeps no record of
  who was signed in when.
- **No request logger.** An access log with IP, path and time rebuilds the
  order people voted. Don't add one during the voting window, and turn your
  host's log retention as low as it goes.

## Setup

```bash
npm install
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # paste into SESSION_SECRET
```

Leave `DATABASE_URL` blank locally and the app uses **PGlite** — real Postgres
compiled to WASM, stored in `./.pgdata` — so local testing runs the same SQL as
production with no database server to install. Set `DATABASE_URL` in production
and it talks to real Postgres instead.

> PGlite is an in-process database: only one process may open `.pgdata` at a
> time. Stop the server before running any script, or you'll get a clear
> "already open in process N" error. This does not apply once `DATABASE_URL`
> is set.

## Loading your data

Three CSVs, each with a header row. Column order doesn't matter.

**voters.csv** — leave `code` out and one is generated per parent.
```csv
site_id,site_name,full_name,email,code
site-a,Main Center,Maria Delgado,maria@example.org,
```

**candidates.csv**
```csv
site_id,name,blurb
site-a,Maria Delgado,Parent of an enrolled child
```

**admins.csv** — `role` is `super` (sees every site, and every code) or
`site` (sees one site's turnout, and no codes).
```csv
email,full_name,role,site_id,code
you@yourcenter.org,Funder Admin,super,,
coord@sitea.org,Site A Coordinator,site,site-a,
```

```bash
node scripts/import-roster.js voters     rosters/voters.csv
node scripts/import-roster.js candidates rosters/candidates.csv
node scripts/import-roster.js admins     rosters/admins.csv
```

The import flags duplicate emails rather than skipping them silently — two
guardians sharing one address would otherwise cost one of them their vote.
Re-running updates existing rows instead of duplicating them, leaves codes
already sent out unchanged, and refuses to touch anyone who has already voted.

## Running the election

```bash
node scripts/election.js status              # turnout + reconciliation, any time
node scripts/election.js codes codes.csv     # export every parent's code
node scripts/election.js seats site-a 2      # only if a site elects more than 1
node scripts/election.js open all            # seeds ballots, voting begins
node scripts/election.js close all           # voting ends
node scripts/election.js finalize            # shuffle the box, then read results
node scripts/election.js results site-a
```

`open` refuses a site with no candidates, or fewer candidates than seats.
`finalize` refuses to run while any site is still open.

Start the server with `npm start` (or `npm run dev` to auto-reload).

- Parents: `/`
- Admins: `/admin`

## What each admin sees

| | Super admin | Site coordinator |
|---|---|---|
| Turnout, all sites | yes | own site only |
| Who has / hasn't voted, by name | yes | own site only |
| **Voting codes** | yes | **no** |
| Issue a replacement code | yes | no |
| CSV export | with codes | without codes |
| Results | after close | after close **and** release |
| Release results to a site | yes | no |

Results stay sealed until a site closes. A running tally visible during voting
would let anyone watching the count change after a known parent votes work out
how they voted.

Codes are deliberately super-admin only. A code is enough to cast that
parent's ballot, so whoever can see the list can vote as anyone who hasn't yet.
That is the accepted tradeoff of a code-based system — keep the exported CSV as
carefully as you'd keep a stack of blank ballots.

## Reconciliation

`election.js status` compares voters marked as having voted against ballots in
the box, per site. They are written in the same transaction, so they must
always agree. If they ever diverge, something is wrong and the result should
not be certified. The admin console shows the same check per site card.

This is the audit artifact for a funder or federal review: it evidences that
the election was properly conducted without touching ballot secrecy.

## Things to decide before you run it

- **Small sites.** At ~20 voters a site, a published tally like 12-6-2 says
  more than you may want. Consider announcing winners only.
- **The last voter.** When 19 of 20 have voted, the remaining ballot is close
  to attributable. Don't publicize per-name turnout in the final days.
- **Unanimity.** A 20-0 result makes everyone's vote public. That's arithmetic,
  not a bug.
- **Backups.** Snapshot before opening and after finalizing, not continuously.
  Point-in-time recovery lets someone diff two moments and see which ballot
  appeared as a given parent's flag flipped. On a managed Postgres, turn
  history retention as low as the plan allows for the duration.
- **Ties.** Reported, never auto-resolved. Your bylaws decide.

## Deploying

Needs Node and a Postgres database. On Vercel, add Postgres from the project's
Storage tab and it sets `DATABASE_URL` for you; run `election.js migrate` once
against it before loading data. Set `NODE_ENV=production` so the session cookie
is marked `Secure`, and turn function log retention down — those logs are a
request-order record.

`RATE_LIMIT_LOGIN` caps sign-in attempts per IP per 15 minutes (default 60).
Several parents can share one IP on a center's wifi, so don't set it too tight;
guessing one parent's code is capped separately at 10 wrong attempts, after
which a super admin has to unlock them.
