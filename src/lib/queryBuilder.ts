import type { SocialPlatform } from '../types/media.ts';

export type QueryLanguage = 'en' | 'zh' | 'es' | 'id' | 'fr' | 'ja';

export interface GeneratedPlatformQuery {
  platform: SocialPlatform;
  platformLabel: string;
  queryText: string;
  rationale: string;
  duckDuckGoUrl: string;
  googleUrl: string;
  bingUrl: string;
}

const LANGUAGE_ORIGINAL_PHRASES: Record<
  QueryLanguage,
  { label: string; tiktok: string; instagram: string; douyin: string; facebook: string }
> = {
  en: {
    label: 'English',
    tiktok: '"original sound -"',
    instagram: '"Original audio"',
    douyin: '"创作的原声"',
    facebook: '"Original audio"',
  },
  zh: {
    label: 'Chinese (原声 / 抖音)',
    tiktok: '"原声"',
    instagram: '"Original audio" OR "原聲"',
    douyin: '"创作的原声" OR "原声"',
    facebook: '"原聲" OR "Original audio"',
  },
  es: {
    label: 'Spanish (Sonido original)',
    tiktok: '"sonido original -"',
    instagram: '"Audio original"',
    douyin: '"创作的原声"',
    facebook: '"Audio original"',
  },
  id: {
    label: 'Indonesian (Suara asli)',
    tiktok: '"suara asli -"',
    instagram: '"Audio asli" OR "Original audio"',
    douyin: '"创作的原声"',
    facebook: '"Audio asli" OR "Original audio"',
  },
  fr: {
    label: 'French (Son original)',
    tiktok: '"son original -"',
    instagram: '"Audio d’origine" OR "Original audio"',
    douyin: '"创作的原声"',
    facebook: '"Audio d’origine" OR "Original audio"',
  },
  ja: {
    label: 'Japanese (オリジナル楽曲)',
    tiktok: '"オリジナル楽曲 -"',
    instagram: '"オリジナル音源" OR "Original audio"',
    douyin: '"创作的原声"',
    facebook: '"オリジナル音源" OR "Original audio"',
  },
};

export const QUERY_LANGUAGES: Array<{ code: QueryLanguage; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'zh', label: 'Chinese (抖音原声)' },
  { code: 'es', label: 'Spanish' },
  { code: 'id', label: 'Indonesian' },
  { code: 'fr', label: 'French' },
  { code: 'ja', label: 'Japanese' },
];

export function buildZeroLoginQueries(params: {
  keyword: string;
  platforms: SocialPlatform[];
  language: QueryLanguage;
  excludeCommercialLabels?: boolean;
  rawAmbientOnly?: boolean;
  royaltyFreeMusicOnly?: boolean;
}): GeneratedPlatformQuery[] {
  const cleanKeyword = params.keyword.trim() || 'street food';
  const langPack = LANGUAGE_ORIGINAL_PHRASES[params.language] || LANGUAGE_ORIGINAL_PHRASES.en;
  const excludeLabels =
    params.excludeCommercialLabels !== false
      ? ' -"Official Audio" -"UMG" -"Sony Music" -"Warner" -"Vevo"'
      : '';
  const ambientBoost = params.rawAmbientOnly
    ? params.language === 'zh'
      ? ' ("沉浸式" OR "同期声" OR "无BGM")'
      : ' ("raw audio" OR "no music" OR "ASMR" OR "voiceover")'
    : '';
  const royaltyFreeBoostGlobal = params.royaltyFreeMusicOnly
    ? ' ("no copyright music" OR "royalty free" OR "free bgm" OR "无版权音乐")'
    : '';
  const royaltyFreeBoostDouyin = params.royaltyFreeMusicOnly
    ? ' ("无版权音乐" OR "免版权BGM" OR "免费商用" OR "原创纯音乐")'
    : '';

  const builders: Record<
    SocialPlatform,
    { label: string; build: () => { q: string; rationale: string } }
  > = {
    tiktok: {
      label: 'TikTok',
      build: () => ({
        q: `site:tiktok.com/@ "/video/" "${cleanKeyword}" ${langPack.tiktok}${royaltyFreeBoostGlobal}${ambientBoost}${excludeLabels}`,
        rationale:
          'Targets direct @creator/video URLs carrying native "original sound -" attribution while excluding "/music/" catalog pages.',
      }),
    },
    instagram: {
      label: 'Instagram Reels',
      build: () => ({
        q: `site:instagram.com/reel "${cleanKeyword}" ${langPack.instagram}${royaltyFreeBoostGlobal}${ambientBoost}${excludeLabels}`,
        rationale:
          'Indexes public /reel/ permalinks indexed with "Original audio" attribution without triggering Instagram login walls.',
      }),
    },
    douyin: {
      label: 'Douyin (抖音)',
      build: () => ({
        q: `site:douyin.com/video "${cleanKeyword}" ${langPack.douyin}${royaltyFreeBoostDouyin}${ambientBoost} -"汽水音乐" -"腾讯音乐"`,
        rationale:
          'Filters public Douyin /video/ pages containing "创作的原声" and creator-released 无版权音乐 (royalty-free BGM) while excluding commercial chart tracks.',
      }),
    },
    facebook: {
      label: 'Facebook Reels',
      build: () => ({
        q: `(site:facebook.com/reel OR site:facebook.com/watch) "${cleanKeyword}" ${langPack.facebook}${royaltyFreeBoostGlobal}${ambientBoost}${excludeLabels}`,
        rationale:
          'Finds public Facebook Reels and Watch clips stamped with "Original audio" outside Rights Manager commercial music.',
      }),
    },
  };

  return params.platforms.map((platform) => {
    const spec = builders[platform];
    const { q, rationale } = spec.build();
    const encoded = encodeURIComponent(q);
    return {
      platform,
      platformLabel: spec.label,
      queryText: q,
      rationale,
      duckDuckGoUrl: `https://duckduckgo.com/?q=${encoded}`,
      googleUrl: `https://www.google.com/search?q=${encoded}`,
      bingUrl: `https://www.bing.com/search?q=${encoded}`,
    };
  });
}
