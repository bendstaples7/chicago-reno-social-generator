/** The four content types supported in v1 */
export enum ContentType {
  Education = 'education',
  Testimonial = 'testimonial',
  PersonalBrand = 'personal_brand',
  SeasonalEvent = 'seasonal_event',
}

/** Content Advisor operating modes */
export enum AdvisorMode {
  Smart = 'smart',
  Random = 'random',
  Manual = 'manual',
}

/** Publish approval modes — only manual_review is available in v1 */
export type ApprovalMode = 'manual_review' | 'auto_publish';

/** Post lifecycle statuses following the state machine */
export type PostStatus =
  | 'draft'
  | 'awaiting_approval'
  | 'approved'
  | 'publishing'
  | 'published'
  | 'failed';

/** Approval workflow statuses */
export type ApprovalStatus = 'awaiting_approval' | 'approved' | 'rejected';

/** Media source labels */
export type MediaSource = 'uploaded' | 'ai_generated';

/** Channel connection statuses */
export type ChannelConnectionStatus = 'connected' | 'disconnected' | 'expired' | 'error';

/** Activity log severity levels */
export type LogSeverity = 'error' | 'warning' | 'info';

/** Image generation style options */
export type ImageStyle = 'photorealistic' | 'modern' | 'illustrative';

/** Generated image format */
export type ImageFormat = 'jpeg' | 'png' | 'webp';
