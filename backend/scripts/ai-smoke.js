/**
 * Live smoke test for the configured AI provider.
 *
 * Makes exactly one tiny call to confirm: the key is valid, the base URL and
 * model id resolve, JSON mode works, and the response parses. Costs a fraction
 * of a cent. Prints no credentials.
 *
 *   node scripts/ai-smoke.js
 */
require('dotenv').config();
const { isAiConfigured, generateJson } = require('../dist/lib/ai');

(async () => {
  if (!isAiConfigured()) {
    console.log('AI is not configured — set AI_PROVIDER, AI_API_KEY and AI_MODEL in backend/.env');
    process.exit(1);
  }

  console.log('provider=', process.env.AI_PROVIDER, 'model=', process.env.AI_MODEL);
  const started = Date.now();

  try {
    const result = await generateJson([
      { role: 'system', content: 'You reply with strict JSON only, never prose.' },
      { role: 'user', content: 'Return exactly {"ok":true,"engine":"gemini"}' },
    ]);
    console.log('OK', JSON.stringify(result), `${((Date.now() - started) / 1000).toFixed(1)}s`);
  } catch (error) {
    console.log('FAIL', error.statusCode, error.code, '-', error.message);
    if (error.details) console.log('details:', JSON.stringify(error.details).slice(0, 400));
    process.exitCode = 1;
  }
})();
