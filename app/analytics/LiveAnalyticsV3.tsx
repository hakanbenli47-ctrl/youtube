"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  Award,
  BarChart3,
  CheckCircle2,
  Clock3,
  Eye,
  Flame,
  Gauge,
  Lightbulb,
  MessageCircle,
  RefreshCw,
  Rocket,
  Share2,
  ShieldAlert,
  Target,
  ThumbsUp,
  Timer,
  TrendingDown,
  TrendingUp,
  UserPlus,
  Users,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import "./analytics-v3.css";

type ThresholdForecast = { threshold: number; probability: number; remaining: number };
type LivePoint = { capturedAt: string; views: number; viewsPerMinute: number };
type LiveVideoAnalysis = {
  id: string;
  title: string;
  thumbnailUrl?: string;
  publishedAt: string;
  ageHours: number;
  views: number;
  viewsPerMinute: number;
  viewsPerHour: number;
  viewsPerMinute60m: number;
  viewsPerMinute6h: number;
  accelerationPercent: number;
  lastDeltaViews: number;
  lastDeltaMinutes: number;
  avgViewDurationSeconds: number;
  avgViewPercentage: number;
  engagedViewRate: number;
  likeRate: number;
  commentRate: number;
  shareRate: number;
  subscribersPerThousand: number;
  sustainProbability: number;
  momentumScore: number;
  qualityScore: number;
  status: "YÜKSELİYOR" | "STABİL" | "YAVAŞLIYOR" | "YENİ TEST";
  confidence: "YÜKSEK" | "ORTA" | "TEST";
  projected24h: number;
  projected72h: number;
  projected7d: number;
  forecastLow: number;
  forecastHigh: number;
  thresholds: ThresholdForecast[];
  history: LivePoint[];
  signal: string;
};

type Payload = {
  generatedAt: string;
  dataThroughDate: string | null;
  analyticsLagDays: number;
  snapshotCount: number;
  refreshEveryMinutes: number;
  connected?: boolean;
  syncMessage?: string;
  summary: {
    activeVideos: number;
    liveViewsPerMinute: number;
    liveViewsPerHour: number;
    todayViews: number;
    todayNetSubscribers: number;
    bestMomentumTitle: string | null;
    bestMomentumScore: number;
    channelMedianViewsPerDay: number;
  };
  today: LiveVideoAnalysis[];
  active: LiveVideoAnalysis[];
  recent: LiveVideoAnalysis[];
  warnings: string[];
  note: string;
};

type BrowserSample = { capturedAt: string; videos: Record<string, number> };
type ActionTone = "good" | "watch" | "risk" | "info";
type DerivedVideo = {
  breakoutScore: number;
  secondWave: number;
  hookScore: number;
  hookGrade: string;
  stage: string;
  paceRatio: number;
  nextThreshold: number | null;
  etaHours: number | null;
  actionTitle: string;
  actionBody: string;
  actionTone: ActionTone;
  quadrant: "ROKET" | "UYUYAN DEV" | "HIZ VAR" | "SOĞUYOR";
};

const STORAGE_KEY = "tarihin-izi-live-samples-v4";
const whole = new Intl.NumberFormat("tr-TR");
const compact = new Intl.NumberFormat("tr-TR", { notation: "compact", maximumFractionDigits: 1 });
const decimal = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 });

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function ageLabel(hours: number) {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} dk`;
  if (hours < 48) return `${decimal.format(hours)} saat`;
  return `${decimal.format(hours / 24)} gün`;
}

function etaLabel(hours: number | null) {
  if (hours === null || !Number.isFinite(hours)) return "belirsiz";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} dk`;
  if (hours < 48) return `${decimal.format(hours)} sa`;
  if (hours < 24 * 14) return `${decimal.format(hours / 24)} gün`;
  return "uzak";
}

function timeAgo(value: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return "şimdi";
  if (minutes < 60) return `${minutes} dk önce`;
  return `${Math.round(minutes / 60)} sa önce`;
}

function statusIcon(status: LiveVideoAnalysis["status"]) {
  if (status === "YÜKSELİYOR") return <TrendingUp size={15} />;
  if (status === "YAVAŞLIYOR") return <TrendingDown size={15} />;
  return <Activity size={15} />;
}

function readBrowserSamples(): BrowserSample[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as BrowserSample[] : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((sample) => sample?.capturedAt && sample?.videos);
  } catch {
    return [];
  }
}

function saveBrowserSample(payload: Payload) {
  const current: BrowserSample = {
    capturedAt: new Date().toISOString(),
    videos: Object.fromEntries(payload.recent.map((video) => [video.id, video.views])),
  };
  const cutoff = Date.now() - 48 * 60 * 60_000;
  const previous = readBrowserSamples()
    .filter((sample) => new Date(sample.capturedAt).getTime() >= cutoff)
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  const last = previous.at(-1);
  if (last && Date.now() - new Date(last.capturedAt).getTime() < 45_000) previous[previous.length - 1] = current;
  else previous.push(current);
  const trimmed = previous.slice(-600);
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed)); } catch { /* sunucu ölçümleri devam eder */ }
  return trimmed;
}

function velocityBetween(a: BrowserSample, b: BrowserSample, videoId: string) {
  const start = new Date(a.capturedAt).getTime();
  const end = new Date(b.capturedAt).getTime();
  const minutes = (end - start) / 60_000;
  if (!Number.isFinite(minutes) || minutes < .5) return null;
  const first = a.videos[videoId];
  const last = b.videos[videoId];
  if (!Number.isFinite(first) || !Number.isFinite(last)) return null;
  return { minutes, delta: Math.max(0, last - first), vpm: Math.max(0, last - first) / minutes };
}

function nearestAnchor(rows: BrowserSample[], targetTime: number) {
  let anchor = rows[0];
  let distance = Math.abs(new Date(anchor.capturedAt).getTime() - targetTime);
  for (const row of rows.slice(0, -1)) {
    const next = Math.abs(new Date(row.capturedAt).getTime() - targetTime);
    if (next < distance) { anchor = row; distance = next; }
  }
  return anchor;
}

function patchWithBrowserHistory(item: LiveVideoAnalysis, samples: BrowserSample[]) {
  const rows = samples.filter((sample) => Number.isFinite(sample.videos[item.id]));
  if (rows.length < 2) return item;
  const latest = rows.at(-1)!;
  let latestVelocity: ReturnType<typeof velocityBetween> = null;
  for (let index = rows.length - 2; index >= 0; index -= 1) {
    latestVelocity = velocityBetween(rows[index], latest, item.id);
    if (latestVelocity && latestVelocity.minutes >= 1) break;
  }
  if (!latestVelocity) return item;

  const latestTime = new Date(latest.capturedAt).getTime();
  const hourVelocity = velocityBetween(nearestAnchor(rows, latestTime - 60 * 60_000), latest, item.id) || latestVelocity;
  const sixHourVelocity = velocityBetween(nearestAnchor(rows, latestTime - 6 * 60 * 60_000), latest, item.id) || hourVelocity;
  const vpm = latestVelocity.vpm;
  const vpm60 = hourVelocity.vpm;
  const vpm6 = sixHourVelocity.vpm;
  const accelerationRatio = vpm6 > .001 ? clamp(vpm / vpm6, .15, 4) : vpm > 0 ? 1.25 : .5;
  const accelerationPercent = Math.round((accelerationRatio - 1) * 100);
  const status: LiveVideoAnalysis["status"] = item.ageHours < 2
    ? "YENİ TEST"
    : accelerationRatio >= 1.2 && vpm >= .1
      ? "YÜKSELİYOR"
      : accelerationRatio <= .65
        ? "YAVAŞLIYOR"
        : "STABİL";
  const sustainFactor = clamp(.35 + item.sustainProbability / 100 * .65, .35, 1);
  const projected24 = Math.max(item.views, Math.round(item.views + vpm * 60 * 24 * .62 * sustainFactor));
  const projected72 = Math.max(projected24, Math.round(item.views + vpm60 * 60 * 72 * .46 * sustainFactor));
  const projected7d = Math.max(projected72, Math.round(item.views + vpm6 * 60 * 24 * 7 * .31 * sustainFactor));
  const localWeight = rows.length >= 8 ? .62 : rows.length >= 4 ? .46 : .28;
  const thresholds = item.thresholds.map((threshold) => {
    if (item.views >= threshold.threshold) return { ...threshold, probability: 100, remaining: 0 };
    const progress = clamp(item.views / threshold.threshold, 0, 1);
    const pace = clamp(projected7d / threshold.threshold, 0, 1.8);
    const accelerationSignal = clamp(accelerationPercent / 100, -.5, 1);
    const localProbability = clamp(5 + progress * 30 + pace * 31 + item.sustainProbability * .23 + accelerationSignal * 11, 1, 97);
    return {
      ...threshold,
      probability: Math.round(threshold.probability * (1 - localWeight) + localProbability * localWeight),
      remaining: Math.max(0, threshold.threshold - item.views),
    };
  });
  const history = rows
    .filter((row) => latestTime - new Date(row.capturedAt).getTime() <= 24 * 60 * 60_000)
    .slice(-100)
    .map((row, index, all) => ({
      capturedAt: row.capturedAt,
      views: row.videos[item.id] || 0,
      viewsPerMinute: index ? velocityBetween(all[index - 1], row, item.id)?.vpm || 0 : 0,
    }));

  return {
    ...item,
    viewsPerMinute: Math.round(vpm * 100) / 100,
    viewsPerHour: Math.round(vpm * 60),
    viewsPerMinute60m: Math.round(vpm60 * 100) / 100,
    viewsPerMinute6h: Math.round(vpm6 * 100) / 100,
    accelerationPercent,
    lastDeltaViews: latestVelocity.delta,
    lastDeltaMinutes: Math.round(latestVelocity.minutes * 10) / 10,
    projected24h: Math.round(item.projected24h * (1 - localWeight) + projected24 * localWeight),
    projected72h: Math.round(item.projected72h * (1 - localWeight) + projected72 * localWeight),
    projected7d: Math.round(item.projected7d * (1 - localWeight) + projected7d * localWeight),
    thresholds,
    status,
    confidence: rows.length >= 8 ? "YÜKSEK" : rows.length >= 3 ? "ORTA" : item.confidence,
    history,
    signal: status === "YÜKSELİYOR"
      ? `Cihaz ölçümlerinde dağıtım güçleniyor; son ölçümde +${latestVelocity.delta} izlenme geldi.`
      : status === "YAVAŞLIYOR"
        ? "Cihaz ölçümlerinde hız aşağı yönlü. Yeni dağıtım dalgası gelmezse alt tahmin bandı daha olası."
        : item.signal,
  };
}

function hydrateWithBrowserSamples(payload: Payload) {
  const samples = saveBrowserSample(payload);
  const patch = (item: LiveVideoAnalysis) => patchWithBrowserHistory(item, samples);
  const byId = new Map(payload.recent.map((item) => [item.id, patch(item)]));
  const recent = payload.recent.map((item) => byId.get(item.id) || item);
  const active = payload.active.map((item) => byId.get(item.id) || patch(item));
  const today = payload.today.map((item) => byId.get(item.id) || patch(item));
  const activeVpm = active.slice(0, 8).map((item) => item.viewsPerMinute);
  const liveViewsPerMinute = activeVpm.length ? activeVpm.reduce((sum, value) => sum + value, 0) / activeVpm.length : 0;
  return {
    payload: {
      ...payload,
      recent,
      active,
      today,
      snapshotCount: Math.max(payload.snapshotCount, samples.length),
      summary: {
        ...payload.summary,
        liveViewsPerMinute: Math.round(liveViewsPerMinute * 100) / 100,
        liveViewsPerHour: Math.round(liveViewsPerMinute * 60),
      },
    },
    browserSampleCount: samples.length,
  };
}

function dailyPace(item: LiveVideoAnalysis) {
  const live = item.viewsPerMinute * 1440;
  const ageDays = Math.max(.2, item.ageHours / 24);
  const agePace = item.views / Math.min(7, ageDays);
  return live > 1 ? live : agePace;
}

function deriveVideo(item: LiveVideoAnalysis, channelMedian: number): DerivedVideo {
  const paceRatio = clamp(dailyPace(item) / Math.max(channelMedian, 1), 0, 8);
  const velocitySignal = clamp(Math.log2(1 + paceRatio) / 2.7, 0, 1);
  const retentionSignal = item.avgViewPercentage > 0 ? clamp((item.avgViewPercentage - 50) / 50, 0, 1) : .42;
  const engagedSignal = item.engagedViewRate > 0 ? clamp((item.engagedViewRate - 45) / 35, 0, 1) : .42;
  const accelerationSignal = clamp((item.accelerationPercent + 40) / 150, 0, 1);
  const breakoutScore = Math.round(clamp(
    velocitySignal * 31 + item.momentumScore * .22 + item.sustainProbability * .19 + item.qualityScore * .16 + accelerationSignal * 12,
    0,
    100,
  ));
  const ageWindow = item.ageHours < 3 ? .42 : item.ageHours <= 96 ? 1 : item.ageHours <= 168 ? .62 : .28;
  const secondWave = Math.round(clamp(
    item.qualityScore * .29 + item.sustainProbability * .31 + accelerationSignal * 22 + ageWindow * 18,
    2,
    97,
  ));
  const hookScore = Math.round(clamp((engagedSignal * .62 + retentionSignal * .38) * 100, 0, 100));
  const hookGrade = hookScore >= 88 ? "A+" : hookScore >= 78 ? "A" : hookScore >= 68 ? "B" : hookScore >= 56 ? "C" : "D";
  const stage = item.ageHours < 2
    ? "İLK TEST"
    : item.views >= 100_000
      ? "VİRAL"
      : breakoutScore >= 78
        ? "PATLAMA ADAYI"
        : item.accelerationPercent >= 25
          ? "HIZLANIYOR"
          : item.sustainProbability >= 65
            ? "YAYILIM"
            : item.ageHours > 48 && item.accelerationPercent <= -25
              ? "SOĞUMA"
              : "DAĞITIM";
  const next = item.thresholds.find((threshold) => threshold.threshold > item.views);
  const effectiveVpm = Math.max(item.viewsPerMinute, item.viewsPerMinute60m * .85, item.viewsPerMinute6h * .62);
  const etaHours = next && effectiveVpm >= .02
    ? clamp(next.remaining / Math.max(effectiveVpm * 60, .01), 0, 24 * 30)
    : null;

  let actionTitle = "Veri toplamaya devam et";
  let actionBody = "Dağıtım henüz net bir yöne girmedi. İlk 90–180 dakikadaki hız ve tutma değişimini izle.";
  let actionTone: ActionTone = "info";
  if (breakoutScore >= 78 && item.accelerationPercent > 5) {
    actionTitle = "Dokunma — dağıtım güçleniyor";
    actionBody = "Bu videoda paket değişikliği yapma. Aynı kriz/çelişki yapısını yeni bir olayda tekrar kullanmak için not al.";
    actionTone = "good";
  } else if (item.qualityScore >= 70 && paceRatio < .75) {
    actionTitle = "Uyuyan dev: kalite var, dağıtım zayıf";
    actionBody = "Bu videonun hook mantığını koru; aynı sonucu farklı ve daha talep gören bir olayla yeniden test et.";
    actionTone = "watch";
  } else if (item.engagedViewRate > 0 && item.engagedViewRate < 58) {
    actionTitle = "İlk 2 saniye ana sorun";
    actionBody = "Sonraki videoda daha büyük kriz, net bedel ve somut sayı kullan. Cevabı ilk cümlede verme.";
    actionTone = "risk";
  } else if (item.avgViewPercentage > 0 && item.avgViewPercentage < 68) {
    actionTitle = "Orta bölüm izleyici kaybediyor";
    actionBody = "Bağlamı kısalt, her 2–3 saniyede yeni bilgi ver ve çözümü son 10 saniyeye taşı.";
    actionTone = "risk";
  } else if (item.subscribersPerThousand >= 4) {
    actionTitle = "Abone motoru çalışıyor";
    actionBody = "Bu videonun konu ve final CTA yapısını abone öncelikli içeriklerde yeniden kullan.";
    actionTone = "good";
  }

  const highVelocity = paceRatio >= 1;
  const highQuality = item.qualityScore >= 64 || hookScore >= 68;
  const quadrant: DerivedVideo["quadrant"] = highVelocity && highQuality
    ? "ROKET"
    : !highVelocity && highQuality
      ? "UYUYAN DEV"
      : highVelocity && !highQuality
        ? "HIZ VAR"
        : "SOĞUYOR";

  return {
    breakoutScore,
    secondWave,
    hookScore,
    hookGrade,
    stage,
    paceRatio,
    nextThreshold: next?.threshold || null,
    etaHours,
    actionTitle,
    actionBody,
    actionTone,
    quadrant,
  };
}

function MetricCard({ icon: Icon, label, value, detail, accent = "blue" }: { icon: typeof Eye; label: string; value: string; detail: string; accent?: "blue" | "red" | "green" | "gold" }) {
  return (
    <article className={`v4-metric v4-${accent}`}>
      <div className="v4-metric-icon"><Icon size={18} /></div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function Thresholds({ item }: { item: LiveVideoAnalysis }) {
  return (
    <div className="v4-thresholds">
      {item.thresholds.map((threshold) => (
        <div key={threshold.threshold} className={threshold.probability >= 70 ? "high" : threshold.probability >= 35 ? "mid" : "low"}>
          <span>{compact.format(threshold.threshold)}</span>
          <strong>%{threshold.probability}</strong>
          <small>{threshold.remaining ? `${compact.format(threshold.remaining)} kaldı` : "aşıldı"}</small>
        </div>
      ))}
    </div>
  );
}

function VideoCard({ item, derived, selected, onClick }: { item: LiveVideoAnalysis; derived: DerivedVideo; selected: boolean; onClick: () => void }) {
  return (
    <button className={`v4-video-card ${selected ? "selected" : ""}`} onClick={onClick}>
      <div className="v4-video-head">
        {item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" /> : <div className="v4-thumb"><Eye size={20} /></div>}
        <div>
          <div className="v4-status-row">
            <span className={`v4-stage stage-${derived.stage.toLowerCase().replaceAll(" ", "-").replace("ı", "i")}`}>{derived.stage}</span>
            <small>{ageLabel(item.ageHours)} · {item.confidence}</small>
          </div>
          <h3>{item.title}</h3>
        </div>
      </div>
      <div className="v4-mini-grid">
        <div><span>Anlık</span><strong>{decimal.format(item.viewsPerMinute)}/dk</strong></div>
        <div><span>Toplam</span><strong>{compact.format(item.views)}</strong></div>
        <div><span>Patlama</span><strong>{derived.breakoutScore}/100</strong></div>
        <div><span>2. dalga</span><strong>%{derived.secondWave}</strong></div>
      </div>
      <div className="v4-quality-row">
        <span>Hook <b>{derived.hookGrade}</b></span>
        <span>Tutma <b>%{decimal.format(item.avgViewPercentage)}</b></span>
        <span>Kaydırmadan izleme tahmini <b>%{decimal.format(item.engagedViewRate)}</b></span>
        <span>Abone/1K <b>{decimal.format(item.subscribersPerThousand)}</b></span>
      </div>
      <div className="v4-sustain">
        <div><span>Dağıtımın sürme ihtimali</span><b>%{item.sustainProbability}</b></div>
        <i><em style={{ width: `${item.sustainProbability}%` }} /></i>
      </div>
      <Thresholds item={item} />
    </button>
  );
}

export default function LiveAnalyticsV3() {
  const [data, setData] = useState<Payload | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [browserSamples, setBrowserSamples] = useState(0);

  async function load(manual = false) {
    if (manual) setBusy(true);
    try {
      const response = await fetch(`/api/analytics/live?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Canlı analiz verisi alınamadı.");
      const raw = await response.json() as Payload;
      const hydrated = hydrateWithBrowserSamples(raw);
      setData(hydrated.payload);
      setBrowserSamples(hydrated.browserSampleCount);
      setSelectedId((current) => current || hydrated.payload.today[0]?.id || hydrated.payload.active[0]?.id || hydrated.payload.recent[0]?.id || "");
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Canlı analiz verisi alınamadı.");
    } finally {
      if (manual) setBusy(false);
    }
  }

  useEffect(() => {
    const initial = window.setTimeout(() => void load(true), 0);
    const timer = window.setInterval(() => void load(false), 90_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, []);

  const derivedMap = useMemo(() => {
    if (!data) return new Map<string, DerivedVideo>();
    return new Map(data.recent.map((item) => [item.id, deriveVideo(item, data.summary.channelMedianViewsPerDay)]));
  }, [data]);

  const selected = useMemo(() => {
    if (!data) return null;
    return data.recent.find((item) => item.id === selectedId) || data.today[0] || data.active[0] || data.recent[0] || null;
  }, [data, selectedId]);

  const selectedDerived = selected ? derivedMap.get(selected.id) || null : null;
  const chart = useMemo(() => selected?.history.map((point) => ({
    ...point,
    label: new Date(point.capturedAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }),
  })) || [], [selected]);

  const intelligence = useMemo(() => {
    if (!data) return null;
    const rows = data.recent.map((item) => ({ item, derived: derivedMap.get(item.id)! })).filter((row) => row.derived);
    const byBreakout = [...rows].sort((a, b) => b.derived.breakoutScore - a.derived.breakoutScore);
    const byRetention = [...rows].sort((a, b) => b.item.avgViewPercentage - a.item.avgViewPercentage);
    const bySubs = [...rows].sort((a, b) => b.item.subscribersPerThousand - a.item.subscribersPerThousand);
    const bySpeed = [...rows].sort((a, b) => b.item.viewsPerMinute - a.item.viewsPerMinute);
    const accelerating = rows.filter((row) => row.item.accelerationPercent >= 15).length;
    const sleepers = rows.filter((row) => row.derived.quadrant === "UYUYAN DEV").length;
    const breakoutCandidates = rows.filter((row) => row.derived.breakoutScore >= 70).length;

    const quadrants = {
      "ROKET": rows.filter((row) => row.derived.quadrant === "ROKET"),
      "UYUYAN DEV": rows.filter((row) => row.derived.quadrant === "UYUYAN DEV"),
      "HIZ VAR": rows.filter((row) => row.derived.quadrant === "HIZ VAR"),
      "SOĞUYOR": rows.filter((row) => row.derived.quadrant === "SOĞUYOR"),
    };

    const hours = new Map<string, { hour: string; sample: number; pace: number; winners: number }>();
    for (const row of rows) {
      const hour = new Date(row.item.publishedAt).toLocaleTimeString("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", hour12: false });
      const key = `${hour}:00`;
      const current = hours.get(key) || { hour: key, sample: 0, pace: 0, winners: 0 };
      current.sample += 1;
      current.pace += dailyPace(row.item);
      if (row.derived.breakoutScore >= 65 || row.derived.paceRatio >= 1.25) current.winners += 1;
      hours.set(key, current);
    }
    const hourRows = [...hours.values()]
      .map((entry) => ({ ...entry, pace: entry.pace / entry.sample, hitRate: Math.round(entry.winners / entry.sample * 100) }))
      .sort((a, b) => b.pace - a.pace)
      .slice(0, 6);

    const observations: Array<{ tone: ActionTone; title: string; body: string }> = [];
    const best = byBreakout[0];
    if (best) observations.push({ tone: best.derived.breakoutScore >= 70 ? "good" : "info", title: `Şu an en güçlü aday: ${best.item.title}`, body: `Patlama skoru ${best.derived.breakoutScore}/100, ikinci dalga ihtimali %${best.derived.secondWave}. ${best.derived.actionTitle}.` });
    const sleeper = rows.find((row) => row.derived.quadrant === "UYUYAN DEV");
    if (sleeper) observations.push({ tone: "watch", title: "Kalitesi hızından güçlü bir video var", body: `${sleeper.item.title} kalite ${sleeper.item.qualityScore}/100 olmasına rağmen kanal tabanının altında dağılıyor. Aynı hook mantığı farklı olayda tekrar test edilmeye değer.` });
    const weakHook = [...rows].filter((row) => row.item.engagedViewRate > 0).sort((a, b) => a.item.engagedViewRate - b.item.engagedViewRate)[0];
    if (weakHook && weakHook.item.engagedViewRate < 60) observations.push({ tone: "risk", title: "Hook alarmı", body: `${weakHook.item.title} için kaydırmadan izleme tahmini %${decimal.format(weakHook.item.engagedViewRate)}. İlk cümlede kriz/bedel/sayı yapısını sertleştir.` });
    const conversion = bySubs[0];
    if (conversion && conversion.item.subscribersPerThousand > 0) observations.push({ tone: "good", title: "En iyi abone dönüştürücü", body: `${conversion.item.title}: 1.000 izlenmede yaklaşık ${decimal.format(conversion.item.subscribersPerThousand)} net abone. Bu konu ve final CTA yapısını sakla.` });
    if (accelerating === 0 && rows.length) observations.push({ tone: "info", title: "Şu an ikinci dağıtım dalgası görünmüyor", body: "Son ölçümlerde belirgin hızlanma yok. Bu normal olabilir; birkaç snapshot daha geldikçe ikinci dalga sinyali daha güvenilir olur." });

    return {
      rows,
      byBreakout,
      byRetention,
      bySubs,
      bySpeed,
      accelerating,
      sleepers,
      breakoutCandidates,
      quadrants,
      hourRows,
      observations: observations.slice(0, 6),
    };
  }, [data, derivedMap]);

  if (!data) {
    return (
      <main className="v4-loading">
        <Activity className="v4-pulse" size={30} />
        <strong>YouTube canlı verileri hazırlanıyor</strong>
        <span>İlk açılışta kanal verileri senkronize ediliyor.</span>
        {error && <small>{error}</small>}
      </main>
    );
  }

  return (
    <div className="v4-analytics-page">
      <header className="v4-topbar">
        <Link href="/" className="v4-back"><ArrowLeft size={18} /><span>Plan</span></Link>
        <div className="v4-brand"><div><BarChart3 size={18} /></div><span><strong>Creator Command Center</strong><small>Tarihin İzi · canlı karar ekranı</small></span></div>
        <button className="v4-refresh" disabled={busy} onClick={() => void load(true)}><RefreshCw className={busy ? "spin" : ""} size={18} /><span>{busy ? "Yenileniyor" : "Yenile"}</span></button>
      </header>

      <main className="v4-content">
        <section className="v4-hero">
          <div>
            <span className="v4-live-label"><i /> CANLI KARAR MOTORU</span>
            <h1>Hangi Short yükseliyor, hangisi neden duruyor?</h1>
            <p>Dakikalık hızdan hook kalitesine, ikinci dağıtım dalgasından 100 bin eşiğine kadar kanalın bütün sinyallerini tek ekranda okuyup ne yapman gerektiğini çıkarır.</p>
          </div>
          <div className="v4-hero-meta">
            <span><Clock3 size={15} /> Son hesap: {timeAgo(data.generatedAt)}</span>
            <span><Zap size={15} /> 90 sn cihaz takibi</span>
            <span><CheckCircle2 size={15} /> {data.snapshotCount} ölçüm · {browserSamples} cihaz örneği</span>
          </div>
        </section>

        {!data.connected && (
          <section className="v4-connect-card">
            <ShieldAlert size={24} />
            <div><strong>YouTube bağlantısını yenile</strong><p>Bu tarayıcı oturumunda OAuth anahtarı yoksa canlı video verisi sıfır görünebilir. Bir kez yeniden bağlamak yeterli.</p></div>
            <a href="/api/auth/youtube">YouTube’u bağla</a>
          </section>
        )}

        {error && <div className="v4-warning">{error}</div>}
        {data.warnings.map((warning) => <div className="v4-warning" key={warning}>{warning}</div>)}

        <section className="v4-section-title compact-title">
          <div><span>KANAL NABZI</span><h2>Şu an ne oluyor?</h2></div>
          <small>Canlı + detaylı Analytics sinyalleri</small>
        </section>

        <section className="v4-metrics">
          <MetricCard icon={Zap} label="Canlı hız" value={`${decimal.format(data.summary.liveViewsPerMinute)}/dk`} detail={`${whole.format(data.summary.liveViewsPerHour)} izlenme/saat`} accent="red" />
          <MetricCard icon={Eye} label="Bugünkü izlenme" value={compact.format(data.summary.todayViews)} detail={`${data.summary.todayNetSubscribers >= 0 ? "+" : ""}${data.summary.todayNetSubscribers} net abone`} />
          <MetricCard icon={Rocket} label="Patlama adayı" value={whole.format(intelligence?.breakoutCandidates || 0)} detail="70+ breakout skorlu video" accent="gold" />
          <MetricCard icon={TrendingUp} label="Hızlanan" value={whole.format(intelligence?.accelerating || 0)} detail="son hızında +%15 ve üzeri" accent="green" />
          <MetricCard icon={Lightbulb} label="Uyuyan dev" value={whole.format(intelligence?.sleepers || 0)} detail="kalite güçlü, dağıtım zayıf" accent="gold" />
          <MetricCard icon={Activity} label="Aktif Shorts" value={whole.format(data.summary.activeVideos)} detail="son 7 gündeki canlı adaylar" />
          <MetricCard icon={Target} label="Kanal tabanı" value={`${compact.format(data.summary.channelMedianViewsPerDay)}/gün`} detail="son dönem Shorts medyanı" />
          <MetricCard icon={Users} label="Analytics gecikmesi" value={`${data.analyticsLagDays} gün`} detail={data.dataThroughDate ? `${data.dataThroughDate} tarihine kadar` : "detaylı veri bekleniyor"} />
        </section>

        <section className="v4-section-title">
          <div><span>BUGÜNÜN SHORTS’LARI</span><h2>İlk dağıtım + viral eşik takibi</h2></div>
          <small>Bir videoya dokun: komuta paneli açılır.</small>
        </section>

        {data.today.length ? (
          <div className="v4-video-grid">
            {data.today.map((item) => <VideoCard key={item.id} item={item} derived={derivedMap.get(item.id) || deriveVideo(item, data.summary.channelMedianViewsPerDay)} selected={selected?.id === item.id} onClick={() => setSelectedId(item.id)} />)}
          </div>
        ) : (
          <section className="v4-empty"><Activity size={22} /><div><strong>Bugün için canlı Short görünmüyor.</strong><p>{data.connected ? "YouTube verisi alındı. Yeni video yayınlandığında burada otomatik görünecek." : "Bağlantıyı yeniledikten sonra videolar otomatik yüklenecek."}</p></div></section>
        )}

        {selected && selectedDerived && (
          <section className="v4-detail">
            <header className="v4-detail-header">
              <div><span>SEÇİLİ VİDEO · WAR ROOM</span><h2>{selected.title}</h2><small>{selectedDerived.stage} · {ageLabel(selected.ageHours)} · {selected.confidence} güven</small></div>
              <div className="v4-score"><Gauge size={18} /><b>{selectedDerived.breakoutScore}</b><small>patlama skoru</small></div>
            </header>

            <div className={`v4-action action-${selectedDerived.actionTone}`}>
              <div><Lightbulb size={20} /></div>
              <span><strong>{selectedDerived.actionTitle}</strong><small>{selectedDerived.actionBody}</small></span>
            </div>

            <div className="v4-command-grid">
              <div><span>Patlama skoru</span><strong>{selectedDerived.breakoutScore}/100</strong><small>hız + kalite + momentum</small></div>
              <div><span>İkinci dalga</span><strong>%{selectedDerived.secondWave}</strong><small>yeniden dağıtım modeli</small></div>
              <div><span>Hook notu</span><strong>{selectedDerived.hookGrade}</strong><small>{selectedDerived.hookScore}/100 hook skoru</small></div>
              <div><span>Kanal hızına göre</span><strong>{decimal.format(selectedDerived.paceRatio)}×</strong><small>medyan günlük hıza kıyas</small></div>
              <div><span>Sonraki eşik</span><strong>{selectedDerived.nextThreshold ? compact.format(selectedDerived.nextThreshold) : "100B+"}</strong><small>ETA: {etaLabel(selectedDerived.etaHours)}</small></div>
              <div><span>Abone verimi</span><strong>{decimal.format(selected.subscribersPerThousand)}/1K</strong><small>net abone dönüşümü</small></div>
            </div>

            <div className="v4-forecast-grid">
              <div><span>24 saat</span><strong>{compact.format(selected.projected24h)}</strong></div>
              <div><span>72 saat</span><strong>{compact.format(selected.projected72h)}</strong></div>
              <div><span>7 gün</span><strong>{compact.format(selected.projected7d)}</strong></div>
              <div><span>Tahmin bandı</span><strong>{compact.format(selected.forecastLow)}–{compact.format(selected.forecastHigh)}</strong></div>
            </div>

            <div className="v4-chart">
              {chart.length >= 2 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chart}>
                    <defs><linearGradient id="v4Area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2878e6" stopOpacity={.28} /><stop offset="100%" stopColor="#2878e6" stopOpacity={.02} /></linearGradient></defs>
                    <CartesianGrid stroke="#e3eaf2" strokeDasharray="3 5" vertical={false} />
                    <XAxis dataKey="label" stroke="#98a2b3" axisLine={false} tickLine={false} minTickGap={24} />
                    <YAxis stroke="#98a2b3" axisLine={false} tickLine={false} width={44} tickFormatter={(value) => compact.format(Number(value))} />
                    <Tooltip contentStyle={{ background: "#fff", color: "#101828", border: "1px solid #dfe7f0", borderRadius: 10, boxShadow: "0 12px 30px rgba(16,24,40,.12)" }} formatter={(value) => [whole.format(Number(value)), "İzlenme"]} />
                    <Area type="monotone" dataKey="views" stroke="#2878e6" strokeWidth={2.4} fill="url(#v4Area)" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : <div className="v4-chart-empty"><Activity size={22} /><span>İkinci canlı ölçümden sonra dakika grafiği oluşacak.</span></div>}
            </div>

            <div className="v4-detail-grid">
              <div><span>Son ölçüm</span><strong>+{whole.format(selected.lastDeltaViews)}</strong><small>{decimal.format(selected.lastDeltaMinutes)} dakikada</small></div>
              <div><span>60 dk hızı</span><strong>{decimal.format(selected.viewsPerMinute60m)}/dk</strong><small>kısa vade</small></div>
              <div><span>6 saat hızı</span><strong>{decimal.format(selected.viewsPerMinute6h)}/dk</strong><small>ana kıyas</small></div>
              <div><span>Kalite</span><strong>{selected.qualityScore}/100</strong><small>tutma + etkileşim</small></div>
              <div><span>Beğeni</span><strong>%{decimal.format(selected.likeRate)}</strong><small><ThumbsUp size={12} /> reaksiyon</small></div>
              <div><span>Yorum</span><strong>%{decimal.format(selected.commentRate)}</strong><small><MessageCircle size={12} /> konuşma</small></div>
              <div><span>Paylaşım</span><strong>%{decimal.format(selected.shareRate)}</strong><small><Share2 size={12} /> yayılma</small></div>
              <div><span>Ortalama izleme</span><strong>{decimal.format(selected.avgViewDurationSeconds)} sn</strong><small>%{decimal.format(selected.avgViewPercentage)} oran</small></div>
            </div>
            <Thresholds item={selected} />
            <p className="v4-signal-copy">{selected.signal}</p>
          </section>
        )}

        {intelligence && (
          <>
            <section className="v4-section-title">
              <div><span>PATLAMA RADARI</span><h2>En güçlü 5 aday</h2></div>
              <small>Hız + tutma + ivme + dağıtım sinyali</small>
            </section>
            <div className="v4-radar-list">
              {intelligence.byBreakout.slice(0, 5).map(({ item, derived }, index) => (
                <button key={item.id} onClick={() => setSelectedId(item.id)} className="v4-radar-row">
                  <b className="v4-rank">#{index + 1}</b>
                  <span className="v4-radar-title"><strong>{item.title}</strong><small>{derived.stage} · {ageLabel(item.ageHours)}</small></span>
                  <span><small>Patlama</small><b>{derived.breakoutScore}/100</b></span>
                  <span><small>2. dalga</small><b>%{derived.secondWave}</b></span>
                  <span><small>Sonraki eşik</small><b>{derived.nextThreshold ? compact.format(derived.nextThreshold) : "100B+"}</b></span>
                  <span><small>ETA</small><b>{etaLabel(derived.etaHours)}</b></span>
                  <ArrowUpRight size={17} />
                </button>
              ))}
            </div>

            <section className="v4-section-title">
              <div><span>KANAL DNA’SI</span><h2>Hangi video neyi en iyi yapıyor?</h2></div>
              <small>Kopyalanacak davranışı bul.</small>
            </section>
            <div className="v4-dna-grid">
              <article><Award size={20} /><span>En güçlü tutma</span><strong>{intelligence.byRetention[0] ? `%${decimal.format(intelligence.byRetention[0].item.avgViewPercentage)}` : "—"}</strong><p>{intelligence.byRetention[0]?.item.title || "Veri bekleniyor"}</p></article>
              <article><UserPlus size={20} /><span>Abone motoru</span><strong>{intelligence.bySubs[0] ? `${decimal.format(intelligence.bySubs[0].item.subscribersPerThousand)}/1K` : "—"}</strong><p>{intelligence.bySubs[0]?.item.title || "Veri bekleniyor"}</p></article>
              <article><Zap size={20} /><span>En hızlı dağıtım</span><strong>{intelligence.bySpeed[0] ? `${decimal.format(intelligence.bySpeed[0].item.viewsPerMinute)}/dk` : "—"}</strong><p>{intelligence.bySpeed[0]?.item.title || "Veri bekleniyor"}</p></article>
              <article><Flame size={20} /><span>En güçlü patlama adayı</span><strong>{intelligence.byBreakout[0]?.derived.breakoutScore || 0}/100</strong><p>{intelligence.byBreakout[0]?.item.title || "Veri bekleniyor"}</p></article>
            </div>

            <section className="v4-section-title">
              <div><span>VİRALLİK HARİTASI</span><h2>Hız mı güçlü, kalite mi?</h2></div>
              <small>Dört farklı dağıtım tipi</small>
            </section>
            <div className="v4-quadrant-grid">
              {([
                ["ROKET", "Hız + kalite güçlü", "good"],
                ["UYUYAN DEV", "Kalite güçlü, hız düşük", "watch"],
                ["HIZ VAR", "Dağıtım var, kalite zayıf", "risk"],
                ["SOĞUYOR", "Hız ve kalite düşük", "neutral"],
              ] as const).map(([name, description, tone]) => (
                <article key={name} className={`v4-quadrant ${tone}`}>
                  <header><strong>{name}</strong><b>{intelligence.quadrants[name].length}</b></header>
                  <p>{description}</p>
                  <div>{intelligence.quadrants[name].slice(0, 3).map((row) => <button key={row.item.id} onClick={() => setSelectedId(row.item.id)}>{row.item.title}</button>)}</div>
                  {!intelligence.quadrants[name].length && <small>Şu an video yok</small>}
                </article>
              ))}
            </div>

            <section className="v4-split-grid">
              <div>
                <section className="v4-section-title inner-title"><div><span>SAAT SİNYALİ</span><h2>Hangi yayın saatleri daha hızlı?</h2></div></section>
                <div className="v4-hour-card">
                  {intelligence.hourRows.length ? intelligence.hourRows.map((row, index) => (
                    <div className="v4-hour-row" key={row.hour}>
                      <b>{index + 1}</b><strong>{row.hour}</strong>
                      <span><small>örnek</small>{row.sample}</span>
                      <span><small>tempo</small>{compact.format(row.pace)}/gün</span>
                      <span><small>hit</small>%{row.hitRate}</span>
                      <i><em style={{ width: `${Math.min(100, row.pace / Math.max(intelligence.hourRows[0]?.pace || 1, 1) * 100)}%` }} /></i>
                    </div>
                  )) : <p className="v4-no-data">Saat kıyası için daha fazla video gerekiyor.</p>}
                  <small className="v4-method-note">Saat sıralaması mevcut son 14 günlük örneklemdeki yaş-normalize dağıtım temposuna göre hesaplanır; kesin yayın garantisi değildir.</small>
                </div>
              </div>

              <div>
                <section className="v4-section-title inner-title"><div><span>AKILLI UYARILAR</span><h2>Şu an dikkat etmen gerekenler</h2></div></section>
                <div className="v4-observation-list">
                  {intelligence.observations.map((observation, index) => (
                    <article className={`obs-${observation.tone}`} key={`${observation.title}-${index}`}>
                      <div>{observation.tone === "risk" ? <AlertTriangle size={18} /> : observation.tone === "good" ? <CheckCircle2 size={18} /> : observation.tone === "watch" ? <Timer size={18} /> : <Lightbulb size={18} />}</div>
                      <span><strong>{observation.title}</strong><small>{observation.body}</small></span>
                    </article>
                  ))}
                </div>
              </div>
            </section>
          </>
        )}

        <section className="v4-section-title v4-recent-title">
          <div><span>SON 14 GÜN</span><h2>Tüm Shorts karşılaştırması</h2></div>
          <small>Her videoyu aynı modelle kıyasla.</small>
        </section>

        <div className="v4-table-wrap">
          <table className="v4-table">
            <thead><tr><th>Video</th><th>İzlenme</th><th>/dk</th><th>Hook</th><th>Tutma</th><th>Patlama</th><th>2. dalga</th><th>10B</th><th>50B</th><th>100B</th><th>7 gün</th></tr></thead>
            <tbody>
              {data.recent.map((item) => {
                const derived = derivedMap.get(item.id) || deriveVideo(item, data.summary.channelMedianViewsPerDay);
                const p10 = item.thresholds.find((x) => x.threshold === 10_000)?.probability || 0;
                const p50 = item.thresholds.find((x) => x.threshold === 50_000)?.probability || 0;
                const p100 = item.thresholds.find((x) => x.threshold === 100_000)?.probability || 0;
                return <tr key={item.id} onClick={() => setSelectedId(item.id)} className={selected?.id === item.id ? "active" : ""}><td><span>{derived.stage} · {ageLabel(item.ageHours)}</span><strong>{item.title}</strong></td><td>{compact.format(item.views)}</td><td>{decimal.format(item.viewsPerMinute)}</td><td>{derived.hookGrade}</td><td>%{decimal.format(item.avgViewPercentage)}</td><td>{derived.breakoutScore}</td><td>%{derived.secondWave}</td><td>%{p10}</td><td>%{p50}</td><td>%{p100}</td><td>{compact.format(item.projected7d)}</td></tr>;
              })}
            </tbody>
          </table>
        </div>

        <section className="v4-model-note">
          <Gauge size={19} />
          <div><strong>Bu panel nasıl okunmalı?</strong><p>{data.note} “Patlama”, “ikinci dalga” ve eşik yüzdeleri YouTube’un verdiği resmi olasılıklar değildir; senin kanalındaki hız, tutma, etkileşim, yaş ve geçmiş dağıtım verilerinden üretilen karar destek tahminleridir. Snapshot sayısı arttıkça güven yükselir.</p></div>
        </section>
      </main>
    </div>
  );
}
