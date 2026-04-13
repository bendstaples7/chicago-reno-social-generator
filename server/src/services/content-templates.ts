import { ContentType } from 'shared';
import type { ContentTypeTemplate } from 'shared';

/**
 * Content type template definitions for all four v1 content types.
 * Each template defines the fields, prompt structure, and layout guidance
 * used by the ContentGenerator to produce captions and hashtags.
 */

const educationTemplate: ContentTypeTemplate = {
  contentType: ContentType.Education,
  displayName: 'Education',
  description: 'Educational content about renovation topics, materials, techniques, or home improvement advice.',
  fields: [
    { name: 'topic_title', label: 'Topic Title', type: 'text', required: true, placeholder: 'e.g. Kitchen Flooring Options' },
    { name: 'key_points', label: 'Key Points', type: 'textarea', required: true, placeholder: 'Main takeaways, separated by newlines' },
    { name: 'supporting_media', label: 'Supporting Media Description', type: 'textarea', required: false, placeholder: 'Describe the attached media' },
  ],
  promptTemplate: [
    'Write an educational Instagram caption for Chicago Reno, a professional and approachable home renovation company.',
    'Topic: {{topic_title}}',
    'Key points to cover: {{key_points}}',
    '{{#context}}Additional context: {{context}}{{/context}}',
    'The caption should:',
    '- Open with an engaging hook about the topic',
    '- Include actionable tips or key takeaways',
    '- End with a call to action (e.g. save this post, contact us)',
    '- Use a professional yet approachable tone',
    'Generate relevant home improvement and education hashtags.',
  ].join('\n'),
  layoutGuidance: {
    suggestedMediaCount: 1,
    captionStructure: 'Hook → Key takeaways → Call to action',
    hashtagFocus: 'Home improvement, renovation tips, DIY education',
  },
};

const testimonialTemplate: ContentTypeTemplate = {
  contentType: ContentType.Testimonial,
  displayName: 'Testimonial',
  description: 'Customer reviews, testimonials, and positive feedback about Chicago Reno projects.',
  fields: [
    { name: 'customer_quote', label: 'Customer Quote', type: 'textarea', required: true, placeholder: 'The customer review or testimonial text' },
    { name: 'customer_name', label: 'Customer Name', type: 'text', required: false, placeholder: 'Customer name (leave blank for anonymous)' },
    { name: 'is_anonymous', label: 'Anonymous Testimonial', type: 'boolean', required: false },
    { name: 'project_type', label: 'Project Type', type: 'text', required: true, placeholder: 'e.g. Kitchen Remodel, Bathroom Renovation' },
  ],
  promptTemplate: [
    'Write a testimonial Instagram caption for Chicago Reno, a professional and approachable home renovation company.',
    'Customer quote: "{{customer_quote}}"',
    '{{#customer_name}}{{^is_anonymous}}Customer: {{customer_name}}{{/is_anonymous}}{{/customer_name}}',
    'Project type: {{project_type}}',
    '{{#context}}Additional context: {{context}}{{/context}}',
    'The caption should:',
    '- Highlight the customer review as the centerpiece',
    '- Reference the project type naturally',
    '- End with a call to action (e.g. ready for your renovation?)',
    '- Use a warm, grateful tone',
    '{{#is_anonymous}}- Do NOT include any customer name — this is an anonymous testimonial{{/is_anonymous}}',
    'Generate relevant customer satisfaction and social proof hashtags.',
  ].join('\n'),
  layoutGuidance: {
    suggestedMediaCount: 1,
    captionStructure: 'Quote highlight → Project reference → Call to action',
    hashtagFocus: 'Customer reviews, social proof, renovation results',
  },
};

const personalBrandTemplate: ContentTypeTemplate = {
  contentType: ContentType.PersonalBrand,
  displayName: 'Personal Brand',
  description: 'Features individual Chicago Reno team members to build personal branding and humanize the company.',
  fields: [
    { name: 'member_name', label: 'Team Member Name', type: 'text', required: true, placeholder: 'e.g. Alex Johnson' },
    { name: 'role', label: 'Role', type: 'text', required: true, placeholder: 'e.g. Lead Designer' },
    { name: 'bio_snippet', label: 'Bio Snippet', type: 'textarea', required: true, placeholder: 'A short bio or fun fact about the team member' },
  ],
  promptTemplate: [
    'Write a personal brand Instagram caption for Chicago Reno, a professional and approachable home renovation company.',
    'Team member: {{member_name}}',
    'Role: {{role}}',
    'Bio: {{bio_snippet}}',
    '{{#context}}Additional context: {{context}}{{/context}}',
    'The caption should:',
    '- Introduce or feature the team member in a personable way',
    '- Highlight their role or expertise at Chicago Reno',
    '- Humanize the company and build connection with followers',
    '- Use a friendly, team-culture tone',
    'Generate relevant team culture and personal branding hashtags.',
  ].join('\n'),
  layoutGuidance: {
    suggestedMediaCount: 1,
    captionStructure: 'Team member intro → Expertise/role → Personal touch',
    hashtagFocus: 'Team culture, personal branding, meet the team',
  },
};

const seasonalEventTemplate: ContentTypeTemplate = {
  contentType: ContentType.SeasonalEvent,
  displayName: 'Seasonal Event',
  description: 'Content tied to current events, holidays, or seasonal themes relevant to home renovation.',
  fields: [
    { name: 'event_name', label: 'Event / Holiday Name', type: 'text', required: true, placeholder: 'e.g. Spring Cleaning Season' },
    { name: 'event_date', label: 'Event Date', type: 'date', required: false, placeholder: 'YYYY-MM-DD' },
    { name: 'renovation_tie_in', label: 'Renovation Tie-In', type: 'textarea', required: true, placeholder: 'How this event connects to home renovation' },
  ],
  promptTemplate: [
    'Write a seasonal/event Instagram caption for Chicago Reno, a professional and approachable home renovation company.',
    'Event: {{event_name}}',
    '{{#event_date}}Date: {{event_date}}{{/event_date}}',
    'Renovation tie-in: {{renovation_tie_in}}',
    '{{#context}}Additional context: {{context}}{{/context}}',
    'The caption should:',
    '- Connect the event or holiday to a home renovation theme',
    '- Feel timely and relevant',
    '- End with a seasonal call to action',
    '- Use an upbeat, seasonal tone',
    'Generate relevant seasonal and timely hashtags.',
  ].join('\n'),
  layoutGuidance: {
    suggestedMediaCount: 1,
    captionStructure: 'Event connection → Renovation tie-in → Seasonal CTA',
    hashtagFocus: 'Seasonal themes, holiday renovation, timely content',
  },
};

const beforeAfterTemplate: ContentTypeTemplate = {
  contentType: ContentType.BeforeAfter,
  displayName: 'Before & After',
  description: 'Project transformation showcases with before and after photos of Chicago Reno renovation work.',
  fields: [
    { name: 'project_type', label: 'Project Type', type: 'text', required: true, placeholder: 'e.g. Kitchen Remodel, Bathroom Renovation' },
    { name: 'scope_summary', label: 'Scope of Work', type: 'textarea', required: true, placeholder: 'Brief description of what was done' },
    { name: 'standout_detail', label: 'Standout Detail', type: 'text', required: false, placeholder: 'e.g. Custom tile work, open-concept layout' },
  ],
  promptTemplate: [
    'Write a before-and-after project showcase Instagram caption for Chicago Reno, a professional and approachable home renovation company.',
    'Project type: {{project_type}}',
    'Scope of work: {{scope_summary}}',
    '{{#standout_detail}}Standout detail: {{standout_detail}}{{/standout_detail}}',
    '{{#context}}Additional context: {{context}}{{/context}}',
    'The caption should:',
    '- Open with a hook that highlights the transformation',
    '- Briefly describe the scope of work and key changes',
    '- Emphasize the visual impact and craftsmanship',
    '- End with a call to action (e.g. ready for your transformation?)',
    '- Use a proud, results-driven tone',
    'Generate relevant renovation transformation and project showcase hashtags.',
  ].join('\n'),
  layoutGuidance: {
    suggestedMediaCount: 2,
    captionStructure: 'Transformation hook → Scope of work → Standout detail → CTA',
    hashtagFocus: 'Before and after, renovation transformation, project showcase',
  },
};

/** Map of all content type templates keyed by ContentType */
export const CONTENT_TEMPLATES: ReadonlyMap<ContentType, ContentTypeTemplate> = new Map([
  [ContentType.Education, educationTemplate],
  [ContentType.Testimonial, testimonialTemplate],
  [ContentType.PersonalBrand, personalBrandTemplate],
  [ContentType.SeasonalEvent, seasonalEventTemplate],
  [ContentType.BeforeAfter, beforeAfterTemplate],
]);

/** Get the template for a given content type. Throws if not found. */
export function getTemplate(contentType: ContentType): ContentTypeTemplate {
  const template = CONTENT_TEMPLATES.get(contentType);
  if (!template) {
    throw new Error(`No template found for content type: ${contentType}`);
  }
  return template;
}

/** Get all available templates as an array */
export function getAllTemplates(): ContentTypeTemplate[] {
  return Array.from(CONTENT_TEMPLATES.values());
}
