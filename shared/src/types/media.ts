import type { ImageFormat, ImageStyle, MediaSource } from './enums';

/** A media file stored in the library (uploaded or AI-generated) */
export interface MediaItem {
  id: string;
  userId: string;
  filename: string;
  mimeType: string;
  fileSizeBytes: number;
  storageKey: string;
  thumbnailUrl: string;
  source: MediaSource;
  aiDescription?: string;
  width: number;
  height: number;
  createdAt: Date;
}

/** Join table linking posts to media items with ordering */
export interface PostMedia {
  id: string;
  postId: string;
  mediaItemId: string;
  displayOrder: number;
}

/** Request payload for AI image generation */
export interface ImageGenerationRequest {
  description: string;
  style?: ImageStyle;
  count?: number;
}

/** A single AI-generated image result */
export interface GeneratedImage {
  url: string;
  format: ImageFormat;
  width: number;
  height: number;
  description: string;
}
