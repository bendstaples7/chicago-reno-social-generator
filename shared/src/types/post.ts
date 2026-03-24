import type { ContentType, PostStatus } from './enums';

/** A social media post entity */
export interface Post {
  id: string;
  userId: string;
  channelConnectionId: string;
  contentType: ContentType;
  caption: string;
  hashtagsJson: string;
  status: PostStatus;
  externalPostId?: string;
  templateFields?: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
  publishedAt?: Date;
}
