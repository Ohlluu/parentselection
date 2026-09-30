// Startup configuration checks, collected rather than fatal.
//
// These used to call process.exit(1) at import time. On a serverless host that
// surfaces as a bare "FUNCTION_INVOCATION_FAILED" 500 with no indication of
// what is wrong, and the logs are behind a dashboard. Collecting the problems
// lets the server answer every request with a page that names them.
const problems = [];

const secret = process.env.SESSION_SECRET || '';
if (!secret) {
  problems.push('SESSION_SECRET is not set. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
} else if (secret.length < 32) {
  problems.push('SESSION_SECRET is shorter than 32 characters.');
}

if (!process.env.DATABASE_URL && process.env.NODE_ENV === 'production') {
  problems.push('DATABASE_URL is not set. Connect a Postgres database to this project, then redeploy.');
}

module.exports = { problems };
