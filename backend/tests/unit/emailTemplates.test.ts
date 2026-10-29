import { describe, expect, it } from 'vitest';
import { OPTIONAL_EMAIL_TYPES, renderEmail } from '../../src/services/emailService';

/**
 * Email rendering and the opt-out policy.
 *
 * The templates are plain strings, but two things matter for safety and for
 * compliance: notification text must be escaped (it can contain learner or
 * instructor supplied strings), and the opt-out must apply only to optional
 * mail, never to receipts.
 */
describe('renderEmail', () => {
  it('escapes HTML from the notification so a course title cannot inject markup', () => {
    const { html } = renderEmail({
      title: '<script>alert(1)</script>',
      message: 'Grade <b>released</b>',
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Grade &lt;b&gt;released&lt;/b&gt;');
  });

  it('includes an absolute call-to-action when a link is present and omits it otherwise', () => {
    const withLink = renderEmail({ title: 'Done', message: 'Course complete', link: '/learn/abc' });
    expect(withLink.html).toContain('href="http://localhost:5173/learn/abc"');

    const withoutLink = renderEmail({ title: 'Done', message: 'Course complete' });
    expect(withoutLink.html).not.toContain('Open Stake It</a>');
  });

  it('addresses the learner by first name when one is known', () => {
    const { html } = renderEmail({ title: 'Hi', message: 'Body', name: 'Ada Lovelace' });
    expect(html).toContain('Hi Ada,');
  });

  it('produces a text alternative with the same content', () => {
    const { text } = renderEmail({ title: 'Deadline', message: 'Due in 48 hours', link: '/x' });
    expect(text).toContain('Deadline');
    expect(text).toContain('Due in 48 hours');
    expect(text).toContain('http://localhost:5173/x');
  });
});

describe('email opt-out policy', () => {
  it('treats reminders and nudges as optional', () => {
    expect(OPTIONAL_EMAIL_TYPES).toContain('DEADLINE_APPROACHING');
    expect(OPTIONAL_EMAIL_TYPES).toContain('AT_RISK');
    expect(OPTIONAL_EMAIL_TYPES).toContain('RETRY_AVAILABLE');
  });

  it('never treats receipts for the learner’s own actions as optional', () => {
    for (const type of ['ENROLLMENT', 'COURSE_COMPLETED', 'REWARD_RECEIVED', 'STAKE_FORFEITED'] as const) {
      expect(OPTIONAL_EMAIL_TYPES).not.toContain(type);
    }
  });

});
