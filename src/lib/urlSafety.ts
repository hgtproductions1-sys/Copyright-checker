import type { SocialPlatform } from '../types/media.ts';

export interface ParsedSocialUrl {
  ok: boolean;
  normalizedUrl?: string;
  platform?: SocialPlatform;
  postId?: string;
  creatorHandle?: string;
  error?: string;
}

const ALLOWED_HOST_TO_PLATFORM: Record<string, SocialPlatform> = {
  'tiktok.com': 'tiktok',
  'www.tiktok.com': 'tiktok',
  'm.tiktok.com': 'tiktok',
  'vm.tiktok.com': 'tiktok',
  'vt.tiktok.com': 'tiktok',
  'instagram.com': 'instagram',
  'www.instagram.com': 'instagram',
  'douyin.com': 'douyin',
  'www.douyin.com': 'douyin',
  'v.douyin.com': 'douyin',
  'iesdouyin.com': 'douyin',
  'www.iesdouyin.com': 'douyin',
  'facebook.com': 'facebook',
  'www.facebook.com': 'facebook',
  'm.facebook.com': 'facebook',
  'fb.watch': 'facebook',
};

function isPrivateOrLoopbackHost(hostname: string): boolean {
  const lower = hostname.toLowerCase().trim();
  if (
    lower === 'localhost' ||
    lower === '0.0.0.0' ||
    lower === '::1' ||
    lower === '[::1]' ||
    lower.endsWith('.local') ||
    lower.endsWith('.internal')
  ) {
    return true;
  }

  // IPv4 literal check
  const ipv4Match = lower.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [a, b] = [Number(ipv4Match[1]), Number(ipv4Match[2])];
    if (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    ) {
      return true;
    }
    // Reject all raw IP literals because allowed social platforms always use domain names
    return true;
  }

  if (lower.includes(':')) {
    // Reject IPv6 literals
    return true;
  }

  return false;
}

export function validateAndParseSocialUrl(rawInput: string): ParsedSocialUrl {
  const trimmed = (rawInput || '').trim();
  if (!trimmed) {
    return {
      ok: false,
      error: 'Enter a public TikTok, Instagram, Douyin, or Facebook video URL to inspect.',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      ok: false,
      error: 'Invalid URL format. Include https:// followed by a supported post link.',
    };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return {
      ok: false,
      error: 'Only http:// and https:// public video links are permitted.',
    };
  }

  if (parsed.username || parsed.password) {
    return {
      ok: false,
      error: 'URLs containing embedded credentials are not allowed.',
    };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (isPrivateOrLoopbackHost(hostname)) {
    return {
      ok: false,
      error: 'Private, loopback, or IP-literal addresses are blocked.',
    };
  }

  const platform = ALLOWED_HOST_TO_PLATFORM[hostname];
  if (!platform) {
    return {
      ok: false,
      error:
        'Unsupported domain. Paste a public link from TikTok, Instagram, Douyin, or Facebook.',
    };
  }

  // Always upgrade to https for outbound requests
  parsed.protocol = 'https:';
  parsed.hash = '';

  const pathname = parsed.pathname;
  let postId: string | undefined;
  let creatorHandle: string | undefined;

  if (platform === 'tiktok') {
    const match = pathname.match(/\/@([^/]+)\/(?:video|photo)\/(\d+)/i);
    if (match) {
      creatorHandle = match[1];
      postId = match[2];
    } else {
      const shortMatch = pathname.match(/^\/([A-Za-z0-9_-]{5,24})\/?$/);
      if (shortMatch) {
        postId = shortMatch[1];
      }
    }
  } else if (platform === 'instagram') {
    const match = pathname.match(/\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/i);
    if (match) {
      postId = match[1];
    }
  } else if (platform === 'douyin') {
    const match =
      pathname.match(/\/(?:video|note|share\/video)\/(\d+)/i) ||
      pathname.match(/^\/([A-Za-z0-9_-]{5,24})\/?$/);
    if (match) {
      postId = match[1];
    }
    const modalId = parsed.searchParams.get('modal_id');
    if (!postId && modalId && /^\d+$/.test(modalId)) {
      postId = modalId;
    }
  } else if (platform === 'facebook') {
    const reelMatch = pathname.match(/\/(?:reel|videos|share\/r)\/([A-Za-z0-9_-]+)/i);
    if (reelMatch) {
      postId = reelMatch[1];
    } else if (hostname === 'fb.watch') {
      const shortMatch = pathname.match(/^\/([A-Za-z0-9_-]+)/);
      if (shortMatch) {
        postId = shortMatch[1];
      }
    } else {
      const vParam = parsed.searchParams.get('v');
      if (vParam) {
        postId = vParam;
      }
    }
  }

  if (pathname === '/' && !parsed.search) {
    return {
      ok: false,
      error: `Paste a direct ${platform} video or reel URL rather than the platform homepage.`,
    };
  }

  return {
    ok: true,
    normalizedUrl: parsed.toString(),
    platform,
    postId,
    creatorHandle,
  };
}

const ALLOWED_MEDIA_CDN_SUFFIXES = [
  '.tikwm.com',
  'tikwm.com',
  '.tiktokcdn.com',
  '.tiktokcdn-us.com',
  '.tiktokcdn-eu.com',
  '.tiktokv.com',
  '.muscdn.com',
  '.byteimg.com',
  '.ibytedtos.com',
  '.ipstatp.com',
  '.pstatp.com',
  '.douyinpic.com',
  '.douyinstatic.com',
  '.douyinvod.com',
  '.zjcdn.com',
  '.cdninstagram.com',
  '.fbcdn.net',
  '.fbsbx.com',
];

export function isAllowedMediaCdnUrl(rawStreamUrl: string): boolean {
  if (!rawStreamUrl || typeof rawStreamUrl !== 'string') {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(rawStreamUrl.trim());
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:') {
    return false;
  }
  if (parsed.username || parsed.password) {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  if (isPrivateOrLoopbackHost(host)) {
    return false;
  }

  return ALLOWED_MEDIA_CDN_SUFFIXES.some((suffix) =>
    suffix.startsWith('.') ? host.endsWith(suffix) : host === suffix
  );
}

export function sanitizeDownloadFilename(raw: string): string {
  const cleaned = (raw || 'video')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return cleaned || 'origisound-clip';
}
