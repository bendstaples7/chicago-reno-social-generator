import type { ChannelConnectionStatus, PostStatus } from './enums';
import type { Post } from './post';

/** A connected social media channel account */
export interface ChannelConnection {
  id: string;
  userId: string;
  channelType: string;
  externalAccountId: string;
  externalAccountName: string;
  accessTokenEncrypted: string;
  tokenExpiresAt: Date;
  status: ChannelConnectionStatus;
  createdAt: Date;
  updatedAt: Date;
}

/** Channel-specific constraints for content validation */
export interface ChannelConstraints {
  maxCaptionLength: number;
  maxHashtags: number;
  maxCarouselImages: number;
  maxReelDuration: number;
  supportedMediaTypes: string[];
  recommendedDimensions: {
    square: { width: number; height: number };
    portrait: { width: number; height: number };
    landscape: { width: number; height: number };
  };
}

/** A post formatted for a specific channel's API */
export interface FormattedPost {
  postId: string;
  channelType: string;
  caption: string;
  hashtags: string[];
  mediaUrls: string[];
  metadata: Record<string, unknown>;
}

/** Result of a publish operation */
export interface PublishResult {
  success: boolean;
  externalPostId?: string;
  error?: string;
}

/** Result of validating a post against channel constraints */
export interface ValidationResult {
  valid: boolean;
  violations: string[];
}

/**
 * Abstract interface that all social media channel implementations must conform to.
 * In v1, only InstagramChannel implements this interface.
 */
export interface ChannelInterface {
  readonly channelType: string;
  getAuthorizationUrl(state: string): string;
  handleAuthCallback(code: string, userId: string): Promise<ChannelConnection>;
  disconnect(connectionId: string): Promise<void>;
  formatPost(post: Post): Promise<FormattedPost>;
  validatePost(post: Post): Promise<ValidationResult>;
  publish(formattedPost: FormattedPost): Promise<PublishResult>;
  getPostStatus(externalPostId: string): Promise<PostStatus>;
  getConstraints(): ChannelConstraints;
}
