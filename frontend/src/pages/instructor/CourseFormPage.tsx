import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { courseApi } from '../../services/endpoints';
import { useAsync, useDocumentTitle } from '../../hooks';
import { Button, Divider, MaterialIcon, ProgressBar } from '../../components/ui/core';
import { Alert, Card, CardHeader, ErrorBlock, LoadingBlock, MetricRow, SectionHeader } from '../../components/ui/data';
import { Input, Select, Textarea } from '../../components/ui/forms';
import { useToast } from '../../context/ToastContext';
import { errorMessage } from '../../services/api';
import { useCourseAreaBase } from '../../router/routeAccess';
import { formatPoints } from '../../utils/format';

const DIFFICULTY_OPTIONS = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'].map((value) => ({
  value,
  label: value.charAt(0) + value.slice(1).toLowerCase(),
}));

interface FormState {
  title: string;
  shortDescription: string;
  description: string;
  category: string;
  difficulty: string;
  durationDays: number;
  gracePeriodHours: number;
  baseStake: number;
  completionReward: number;
  commitmentBonus: number;
  performanceBonus: number;
  performanceThreshold: number;
  minFinalTestScore: string;
  maxAttempts: number;
  moduleWeight: number;
  finalTestWeight: number;
  moduleQuizWeight: number;
  moduleAssessmentWeight: number;
  requiredWatchPercent: number;
}

const DEFAULTS: FormState = {
  title: '',
  shortDescription: '',
  description: '',
  category: '',
  difficulty: 'INTERMEDIATE',
  durationDays: 30,
  gracePeriodHours: 24,
  baseStake: 100,
  completionReward: 50,
  commitmentBonus: 40,
  performanceBonus: 50,
  performanceThreshold: 85,
  minFinalTestScore: '',
  maxAttempts: 3,
  moduleWeight: 70,
  finalTestWeight: 30,
  moduleQuizWeight: 30,
  moduleAssessmentWeight: 70,
  requiredWatchPercent: 90,
};

/**
 * Course information + accountability economics.
 *
 * Weights are validated in the browser for immediate feedback, but the API is
 * authoritative — it rejects a course whose weights do not total 100%.
 */
export function CourseFormPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  // Course authoring lives under /instructor/courses for instructors and
  // /admin/courses for administrators.
  const areaBase = useCourseAreaBase();

  const isEdit = Boolean(courseId);
  useDocumentTitle(isEdit ? 'Edit course' : 'Create course');

  const existing = useAsync(() => courseApi.preview(courseId!), [courseId], { enabled: isEdit });

  const [form, setForm] = useState<FormState>(DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hydrate from the existing course when editing.
  useEffect(() => {
    const course = existing.data;
    if (!course) return;
    setForm({
      title: course.title,
      shortDescription: course.shortDescription,
      description: course.description,
      category: course.category,
      difficulty: course.difficulty,
      durationDays: course.durationDays,
      gracePeriodHours: course.gracePeriodHours,
      baseStake: course.baseStake,
      completionReward: course.completionReward,
      commitmentBonus: course.commitmentBonus,
      performanceBonus: course.performanceBonus,
      performanceThreshold: course.performanceThreshold,
      minFinalTestScore: course.minFinalTestScore === null ? '' : String(course.minFinalTestScore),
      maxAttempts: course.maxAttempts,
      moduleWeight: course.moduleWeight,
      finalTestWeight: course.finalTestWeight,
      moduleQuizWeight: course.moduleQuizWeight,
      moduleAssessmentWeight: course.moduleAssessmentWeight,
      requiredWatchPercent: course.requiredWatchPercent,
    });
  }, [existing.data]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const weightsValid = form.moduleWeight + form.finalTestWeight === 100;
  const moduleWeightsValid = form.moduleQuizWeight + form.moduleAssessmentWeight === 100;

  const submit = async () => {
    setSaving(true);
    setError(null);

    const payload = {
      title: form.title.trim(),
      shortDescription: form.shortDescription.trim(),
      description: form.description.trim(),
      category: form.category.trim(),
      difficulty: form.difficulty,
      durationDays: form.durationDays,
      gracePeriodHours: form.gracePeriodHours,
      baseStake: form.baseStake,
      completionReward: form.completionReward,
      commitmentBonus: form.commitmentBonus,
      performanceBonus: form.performanceBonus,
      performanceThreshold: form.performanceThreshold,
      minFinalTestScore: form.minFinalTestScore === '' ? null : Number(form.minFinalTestScore),
      maxAttempts: form.maxAttempts,
      moduleWeight: form.moduleWeight,
      finalTestWeight: form.finalTestWeight,
      moduleQuizWeight: form.moduleQuizWeight,
      moduleAssessmentWeight: form.moduleAssessmentWeight,
      requiredWatchPercent: form.requiredWatchPercent,
    };

    try {
      if (isEdit) {
        await courseApi.update(courseId!, payload);
        toast.success('Course updated');
      } else {
        const created = await courseApi.create(payload);
        toast.success('Course created', 'Add modules and a final assessment, then publish.');
        navigate(`${areaBase}/${created.id}/builder`, { replace: true });
        return;
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  if (isEdit && existing.loading) return <LoadingBlock label="Loading course…" rows={5} />;
  if (isEdit && (existing.error || !existing.data)) {
    return <ErrorBlock title="Could not load this course" message={existing.error} onRetry={() => void existing.refetch()} />;
  }

  const totalPotential =
    form.baseStake + form.completionReward + form.commitmentBonus + form.performanceBonus;

  return (
    <div className="flex flex-col gap-space-lg">
      <Link
        to={areaBase}
        className="inline-flex w-fit items-center gap-1.5 font-label-sm text-label-sm text-on-surface-variant hover:text-on-surface"
      >
        <MaterialIcon name="arrow_back" className="text-[16px]" />
        Back to my courses
      </Link>

      <SectionHeader
        eyebrow={isEdit ? 'Course settings' : 'New course'}
        title={isEdit ? form.title || 'Edit course' : 'Create a course'}
        meta={
          <div className="flex items-center gap-space-sm">
            {isEdit ? (
              <Link to={`${areaBase}/${courseId}/builder`}>
                <Button variant="secondary" icon="construction">
                  Open builder
                </Button>
              </Link>
            ) : null}
            <Button icon="save" loading={saving} disabled={!weightsValid || !moduleWeightsValid} onClick={() => void submit()}>
              {isEdit ? 'Save changes' : 'Create & continue'}
            </Button>
          </div>
        }
      />

      {error ? <Alert tone="error" title="Could not save">{error}</Alert> : null}
      {!weightsValid || !moduleWeightsValid ? (
        <Alert tone="error" title="Weights must total 100%">
          Module + final test weights currently total {form.moduleWeight + form.finalTestWeight}%. Module quiz + assessment weights
          total {form.moduleQuizWeight + form.moduleAssessmentWeight}%. The API rejects any course that does not total exactly
          100% in both pairs.
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-space-lg lg:grid-cols-3">
        <div className="flex flex-col gap-space-lg lg:col-span-2">
          <Card>
            <CardHeader title="Course information" subtitle="01 / Foundation" />
            <Divider />
            <div className="flex flex-col gap-space-md p-space-lg">
              <Input
                label="Course title"
                required
                maxLength={160}
                value={form.title}
                onChange={(event) => set('title', event.target.value)}
                placeholder="Statistical Arbitrage & Risk Mitigation"
              />
              <Input
                label="Short description"
                required
                maxLength={280}
                value={form.shortDescription}
                onChange={(event) => set('shortDescription', event.target.value)}
                hint={`${form.shortDescription.length}/280 characters — shown on catalogue cards.`}
              />
              <Textarea
                label="Full description"
                required
                rows={5}
                maxLength={6000}
                value={form.description}
                onChange={(event) => set('description', event.target.value)}
                placeholder="What will learners be able to do after this course?"
              />
              <div className="grid grid-cols-1 gap-space-md sm:grid-cols-2">
                <Input
                  label="Category"
                  required
                  value={form.category}
                  onChange={(event) => set('category', event.target.value)}
                  placeholder="Computer Science"
                />
                <Select
                  label="Difficulty"
                  value={form.difficulty}
                  onChange={(event) => set('difficulty', event.target.value)}
                  options={DIFFICULTY_OPTIONS}
                />
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Stake & rewards"
              subtitle="02 / Accountability economics"
              action={
                <span className="rounded border border-secondary-fixed-dim bg-secondary-fixed/30 px-space-sm py-0.5 micro-label text-secondary">
                  Escrow protected
                </span>
              }
            />
            <Divider />
            <div className="flex flex-col gap-space-md p-space-lg">
              <div className="grid grid-cols-2 gap-space-md lg:grid-cols-4">
                <Input
                  label="Base stake"
                  type="number"
                  min={0}
                  value={form.baseStake}
                  onChange={(event) => set('baseStake', Number(event.target.value))}
                  hint="Committed at enrolment"
                />
                <Input
                  label="Completion reward"
                  type="number"
                  min={0}
                  value={form.completionReward}
                  onChange={(event) => set('completionReward', Number(event.target.value))}
                  hint="Paid on verified completion"
                />
                <Input
                  label="Commitment bonus"
                  type="number"
                  min={0}
                  value={form.commitmentBonus}
                  onChange={(event) => set('commitmentBonus', Number(event.target.value))}
                  hint="Accelerated deadline met"
                />
                <Input
                  label="Performance bonus"
                  type="number"
                  min={0}
                  value={form.performanceBonus}
                  onChange={(event) => set('performanceBonus', Number(event.target.value))}
                  hint="Score threshold reached"
                />
              </div>

              <div className="flex items-center justify-between gap-space-md rounded border border-outline-variant bg-surface-container-low px-space-md py-space-sm">
                <span className="flex items-center gap-space-sm font-label-md text-label-md text-on-surface">
                  <MaterialIcon name="savings" className="text-primary-container" />
                  Total learner return cap
                </span>
                <span className="flex items-center gap-space-md">
                  <span className="font-headline-sm text-headline-sm tabular text-on-surface">
                    {formatPoints(totalPotential, { suffix: false })} pts
                  </span>
                  {form.baseStake > 0 ? (
                    <span className="micro-label text-secondary">
                      +{Math.round(((totalPotential - form.baseStake) / form.baseStake) * 100)}% effective recovery
                    </span>
                  ) : null}
                </span>
              </div>

              <p className="font-label-xs text-label-xs text-on-surface-variant">
                A course that charges a stake must offer at least one reward, otherwise publishing is rejected. Changing stake or
                reward values is blocked while the course is published — unpublish it first.
              </p>
            </div>
          </Card>

          <Card>
            <CardHeader title="Deadlines & grading" subtitle="03 / Pace & schedule" />
            <Divider />
            <div className="flex flex-col gap-space-md p-space-lg">
              <div className="grid grid-cols-2 gap-space-md lg:grid-cols-4">
                <Input
                  label="Standard duration"
                  type="number"
                  min={1}
                  value={form.durationDays}
                  onChange={(event) => set('durationDays', Number(event.target.value))}
                  hint="Days"
                />
                <Input
                  label="Grace period"
                  type="number"
                  min={0}
                  value={form.gracePeriodHours}
                  onChange={(event) => set('gracePeriodHours', Number(event.target.value))}
                  hint="Hours after the deadline"
                />
                <Input
                  label="Max attempts"
                  type="number"
                  min={1}
                  max={20}
                  value={form.maxAttempts}
                  onChange={(event) => set('maxAttempts', Number(event.target.value))}
                  hint="Includes the first attempt"
                />
                <Input
                  label="Required watch %"
                  type="number"
                  min={1}
                  max={100}
                  value={form.requiredWatchPercent}
                  onChange={(event) => set('requiredWatchPercent', Number(event.target.value))}
                  hint="Valid watch time for videos"
                />
              </div>

              <div className="grid grid-cols-2 gap-space-md lg:grid-cols-3">
                <Input
                  label="Module weight %"
                  type="number"
                  min={0}
                  max={100}
                  value={form.moduleWeight}
                  onChange={(event) => set('moduleWeight', Number(event.target.value))}
                  error={weightsValid ? null : 'Must total 100% with the final test weight.'}
                />
                <Input
                  label="Final test weight %"
                  type="number"
                  min={0}
                  max={100}
                  value={form.finalTestWeight}
                  onChange={(event) => set('finalTestWeight', Number(event.target.value))}
                  error={weightsValid ? null : 'Must total 100% with the module weight.'}
                />
                <Input
                  label="Performance threshold %"
                  type="number"
                  min={0}
                  max={100}
                  value={form.performanceThreshold}
                  onChange={(event) => set('performanceThreshold', Number(event.target.value))}
                  hint="Final score needed for the bonus"
                />
              </div>

              <div className="grid grid-cols-2 gap-space-md lg:grid-cols-3">
                <Input
                  label="Module quiz weight %"
                  type="number"
                  min={0}
                  max={100}
                  value={form.moduleQuizWeight}
                  onChange={(event) => set('moduleQuizWeight', Number(event.target.value))}
                  error={moduleWeightsValid ? null : 'Must total 100% with the assessment weight.'}
                />
                <Input
                  label="Module assessment weight %"
                  type="number"
                  min={0}
                  max={100}
                  value={form.moduleAssessmentWeight}
                  onChange={(event) => set('moduleAssessmentWeight', Number(event.target.value))}
                  error={moduleWeightsValid ? null : 'Must total 100% with the quiz weight.'}
                />
                <Input
                  label="Minimum final test % (optional)"
                  type="number"
                  min={0}
                  max={100}
                  value={form.minFinalTestScore}
                  onChange={(event) => set('minFinalTestScore', event.target.value)}
                  hint="Hard floor regardless of weighted score"
                />
              </div>
            </div>
          </Card>
        </div>

        <div className="flex flex-col gap-space-lg">
          <Card>
            <CardHeader title="Weight check" />
            <Divider />
            <div className="flex flex-col gap-space-md p-space-lg">
              <div className="flex flex-col gap-space-xs">
                <div className="flex items-center justify-between font-label-xs text-label-xs text-on-surface-variant">
                  <span>Module / final split</span>
                  <span className={weightsValid ? 'text-secondary' : 'text-error'}>
                    {form.moduleWeight}% + {form.finalTestWeight}%
                  </span>
                </div>
                <ProgressBar value={form.moduleWeight} tone={weightsValid ? 'success' : 'risk'} label="Module weight" />
              </div>

              <div className="flex flex-col gap-space-xs">
                <div className="flex items-center justify-between font-label-xs text-label-xs text-on-surface-variant">
                  <span>Quiz / assessment split</span>
                  <span className={moduleWeightsValid ? 'text-secondary' : 'text-error'}>
                    {form.moduleQuizWeight}% + {form.moduleAssessmentWeight}%
                  </span>
                </div>
                <ProgressBar
                  value={form.moduleQuizWeight}
                  tone={moduleWeightsValid ? 'success' : 'risk'}
                  label="Quiz weight"
                />
              </div>

              <Divider />

              <MetricRow label="Final score formula" value={`m × ${form.moduleWeight}% + t × ${form.finalTestWeight}%`} />
              <MetricRow
                label="Performance bonus at"
                value={`${form.performanceThreshold}%`}
                sub={`Worth ${form.performanceBonus} points`}
              />
            </div>
          </Card>

          <Card>
            <CardHeader title="Rules enforced by the API" />
            <Divider />
            <ul className="flex flex-col gap-space-xs p-space-lg">
              {[
                'Both weight pairs must total exactly 100%.',
                'Accelerated options must be shorter than the standard duration.',
                'A published course cannot change stake or reward amounts.',
                'Publishing requires a module with required content, a quiz with questions, and a final assessment with questions.',
              ].map((rule) => (
                <li key={rule} className="flex items-start gap-space-sm font-body-sm text-body-sm text-on-surface-variant">
                  <MaterialIcon name="rule" className="mt-0.5 shrink-0 text-[15px]" />
                  {rule}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
