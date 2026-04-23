export interface NormalizedError {
  code?: string;
  subcode?: string;
  message: string;
  raw?: unknown;
}

export class SocialAnalyticsError extends Error {
  public readonly platform: string;
  public readonly code: string;

  constructor(message: string, platform: string, code?: string) {
    super(message);
    this.name = 'SocialAnalyticsError';
    this.platform = platform;
    this.code = code ?? 'UNKNOWN';
  }
}

export class InstagramApiError extends SocialAnalyticsError {
  public readonly apiCode?: number;
  public readonly apiType?: string;
  public readonly fbtrace_id?: string;

  constructor(params: { message: string; code?: number; type?: string; fbtrace_id?: string }) {
    const parts: string[] = [];
    if (params.code) parts.push(`code=${params.code}`);
    if (params.fbtrace_id) parts.push(`fbtrace=${params.fbtrace_id}`);
    const detail = parts.length ? ` (${parts.join(', ')})` : '';
    super(`${params.message}${detail}`, 'instagram');
    this.name = 'InstagramApiError';
    this.apiCode = params.code;
    this.apiType = params.type;
    this.fbtrace_id = params.fbtrace_id;
  }
}

export class FacebookApiError extends Error {
  public readonly normalized: NormalizedError;

  constructor(error: NormalizedError) {
    super(error.message);
    this.name = 'FacebookApiError';
    this.normalized = error;
  }
}
