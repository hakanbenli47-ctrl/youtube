export type ContentType = "SHORT" | "LONG" | "UNKNOWN";

export type VideoMetric = {
  id: string;
  title: string;
  publishedAt: string;
  durationSeconds: number;
  contentType: ContentType;
  views: number;
  engagedViews?: number;
  watchHours: number;
  subscribersGained: number;
  subscribersLost: number;
  impressions: number | null;
  ctr: number | null;
  avgViewDurationSeconds: number;
  avgViewPercentage: number;
  likes: number;
  comments: number;
  thumbnailUrl?: string;
  topic: string;
};

export type DailyMetric = {
  date: string;
  views: number;
  engagedViews?: number;
  watchMinutes: number;
  subscribersGained: number;
  subscribersLost: number;
  likes: number;
  comments: number;
  shares: number;
};

export type ShortsDailyMetric = DailyMetric & {
  contentType: "SHORTS";
};

export type TrendVideo = {
  id: string;
  title: string;
  channelTitle: string;
  publishedAt: string;
  thumbnailUrl: string;
  views: number;
  likes: number;
  comments: number;
  viewsPerDay: number;
  trendScore: number;
  query: string;
};

export type PlanItem = {
  id: string;
  date: string;
  dayLabel: string;
  format: "Shorts" | "Uzun Video";
  title: string;
  hook: string;
  duration: string;
  publishTime: string;
  pillar: string;
  objective: "İzlenme" | "Abone" | "Beğeni" | "İzlenme Süresi";
  priority: "Kritik" | "Yüksek" | "Normal";
  reason: string;
  voiceover: string;
  description: string;
  hashtags: string[];
  cta: string;
  estimatedSeconds: number;
  strategyMode: "Kazananı büyüt" | "Kontrollü test" | "Denge";
};

export type TopicInsight = {
  topic: string;
  videoCount: number;
  recentCount: number;
  averageViews: number;
  subscribersPerThousand: number;
  averageRetention: number;
  score: number;
  decision: "ÖLÇEKLE" | "TEST ET" | "DENGELE" | "DİNLENDİR";
  reason: string;
};

export type RepetitionAlert = {
  id: string;
  label: string;
  evidence: string;
  severity: "DİNLENDİR" | "BENZERLİK" | "DENGE";
  cooldownDays: number;
  titles: string[];
};

export type PostingSlot = {
  id: string;
  dayLabel: string;
  time: string;
  format: "Tümü" | "Shorts" | "Uzun Video";
  sampleSize: number;
  score: number;
  confidence: "Yüksek" | "Orta" | "Test";
  reason: string;
};

export type WeeklyScheduleDay = {
  day: number;
  dayLabel: string;
  shortsTimes: string[];
  longVideoTime: string | null;
  evidence: string;
  confidence: "Yüksek" | "Orta" | "Test";
  shortSlots?: Array<{
    time: string;
    objective: "İzlenme" | "Abone" | "Beğeni";
    score: number;
    sampleSize: number;
    reason: string;
    change: "Korundu" | "Değişti" | "Test";
  }>;
};

export type CombinationInsight = {
  id: string;
  dimension: "Padişah" | "Başlık Kalıbı" | "Gün × Dönem" | "Konu";
  label: string;
  sampleSize: number;
  totalViews: number;
  viewsPerDay: number;
  engagementRate: number;
  subscribersPerThousand: number;
  score: number;
  confidence: "Yüksek" | "Orta" | "Test";
  decision: "ÖLÇEKLE" | "DOĞRULA" | "DİNLENDİR";
  reason: string;
};

export type ShortsGrowthGoal = {
  targetViews: number;
  windowDays: number;
  currentViews: number;
  remainingViews: number;
  requiredViewsPerDay: number;
  currentViewsPerDay: number;
  projectedWindowViews: number;
  progressPercent: number;
  subscriberTarget: number;
  currentSubscribers: number;
  subscribersRemaining: number;
  requiredSubscribersPerDay: number;
  status: "HEDEF HIZINDA" | "SIÇRAMA GEREKLİ" | "TEST AŞAMASI";
};

export type Recommendation = {
  id: string;
  action: "YAP" | "TEST ET" | "DURDUR" | "DÜZELT";
  title: string;
  detail: string;
  confidence: number;
  impact: "Yüksek" | "Orta" | "Düşük";
};

export type ChannelState = {
  channel: {
    id: string;
    title: string;
    handle: string;
    thumbnailUrl: string;
    subscriberCount: number;
    videoCount: number;
    viewCount: number;
  };
  goals: {
    subscriberTarget: number;
    deadline: string;
  };
  totals: {
    views: number;
    watchHours: number;
    netSubscribers: number;
    impressions: number;
    ctr: number;
  };
  videos: VideoMetric[];
  daily: DailyMetric[];
  shortsDaily: ShortsDailyMetric[];
  trends: TrendVideo[];
  plan: PlanItem[];
  recommendations: Recommendation[];
  planning?: {
    weekKey: string;
    generatedAt: string;
    weeklySchedule?: WeeklyScheduleDay[];
  };
  auth: {
    connected: boolean;
    tokens?: Record<string, unknown>;
    oauthState?: string;
  };
  sync: {
    lastStudioImport: string | null;
    lastYouTubeSync: string | null;
    lastTrendScan: string | null;
    status: "ready" | "syncing" | "error";
    message: string;
  };
};

export type DashboardData = {
  state: Omit<ChannelState, "auth"> & { auth: { connected: boolean } };
  momentum: {
    last7Views: number;
    previous7Views: number;
    viewGrowthPercent: number;
    last7Subscribers: number;
    subscriberGrowthRequired: number;
    subscribersPerDayRequired: number;
    viewsRequired: number;
    viewsPerDayRequired: number;
    projected30DaySubscribers: number;
    targetProbabilityLabel: string;
    progressPercent: number;
  };
  formatSplit: Array<{
    name: string;
    views: number;
    subscribers: number;
    watchHours: number;
  }>;
  topVideos: VideoMetric[];
  topicInsights: TopicInsight[];
  repetitionAlerts: RepetitionAlert[];
  postingSlots: PostingSlot[];
  weeklySchedule: WeeklyScheduleDay[];
  winningCombinations: CombinationInsight[];
  shortsGrowthGoal: ShortsGrowthGoal;
  weeklyReview: {
    weekKey: string;
    nextReviewAt: string;
    shortsAnalyzed: number;
    changedSlotCount: number;
    summary: string;
  };
  setup: {
    youtubeCredentialsReady: boolean;
    hasChannelData: boolean;
    dataSource: "live" | "studio" | "none";
  };
  generatedAt: string;
};
