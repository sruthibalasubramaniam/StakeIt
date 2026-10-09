/**
 * Global test setup.
 *
 * Runs before any test file imports `config/env`, so the environment it sees is
 * fully controlled here. Integration tests point at `TEST_DATABASE_URL` when
 * provided; otherwise they fall back to `DATABASE_URL` and skip gracefully if
 * no database is reachable.
 */
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.SCHEDULER_ENABLED = 'false';
process.env.AUTH_PROVIDER = 'local';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test_secret_value_for_stake_it_suite_0123456789';
process.env.SIGNUP_WALLET_GRANT = process.env.SIGNUP_WALLET_GRANT ?? '1500';

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
