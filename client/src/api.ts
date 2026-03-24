import type {
  User, ErrorResponse, MediaItem, GeneratedImage, ImageStyle,
  ContentTypeTemplate, ContentSuggestion, Post, GeneratedContent,
  ChannelConnection, PublishResult, ContentType, UserSettings,
  ActivityLogEntry, AdvisorMode, ContentIdea,
} from 'shared';

const TOKEN_KEY = 'session_token';

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
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    let error: ErrorResponse;
    if (body && 'severity' in body) {
      error = body as ErrorResponse;
    } else {
      error = { severity: 'error', component: 'API', operation: '', message: `Request failed (${res.status})`, actions: [] } satisfies ErrorResponse;
    }
    globalErrorListener?.(error);
    throw error;
  }
  return res.json();
}

export async function login(email: string): Promise<{ user: User; token: string }> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  return handleResponse(res);
}

export async function verifySession(): Promise<{ valid: boolean; user?: User }> {
  const res = await fetch('/api/auth/verify', {
    method: 'POST',
    headers: { ...authHeaders() },
  });
  return handleResponse(res);
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', {
    method: 'POST',
    headers: { ...authHeaders() },
  });
  clearToken();
}

// ── Media Library ──

export async function listMedia(page = 1, limit = 20): Promise<{ items: MediaItem[]; page: number; limit: number }> {
  const res = await fetch(`/api/media?page=${page}&limit=${limit}`, {
    headers: { ...authHeaders() },
  });
  return handleResponse(res);
}

export async function uploadMedia(file: File): Promise<MediaItem> {
  const res = await fetch('/api/media/upload', {
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

export async function generateImages(description: string, style?: ImageStyle, count?: number, topic?: string): Promise<{ images: GeneratedImage[] }> {
  const res = await fetch('/api/media/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ description, style, count, topic }),
  });
  return handleResponse(res);
}

export async function saveGeneratedImage(image: GeneratedImage): Promise<MediaItem> {
  const res = await fetch(`/api/media/temp/save-generated`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(image),
  });
  return handleResponse(res);
}

export async function deleteMedia(id: string): Promise<void> {
  const res = await fetch(`/api/media/${id}`, {
    method: 'DELETE',
    headers: { ...authHeaders() },
  });
  await handleResponse(res);
}

// ── Content Types & Advisor ──

export async function fetchContentTypes(): Promise<{ contentTypes: ContentTypeTemplate[] }> {
  const res = await fetch('/api/content-types', {
    headers: { ...authHeaders() },
  });
  return handleResponse(res);
}

export async function fetchContentAdvisorSuggestion(): Promise<{ suggestion: ContentSuggestion | null }> {
  const res = await fetch('/api/content-advisor/suggest', {
    headers: { ...authHeaders() },
  });
  return handleResponse(res);
}

// ── Channels ──

export async function fetchChannels(): Promise<{ channels: ChannelConnection[] }> {
  const res = await fetch('/api/channels', {
    headers: { ...authHeaders() },
  });
  return handleResponse(res);
}

// ── Posts ──

export async function fetchPost(id: string): Promise<Post> {
  const res = await fetch(`/api/posts/${id}`, {
    headers: { ...authHeaders() },
  });
  return handleResponse(res);
}

export async function fetchPosts(): Promise<{ posts: Post[]; page: number; limit: number }> {
  const res = await fetch('/api/posts', {
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
  const res = await fetch('/api/posts', {
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
  const res = await fetch(`/api/posts/${id}`, {
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
  const res = await fetch(`/api/posts/${postId}/generate-content`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(data ?? {}),
  });
  return handleResponse(res);
}

export async function approvePost(id: string): Promise<{ success: boolean }> {
  const res = await fetch(`/api/posts/${id}/approve`, {
    method: 'POST',
    headers: { ...authHeaders() },
  });
  return handleResponse(res);
}

export async function publishPost(id: string): Promise<PublishResult> {
  const res = await fetch(`/api/posts/${id}/publish`, {
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
  const res = await fetch('/api/posts/quick-start', {
    method: 'POST',
    headers: { ...authHeaders() },
  });
  return handleResponse(res);
}

// ── Settings ──

export async function fetchSettings(): Promise<{ settings: UserSettings }> {
  const res = await fetch('/api/settings', {
    headers: { ...authHeaders() },
  });
  return handleResponse(res);
}

export async function updateSettings(data: {
  advisorMode?: AdvisorMode;
}): Promise<{ settings: UserSettings }> {
  const res = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

// ── Channels (connect/disconnect) ──

export async function connectInstagram(): Promise<{ authorizationUrl: string; state: string }> {
  const res = await fetch('/api/channels/instagram/connect', {
    method: 'POST',
    headers: { ...authHeaders() },
  });
  return handleResponse(res);
}

export async function disconnectChannel(id: string): Promise<{ success: boolean }> {
  const res = await fetch(`/api/channels/${id}`, {
    method: 'DELETE',
    headers: { ...authHeaders() },
  });
  return handleResponse(res);
}

// ── Activity Log ──

export async function fetchActivityLog(page = 1, limit = 20): Promise<{ entries: ActivityLogEntry[]; page: number; limit: number }> {
  const res = await fetch(`/api/activity-log?page=${page}&limit=${limit}`, {
    headers: { ...authHeaders() },
  });
  return handleResponse(res);
}

// ── Content Ideas ──

export async function fetchContentIdeas(contentType: ContentType): Promise<{ ideas: ContentIdea[] }> {
  const res = await fetch(`/api/content-ideas?contentType=${contentType}`, {
    headers: { ...authHeaders() },
  });
  return handleResponse(res);
}

export async function generateContentIdeas(contentType: ContentType): Promise<{ ideas: ContentIdea[] }> {
  const res = await fetch('/api/content-ideas/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ contentType }),
  });
  return handleResponse(res);
}

export async function useContentIdea(ideaId: string): Promise<{ idea: ContentIdea }> {
  const res = await fetch(`/api/content-ideas/${ideaId}/use`, {
    method: 'POST',
    headers: { ...authHeaders() },
  });
  return handleResponse(res);
}

export async function dismissContentIdea(ideaId: string): Promise<{ success: boolean }> {
  const res = await fetch(`/api/content-ideas/${ideaId}`, {
    method: 'DELETE',
    headers: { ...authHeaders() },
  });
  return handleResponse(res);
}
