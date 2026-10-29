/**
 * Seeds a demonstration reading lesson for the MOOC reader.
 *
 * Why this exists: the seeded reading content is one or two lines per section,
 * which neither scrolls nor demonstrates the gating. This replaces it with five
 * multi-screen sections and a checkpoint between each pair, so a demo can show
 * that the next section stays locked until the knowledge check is passed.
 *
 * Idempotent: re-running replaces the sections/checkpoints of the target lesson
 * and republishes it. Learner section progress for that lesson is cascade-deleted
 * (the sections are rebuilt), which is expected for demo content.
 *
 *   node scripts/seed-demo-reading.js
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const COURSE_CODE = process.env.DEMO_COURSE_CODE || 'DEV-301';
const LESSON_TITLE = 'Reading: Building Type-Safe Systems at Scale';

const WORDS_PER_MINUTE = 200;

const wordCount = (html) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

/* -------------------------------------------------------------------------- */
/* Content                                                                     */
/* -------------------------------------------------------------------------- */

const SECTIONS = [
  {
    title: 'Why types are architecture',
    body: `
<h2>Why types are architecture</h2>
<p>Most teams treat the type system as decoration applied after the design is settled — a coat of paint over a structure that was already standing. In a TypeScript codebase that habit is expensive, because the type system is the only part of the design that the compiler can check for you. When you model the domain honestly, the compiler becomes a reviewer that never gets bored, never forgets the edge case you discussed six weeks ago, and never approves a change it has not read.</p>
<p>Architecture is the set of decisions that are hard to reverse: where the boundaries sit, which module owns which fact, what happens when two parts of the system disagree. Types describe exactly that. A function signature is a boundary. A union is a decision about which states are legal. An <code>interface</code> is a contract about who may depend on whom. None of these are cosmetic; each one closes off some futures and keeps others open.</p>
<blockquote>If a rule matters, put it somewhere the compiler can enforce it. If it lives only in a document, it will be violated the first time someone is in a hurry.</blockquote>
<p>Consider how a single unmodelled state propagates. A course enrolment is <em>pending</em>, <em>active</em>, <em>completed</em> or <em>failed</em>. Represent that as three booleans and you have created sixteen combinations, twelve of which are nonsense. Every consumer of those flags now has to guess which combinations can actually occur, and each guess is an unwritten rule. Represent it as a union and the nonsense combinations cannot be constructed at all.</p>
<ul>
<li><strong>Types carry design intent.</strong> A parameter named <code>attemptId: string</code> tells you nothing; a branded <code>AttemptId</code> tells you it came from the attempt table and must not be confused with a content id.</li>
<li><strong>Types localise change.</strong> Renaming a domain concept should produce a list of compile errors, not a list of runtime surprises in production.</li>
<li><strong>Types document time.</strong> A comment describing a state machine rots; a discriminated union does not.</li>
</ul>
<p>The cost is real: modelling takes longer at the start, and a stricter model sometimes forces an awkward refactor when the domain shifts. That is the trade you are making deliberately — pay a little now, or pay interest later at a moment you do not choose.</p>
`,
    checkpoint: {
      title: 'Knowledge check · Why types are architecture',
      questions: [
        {
          prompt: 'Why is representing status as three independent booleans risky?',
          options: [
            { label: 'It creates combinations that can never occur, so readers must guess the real rules', isCorrect: true },
            { label: 'Booleans take more memory than a string union', isCorrect: false },
            { label: 'TypeScript cannot narrow boolean values', isCorrect: false },
          ],
        },
        {
          prompt: 'According to the section, what belongs in the type system rather than a document?',
          options: [
            { label: 'Rules that matter, so the compiler can enforce them', isCorrect: true },
            { label: 'Only formatting conventions', isCorrect: false },
            { label: 'Nothing — documents are the source of truth', isCorrect: false },
          ],
        },
      ],
    },
  },
  {
    title: 'Modelling state: unions over booleans',
    body: `
<h2>Modelling state: unions over booleans</h2>
<p>A discriminated union is the workhorse of domain modelling in TypeScript. Each variant carries the data that is only meaningful in that variant, and the compiler will not let you read a field without first proving which variant you have. The practical effect is that impossible states become unrepresentable, and every <code>switch</code> becomes a checklist.</p>
<pre><code>type Settlement =
  | { status: 'pending' }
  | { status: 'credited'; points: number; auditRef: string }
  | { status: 'forfeited'; reason: 'deadline' | 'withdrawn' };

function describe(settlement: Settlement): string {
  switch (settlement.status) {
    case 'pending':
      return 'Awaiting settlement';
    case 'credited':
      return \`Credited \${settlement.points} (ref \${settlement.auditRef})\`;
    case 'forfeited':
      return \`Forfeited: \${settlement.reason}\`;
  }
}</code></pre>
<p>Notice what the compiler now guarantees. If a fourth status is added later, every exhaustive <code>switch</code> in the codebase fails to compile until it is handled. That is not friction — that is the design reaching out and telling you where the consequences are. Compare with a shape carrying <code>isSettled: boolean</code> and a nullable <code>points</code>: nothing forces you to consider the case where a settlement is settled but has no points.</p>
<h3>The three shapes you will reach for</h3>
<table>
<thead><tr><th>Shape</th><th>Use when</th><th>Failure mode it removes</th></tr></thead>
<tbody>
<tr><td>Discriminated union</td><td>State has mutually exclusive variants</td><td>Reading fields that do not apply</td></tr>
<tr><td>Branded primitive</td><td>Two ids or strings must not be mixed</td><td>Passing an argument in the wrong slot</td></tr>
<tr><td>Result type</td><td>A call can fail in a way the caller must handle</td><td>Forgotten error checks</td></tr>
</tbody>
</table>
<p>A result type is worth a paragraph on its own. Throwing an exception is not part of a function's signature, so the compiler cannot tell a caller that they forgot to handle failure. Returning <code>{ ok: true; value } | { ok: false; error }</code> puts the failure in the type, and the caller cannot reach <code>value</code> without narrowing first.</p>
<p>There is a discipline to this: do not reach for a union when a simple nullable field is genuinely simpler. The rule of thumb is whether the variants carry <em>different data</em>. If both variants carry identical payloads, a plain union of literals is enough and adding ceremony only makes it harder to read.</p>
`,
    checkpoint: {
      title: 'Knowledge check · Modelling state',
      questions: [
        {
          prompt: 'What does an exhaustive switch over a discriminated union give you when a new variant is added?',
          options: [
            { label: 'Compile errors at every place that must handle the new case', isCorrect: true },
            { label: 'A runtime warning in development only', isCorrect: false },
            { label: 'Nothing — switch statements are not checked', isCorrect: false },
          ],
        },
        {
          prompt: 'When is a plain nullable field preferable to a discriminated union?',
          options: [
            { label: 'When all variants carry the same data', isCorrect: true },
            { label: 'Never — unions are always better', isCorrect: false },
            { label: 'Only in test code', isCorrect: false },
          ],
        },
      ],
    },
  },
  {
    title: 'Boundaries: validate at the edge, trust inside',
    body: `
<h2>Boundaries: validate at the edge, trust inside</h2>
<p>Every system has edges where untyped reality enters: HTTP requests, uploaded files, third-party webhooks, environment variables. Inside those edges you want the opposite of defensive programming — you want code that assumes its inputs have already been proven, because re-checking the same field in five layers hides which layer actually owns the rule.</p>
<p>The pattern that scales is: parse once at the boundary into a well-typed value, then pass that value around. A schema library does the parsing; the rest of the codebase receives a type the compiler can reason about.</p>
<pre><code>const sectionSchema = z.object({
  title: z.string().min(1).max(200),
  bodyHtml: z.string().max(60_000),
  estimatedMinutes: z.coerce.number().int().min(0).max(600).nullish(),
});

// Parsed once, at the edge. input is now typed, not unknown.
const input = sectionSchema.parse(req.body);</code></pre>
<p>Two mistakes are common here. The first is validating in the handler and then again in the service, with slightly different rules, so behaviour depends on which check ran first. The second is validating only in the client, treating the browser as a trust boundary when it is not — anything the client sends can be forged with a single request from a terminal.</p>
<ul>
<li><strong>Validate shape and range</strong> at the edge: types, lengths, formats.</li>
<li><strong>Authorise separately.</strong> “Is this well formed?” and “may this user do it?” are different questions, asked in different places.</li>
<li><strong>Reject loudly.</strong> A silently coerced value is a bug that surfaces days later, far from its cause.</li>
</ul>
<p>File uploads deserve special care. A file's declared <code>content-type</code> is a client-supplied string; it proves nothing. Check the magic bytes, cap the size before reading the body into memory, and store the file somewhere the requester cannot address directly — then hand out short-lived signed links instead of public paths. That is the difference between a document viewer and an open file host.</p>
<p>Environment configuration is the quietest boundary of all. A missing variable should fail at start-up with a clear message, not at 2 a.m. on the first request that happens to need it. Parse the environment once, at boot, into a typed object, and let the rest of the code import that object instead of reading <code>process.env</code> directly.</p>
`,
    checkpoint: {
      title: 'Knowledge check · Boundaries',
      questions: [
        {
          prompt: 'Why is validating the same field in both the client and the server not enough?',
          options: [
            { label: 'Client validation can be bypassed entirely by calling the API directly', isCorrect: true },
            { label: 'It doubles the bundle size', isCorrect: false },
            { label: 'Browsers cannot run schema validation', isCorrect: false },
          ],
        },
        {
          prompt: 'What actually proves an uploaded file is a PDF?',
          options: [
            { label: 'Checking the file magic bytes on the server', isCorrect: true },
            { label: 'The content-type header sent by the client', isCorrect: false },
            { label: 'The file extension in the filename', isCorrect: false },
          ],
        },
      ],
    },
  },
  {
    title: 'Layered services and the cost of coupling',
    body: `
<h2>Layered services and the cost of coupling</h2>
<p>A layer earns its place by owning a decision. Routes own transport: parsing, status codes, which middleware runs. Services own rules: who may do what, which invariants hold across tables, when a transaction is required. Data access owns queries. When those responsibilities blur, the symptom is always the same — a rule that exists in two places and drifts.</p>
<p>Coupling has a measurable cost in a codebase: the number of files you must open to answer “what happens when a learner submits this?” If the answer is “the route, the service, two helpers and a scheduler”, the design is telling you the decision is spread out. The fix is rarely a new abstraction; usually it is moving a rule into the one place that already owns the surrounding transaction.</p>
<table>
<thead><tr><th>Symptom</th><th>Underlying cause</th><th>Repair</th></tr></thead>
<tbody>
<tr><td>Same validation in two layers</td><td>Unclear ownership</td><td>Validate once at the edge; delete the copy</td></tr>
<tr><td>Long chains of conditionals on <code>status</code></td><td>State not modelled</td><td>Discriminated union plus exhaustive switch</td></tr>
<tr><td>“Works locally, fails in production”</td><td>Hidden configuration or timing</td><td>Parse config at boot; make time explicit</td></tr>
</tbody>
</table>
<p>Transactions are where layering is most often violated in practice. A settlement touches the wallet, the ledger, the stake and the enrolment; all four must succeed or none should. That means one transaction, and it means every query inside it must use the transaction's own client. A nested call that quietly uses the global client looks harmless, and then one day the pool is configured to a single connection and the request hangs until it times out. The rule is mechanical and worth stating plainly: inside a transaction, never reach for the shared client.</p>
<p>The same logic applies to idempotency. If an operation can be retried — a webhook, a scheduled reminder, a learner double-clicking — the guard belongs in the database as a unique constraint, not in an in-memory flag that evaporates on restart. Two identical requests racing each other is the normal case, not an exotic one.</p>
<blockquote>A unique index is the only lock that survives a restart, a second server, and a retry.</blockquote>
`,
    checkpoint: {
      title: 'Knowledge check · Layers and coupling',
      questions: [
        {
          prompt: 'Inside an interactive transaction, why must nested calls use the transaction client?',
          options: [
            { label: 'With a single pooled connection the global client waits forever for a connection the transaction holds', isCorrect: true },
            { label: 'The global client returns stale data', isCorrect: false },
            { label: 'It is only a style preference', isCorrect: false },
          ],
        },
        {
          prompt: 'Where should a guard against duplicate operations live?',
          options: [
            { label: 'In the database as a unique constraint', isCorrect: true },
            { label: 'In a module-level boolean', isCorrect: false },
            { label: 'In the browser, by disabling the button', isCorrect: false },
          ],
        },
      ],
    },
  },
  {
    title: 'Operational reality: migrations, observability, rollback',
    body: `
<h2>Operational reality: migrations, observability, rollback</h2>
<p>Software that cannot be deployed safely is not finished, however elegant its types. Three operational habits separate a prototype from a system: migrations that preserve data, logs that answer questions you did not anticipate, and a rollback story you have actually rehearsed.</p>
<p>Migrations should be additive first. Add a nullable column, backfill it, deploy code that writes to both shapes, then enforce. This ordering lets old and new code run side by side during a rollout, which is the only way to deploy without a maintenance window. Dropping a column in the same release that stops writing to it is the classic way to take an outage during a rollback.</p>
<ul>
<li><strong>Additive first.</strong> Create, backfill, switch reads, then remove — in four deploys, not one.</li>
<li><strong>Never edit an applied migration.</strong> Its checksum is recorded; changing the file creates drift that a fresh environment cannot reproduce.</li>
<li><strong>Know your connection mode.</strong> Migration tooling often needs a direct database connection; a transaction pooler will make it hang with no error at all.</li>
</ul>
<p>Observability is not dashboards; it is the ability to answer a question you did not know you would ask. Structured logs with a request id let you follow one learner's failing submission across handlers. Audit rows for money movements let you reconstruct a settlement months later. Neither is glamorous, both are what you reach for at 3 a.m.</p>
<table>
<thead><tr><th>Question at 3 a.m.</th><th>What answers it</th></tr></thead>
<tbody>
<tr><td>Why did this request fail?</td><td>Request-scoped structured logs with an id</td></tr>
<tr><td>Why does this learner have 650 points?</td><td>An audit row per credit, with a reference</td></tr>
<tr><td>Which deploy changed behaviour?</td><td>Version stamped on the running process</td></tr>
</tbody>
</table>
<p>Finally, rollback. The plan must be executable by someone who did not write the code: which command, which environment variable, what happens to in-flight jobs. A rollback that depends on tribal knowledge is not a plan, it is a hope. Write it down next to the deploy instructions, and rehearse it once on a throwaway environment before you need it for real.</p>
<p>None of this is specific to TypeScript. It is specific to running software that other people depend on — which, for a learning platform holding someone's stake, is exactly the responsibility you have accepted.</p>
`,
  },
];

/* -------------------------------------------------------------------------- */
/* Runner                                                                      */
/* -------------------------------------------------------------------------- */

async function main() {
  const course = await prisma.course.findFirst({
    where: { code: COURSE_CODE },
    include: { modules: { orderBy: { orderIndex: 'asc' }, include: { contents: { orderBy: { orderIndex: 'asc' } } } } },
  });
  if (!course) throw new Error(`Course ${COURSE_CODE} not found. Run "npm run db:seed" first.`);

  const module = course.modules[0];
  if (!module) throw new Error(`Course ${COURSE_CODE} has no modules.`);

  let content = module.contents.find((item) => item.type === 'READING');

  if (!content) {
    content = await prisma.moduleContent.create({
      data: {
        moduleId: module.id,
        type: 'READING',
        title: LESSON_TITLE,
        isRequired: true,
        orderIndex: module.contents.length,
      },
    });
    console.log(`Created reading lesson ${content.id} in module "${module.title}".`);
  } else {
    console.log(`Using existing reading lesson ${content.id} ("${content.title}").`);
  }

  // Rebuild the lesson: removing sections cascades their checkpoints and any
  // learner section progress for this lesson.
  await prisma.readingSection.deleteMany({ where: { contentId: content.id } });
  await prisma.readingResource.deleteMany({ where: { contentId: content.id } });

  const totalWords = SECTIONS.reduce((sum, section) => sum + wordCount(section.body), 0);

  await prisma.moduleContent.update({
    where: { id: content.id },
    data: {
      title: LESSON_TITLE,
      readingBody: null,
      requiresComprehensionCheck: false,
      readingPublishedAt: new Date(),
      readingObjectives: [
        'Explain why domain types are architectural decisions',
        'Model exclusive states as discriminated unions',
        'Validate untrusted input once, at the system edge',
        'Keep transaction work on a single client',
        'Plan an additive, reversible deployment',
      ],
      readingReferences: [
        { label: 'TypeScript handbook — Narrowing', url: 'https://www.typescriptlang.org/docs/handbook/2/narrowing.html', note: null },
        { label: 'Prisma — Interactive transactions', url: 'https://www.prisma.io/docs/orm/prisma-client/queries/transactions', note: 'Read the timeout and connection notes.' },
      ],
      estimatedMinutes: Math.max(1, Math.round(totalWords / WORDS_PER_MINUTE)),
    },
  });

  for (const [index, section] of SECTIONS.entries()) {
    const words = wordCount(section.body);
    const created = await prisma.readingSection.create({
      data: {
        contentId: content.id,
        title: section.title,
        bodyHtml: section.body.trim(),
        orderIndex: index,
        estimatedMinutes: Math.max(1, Math.round(words / WORDS_PER_MINUTE)),
      },
    });

    if (section.checkpoint) {
      await prisma.readingCheckpoint.create({
        data: {
          contentId: content.id,
          sectionId: created.id,
          title: section.checkpoint.title,
          passingScore: 100,
          maxAttempts: null,
          questions: {
            create: section.checkpoint.questions.map((question, questionIndex) => ({
              type: 'SINGLE_CHOICE',
              prompt: question.prompt,
              points: 1,
              orderIndex: questionIndex,
              options: {
                create: question.options.map((option, optionIndex) => ({
                  label: option.label,
                  isCorrect: option.isCorrect,
                  orderIndex: optionIndex,
                })),
              },
            })),
          },
        },
      });
    }

    console.log(`  ${index + 1}. ${section.title} — ${words} words (~${Math.max(1, Math.round(words / WORDS_PER_MINUTE))} min)${section.checkpoint ? ' · checkpoint' : ' · final section'}`);
  }

  console.log(`\nPublished "${LESSON_TITLE}" — ${SECTIONS.length} sections, ${SECTIONS.filter((s) => s.checkpoint).length} checkpoints, ${totalWords} words (~${Math.round(totalWords / WORDS_PER_MINUTE)} min).`);
}

main()
  .catch((error) => {
    console.error('Demo reading seed failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
