"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  ArrowUpRight,
  BarChart3,
  Clock3,
  Eye,
  Gauge,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Sparkles,
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
import "./analytics.css";

type ThresholdForecast = {
  threshold: number;
  probability: number;
  remaining: number;
};

type LivePoint = {
  capturedAt: string;
  views: number;
  viewsPerMinute: number;
};

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

const whole = new Intl.NumberFormat("tr-TR");
const compact = new Intl.NumberFormat("tr-TR", { notation: "compact", maximumFractionDigits: 1 });
const decimal = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 });

function timeAgo(value: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return "şimdi";
  if (minutes < 60) return `${minutes} dk önce`;
  const hours = Math.round(minutes / 60);
  return `${hours} sa önce`;
}

function ageLabel(hours: number) {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} dk`;
  if (hours < 48) return `${decimal.format(hours)} saat`;
  return `${decimal.format(hours / 24)} gün`;
}

function probabilityClass(value: number) {
  if (value >= 70) return "prob-high";
  if (value >= 40) return "prob-mid";
  return "prob-low";
}

function statusIcon(status: LiveVideoAnalysis["status"]) {
  if (status === "YÜKSELİYOR") return <TrendingUp size={16} />;
  if (status === "YAVAŞLIYOR") return <TrendingDown size={16} />;
  if (status === "STABİL") return <Activity size={16} />;
  return <Sparkles size={16} />;
}

function Metric({ label, value, detail, icon: Icon }: { label: string; value: string; detail: string; icon: typeof Eye }) {
  return (
    <article className="live-metric-card">
      <div className="metric-icon"><Icon size={19} /></div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function ProbabilityStrip({ item }: { item: LiveVideoAnalysis }) {
  return (
    <div className="threshold-grid">
      {item.thresholds.map((threshold) => (
        <div className={`threshold-box ${probabilityClass(threshold.probability)}`} key={threshold.threshold}>
          <span>{compact.format(threshold.threshold)}</span>
          <strong>%{threshold.probability}</strong>
          <small>{threshold.remaining ? `${compact.format(threshold.remaining)} kaldı` : "Aşıldı"}</small>
        </div>
      ))}
    </div>
  );
}

function VideoCard({ item, selected, onSelect }: { item: LiveVideoAnalysis; selected: boolean; onSelect: () => void }) {
  return (
    <button className={`live-video-card ${selected ? "selected" : ""}`} onClick={onSelect}>
      <div className="video-card-top">
        {item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" /> : <div className="thumb-fallback"><Eye size={24} /></div>}
        <div className="video-title-block">
          <div className="video-status-line">
            <span className={`status-pill status-${item.status.toLowerCase().replace("ü", "u").replace("ı", "i")}`}>
              {statusIcon(item.status)} {item.status}
            </span>
            <small>{ageLabel(item.ageHours)} · {item.confidence} güven</small>
          </div>
          <h3>{item.title}</h3>
        </div>
      </div>

      <div className="velocity-row">
        <div><span>Anlık hız</span><strong>{decimal.format(item.viewsPerMinute)} /dk</strong></div>
        <div><span>Saatlik</span><strong>{whole.format(item.viewsPerHour)} /sa</strong></div>
        <div><span>Toplam</span><strong>{whole.format(item.views)}</strong></div>
        <div className={item.accelerationPercent >= 0 ? "positive" : "negative"}>
          <span>Hız değişimi</span><strong>{item.accelerationPercent >= 0 ? "+" : ""}%{item.accelerationPercent}</strong>
        </div>
      </div>

      <div className="signal-grid">
        <div><span>İzleyici tutma</span><strong>%{decimal.format(item.avgViewPercentage)}</strong></div>
        <div><span>Kaydırmadan izleme</span><strong>%{decimal.format(item.engagedViewRate)}</strong></div>
        <div><span>Beğeni oranı</span><strong>%{decimal.format(item.likeRate)}</strong></div>
        <div><span>Abone / 1K</span><strong>{decimal.format(item.subscribersPerThousand)}</strong></div>
      </div>

      <div className="sustain-row">
        <div>
          <span>Dağıtımın sürme ihtimali</span>
          <strong>%{item.sustainProbability}</strong>
        </div>
        <div className="sustain-track"><i style={{ width: `${item.sustainProbability}%` }} /></div>
      </div>

      <ProbabilityStrip item={item} />
      <p className="video-signal-copy">{item.signal}</p>
    </button>
  );
}

function ForecastPanel({ item }: { item: LiveVideoAnalysis }) {
  const chart = item.history.map((point) => ({
    ...point,
    label: new Date(point.capturedAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }),
  }));
  return (
    <section className="forecast-panel">
      <header>
        <div>
          <span>SEÇİLİ VİDEO · CANLI MODEL</span>
          <h2>{item.title}</h2>
        </div>
        <div className="forecast-score"><Gauge size={18} /><b>{item.momentumScore}</b><small>momentum</small></div>
      </header>

      <div className="forecast-stat-grid">
        <div><span>24 saat tahmini</span><strong>{compact.format(item.projected24h)}</strong></div>
        <div><span>72 saat tahmini</span><strong>{compact.format(item.projected72h)}</strong></div>
        <div><span>7 gün tahmini</span><strong>{compact.format(item.projected7d)}</strong></div>
        <div><span>Model aralığı</span><strong>{compact.format(item.forecastLow)} – {compact.format(item.forecastHigh)}</strong></div>
      </div>

      <div className="chart-shell">
        {chart.length >= 2 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chart}>
              <defs>
                <linearGradient id="liveViewFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3ea6ff" stopOpacity={0.38} />
                  <stop offset="100%" stopColor="#3ea6ff" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#2b2b2b" strokeDasharray="3 5" vertical={false} />
              <XAxis dataKey="label" stroke="#8e8e8e" axisLine={false} tickLine={false} minTickGap={26} />
              <YAxis stroke="#8e8e8e" axisLine={false} tickLine={false} width={48} tickFormatter={(value) => compact.format(Number(value))} />
              <Tooltip contentStyle={{ background: "#1f1f1f", border: "1px solid #3a3a3a", borderRadius: 10 }} formatter={(value) => [whole.format(Number(value)), "İzlenme"]} />
              <Area type="monotone" dataKey="views" stroke="#3ea6ff" strokeWidth={2.5} fill="url(#liveViewFill)" />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="chart-empty"><Activity size={24} /><span>Grafik için birkaç canlı ölçüm daha gerekiyor.</span></div>
        )}
      </div>

      <div className="forecast-detail-grid">
        <div><span>Son ölçüm</span><strong>+{whole.format(item.lastDeltaViews)}</strong><small>{decimal.format(item.lastDeltaMinutes)} dakikada</small></div>
        <div><span>60 dk hızı</span><strong>{decimal.format(item.viewsPerMinute60m)}/dk</strong><small>kısa vadeli</small></div>
        <div><span>6 saat hızı</span><strong>{decimal.format(item.viewsPerMinute6h)}/dk</strong><small>ana kıyas</small></div>
        <div><span>Kalite skoru</span><strong>{item.qualityScore}/100</strong><small>tutma + etkileşim</small></div>
      </div>
    </section>
  );
}

export default function LiveAnalyticsPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load(refresh = false) {
    if (refresh) setBusy(true);
    try {
      if (refresh) {
        await fetch("/api/sync?auto=1", { method: "POST", cache: "no-store" }).catch(() => null);
      }
      const response = await fetch("/api/analytics/live", { cache: "no-store" });
      if (!response.ok) throw new Error("Canlı analiz yüklenemedi.");
      const payload = await response.json() as Payload;
      setData(payload);
      setError("");
      setSelectedId((current) => current || payload.today[0]?.id || payload.active[0]?.id || "");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Canlı analiz yüklenemedi.");
    } finally {
      if (refresh) setBusy(false);
    }
  }

  useEffect(() => {
    void load(true);
    const timer = window.setInterval(() => void load(true), 2 * 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const selected = useMemo(() => {
    if (!data) return null;
    return data.recent.find((item) => item.id === selectedId) || data.today[0] || data.active[0] || null;
  }, [data, selectedId]);

  if (!data) {
    return (
      <main className="analytics-loading">
        <Activity className="live-pulse-icon" size={30} />
        <strong>Canlı YouTube verileri hazırlanıyor</strong>
        <span>İzlenme hızı, tutma ve eşik tahminleri hesaplanıyor…</span>
        {error && <small>{error}</small>}
      </main>
    );
  }

  return (
    <div className="analytics-page">
      <header className="analytics-topbar">
        <Link href="/" className="back-link"><ArrowLeft size={18} /> Ana panel</Link>
        <div className="analytics-brand">
          <div className="analytics-logo"><BarChart3 size={19} /></div>
          <div><strong>Canlı Analiz Merkezi</strong><span>YouTube performans tahmin paneli</span></div>
        </div>
        <button className="analytics-refresh" disabled={busy} onClick={() => void load(true)}>
          <RefreshCw className={busy ? "spin" : ""} size={17} /> {busy ? "Yenileniyor" : "Şimdi yenile"}
        </button>
      </header>

      <main className="analytics-content">
        <section className="analytics-hero">
          <div>
            <span className="eyebrow"><i /> YAKIN CANLI VERİ</span>
            <h1>Her Short’un nereye gittiğini<br />tek ekranda gör.</h1>
            <p>Dakikalık hız, hızlanma, tutma, etkileşim, dağıtımın sürme ihtimali ve 10B / 20B / 50B / 100B eşik tahminleri aynı modelde hesaplanıyor.</p>
          </div>
          <div className="hero-meta">
            <span><Clock3 size={16} /> Son hesap: {timeAgo(data.generatedAt)}</span>
            <span><Zap size={16} /> Yaklaşık {data.refreshEveryMinutes} dk canlı yenileme</span>
            <span><ShieldCheck size={16} /> {data.snapshotCount} ölçüm snapshotı</span>
          </div>
        </section>

        {error && <div className="analytics-warning">{error}</div>}
        {data.warnings.map((warning) => <div className="analytics-warning" key={warning}>{warning}</div>)}

        <section className="metric-grid">
          <Metric icon={Zap} label="Aktif canlı hız" value={`${decimal.format(data.summary.liveViewsPerMinute)} /dk`} detail={`yaklaşık ${whole.format(data.summary.liveViewsPerHour)} izlenme/saat`} />
          <Metric icon={Eye} label="Bugünkü izlenme" value={compact.format(data.summary.todayViews)} detail={`${data.summary.todayNetSubscribers >= 0 ? "+" : ""}${data.summary.todayNetSubscribers} net abone`} />
          <Metric icon={Activity} label="Aktif Shorts" value={whole.format(data.summary.activeVideos)} detail="son 7 gündeki canlı adaylar" />
          <Metric icon={Rocket} label="En güçlü momentum" value={`${data.summary.bestMomentumScore}/100`} detail={data.summary.bestMomentumTitle || "Henüz veri yok"} />
          <Metric icon={Target} label="Kanal tabanı" value={`${compact.format(data.summary.channelMedianViewsPerDay)}/gün`} detail="son dönem Shorts medyanı" />
          <Metric icon={Users} label="Analytics gecikmesi" value={`${data.analyticsLagDays} gün`} detail={data.dataThroughDate ? `${data.dataThroughDate} tarihine kadar` : "detaylı veri bekleniyor"} />
        </section>

        <section className="analytics-section-heading">
          <div><span>BUGÜNÜN SHORTS’LARI</span><h2>İlk dağıtım ve viral eşik takibi</h2></div>
          <small>Bir videoya dokun: detay grafiği ve tahmin açılır.</small>
        </section>

        <section className="today-live-grid">
          {(data.today.length ? data.today : data.active.slice(0, 3)).map((item) => (
            <VideoCard key={item.id} item={item} selected={selected?.id === item.id} onSelect={() => setSelectedId(item.id)} />
          ))}
        </section>

        {selected && <ForecastPanel item={selected} />}

        <section className="analytics-section-heading recent-heading">
          <div><span>SON 14 GÜN</span><h2>Tüm videoların canlı tahmin tablosu</h2></div>
          <small>Yüzdeler canlı sinyal geldikçe otomatik değişir.</small>
        </section>

        <section className="live-table-wrap">
          <table className="live-table">
            <thead>
              <tr>
                <th>Video</th>
                <th>İzlenme</th>
                <th>/dk</th>
                <th>Hız</th>
                <th>Tutma</th>
                <th>Sürme</th>
                <th>10B</th>
                <th>20B</th>
                <th>50B</th>
                <th>100B</th>
                <th>Tahmin</th>
              </tr>
            </thead>
            <tbody>
              {data.recent.map((item) => (
                <tr key={item.id} onClick={() => setSelectedId(item.id)} className={selected?.id === item.id ? "active-row" : ""}>
                  <td><span>{ageLabel(item.ageHours)} · {item.confidence}</span><strong>{item.title}</strong></td>
                  <td>{whole.format(item.views)}</td>
                  <td><b>{decimal.format(item.viewsPerMinute)}</b></td>
                  <td className={item.accelerationPercent >= 0 ? "positive" : "negative"}>{item.accelerationPercent >= 0 ? "+" : ""}%{item.accelerationPercent}</td>
                  <td>%{decimal.format(item.avgViewPercentage)}</td>
                  <td><b className={probabilityClass(item.sustainProbability)}>%{item.sustainProbability}</b></td>
                  {item.thresholds.map((threshold) => <td key={threshold.threshold}><b className={probabilityClass(threshold.probability)}>%{threshold.probability}</b></td>)}
                  <td><span className="forecast-range">{compact.format(item.forecastLow)}–{compact.format(item.forecastHigh)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="model-note">
          <div><Sparkles size={20} /><strong>Model nasıl düşünüyor?</strong></div>
          <p>{data.note}</p>
          <div className="model-rules">
            <span><b>Hız:</b> son snapshot, 60 dk ve 6 saat kıyası</span>
            <span><b>Kalite:</b> izleyici tutma + kaydırmadan izleme</span>
            <span><b>Etkileşim:</b> beğeni + yorum + paylaşım</span>
            <span><b>Tahmin:</b> hızlanma ve yaşa göre dağıtım sönümü</span>
          </div>
        </section>
      </main>
    </div>
  );
}
