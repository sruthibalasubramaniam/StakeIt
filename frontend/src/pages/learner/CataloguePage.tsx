import { useMemo, useState } from 'react';
import { courseApi, type CourseListQuery } from '../../services/endpoints';
import { useAsync, useDebounced, useDocumentTitle } from '../../hooks';
import { Button, Chip, MaterialIcon } from '../../components/ui/core';
import { EmptyState, ErrorBlock, LoadingBlock, Pagination, SectionHeader, Tabs } from '../../components/ui/data';
import { SearchInput, Select } from '../../components/ui/forms';
import { CourseCard } from '../../components/domain/CourseCard';
import { useAuth } from '../../context/AuthContext';

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest' },
  { value: 'popular', label: 'Most learners' },
  { value: 'rating', label: 'Highest rated' },
  { value: 'reputation', label: 'Instructor reputation' },
  { value: 'stake', label: 'Highest stake' },
  { value: 'duration', label: 'Shortest duration' },
  { value: 'title', label: 'Title A–Z' },
];

const DIFFICULTIES = ['ALL', 'BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'];

export function CataloguePage() {
  useDocumentTitle('Course catalogue');
  const { user } = useAuth();

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('ALL');
  const [difficulty, setDifficulty] = useState('ALL');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const [view, setView] = useState<'all' | 'mine'>('all');

  const debouncedSearch = useDebounced(search, 350);

  const facets = useAsync(() => courseApi.facets(), []);

  const query = useMemo<CourseListQuery>(
    () => ({
      q: debouncedSearch.trim() || undefined,
      category: category === 'ALL' ? undefined : category,
      difficulty: difficulty === 'ALL' ? undefined : difficulty,
      sort,
      page,
      pageSize: 9,
    }),
    [debouncedSearch, category, difficulty, sort, page],
  );

  const courses = useAsync(() => courseApi.list(query), [JSON.stringify(query)]);

  const items = courses.data?.items ?? [];
  const visible = view === 'mine' ? items.filter((course) => Boolean(course.enrollment)) : items;

  const resetPage = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setPage(1);
  };

  return (
    <div className="flex flex-col gap-space-lg">
      <SectionHeader
        eyebrow="Curriculum"
        title="Course catalogue"
        meta={
          <span className="flex items-baseline gap-1.5">
            <span className="micro-label text-on-surface-variant">Available:</span>
            <span className="font-mono text-label-md tabular text-on-surface">{courses.data?.pagination.total ?? 0}</span>
          </span>
        }
      />

      <p className="-mt-space-md font-body-md text-body-md text-on-surface-variant">
        Every course is a structured accountability track. Stake platform points to enrol, then earn them back through verified
        completion of each module and the final assessment.
      </p>

      {/* Filters */}
      <div className="surface-card flex flex-col gap-space-md p-space-lg">
        <div className="flex flex-col gap-space-md lg:flex-row lg:items-end">
          <SearchInput
            value={search}
            onChange={resetPage(setSearch)}
            placeholder="Search courses, categories or instructors"
            className="lg:flex-1"
          />

          <div className="grid grid-cols-2 gap-space-md sm:grid-cols-3 lg:w-auto">
            <Select
              label="Category"
              value={category}
              onChange={(event) => resetPage(setCategory)(event.target.value)}
              options={[
                { value: 'ALL', label: 'All categories' },
                ...(facets.data?.categories ?? []).map((entry) => ({
                  value: entry.value,
                  label: `${entry.value} (${entry.count})`,
                })),
              ]}
            />
            <Select
              label="Difficulty"
              value={difficulty}
              onChange={(event) => resetPage(setDifficulty)(event.target.value)}
              options={DIFFICULTIES.map((value) => ({
                value,
                label: value === 'ALL' ? 'All levels' : value.charAt(0) + value.slice(1).toLowerCase(),
              }))}
            />
            <Select
              label="Sort by"
              value={sort}
              onChange={(event) => resetPage(setSort)(event.target.value)}
              options={SORT_OPTIONS}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-space-md">
          <div className="flex flex-wrap items-center gap-space-sm">
            {difficulty !== 'ALL' ? (
              <Chip tone="stake" icon="tune">
                {difficulty.toLowerCase()}
              </Chip>
            ) : null}
            {category !== 'ALL' ? <Chip tone="stake">{category}</Chip> : null}
            {debouncedSearch ? <Chip tone="info">“{debouncedSearch}”</Chip> : null}
            {(difficulty !== 'ALL' || category !== 'ALL' || debouncedSearch) ? (
              <Button
                size="sm"
                variant="ghost"
                icon="close"
                onClick={() => {
                  setSearch('');
                  resetPage(setCategory)('ALL');
                  resetPage(setDifficulty)('ALL');
                }}
              >
                Clear filters
              </Button>
            ) : null}
          </div>

          {user?.role === 'LEARNER' ? (
            <Tabs
              tabs={[
                { id: 'all', label: 'All courses' },
                { id: 'mine', label: 'My enrolments' },
              ]}
              active={view}
              onChange={(id) => setView(id as 'all' | 'mine')}
              className="border-b-0"
            />
          ) : null}
        </div>
      </div>

      {/* Results */}
      {courses.error ? (
        <ErrorBlock title="Could not load courses" message={courses.error} onRetry={() => void courses.refetch()} />
      ) : courses.loading ? (
        <LoadingBlock label="Loading courses…" rows={4} />
      ) : visible.length === 0 ? (
        <div className="surface-card">
          <EmptyState
            icon="search_off"
            title={view === 'mine' ? 'No enrolments match these filters' : 'No courses match your filters'}
            description={
              view === 'mine'
                ? 'Switch to All courses to browse the full catalogue.'
                : 'Try a different search term, or clear the category and difficulty filters.'
            }
            action={
              <Button
                variant="secondary"
                icon="restart_alt"
                onClick={() => {
                  setSearch('');
                  setCategory('ALL');
                  setDifficulty('ALL');
                  setPage(1);
                }}
              >
                Reset filters
              </Button>
            }
          />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-space-lg md:grid-cols-2 xl:grid-cols-3">
            {visible.map((course) => (
              <CourseCard key={course.id} course={course} />
            ))}
          </div>

          {courses.data ? (
            <div className="surface-card">
              <Pagination
                page={courses.data.pagination.page}
                totalPages={courses.data.pagination.totalPages}
                total={courses.data.pagination.total}
                onPageChange={setPage}
              />
            </div>
          ) : null}
        </>
      )}

      <p className="flex items-center gap-1.5 font-label-xs text-label-xs text-on-surface-variant">
        <MaterialIcon name="info" className="text-[13px]" />
        Stake amounts and rewards shown here are virtual platform points. Stake It involves no real money.
      </p>
    </div>
  );
}
