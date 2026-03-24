import type { ContentType } from './enums';
import type { MediaItem } from './media';

/** Input for the Content Generator service */
export interface ContentGeneratorInput {
  contentType: ContentType;
  media: MediaItem[];
  context?: string;
  templateFields?: Record<string, string>;
}

/** Output from the Content Generator */
export interface GeneratedContent {
  caption: string;
  hashtags: string[];
  formattedCaption: string;
}

/** A content type suggestion from the Content Advisor */
export interface ContentSuggestion {
  contentType: ContentType;
  reason: string;
}

/** Defines a field within a content type template */
export interface TemplateField {
  name: string;
  label: string;
  type: 'text' | 'textarea' | 'boolean' | 'date';
  required: boolean;
  placeholder?: string;
}

/** Layout guidance for a content type template */
export interface LayoutGuidance {
  suggestedMediaCount: number;
  captionStructure: string;
  hashtagFocus: string;
}

/** Full definition of a content type template */
export interface ContentTypeTemplate {
  contentType: ContentType;
  displayName: string;
  description: string;
  fields: TemplateField[];
  promptTemplate: string;
  layoutGuidance: LayoutGuidance;
}

/** Holiday / seasonal event entry for planning */
export interface HolidayEntry {
  name: string;
  date: string;
  renovationTieIn: string;
}

/** A generated content idea stored in the database */
export interface ContentIdea {
  id: string;
  userId: string;
  contentType: ContentType;
  idea: string;
  used: boolean;
  createdAt: Date;
}
