import type {
  User, ErrorResponse, MediaItem, GeneratedImage, ImageStyle,
  ContentTypeTemplate, ContentSuggestion, Post, GeneratedContent,
  ChannelConnection, PublishResult, ContentType, UserSettings,
  ActivityLogEntry, AdvisorMode, ContentIdea,
} from 'shared';

const TOKEN_KEY = 'session_token';

const API_BASE = import.meta.env.PROD
  ? (import.meta.env.VITE_API_URL || 'https://social-media-cross-poster.chicago-reno.workers.dev')
  : '';

// Global error listener for toast notifications
type ErrorListener = (error: ErrorResponse) => void;
let globalErrorListener: ErrorListener | null = null;

export function setGlobalErrorListener(listener: ErrorListener | null): void {
  globalErrorListener = listener;
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: 'Bearer ' + token } : {};
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    let error: ErrorResponse;
    if (body && 'severity' in body) {
      error = body as ErrorResponse;
    } else {
      error = { severity: 'error', component: 'API', operation: '', message: 'Request failed (' + res.status + ')', actions: [] } satisfies ErrorResponse;
    }
    globalErrorListener?.(error);
    throw error;
  }
  return res.json();
}

export async function login(email: string): Promise<{ user: User; token: string }> {
  const res = await fetch(API_BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  return handleResponse(res);
}

export async function verifySession(): Promise<{ valid: boolean; user?: User }> {
  const res = await fetch(API_BASE + '/api/auth/verify', {
    method: 'POST',
    headers: { ...authHeaders() },
  });
  return handleResponse(res);
}

export async function logout(): Promise<void> {
  await fetch(API_BASE + '/api/auth/logout', {
    method: 'POST',
    headers: { ...authHeaders() },
  });
  clearToken();
}

// ── Media Library ──

export async function listMedia(page = 1, limit = 20): Promise<{ items: MediaItem[]; page: number; limit: number }> {
  const res = await fetch(API_BASE + '/api/media?page=' + page + '&limit=' + limit, {
    headers: { ...authHeaders() },
  });
  return handleResponse(res);
}

export async function uploadMedia(file: File): Promise<MediaItem> {
  const res = await fetch(API_BASE + '/api/media/upload', {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'Content-Type': file.type,
      'X-Filename': file.name,
    },
    body: file,
  });
  return handleResponse(res);
}

export async function generateImages(description: string, style?: ImageStyle, count?: number, topic?: string): Promise<{ images: GeneratedImage[]; mediaItems?: MediaItem[] }> {
  // Enqueue the generation job
  const enqueueRes = await fetch(API_BASE + '/api/media/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ description, style, count, topic }),
  });
  const { jobId } = await handleResponse<{ jobId: string }>(enqueueRes);

  // Poll for completion
  const POLL_INTERVAL = 2000;
  const MAX_POLLS = 90; // 3 minutes max
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
    const statusRes = await fetch(API_BASE + '/api/media/generate-status/' + jobId, {
      headers: { ...authHeaders() },
    });
    const status = await handleResponse<{
      jobId: string;
      status: string;
      error?: string;
      mediaItem?: MediaItem;
    }>(statusRes);

    if (status.status === 'completed' && status.mediaItem) {
      // Build a GeneratedImage for backward compat, but also return the saved MediaItem
      const img: GeneratedImage = {
        url: status.mediaItem.thumbnailUrl || status.mediaItem.storageKey,
        format: status.mediaItem.mimeType === 'image/png' ? 'png' : 'jpeg',
        width: status.mediaItem.width ?? 1024,
        height: status.mediaItem.height ?? 1024,
        description: status.mediaItem.aiDescription || description || topic || '',
      };
      return { images: [img], mediaItems: [status.mediaItem] };
    }

    if (status.status === 'failed') {
      const error: ErrorResponse = {
        severity: 'error',
        component: 'ImageGenerator',
        operation: 'generate',
        message: status.error || 'Image generation failed.',
        actions: ['Try again'],
      };
      globalErrorListener?.(error);
      throw error;
    }
  }

  // Timed out
  const error: ErrorResponse = {
    severity: 'error',
    component: 'ImageGenerator',
    operation: 'generate',
    message: 'Image generation timed out. Please try again.',
    actions: ['Try again'],
  };
  globalErrorListener?.(error);
  throw error;
}

export async function saveGeneratedImage(image: GeneratedImage): Promise<MediaItem> {
  const res = await fetch(API_BASE + '/api/media/temp/save-generated', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(image),
  });
  return handleResponse(res);
}

export async function deleteMedia(id: string): Promise<void> {
  const res = await fetch(API_BASE + '/api/media/' + id, {
    method: 'DELETE',
    headers: { ...authHeaders() },
  });
  await handleResponse(res);
}

// ── Content Types & Advisor ──

export async function fetchContentTypes(): Promise<{ contentTypes: ContentTypeTemplate[] }> {
  const res = await fetch(API_BASE + '/api/content-types', {
    headers: { ...authHeaders() },
  });
  return handleResponse(res);
}

// ── Channels ──

export async function fetchChannels(): Promise<{ channels: ChannelConnection[] }> {
  const res = await fetch(API_BASE + '/api/channels', {
    headers: { ...authHeaders() },
  });
  return handleResponse(res);
}

// ── Posts ──

export async function fetchPost(id: string): Promise<Post> {
  const res = await fetch(API_BASE + '/api/posts/' + id, {
    headers: { ...authHeaders() },
  });
  return handleResponse(res);
}

export async function fetchPosts(): Promise<{ posts: Post[]; page: number; limit: number }> {
  const res = await fetch(API_BASE + '/api/posts', {
    headers: { ...authHeaders() },
  });
  return handleResponse(res);
}

export async function createPost(data: {
  channelConnectionId: string;
  contentType: ContentType;
  caption: string;
  hashtags: string[];
  templateFields?: Record<string, string>;
  mediaItemIds?: string[];
}): Promise<Post> {
  const res = await fetch(API_BASE + '/api/posts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

export async function updatePost(id: string, data: {
  caption?: string;
  hashtags?: string[];
  contentType?: ContentType;
  channelConnectionId?: string;
  templateFields?: Record<string, string>;
  mediaItemIds?: string[];
}): Promise<Post> {
  const res = await fetch(API_BASE + '/api/posts/' + id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

export async function generateContent(postId: string, data?: {
  context?: string;
  templateFields?: Record<string, string>;
}): Promise<GeneratedContent> {
  const res = await fetch(API_BASE + '/api/posts/' + postId + '/generate-content', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(data ?? {}),
  });
  return handleResponse(res);
}

export async function approvePost(id: string): Promise<{ success: boolean }> {
  const res = await fetch(API_BASE + '/api/posts/' + id + '/approve', {
    method: 'POST',
    headers: { ...authHeaders() },
  });
  return handleResponse(res);
}

export async function publishPost(id: string): Promise<PublishResult> {
  const res = await fetch(API_BASE + '/api/posts/' + id + '/publish', {
    method: 'POST',
    headers: { ...authHeaders() },
  });
  return handleResponse(res);
}

// ── Quick-Post Workflow ──

export interface QuickStartResponse {
  suggestion: ContentSuggestion | null;
  mediaThumbnails: MediaItem[];
  defaults: {
    contentType: ContentType | null;
    hashtagCount: number;
    instagramFormat: {
      recommendedDimensions: {
        square: { width: number; height: number };
        portrait: { width: number; height: number };
        landscape: { width: number; height: number };
      };
      maxCaptionLength: number;
      maxCarouselImages: number;
      maxReelDuration: number;
      supportedMediaTypes: string[];
    };
  };
}

export async function quickStart(): Promise<QuickStartResponse> {
  const res = await fetch(API_BASE + '/api/posts/quick-start', {
    method: 'POST',
    headers: { ...authHeaders() },
  });
  return handleResponse(res);
}

// ── Settings ──

export async function fetchSettings(): Promise<{ settings: UserSettings }> {
  const res = await fetch(API_BASE + '/api/settings', {
    headers: { ...authHeaders() },
  });
  return handleResponse(res);
}

export async function updateSettings(data: {
  advisorMode?: AdvisorMode;
}): Promise<{ settings: UserSettings }> {
  const res = await fetch(API_BASE + '/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

// ── Channels (connect/disconnect) ──

export async function connectInstagram(): Promise<{ authorizationUrl: string; state: string }> {
  const res = await fetch(API_BASE + '/api/channels/instagram/connect', {
    method: 'POST',
    headers: { ...authHeaders() },
  });
  return handleResponse(res);
}

export async function disconnectChannel(id: string): Promise<{ success: boolean }> {
  const res = await fetch(API_BASE + '/api/channels/' + id, {
    method: 'DELETE',
    headers: { ...authHeaders() },
  });
  return handleResponse(res);
}

export async function refreshInstagramToken(id: string): Promise<{ channel: ChannelConnection }> {
  const res = await fetch(API_BASE + '/api/channels/instagram/refresh/' + id, {
    method: 'POST',
    headers: { ...authHeaders() },
  });
  return handleResponse(res);
}

// ── Activity Log ──

export async function fetchActivityLog(page = 1, limit = 20): Promise<{ entries: ActivityLogEntry[]; page: number; limit: number }> {
  const res = await fetch(API_BASE + '/api/activity-log?page=' + page + '&limit=' + limit, {
    headers: { ...authHeaders() },
  });
  return handleResponse(res);
}

// ── Content Ideas ──

export async function fetchContentIdeas(contentType: ContentType): Promise<{ ideas: ContentIdea[] }> {
  const res = await fetch(API_BASE + '/api/content-ideas?contentType=' + contentType, {
    headers: { ...authHeaders() },
  });
  return handleResponse(res);
}

export async function generateContentIdeas(contentType: ContentType): Promise<{ ideas: ContentIdea[] }> {
  const res = await fetch(API_BASE + '/api/content-ideas/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ contentType }),
  });
  return handleResponse(res);
}

export async function useContentIdea(ideaId: string): Promise<{ idea: ContentIdea }> {
  const res = await fetch(API_BASE + '/api/content-ideas/' + ideaId + '/use', {
    method: 'POST',
    headers: { ...authHeaders() },
  });
  return handleResponse(res);
}

export async function dismissContentIdea(ideaId: string): Promise<{ success: boolean }> {
  const res = await fetch(API_BASE + '/api/content-ideas/' + ideaId, {
    method: 'DELETE',
    headers: { ...authHeaders() },
  });
  return handleResponse(res);
}
