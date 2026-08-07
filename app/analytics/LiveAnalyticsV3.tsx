"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  Clock3,
  Eye,
  Gauge,
  RefreshCw,
  Rocket,
  ShieldAlert,
  Target,
  TrendingDown,
  TrendingUp,
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

type BrowserSample = {
  capturedAt: string;
  videos: Record<string, number>;
};

const STORAGE_KEY = "tarihin-izi-live-samples-v3";
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
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed)); } catch { /* cihaz depolaması doluysa sunucu ölçümleri devam eder */ }
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
    const localProbability = clamp(
      5 + progress * 30 + pace * 31 + item.sustainProbability * .23 + accelerationSignal * 11,
      1,
      97,
    );
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
      ? `Cihaz ölçümlerinde dağıtım hızı güçleniyor. Son ölçümde ${latestVelocity.delta} yeni izlenme geldi.`
      : status === "YAVAŞLIYOR"
        ? "Cihaz ölçümlerinde hız aşağı yönlü. İkinci dağıtım dalgası gelmezse alt tahmin bandı daha olası."
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

function MetricCard({ icon: Icon, label, value, detail, accent = "blue" }: { icon: typeof Eye; label: string; value: string; detail: string; accent?: "blue" | "red" | "green" }) {
  return (
    <article className={`v3-metric v3-${accent}`}>
      <div className="v3-metric-icon"><Icon size={18} /></div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function Thresholds({ item }: { item: LiveVideoAnalysis }) {
  return (
    <div className="v3-thresholds">
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

function VideoCard({ item, selected, onClick }: { item: LiveVideoAnalysis; selected: boolean; onClick: () => void }) {
  return (
    <button className={`v3-video-card ${selected ? "selected" : ""}`} onClick={onClick}>
      <div className="v3-video-head">
        {item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" /> : <div className="v3-thumb"><Eye size={20} /></div>}
        <div>
          <div className="v3-status-row">
            <span className={`v3-status ${item.status.toLowerCase().replace("ü", "u").replace("ı", "i")}`}>{statusIcon(item.status)} {item.status}</span>
            <small>{ageLabel(item.ageHours)} · {item.confidence}</small>
          </div>
          <h3>{item.title}</h3>
        </div>
      </div>
      <div className="v3-mini-grid">
        <div><span>Anlık</span><strong>{decimal.format(item.viewsPerMinute)}/dk</strong></div>
        <div><span>Saatlik</span><strong>{compact.format(item.viewsPerHour)}</strong></div>
        <div><span>Toplam</span><strong>{compact.format(item.views)}</strong></div>
        <div><span>Hız</span><strong className={item.accelerationPercent >= 0 ? "up" : "down"}>{item.accelerationPercent >= 0 ? "+" : ""}{item.accelerationPercent}%</strong></div>
      </div>
      <div className="v3-quality-row">
        <span>Tutma <b>%{decimal.format(item.avgViewPercentage)}</b></span>
        <span>Kaydırmadan izleme tahmini <b>%{decimal.format(item.engagedViewRate)}</b></span>
        <span>Beğeni <b>%{decimal.format(item.likeRate)}</b></span>
        <span>Abone/1K <b>{decimal.format(item.subscribersPerThousand)}</b></span>
      </div>
      <div className="v3-sustain">
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
    void load(true);
    const timer = window.setInterval(() => void load(false), 90_000);
    return () => window.clearInterval(timer);
  }, []);

  const selected = useMemo(() => {
    if (!data) return null;
    return data.recent.find((item) => item.id === selectedId) || data.today[0] || data.active[0] || data.recent[0] || null;
  }, [data, selectedId]);

  const chart = useMemo(() => selected?.history.map((point) => ({
    ...point,
    label: new Date(point.capturedAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }),
  })) || [], [selected]);

  if (!data) {
    return (
      <main className="v3-loading">
        <Activity className="v3-pulse" size={30} />
        <strong>YouTube canlı verileri hazırlanıyor</strong>
        <span>İlk açılışta kanal verileri senkronize ediliyor.</span>
        {error && <small>{error}</small>}
      </main>
    );
  }

  return (
    <div className="v3-analytics-page">
      <header className="v3-topbar">
        <Link href="/" className="v3-back"><ArrowLeft size={18} /><span>Plan</span></Link>
        <div className="v3-brand"><div><BarChart3 size={18} /></div><span><strong>Canlı Analiz</strong><small>Tarihin İzi</small></span></div>
        <button className="v3-refresh" disabled={busy} onClick={() => void load(true)}><RefreshCw className={busy ? "spin" : ""} size={18} /><span>{busy ? "Yenileniyor" : "Yenile"}</span></button>
      </header>

      <main className="v3-content">
        <section className="v3-hero">
          <div>
            <span className="v3-live-label"><i /> CANLI PERFORMANS</span>
            <h1>Shorts’ların nereye gidiyor?</h1>
            <p>Hız, tutma, etkileşim ve dağıtım sinyallerini aynı yerde izle. 10 bin–100 bin eşikleri kanalındaki gerçek veriye göre sürekli yeniden hesaplanır.</p>
          </div>
          <div className="v3-hero-meta">
            <span><Clock3 size={15} /> Son hesap: {timeAgo(data.generatedAt)}</span>
            <span><Zap size={15} /> 90 sn cihaz takibi</span>
            <span><CheckCircle2 size={15} /> {data.snapshotCount} ölçüm · {browserSamples} cihaz örneği</span>
          </div>
        </section>

        {!data.connected && (
          <section className="v3-connect-card">
            <ShieldAlert size={24} />
            <div><strong>YouTube bağlantısını yenile</strong><p>Canlı verinin 0 görünmesinin nedeni bu tarayıcı oturumunda OAuth anahtarının bulunmaması olabilir. Bir kez yeniden bağladıktan sonra analiz ekranı kendi kendine senkronize olur.</p></div>
            <a href="/api/auth/youtube">YouTube’u bağla</a>
          </section>
        )}

        {error && <div className="v3-warning">{error}</div>}
        {data.warnings.map((warning) => <div className="v3-warning" key={warning}>{warning}</div>)}

        <section className="v3-metrics">
          <MetricCard icon={Zap} label="Canlı hız" value={`${decimal.format(data.summary.liveViewsPerMinute)}/dk`} detail={`${whole.format(data.summary.liveViewsPerHour)} izlenme/saat`} accent="red" />
          <MetricCard icon={Eye} label="Bugünkü izlenme" value={compact.format(data.summary.todayViews)} detail={`${data.summary.todayNetSubscribers >= 0 ? "+" : ""}${data.summary.todayNetSubscribers} net abone`} />
          <MetricCard icon={Activity} label="Aktif Shorts" value={whole.format(data.summary.activeVideos)} detail="son 7 gündeki canlı adaylar" />
          <MetricCard icon={Rocket} label="En güçlü momentum" value={`${data.summary.bestMomentumScore}/100`} detail={data.summary.bestMomentumTitle || "veri bekleniyor"} accent="red" />
          <MetricCard icon={Target} label="Kanal tabanı" value={`${compact.format(data.summary.channelMedianViewsPerDay)}/gün`} detail="son dönem Shorts medyanı" />
          <MetricCard icon={Users} label="Analytics gecikmesi" value={`${data.analyticsLagDays} gün`} detail={data.dataThroughDate ? `${data.dataThroughDate} tarihine kadar` : "detaylı veri bekleniyor"} />
        </section>

        <section className="v3-section-title">
          <div><span>BUGÜNÜN SHORTS’LARI</span><h2>İlk dağıtım ve viral eşik takibi</h2></div>
          <small>Bir videoya dokun: ayrıntılı tahmin açılır.</small>
        </section>

        {data.today.length ? (
          <div className="v3-video-grid">
            {data.today.map((item) => <VideoCard key={item.id} item={item} selected={selected?.id === item.id} onClick={() => setSelectedId(item.id)} />)}
          </div>
        ) : (
          <section className="v3-empty"><Activity size={22} /><div><strong>Bugün için canlı Short görünmüyor.</strong><p>{data.connected ? "YouTube verisi alındı. Yeni video yayınlandığında burada otomatik görünecek." : "Bağlantıyı yeniledikten sonra videolar otomatik yüklenecek."}</p></div></section>
        )}

        {selected && (
          <section className="v3-detail">
            <header>
              <div><span>SEÇİLİ VİDEO · CANLI MODEL</span><h2>{selected.title}</h2></div>
              <div className="v3-score"><Gauge size={18} /><b>{selected.momentumScore}</b><small>momentum</small></div>
            </header>

            <div className="v3-forecast-grid">
              <div><span>24 saat</span><strong>{compact.format(selected.projected24h)}</strong></div>
              <div><span>72 saat</span><strong>{compact.format(selected.projected72h)}</strong></div>
              <div><span>7 gün</span><strong>{compact.format(selected.projected7d)}</strong></div>
              <div><span>Tahmin bandı</span><strong>{compact.format(selected.forecastLow)}–{compact.format(selected.forecastHigh)}</strong></div>
            </div>

            <div className="v3-chart">
              {chart.length >= 2 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chart}>
                    <defs><linearGradient id="v3Area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3ea6ff" stopOpacity={.28} /><stop offset="100%" stopColor="#3ea6ff" stopOpacity={.02} /></linearGradient></defs>
                    <CartesianGrid stroke="#2a2a2a" strokeDasharray="3 5" vertical={false} />
                    <XAxis dataKey="label" stroke="#777" axisLine={false} tickLine={false} minTickGap={24} />
                    <YAxis stroke="#777" axisLine={false} tickLine={false} width={44} tickFormatter={(value) => compact.format(Number(value))} />
                    <Tooltip contentStyle={{ background: "#1f1f1f", border: "1px solid #363636", borderRadius: 9 }} formatter={(value) => [whole.format(Number(value)), "İzlenme"]} />
                    <Area type="monotone" dataKey="views" stroke="#3ea6ff" strokeWidth={2.3} fill="url(#v3Area)" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : <div className="v3-chart-empty"><Activity size={22} /><span>İkinci canlı ölçümden sonra dakika grafiği oluşacak.</span></div>}
            </div>

            <div className="v3-detail-grid">
              <div><span>Son ölçüm</span><strong>+{whole.format(selected.lastDeltaViews)}</strong><small>{decimal.format(selected.lastDeltaMinutes)} dakikada</small></div>
              <div><span>60 dk hızı</span><strong>{decimal.format(selected.viewsPerMinute60m)}/dk</strong><small>kısa vade</small></div>
              <div><span>6 saat hızı</span><strong>{decimal.format(selected.viewsPerMinute6h)}/dk</strong><small>ana kıyas</small></div>
              <div><span>Kalite</span><strong>{selected.qualityScore}/100</strong><small>tutma + etkileşim</small></div>
            </div>
            <Thresholds item={selected} />
            <p className="v3-signal-copy">{selected.signal}</p>
          </section>
        )}

        <section className="v3-section-title v3-recent-title">
          <div><span>SON 14 GÜN</span><h2>Tüm Shorts karşılaştırması</h2></div>
          <small>Momentum, hız ve eşik ihtimallerini birlikte gör.</small>
        </section>

        <div className="v3-table-wrap">
          <table className="v3-table">
            <thead><tr><th>Video</th><th>İzlenme</th><th>/dk</th><th>Tutma</th><th>Sürme</th><th>10B</th><th>50B</th><th>100B</th><th>7 gün tahmini</th></tr></thead>
            <tbody>
              {data.recent.map((item) => {
                const p10 = item.thresholds.find((x) => x.threshold === 10_000)?.probability || 0;
                const p50 = item.thresholds.find((x) => x.threshold === 50_000)?.probability || 0;
                const p100 = item.thresholds.find((x) => x.threshold === 100_000)?.probability || 0;
                return <tr key={item.id} onClick={() => setSelectedId(item.id)} className={selected?.id === item.id ? "active" : ""}><td><span>{item.status} · {ageLabel(item.ageHours)}</span><strong>{item.title}</strong></td><td>{compact.format(item.views)}</td><td>{decimal.format(item.viewsPerMinute)}</td><td>%{decimal.format(item.avgViewPercentage)}</td><td>%{item.sustainProbability}</td><td>%{p10}</td><td>%{p50}</td><td>%{p100}</td><td>{compact.format(item.projected7d)}</td></tr>;
              })}
            </tbody>
          </table>
        </div>

        <section className="v3-model-note">
          <Gauge size={19} />
          <div><strong>Yüzdeler ne anlama geliyor?</strong><p>{data.note} Tarayıcıdaki 90 saniyelik ölçümler ayrıca kullanıldığı için Vercel geçici depoya düşse bile bu cihazdaki hız geçmişi kaybolmaz.</p></div>
        </section>
      </main>
    </div>
  );
}
