import { query } from '../config/database.js';
import { PlatformError } from '../errors/index.js';
import { ContentType, AdvisorMode } from 'shared';
import type { ContentSuggestion } from 'shared';

const ALL_CONTENT_TYPES: ContentType[] = [
  ContentType.Education,
  ContentType.Testimonial,
  ContentType.PersonalBrand,
  ContentType.SeasonalEvent,
  ContentType.BeforeAfter,
];

export class ContentAdvisor {
  /**
   * Get a content type suggestion based on the current mode.
   * Returns null in Manual mode.
   */
  async suggest(userId: string, mode: AdvisorMode): Promise<ContentSuggestion | null> {
    switch (mode) {
      case AdvisorMode.Smart:
        return this.smartSuggest(userId);
      case AdvisorMode.Random:
        return this.randomSuggest(userId);
      case AdvisorMode.Manual:
        return null;
      default:
        throw new PlatformError({
          severity: 'error',
          component: 'ContentAdvisor',
          operation: 'suggest',
          description: `Unknown advisor mode: ${mode as string}`,
          recommendedActions: ['Select a valid advisor mode (Smart, Random, or Manual)'],
        });
    }
  }

  /**
   * Smart mode: analyze post history for recency and variety.
   * Returns the content type that has the longest gap since last use.
   * If a type has never been posted, it gets highest priority.
   */
  private async smartSuggest(userId: string): Promise<ContentSuggestion> {
    const result = await query(
      `SELECT content_type, MAX(created_at) AS last_posted
       FROM posts
       WHERE user_id = $1
       GROUP BY content_type`,
      [userId],
    );

    const lastPosted = new Map<string, Date>();
    for (const row of result.rows) {
      lastPosted.set(row.content_type as string, new Date(row.last_posted as string));
    }

    // Find types never posted — they get top priority
    const neverPosted = ALL_CONTENT_TYPES.filter((ct) => !lastPosted.has(ct));
    if (neverPosted.length > 0) {
      const suggested = neverPosted[0];
      return {
        contentType: suggested,
        reason: `You haven't posted any ${this.formatTypeName(suggested)} content yet — great time to start!`,
      };
    }

    // All types have been posted; pick the one with the oldest last post
    let oldestType = ALL_CONTENT_TYPES[0];
    let oldestDate = lastPosted.get(oldestType)!;

    for (const ct of ALL_CONTENT_TYPES) {
      const date = lastPosted.get(ct)!;
      if (date < oldestDate) {
        oldestDate = date;
        oldestType = ct;
      }
    }

    const daysSince = Math.floor((Date.now() - oldestDate.getTime()) / (1000 * 60 * 60 * 24));
    const reason =
      daysSince > 0
        ? `You haven't posted ${this.formatTypeName(oldestType)} content in ${daysSince} day${daysSince === 1 ? '' : 's'} — time to mix it up!`
        : `Your ${this.formatTypeName(oldestType)} content is the least recent — posting it now keeps your mix balanced.`;

    return { contentType: oldestType, reason };
  }

  /**
   * Random mode: weighted random selection favoring content types
   * used less frequently in the last 30 days.
   */
  private async randomSuggest(userId: string): Promise<ContentSuggestion> {
    const result = await query(
      `SELECT content_type, COUNT(*)::int AS post_count
       FROM posts
       WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '30 days'
       GROUP BY content_type`,
      [userId],
    );

    const counts = new Map<string, number>();
    for (const row of result.rows) {
      counts.set(row.content_type as string, row.post_count as number);
    }

    // Build weights: inverse of usage count. Types with 0 posts get the highest weight.
    const maxCount = Math.max(1, ...ALL_CONTENT_TYPES.map((ct) => counts.get(ct) ?? 0));
    const weights = ALL_CONTENT_TYPES.map((ct) => {
      const count = counts.get(ct) ?? 0;
      // Weight = maxCount + 1 - count, so less-used types get higher weight
      return maxCount + 1 - count;
    });

    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    let random = Math.random() * totalWeight;

    for (let i = 0; i < ALL_CONTENT_TYPES.length; i++) {
      random -= weights[i];
      if (random <= 0) {
        return {
          contentType: ALL_CONTENT_TYPES[i],
          reason: `Randomly selected ${this.formatTypeName(ALL_CONTENT_TYPES[i])} — weighted toward content types you've used less recently.`,
        };
      }
    }

    // Fallback (should not reach here)
    return {
      contentType: ALL_CONTENT_TYPES[ALL_CONTENT_TYPES.length - 1],
      reason: `Randomly selected ${this.formatTypeName(ALL_CONTENT_TYPES[ALL_CONTENT_TYPES.length - 1])} — weighted toward content types you've used less recently.`,
    };
  }

  /** Format a ContentType enum value into a human-readable name. */
  private formatTypeName(ct: ContentType): string {
    switch (ct) {
      case ContentType.Education:
        return 'Education';
      case ContentType.Testimonial:
        return 'Testimonial';
      case ContentType.PersonalBrand:
        return 'Personal Brand';
      case ContentType.SeasonalEvent:
        return 'Seasonal Event';
      case ContentType.BeforeAfter:
        return 'Before & After';
      default:
        return ct;
    }
  }
}
