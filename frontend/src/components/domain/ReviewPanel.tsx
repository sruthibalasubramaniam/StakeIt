import { useState } from 'react';
import { cn } from '../../utils/cn';
import { Avatar, Button, Chip, Divider, MaterialIcon } from '../ui/core';
import { Alert, EmptyState, Modal } from '../ui/data';
import { RatingInput } from '../ui/forms';
import { formatDate } from '../../utils/format';

export interface CourseReview {
  id?: string;
  rating: number;
  difficultyRating?: number | null;
  wouldRecommend?: boolean;
  reviewText?: string | null;
  createdAt?: string;
  user?: { id: string; fullName: string; avatarUrl: string | null };
}

/**
 * Course reviews. New reviews are only offered to learners the backend has
 * already verified as having completed the course — the modal never appears
 * speculatively, and the API rejects it regardless.
 */
export function ReviewList({ reviews, className }: { reviews: CourseReview[]; className?: string }) {
  if (reviews.length === 0) {
    return (
      <div className={cn('py-space-md', className)}>
        <EmptyState
          icon="reviews"
          title="No reviews yet"
          description="Reviews are only accepted from learners who complete the course, so this stays empty until the first graduate."
        />
      </div>
    );
  }

  return (
    <ul className={cn('flex flex-col divide-y divide-outline-variant', className)}>
      {reviews.map((review, index) => (
        <li key={review.id ?? index} className="flex flex-col gap-space-xs py-space-md">
          <div className="flex items-start justify-between gap-space-md">
            <div className="flex items-center gap-space-sm">
              <Avatar name={review.user?.fullName ?? 'Graduate'} url={review.user?.avatarUrl} />
              <div className="flex flex-col">
                <span className="font-label-sm text-label-sm text-on-surface">{review.user?.fullName ?? 'Verified graduate'}</span>
                {review.createdAt ? (
                  <span className="font-label-xs text-label-xs text-on-surface-variant">{formatDate(review.createdAt)}</span>
                ) : null}
              </div>
            </div>
            <div className="flex items-center gap-space-sm">
              <span className="flex items-center gap-0.5">
                {Array.from({ length: 5 }, (_, index_) => (
                  <MaterialIcon
                    key={index_}
                    name="star"
                    filled={index_ < review.rating}
                    className={cn('text-[14px]', index_ < review.rating ? 'text-primary-container' : 'text-outline-variant')}
                  />
                ))}
              </span>
              {review.wouldRecommend ? <Chip tone="earned">recommends</Chip> : null}
            </div>
          </div>
          {review.reviewText ? (
            <p className="pl-9 font-body-sm text-body-sm text-on-surface-variant">{review.reviewText}</p>
          ) : null}
          {review.difficultyRating ? (
            <span className="pl-9 font-label-xs text-label-xs text-on-surface-variant">
              Rated difficulty {review.difficultyRating}/5
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function ReviewModal({
  open,
  onClose,
  onSubmit,
  courseTitle,
  submitting,
  error,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: { rating: number; difficultyRating: number; wouldRecommend: boolean; reviewText: string }) => void;
  courseTitle: string;
  submitting: boolean;
  error?: string | null;
}) {
  const [rating, setRating] = useState(5);
  const [difficulty, setDifficulty] = useState(3);
  const [wouldRecommend, setWouldRecommend] = useState(true);
  const [text, setText] = useState('');

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Rate this course"
      description={courseTitle}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            loading={submitting}
            onClick={() => onSubmit({ rating, difficultyRating: difficulty, wouldRecommend, reviewText: text })}
          >
            Submit review
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-space-lg">
        <div className="flex flex-col gap-space-xs">
          <span className="font-label-sm text-label-sm text-on-surface">Overall rating</span>
          <RatingInput value={rating} onChange={setRating} />
        </div>

        <Divider />

        <div className="flex flex-col gap-space-xs">
          <span className="font-label-sm text-label-sm text-on-surface">How difficult was it?</span>
          <span className="font-label-xs text-label-xs text-on-surface-variant">
            1 = very easy · 5 = very demanding
          </span>
          <RatingInput value={difficulty} onChange={setDifficulty} />
        </div>

        <Divider />

        <div className="flex flex-col gap-space-xs">
          <span className="font-label-sm text-label-sm text-on-surface">Would you recommend it?</span>
          <div className="flex items-center gap-space-sm">
            <Button
              size="sm"
              variant={wouldRecommend ? 'primary' : 'secondary'}
              icon="thumb_up"
              onClick={() => setWouldRecommend(true)}
            >
              Yes
            </Button>
            <Button
              size="sm"
              variant={!wouldRecommend ? 'primary' : 'secondary'}
              icon="thumb_down"
              onClick={() => setWouldRecommend(false)}
            >
              No
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-space-xs">
          <label htmlFor="review-text" className="font-label-sm text-label-sm text-on-surface">
            Written review (optional)
          </label>
          <textarea
            id="review-text"
            rows={4}
            value={text}
            maxLength={4000}
            onChange={(event) => setText(event.target.value)}
            placeholder="What worked, what did not, and who would benefit from this course?"
            className="w-full rounded border border-outline-variant bg-surface-container-lowest px-space-md py-space-sm font-body-md text-body-md focus:border-primary-container focus:outline-none focus:ring-2 focus:ring-primary-container/10"
          />
          <span className="self-end font-label-xs text-label-xs text-on-surface-variant">{text.length}/4000</span>
        </div>

        {error ? <Alert tone="error" title="Could not submit review">{error}</Alert> : null}
      </div>
    </Modal>
  );
}
