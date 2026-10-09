import { Chip } from './core';

/** Small expertise tag list used on instructor cards and profiles. */
export function SkillList({ skills, className }: { skills: string[]; className?: string }) {
  if (skills.length === 0) return null;

  return (
    <div className={className}>
      <span className="micro-label text-on-surface-variant">Expertise</span>
      <div className="mt-space-xs flex flex-wrap gap-space-xs">
        {skills.map((skill) => (
          <Chip key={skill} tone="info">
            {skill}
          </Chip>
        ))}
      </div>
    </div>
  );
}
