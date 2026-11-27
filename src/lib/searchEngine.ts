import type {
  AudioFilterMode,
  SocialPlatform,
  SortOrder,
  ViralPost,
} from '../types/media.ts';

export interface SearchFilterInput {
  query?: string;
  platforms?: SocialPlatform[];
  niche?: string;
  audioMode?: AudioFilterMode;
  audioStyle?: string;
  minViews?: number;
  sort?: SortOrder;
}

export interface FilteredSearchOutput {
  items: ViralPost[];
  totalMatchedOriginal: number;
  excludedCopyrightedCount: number;
}

export function filterAndRankViralPosts(
  allPosts: ViralPost[],
  filter: SearchFilterInput
): FilteredSearchOutput {
  const q = (filter.query || '').trim().toLowerCase();
  const platforms =
    filter.platforms && filter.platforms.length > 0
      ? new Set<SocialPlatform>(filter.platforms)
      : null;
  const niche =
    filter.niche && filter.niche !== 'All Niches' ? filter.niche : null;
  const audioMode: AudioFilterMode = filter.audioMode || 'original_only';
  const audioStyle =
    filter.audioStyle && filter.audioStyle !== 'all' ? filter.audioStyle : null;
  const minViews = Math.max(0, Number(filter.minViews || 0));
  const sort: SortOrder = filter.sort || 'velocity';

  // Deduplicate by postUrl
  const seenUrls = new Set<string>();
  const deduped: ViralPost[] = [];
  for (const post of allPosts) {
    const key = post.postUrl.toLowerCase();
    if (!seenUrls.has(key)) {
      seenUrls.add(key);
      deduped.push(post);
    }
  }

  // Step 1: Match query, platform, niche, minViews
  const baseMatches = deduped.filter((post) => {
    if (platforms && !platforms.has(post.platform)) {
      return false;
    }
    if (niche && post.niche !== niche) {
      return false;
    }
    if (post.views < minViews) {
      return false;
    }
    if (q) {
      const searchable = [
        post.title,
        post.caption,
        post.creatorName,
        post.creatorHandle,
        post.niche,
        post.audioTitle,
        post.platform,
      ]
        .join(' ')
        .toLowerCase();
      const tokens = q.split(/\s+/).filter(Boolean);
      const matchesAll = tokens.every((tok) => searchable.includes(tok));
      if (!matchesAll) {
        return false;
      }
    }
    return true;
  });

  let excludedCopyrightedCount = 0;
  let totalMatchedOriginal = 0;

  for (const post of baseMatches) {
    if (post.classification.isOriginalSafe) {
      totalMatchedOriginal += 1;
    } else {
      excludedCopyrightedCount += 1;
    }
  }

  // Step 2: Apply audio rights & audio style filters
  const items = baseMatches.filter((post) => {
    if (audioMode === 'original_only' && !post.classification.isOriginalSafe) {
      return false;
    }
    if (
      audioMode === 'creator_owned_only' &&
      !post.classification.isCreatorOwned
    ) {
      return false;
    }
    if (audioStyle && post.classification.audioStyle !== audioStyle) {
      return false;
    }
    return true;
  });

  // Step 3: Sort
  items.sort((a, b) => {
    if (sort === 'views') {
      return b.views - a.views;
    }
    if (sort === 'engagement') {
      return b.engagementRatePct - a.engagementRatePct;
    }
    if (sort === 'recent') {
      return Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
    }
    return b.viewsPerDay - a.viewsPerDay;
  });

  return {
    items,
    totalMatchedOriginal,
    excludedCopyrightedCount,
  };
}
