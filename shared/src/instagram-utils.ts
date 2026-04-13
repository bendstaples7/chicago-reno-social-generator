import { ContentType } from './types/enums';

/**
 * Content type labels used by the content ideas generator.
 * Single source of truth for both server and worker.
 */
export const CONTENT_TYPE_LABELS: Record<string, string> = {
  education: 'Educational content about renovation topics, materials, techniques, or home improvement advice',
  testimonial: 'Customer reviews, testimonials, and success stories about renovation projects',
  personal_brand: 'Team member spotlights, behind-the-scenes, and company culture content',
  seasonal_event: 'Content tied to seasons, holidays, or timely events related to home renovation',
  before_after: 'Project transformation showcases with before and after photos of renovation work',
};

/**
 * Classifies an Instagram post caption into a ContentType using keyword heuristics.
 * Falls back to Education as the most generic type.
 */
export function classifyContentType(caption: string): ContentType {
  const lower = (caption || '').toLowerCase();

  const beforeAfterKeywords = [
    'before and after', 'before & after', 'transformation',
    'the before', 'the after', 'swipe to see', 'what a difference',
    'from this to this', 'project reveal', 'reveal day',
  ];
  if (beforeAfterKeywords.some((kw) => lower.includes(kw))) return ContentType.BeforeAfter;

  const testimonialKeywords = [
    'review', 'testimonial', 'feedback', 'thank you for the kind words',
    'what our client', 'client said', 'customer said', '⭐', 'stars',
    'happy client', 'happy customer', 'loved working with',
  ];
  if (testimonialKeywords.some((kw) => lower.includes(kw))) return ContentType.Testimonial;

  const personalBrandKeywords = [
    'meet the team', 'team member', 'behind the scenes', 'our crew',
    'employee spotlight', 'team spotlight', 'day in the life',
  ];
  if (personalBrandKeywords.some((kw) => lower.includes(kw))) return ContentType.PersonalBrand;

  const seasonalKeywords = [
    'happy holidays', 'merry christmas', 'happy new year',
    'spring cleaning', 'spring project', 'summer project',
    'fall project', 'winter project', 'thanksgiving',
    'memorial day', 'labor day', '4th of july', 'fourth of july',
    'valentine', "mother's day", "father's day", 'seasonal',
    'new year', 'holiday season',
  ];
  if (seasonalKeywords.some((kw) => lower.includes(kw))) return ContentType.SeasonalEvent;

  return ContentType.Education;
}

/** Extract hashtags from a caption string. */
export function extractHashtags(caption: string): string[] {
  const matches = (caption || '').match(/#[\w]+/g);
  return matches ? matches.map((tag) => tag.slice(1)) : [];
}
