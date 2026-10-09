# Stake It — Business Rules

This document is the authoritative description of how Stake It behaves. Every rule below
is enforced **server-side**; the interface only reflects it. Where a rule has a
configurable knob, the knob is named.

**The platform uses virtual platform points only. There is no money, no wagering and no
financial transaction anywhere in the system.**

---

## 1. Roles

| Role | Capabilities |
|---|---|
| `LEARNER` | Browse the catalogue, enrol, stake points, learn sequentially, take quizzes/assessments, earn rewards, retry, review completed courses |
| `INSTRUCTOR` | Own courses (create, configure, build curriculum, publish/unpublish/archive), inspect learners and analytics, view reputation |
| `ADMIN` | Everything above, plus user management, platform-wide ledger, reward pool, badge override, review moderation, exceptional cases |

Rules:

1. Only `LEARNER` and `INSTRUCTOR` are self-registerable. A client-supplied `ADMIN` role is
   silently downgraded to `LEARNER` at registration and can never be used to obtain access.
2. The role is read from the database on every authenticated request. A token issued before
   a role change cannot retain the old privileges.
3. Instructors may only manage their own courses; the API returns `403 FORBIDDEN` otherwise.
4. Admins may act on any course.

---

## 2. Course configuration

An instructor configures:

| Setting | Constraint |
|---|---|
| `durationDays` | ≥ 1 |
| `gracePeriodHours` | ≥ 0 |
| `baseStake` | ≥ 0 |
| `completionReward`, `commitmentBonus`, `performanceBonus` | ≥ 0 |
| `performanceThreshold` | 0–100 (default 90) |
| `moduleWeight` + `finalTestWeight` | **must total exactly 100** |
| `moduleQuizWeight` + `moduleAssessmentWeight` | **must total exactly 100** |
| `minFinalTestScore` | optional, 0–100 |
| `maxAttempts` | ≥ 1 |
| `requiredWatchPercent` | 1–100 (default 90) |

A course that charges a stake must offer at least one reward, otherwise publishing is
refused.

**Publish gate.** Publishing is rejected unless:

- the course has ≥ 1 module;
- every module has ≥ 1 required content item, every video has a URL and every reading has a
  body;
- every quiz and module assessment has ≥ 1 question;
- a final assessment exists with ≥ 1 question;
- every accelerated option is shorter than the course duration and has a positive stake;
- both weight pairs total 100%.

The API returns `422 INVALID_COURSE_CONFIGURATION` with a per-field `issues` array naming
everything that blocks publication.

**Immutability.** While a course is `PUBLISHED`, `baseStake`, `completionReward`,
`commitmentBonus` and `performanceBonus` cannot be changed — learners already hold stakes
against those numbers. Unpublish first.

---

## 3. Enrolment and staking

Enrolling locks the base stake. This happens inside **one database transaction**:
balance check → point deduction → ledger row → stake row → attempt row → enrolment counter.
If any step fails, everything rolls back. A learner can never end up enrolled without a
stake, or staked without a course.

Rules:

1. The course must be `PUBLISHED`.
2. The wallet must cover `baseStake + commitmentStake`, otherwise
   `422 INSUFFICIENT_BALANCE` with `required` / `available` / `shortfall`.
3. Wallet rows are locked with `SELECT … FOR UPDATE`, so two concurrent enrolments cannot
   both succeed against the same balance.
4. One enrolment per (learner, course). Further attempts are **retries** under the same
   enrolment.
5. A learner with an active attempt cannot enrol again (`409 ALREADY_ENROLLED`).
6. Withdrawal is allowed only before any content is completed, and returns the whole stake.

---

## 4. Deadlines

| Deadline | Meaning |
|---|---|
| **Normal course deadline** | `startedAt + durationDays`. Missing it fails the attempt. |
| **Grace deadline** | `normalDeadline + gracePeriodHours`. Final window before forfeiture. |
| **Accelerated deadline** | Optional, learner-chosen at enrolment. Missing it costs only the bonus. |

Attempt status transitions:

```
ACTIVE ──(gap ≥ AT_RISK_THRESHOLD_PERCENT)──▶ AT_RISK
ACTIVE/AT_RISK ──(past normalDeadline)──────▶ GRACE_PERIOD
GRACE_PERIOD ──(past graceDeadline)─────────▶ COMPLETED (if verified) | FAILED
```

`AT_RISK_THRESHOLD_PERCENT` defaults to 15 percentage points.

**Critical rule:** missing the *accelerated* deadline never fails the course. The learner
keeps working toward the normal deadline; only the commitment bonus is forgone.

---

## 5. At-risk detection

Expected progress = elapsed fraction of the course window × 100.
Actual progress = completed required items ÷ total required items × 100.
Gap = expected − actual.

| Gap | State |
|---|---|
| ≤ 0 | `ON_TRACK` |
| 0 < gap < threshold | `STEADY` |
| gap ≥ threshold | `AT_RISK` |
| past normal deadline, within grace | `GRACE_PERIOD` |
| past grace | `FAILED` |

At-risk learners are notified at most once per calendar day per attempt.

---

## 6. Sequential learning (core rule)

Content unlocks strictly in order. Within a module: **video/reading → quiz → module
assessment**. Modules unlock in order; the final test unlocks last.

The flattened unlock rule is: *an item is unlocked when every required item before it is
complete.* Optional items never block progress.

Enforcement:

- The API rejects a request for locked content with `422 CONTENT_LOCKED` and a hint.
- The final test returns `422 FINAL_TEST_LOCKED` while any required module is incomplete.
- The interface disables locked items, but that is a convenience — the check is server-side.

---

## 7. Content completion verification

| Type | Requirement |
|---|---|
| `VIDEO` | `validWatchPercent ≥ requiredWatchPercent` (course default 90%, per-item override allowed) |
| `READING` | Reached the end (`≥ 95%` scrolled) **and**, if configured, passed the comprehension check |
| `QUIZ` | A passing attempt exists |
| `MODULE_ASSESSMENT` | A passing submission exists |
| `CODING` / `SUBJECTIVE` | A submission has been recorded and graded (extension point) |

### Video watch verification

The client reports **segments it actually played**. The server:

1. rejects impossible segments (negative start, inverted, beyond duration);
2. trims any segment claiming more forward progress than wall-clock time allows
   (`elapsedRealSeconds × MAX_PLAYBACK_RATE`, default 2.5×);
3. merges overlapping and touching segments so re-watching never double-counts;
4. computes the union length — the only number that can mark a video complete.

Scrubbing from 0 to the end therefore credits only the physically possible fraction. A
learner cannot reach 90% by dragging the scrubber.

**No invasive surveillance:** no webcam, no facial recognition, no mouse tracking, no
forced browser focus. The check is deliberately limited to reasonable learning verification.

---

## 8. Grading

- `SINGLE_CHOICE`, `TRUE_FALSE`: exact single-option match.
- `MULTI_CHOICE`: exact set match (all-or-nothing, no partial credit).
- `CODING`, `SUBJECTIVE`, `SHORT_TEXT`: **not** auto-graded. The submission is stored as
  `PENDING_REVIEW` and **cannot satisfy a gate or pass** until a reviewer or sandbox
  evaluator grades it. This is the documented extension seam.

All grading happens in the API. The frontend never computes an authoritative score.

---

## 9. Scoring

```
moduleScore  = Σ(quizAvg × moduleQuizWeight% + assessmentAvg × moduleAssessmentWeight%) / moduleCount
finalScore   = moduleScore × moduleWeight% + finalTestScore × finalTestWeight%
```

- Per module, the best attempt for each instrument is used.
- Weights are renormalised over the components a module actually has, so a module with no
  quiz is scored on its assessment alone rather than being diluted toward zero.
- Videos and readings are completion gates, not marks.
- The course-level module score is the mean across modules that have gradable instruments.
- `moduleWeight + finalTestWeight` must equal 100 — re-asserted at settlement time, so a
  corrupted row cannot silently mis-score anyone.

**Minimum final-test score.** If configured, `finalTestScore < minFinalTestScore` blocks
completion even when the weighted score is high. The attempt stays active so the learner can
retry the test.

---

## 10. Successful completion and settlement

Triggered by passing the final assessment. Everything below commits in **one transaction**.

| Award | Condition |
|---|---|
| Base stake returned | Always, on attempt 1 |
| Course completion reward | Always |
| Commitment stake returned | The accelerated deadline was met |
| Commitment bonus | The accelerated deadline was met |
| Performance bonus | `finalScore ≥ performanceThreshold` |

If the accelerated deadline was missed, the commitment **stake is still returned** — only
the bonus is forgone.

Settlement also writes the attempt's final scores, marks the enrolment `COMPLETED`, closes
any sibling attempt, and emits `COURSE_COMPLETED` / `REWARD_RECEIVED` notifications. The
receipt carries a server-generated audit reference and SHA-256 hash so it can be
re-verified. Requesting it again is idempotent — no points move twice.

---

## 11. Failure

When the grace deadline elapses without verified completion, in one transaction:

1. every `LOCKED` stake is forfeited;
2. the points are credited to the **platform reward pool**;
3. a `STAKE_FORFEITED` ledger entry is written per stake;
4. the attempt becomes `FAILED`, the enrolment `FAILED`;
5. `RETRY_AVAILABLE` is emitted when attempts remain.

If the learner had in fact completed everything, the same job settles it as a **success**
instead of forfeiting.

---

## 12. Retries

- `maxAttempts` is configured per course and includes the first attempt.
- **A retry does not require a new mandatory stake.** The failed stake was already
  forfeited and moved to the pool.
- A retry creates a new attempt with a fresh full-duration window and no locked stakes.
- On a successful retry the stake return is replaced by a recovery reward:

```
recoveryReward = floor(originalStake ÷ attemptNumber)

attempt 2 → 100 / 2 = 50
attempt 3 → 100 / 3 = 33
```

Recorded as a `RETRY_REWARD` ledger transaction. The completion reward still applies; the
performance bonus still applies if the threshold is cleared. The commitment bonus does not,
because no commitment stake was at risk.

- Exceeding `maxAttempts` returns `422 ATTEMPT_LIMIT_REACHED`.

---

## 13. Wallet and ledger

- Every learner has exactly one wallet with `availableBalance` and `lockedBalance`.
- **Every** point movement writes a `WalletTransaction` with the signed amount, the
  resulting balance, a type and a reference to the object that caused it.
- Balances are only ever mutated through `WalletService` under a row lock inside a
  transaction. No code path edits a balance directly.
- Transaction types: `SIGNUP_GRANT`, `STAKE_LOCKED`, `STAKE_RETURNED`, `STAKE_FORFEITED`,
  `COURSE_REWARD`, `COMMITMENT_BONUS`, `PERFORMANCE_BONUS`, `RETRY_REWARD`,
  `ADMIN_ADJUSTMENT`.
- A debit that would overdraw throws `INSUFFICIENT_BALANCE`; an invariant violation while
  releasing or forfeiting more than is locked throws rather than corrupting the balance.

---

## 14. Reward pool

- A singleton row holds `balance`, `totalIn`, `totalOut`.
- Credited by forfeitures, debited by explicit platform rewards and admin adjustments.
- **Forfeited points are never transferred directly to another learner.** Every movement has
  its own audited `RewardPoolTransaction`.
- Pool debits are guarded: paying out more than the balance throws.

---

## 15. Instructor reputation and badges

Composite score (0–100), weights:

| Component | Weight |
|---|---|
| Completion rate | 35% |
| Average learner score | 30% |
| Commitment success rate | 20% |
| Average learner rating (normalised from 5) | 15% |

Tier gates — **every** condition must hold, including a minimum number of settled learner
outcomes, so a handful of perfect completions never awards a high badge:

| Tier | Min outcomes | Completion | Avg score | Commitment | Rating | Composite |
|---|---|---|---|---|---|---|
| GOLD | 40 | 80% | 85% | 70% | 4.5 | ≥ 85 |
| SILVER | 20 | 65% | 75% | 55% | 4.0 | ≥ 72 |
| BRONZE | 8 | 50% | 65% | 40% | 3.5 | ≥ 58 |

Thresholds live in `backend/src/config/constants.ts`. Badges refresh nightly
(`ReputationService.recomputeAllBadges`) and an admin can override explicitly, which is
recorded against the admin's account.

Reputation affects course visibility, trust indicators and featured eligibility — **never
stake pricing**.

---

## 16. Course ratings

- Only learners the server has verified as having completed the course may review it.
- One review per learner per course: star rating (1–5), difficulty (1–5), would-recommend,
  optional written text.
- A new or updated review triggers a reputation recompute.
- Admins can flag or unpublish a review; the row is retained so moderation history stays
  intact.

---

## 17. Adaptive stake recommendation

V1 is rule-based and **advisory only** — it never changes a commitment on the learner's
behalf.

| Learner history | Stance | Effect |
|---|---|---|
| < 3 settled attempts | `NEUTRAL` | Standard stake, slightly longer window |
| Completion ≥ 80%, avg score ≥ 82, no failures | `AMBITIOUS` | Stake ×1.25, window ×0.85, accelerated suggested |
| Completion ≤ 40% | `CAUTIOUS` | Stake ×0.75, window ×1.5, accelerated withheld |
| Otherwise | `BALANCED` | Standard commitment |

The engine sits behind the `StakeRecommender` interface (`setRecommender`), which is the
swap point for an ML model — no other code changes.

---

## 18. Deadline processing

The API process runs a cron scheduler; it never depends on a browser being open.

| Job | Schedule | Purpose |
|---|---|---|
| `deadline-settlement` | every 5 min | Settle attempts past their grace deadline (success or forfeiture) |
| `at-risk-scan` | every 15 min | Refresh pacing, flag `AT_RISK`/`GRACE_PERIOD`, notify |
| `deadline-reminders` | hourly at :07 | 72h / 24h / 6h / 1h reminders, idempotent per threshold |
| `reputation-recompute` | nightly 02:15 | Refresh instructor tiers |

Jobs guard against overlapping runs and never throw into the process. Notification
idempotency uses `metadata.referenceId`, so a reminder is never duplicated. Admins can
trigger a run on demand.

---

## 19. Notifications

Types: `ENROLLMENT`, `DEADLINE_APPROACHING`, `AT_RISK`, `ACCELERATED_DEADLINE`,
`COURSE_COMPLETED`, `REWARD_RECEIVED`, `STAKE_FORFEITED`, `RETRY_AVAILABLE`,
`INSTRUCTOR_BADGE`, `SYSTEM`.

In-app only for now. Persistence is decoupled from emission, so an email or push transport
can be layered on the same events without touching business services.

---

## 20. Security and server authority

- JWT verification on every protected route; RBAC from the database role.
- Request validation with zod before any controller runs.
- Helmet, CORS allow-list, and rate limiting (a tighter bucket on credential endpoints).
- Parameterised queries only, via Prisma.
- No secrets in the frontend bundle. `SUPABASE_SERVICE_ROLE_KEY` is server-only.
- Settlement, staking and forfeiture run inside transactions with row locks.

**The frontend is never trusted for:** wallet balance, stake amount, role, score,
completion state, or deadline settlement. Every one of those is recomputed server-side.

---

## 21. Rule index — implementation map

| Rule | Where it is enforced |
|---|---|
| Weight pairs total 100% | `courseService.assertValidConfiguration`, re-asserted in `completionService.computeFinalScore` |
| Publish gate | `courseService.publish` |
| Stake locking / insufficient balance | `walletService.lockStake`, `enrollmentService.enroll` |
| Sequential unlocking | `lib/sequence.computeUnlocks`, `learningService.assertContentUnlocked` |
| Valid-watch tracking | `lib/watchTracking`, `learningService.recordVideoProgress` |
| Grading | `lib/grading.gradeQuestions` |
| Module / final score | `completionService.computeModuleScore`, `computeFinalScore` |
| Retry recovery reward | `completionService.computeRetryRecoveryReward` |
| Performance bonus | `completionService.isPerformanceBonusEarned` |
| Settlement | `completionService.settleSuccessfulCompletion` |
| Forfeiture | `stakeService.settleFailedAttempt` → `completionService.recordForfeiture` |
| Deadline transitions | `lib/pacing.computePacing`, `deadlineService` |
| Reputation tiers | `reputationService.resolveTier` + `config/constants.REPUTATION_TIERS` |
| Adaptive recommendation | `recommendationService.RuleBasedRecommender` |
