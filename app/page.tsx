"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Copy,
  Clock3,
  Eye,
  FileText,
  Lightbulb,
  Link2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
  ThumbsUp,
  TrendingUp,
  Upload,
  Video,
  X,
  XCircle,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  CombinationInsight,
  DashboardData,
  PlanItem,
  VideoMetric,
} from "@/lib/schema";

type Tab = "today" | "winners" | "plan" | "videos" | "settings";

const whole = new Intl.NumberFormat("tr-TR");
const decimal = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });
const compact = new Intl.NumberFormat("tr-TR", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const navItems: Array<{ id: Tab; label: string; icon: typeof Lightbulb }> = [
  { id: "today", label: "Bugün ne yapmalıyım?", icon: Lightbulb },
  { id: "winners", label: "Ne tutuyor?", icon: TrendingUp },
  { id: "plan", label: "30 günlük plan", icon: CalendarDays },
  { id: "videos", label: "Videolarım", icon: Video },
  { id: "settings", label: "Bağlantı ve hedef", icon: Link2 },
];

function formatDate(value: string | null) {
  if (!value) return "Henüz yok";
  return new Date(value).toLocaleString("tr-TR", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function todayInIstanbul() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function dateInIstanbul(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function displayDay(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("tr-TR", {
    day: "numeric",
    month: "long",
    weekday: "long",
  });
}

function scoreVideo(video: VideoMetric) {
  const conversion =
    ((video.subscribersGained - video.subscribersLost) / Math.max(video.views, 1)) * 1000;
  const retention = Math.min(100, video.avgViewPercentage);
  const reach = Math.min(100, Math.log10(video.views + 1) * 24);
  return Math.round(
    reach * 0.45 + retention * 0.35 + Math.min(100, conversion * 8) * 0.2,
  );
}

function confidenceLabel(item: CombinationInsight) {
  if (item.sampleSize >= 5) return "Güçlü kanıt";
  if (item.sampleSize >= 3) return "Umut verici";
  return "Daha fazla test gerekli";
}

function decisionLabel(item: CombinationInsight) {
  const decision = item.decision.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  if (decision.includes("LENDIR")) return "Şimdilik bırak";
  if (decision.includes("RULA") || item.sampleSize < 3) return "Bir kez daha dene";
  return "Daha çok yap";
}

function ProgressLine({
  label,
  current,
  target,
  note,
}: {
  label: string;
  current: number;
  target: number;
  note: string;
}) {
  const percent = Math.min(100, (current / Math.max(target, 1)) * 100);
  return (
    <div className="progress-block">
      <div className="progress-head">
        <strong>{label}</strong>
        <span>%{decimal.format(percent)}</span>
      </div>
      <div className="progress-track" aria-label={`${label} yüzde ${decimal.format(percent)}`}>
        <i style={{ width: `${Math.max(percent, 0.3)}%` }} />
      </div>
      <p>{note}</p>
    </div>
  );
}

function TodayItem({ item, index, onSelect }: { item: PlanItem; index: number; onSelect: (item: PlanItem) => void }) {
  return (
    <button className="today-item" onClick={() => onSelect(item)}>
      <div className="time-column">
        <span>{index + 1}. paylaşım</span>
        <strong>{item.publishTime}</strong>
      </div>
      <div className="today-copy">
        <div className="plain-tags">
          <span>{item.format}</span>
          <span>{item.pillar}</span>
        </div>
        <h3>{item.title}</h3>
        <p><b>İlk cümle:</b> {item.hook}</p>
        <small><b>Neden:</b> {item.reason}</small>
      </div>
      <ChevronRight className="open-detail-icon" size={20} />
    </button>
  );
}

function WinnerCard({ item }: { item: CombinationInsight }) {
  const action = decisionLabel(item);
  return (
    <article className="winner-card">
      <header>
        <span>{item.dimension}</span>
        <b className={action === "Daha çok yap" ? "good" : action === "Şimdilik bırak" ? "bad" : "test"}>
          {action}
        </b>
      </header>
      <h3>{item.label}</h3>
      <div className="winner-numbers">
        <span><b>{item.sampleSize}</b> video</span>
        <span><b>{compact.format(item.viewsPerDay)}</b> izlenme/gün</span>
        <span><b>%{decimal.format(item.engagementRate)}</b> etkileşim</span>
        <span><b>{decimal.format(item.subscribersPerThousand)}</b> abone/1.000</span>
      </div>
      <p>{item.reason}</p>
      <footer>{confidenceLabel(item)}</footer>
    </article>
  );
}

function PlanDay({ date, items, onSelect }: { date: string; items: PlanItem[]; onSelect: (item: PlanItem) => void }) {
  return (
    <article className="plan-day">
      <header>
        <div>
          <span>{new Date(`${date}T12:00:00`).getDate()}</span>
          <div><strong>{displayDay(date)}</strong><small>{items.filter((item) => item.format === "Shorts").length} Shorts</small></div>
        </div>
        {items.some((item) => item.format !== "Shorts") && <b>Uzun video günü</b>}
      </header>
      <div className="plan-day-list">
        {items.map((item) => (
          <button className={item.format === "Shorts" ? "plan-short" : "plan-long"} key={item.id} onClick={() => onSelect(item)}>
            <time>{item.publishTime}</time>
            <div>
              <span>{item.format} · {item.pillar}</span>
              <strong>{item.title}</strong>
              <small>{item.hook}</small>
            </div>
            <ChevronRight size={18} />
          </button>
        ))}
      </div>
    </article>
  );
}

export default function Home() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("today");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedPlan, setSelectedPlan] = useState<PlanItem | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function initialize() {
      try {
        const response = await fetch("/api/dashboard", { cache: "no-store" });
        if (!response.ok) throw new Error("Kanal verileri yüklenemedi.");
        const initial = (await response.json()) as DashboardData;
        if (!cancelled) setData(initial);
        if (initial.state.auth.connected) {
          const syncResponse = await fetch("/api/sync?auto=1", { method: "POST" });
          const syncPayload = await syncResponse.json().catch(() => null) as { dashboard?: DashboardData } | null;
          if (!cancelled && syncResponse.ok && syncPayload?.dashboard) setData(syncPayload.dashboard);
        }
      } catch (error) {
        if (!cancelled) setNotice(error instanceof Error ? error.message : "Kanal verileri yüklenemedi.");
      }
      const params = new URLSearchParams(window.location.search);
      if (!cancelled && params.get("connected")) setNotice("YouTube hesabı bağlandı.");
      if (!cancelled && params.get("connectionError")) {
        setNotice(params.get("connectionError") || "Bağlantı kurulamadı.");
      }
    }
    void initialize();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const handleLiveDashboard = (event: Event) => {
      const dashboard = (event as CustomEvent<DashboardData>).detail;
      if (dashboard) setData(dashboard);
    };
    window.addEventListener("youtube-dashboard-update", handleLiveDashboard);
    return () => window.removeEventListener("youtube-dashboard-update", handleLiveDashboard);
  }, []);

  async function runAction(name: string, endpoint: string, options?: RequestInit) {
    setBusy(name);
    setNotice("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: options?.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
        ...options,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "İşlem tamamlanamadı.");
      setData((payload.dashboard || payload) as DashboardData);
      setNotice(name === "sync" ? "Canlı veriler yenilendi." : name === "import" ? "Studio raporu eklendi." : "30 günlük plan yenilendi.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Bir hata oluştu.");
    } finally {
      setBusy("");
    }
  }

  async function uploadStudio(file: File) {
    const form = new FormData();
    form.append("file", file);
    await runAction("import", "/api/import", { body: form });
  }

  const derived = useMemo(() => {
    if (!data) return null;
    const planDays = new Map<string, PlanItem[]>();
    data.state.plan.forEach((item) => {
      const list = planDays.get(item.date) || [];
      list.push(item);
      planDays.set(item.date, list);
    });
    const sortedDays = [...planDays.entries()].sort(([a], [b]) => a.localeCompare(b));
    const today = todayInIstanbul();
    const publishedToday = data.state.videos
      .filter((video) => video.contentType === "SHORT" && dateInIstanbul(video.publishedAt) === today)
      .sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
    const todayComplete = publishedToday.length >= 6;
    const actionDay = todayComplete
      ? sortedDays.find(([date]) => date > today)
      : sortedDays.find(([date]) => date >= today);
    const todayItems = (actionDay?.[1] || planDays.get(today) || sortedDays[0]?.[1] || [])
      .sort((a, b) => a.publishTime.localeCompare(b.publishTime));
    const byDimension = new Map<string, CombinationInsight[]>();
    data.winningCombinations.forEach((item) => {
      const list = byDimension.get(item.dimension) || [];
      list.push(item);
      byDimension.set(item.dimension, list);
    });
    byDimension.forEach((items) => items.sort((a, b) => b.score - a.score || b.sampleSize - a.sampleSize));
    const strongest = [...data.winningCombinations]
      .filter((item) => item.sampleSize >= 3)
      .sort((a, b) => b.score - a.score)[0] || data.winningCombinations[0];
    const pacePercent = (data.shortsGrowthGoal.currentViewsPerDay / Math.max(data.shortsGrowthGoal.requiredViewsPerDay, 1)) * 100;
    const chartData = data.state.daily.slice(-14).map((day) => ({
      ...day,
      label: new Date(`${day.date}T12:00:00`).toLocaleDateString("tr-TR", { day: "2-digit", month: "short" }),
    }));
    return { sortedDays, todayItems, publishedToday, todayComplete, byDimension, strongest, pacePercent, chartData };
  }, [data]);

  if (!data || !derived) {
    return (
      <main className="loading-screen">
        <BookOpen size={32} />
        <strong>Kanalın analiz ediliyor</strong>
        <span>Osmanlı içeriklerinin sonuçları hazırlanıyor…</span>
      </main>
    );
  }

  const { state, shortsGrowthGoal } = data;
  const todayShorts = derived.todayItems.filter((item) => item.format === "Shorts");
  const todayLong = derived.todayItems.find((item) => item.format !== "Shorts");
  const perShortTarget = shortsGrowthGoal.requiredViewsPerDay / 6;
  const titleForTab: Record<Tab, string> = {
    today: "Bugün ne yapmalıyım?",
    winners: "Kanalında ne tutuyor?",
    plan: "30 günlük yayın planı",
    videos: "Video sonuçları",
    settings: "Bağlantı ve hedef",
  };

  return (
    <div className="site-shell">
      <header className="site-header">
        <div className="brand-block">
          <div className="brand-seal">Tİ</div>
          <div><strong>Tarihin İzi</strong><span>Osmanlı büyüme rehberi</span></div>
        </div>
        <div className="channel-state">
          <span className={state.auth.connected ? "live-dot" : "offline-dot"} />
          <div><strong>{state.channel.title}</strong><small>{state.auth.connected ? "Canlı veriye bağlı" : "Bağlantı bekliyor"}</small></div>
        </div>
        <button className="refresh-button" disabled={Boolean(busy)} onClick={() => runAction("sync", "/api/sync")}>
          <RefreshCw size={17} className={busy === "sync" ? "spin" : ""} />
          Verileri yenile
        </button>
      </header>

      <nav className="main-nav" aria-label="Ana sayfalar">
        {navItems.map(({ id, label, icon: Icon }) => (
          <button key={id} className={activeTab === id ? "active" : ""} onClick={() => setActiveTab(id)}>
            <Icon size={18} /><span>{label}</span>
          </button>
        ))}
      </nav>

      <main className="content">
        <div className="page-heading">
          <div><span>{state.channel.handle}</span><h1>{titleForTab[activeTab]}</h1></div>
          <small>Son yenileme: {formatDate(state.sync.lastYouTubeSync || state.sync.lastStudioImport)}</small>
        </div>
        {notice && <div className="notice"><ShieldCheck size={18} />{notice}</div>}

        {activeTab === "today" && (
          <>
            <section className="answer-hero">
              <div className="answer-copy">
                <span className="section-label">BUGÜNÜN NET KARARI</span>
                <h2>{derived.todayComplete ? `Bugünün ${derived.publishedToday.length} Shorts’u yayınlandı.` : "Bugünkü yayın planın hazır."}</h2>
                <p>{derived.todayComplete
                  ? "Bugün için yeni video ekleme. İlk sonuçların yerleşmesine izin ver; sıradaki üç içeriği yarın için hazırla."
                  : "Altı video üç amacı dengeli dağıtıyor: iki izlenme, iki abone, iki beğeni odağı. Saatler kanalındaki gerçek yayın sonuçlarına göre puanlanıyor."}</p>
                <div className="answer-rule">
                  <CheckCircle2 size={20} />
                  <span><b>Haftalık kural:</b> Anlamlı fark yoksa saat korunur; yeni saat ancak yeterli performans kanıtıyla seçilir.</span>
                </div>
              </div>
              <div className="answer-summary">
                <span>{derived.todayComplete ? "Bugünkü durum" : "Bugünkü üretim"}</span>
                <strong>{derived.todayComplete ? "Tamamlandı ✓" : `${todayShorts.length || 6} Shorts${todayLong ? " + 1 uzun" : ""}`}</strong>
                <small>{derived.todayComplete ? "Şimdi yarının seslendirmelerini ve görsellerini hazırla." : `Her Shorts için hedef: yaklaşık ${compact.format(perShortTarget)} geçerli izlenme`}</small>
              </div>
            </section>

            <section className="weekly-review-bar">
              <div><RefreshCw size={20} /><span><b>Haftalık saat ve konu kontrolü</b>{data.weeklyReview.summary}</span></div>
              <small>Sonraki kontrol: {new Date(data.weeklyReview.nextReviewAt).toLocaleDateString("tr-TR", { day: "numeric", month: "long", weekday: "long" })}</small>
            </section>

            <section className="analytics-overview">
              <article className="chart-card">
                <div className="section-title"><div><span>SON 14 GÜN</span><h2>Günlük izlenme hareketi</h2></div><BarChart3 size={23} /></div>
                <div className="main-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={derived.chartData}>
                      <defs><linearGradient id="viewsGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#d99a4e" stopOpacity={0.6} /><stop offset="100%" stopColor="#d99a4e" stopOpacity={0.04} /></linearGradient></defs>
                      <CartesianGrid stroke="#31465b" strokeDasharray="3 5" vertical={false} />
                      <XAxis dataKey="label" stroke="#9babb8" axisLine={false} tickLine={false} minTickGap={22} />
                      <YAxis stroke="#9babb8" axisLine={false} tickLine={false} width={42} tickFormatter={(value) => compact.format(Number(value))} />
                      <RechartsTooltip contentStyle={{ background: "#132d46", border: "1px solid #486078", borderRadius: 10 }} labelStyle={{ color: "#dce5eb" }} formatter={(value) => [whole.format(Number(value)), "İzlenme"]} />
                      <Area type="monotone" dataKey="views" stroke="#e2aa5e" strokeWidth={3} fill="url(#viewsGradient)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </article>
              <article className="schedule-card">
                <div className="section-title"><div><span>BU HAFTANIN SAATLERİ</span><h2>Her gün, her amaca ayrı saat</h2></div><Clock3 size={23} /></div>
                <div className="schedule-map">
                  {data.weeklySchedule.map((day) => (
                    <div className="schedule-day" key={day.day}>
                      <strong>{day.dayLabel}</strong>
                      <div>{(day.shortSlots || []).map((slot) => <span className={`objective-${slot.objective.toLocaleLowerCase("tr-TR")}`} key={`${day.day}-${slot.objective}`}><b>{slot.time}</b><small>{slot.objective}</small></span>)}</div>
                    </div>
                  ))}
                </div>
                <button className="text-link" onClick={() => setActiveTab("plan")}>Saatlerin açıklamasını gör <ChevronRight size={16} /></button>
              </article>
            </section>

            {derived.todayComplete && (
              <section className="completed-today">
                <div className="section-title"><div><span>BUGÜN TAMAMLANDI</span><h2>Yayınlanan Shorts’lar</h2></div><CheckCircle2 size={25} /></div>
                <div>
                  {derived.publishedToday.map((video) => (
                    <article key={video.id}>
                      <CheckCircle2 size={18} />
                      <span><strong>{video.title}</strong><small>{new Date(video.publishedAt).toLocaleTimeString("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" })} · ilk veri {whole.format(video.views)} izlenme</small></span>
                    </article>
                  ))}
                </div>
              </section>
            )}

            <section className="today-layout">
              <div className="today-plan">
                <div className="section-title">
                  <div><span>{derived.todayComplete ? "SIRADAKİ ÜRETİM" : "HAZIR YAYIN LİSTESİ"}</span><h2>{displayDay(derived.todayItems[0]?.date || todayInIstanbul())}</h2></div>
                  <button className="text-link" onClick={() => setActiveTab("plan")}>30 günü gör <ChevronRight size={16} /></button>
                </div>
                {todayShorts.map((item, index) => <TodayItem key={item.id} item={item} index={index} onSelect={setSelectedPlan} />)}
                {todayLong && <TodayItem item={todayLong} index={todayShorts.length} onSelect={setSelectedPlan} />}
                <p className="click-hint">Bir videoya bas: seslendirme, açıklama, etiketler ve amaç açılır.</p>
              </div>

              <aside className="decision-column">
                <article className="simple-card winner-summary">
                  <ThumbsUp size={22} />
                  <span>ŞİMDİLİK EN GÜÇLÜ SİNYAL</span>
                  <h3>{derived.strongest?.label || "Veri birikiyor"}</h3>
                  <p>{derived.strongest?.reason || "Daha kesin karar için birkaç video daha gerekli."}</p>
                  {derived.strongest && <small>{derived.strongest.sampleSize} videodan hesaplandı · {confidenceLabel(derived.strongest)}</small>}
                </article>
                <article className="simple-card stop-card">
                  <XCircle size={22} />
                  <span>BUGÜN YAPMA</span>
                  <h3>Aynı başlığı ve aynı olayı kopyalama.</h3>
                  <p>İşe yarayan konu başlığı değil, izleyicide oluşturduğu meraktır. Aynı sonucu yeni olayla üret.</p>
                </article>
              </aside>
            </section>

            <section className="goal-section">
              <div className="section-title">
                <div><span>ASIL HEDEF</span><h2>10 milyon Shorts + 1.000 abone</h2></div>
                <Target size={26} />
              </div>
              <div className="goal-grid">
                <ProgressLine
                  label="90 günlük geçerli Shorts izlenmesi"
                  current={shortsGrowthGoal.currentViews}
                  target={shortsGrowthGoal.targetViews}
                  note={`${whole.format(shortsGrowthGoal.currentViews)} / ${whole.format(shortsGrowthGoal.targetViews)} · ${compact.format(shortsGrowthGoal.remainingViews)} kaldı`}
                />
                <ProgressLine
                  label="Abone"
                  current={shortsGrowthGoal.currentSubscribers}
                  target={shortsGrowthGoal.subscriberTarget}
                  note={`${whole.format(shortsGrowthGoal.currentSubscribers)} / ${whole.format(shortsGrowthGoal.subscriberTarget)} · ${whole.format(shortsGrowthGoal.subscribersRemaining)} abone kaldı`}
                />
              </div>
              <div className="pace-verdict">
                <CircleAlert size={24} />
                <div>
                  <span>Şu an hedef hızının %{decimal.format(derived.pacePercent)} seviyesindesin.</span>
                  <p>Günlük ortalaman <b>{compact.format(shortsGrowthGoal.currentViewsPerDay)}</b>; gereken günlük hız <b>{compact.format(shortsGrowthGoal.requiredViewsPerDay)}</b>. Bu yüzden aynı konuyu tekrarlamak yerine, 6 ayrı içeriği kanalındaki gerçek sonuçlarla kontrollü test edeceğiz.</p>
                </div>
              </div>
              <details className="calculation-details">
                <summary>Bu hedef nasıl hesaplandı?</summary>
                <p>YouTube iş ortağı hedefi için son 90 gündeki geçerli, herkese açık Shorts Akışı izlenmeleri kullanılır. Sistem yalnızca tamamlanan günleri ve Shorts Akışı kaynaklı etkileşimli izlenmeleri sayar. Abone hedefi ayrıca takip edilir.</p>
              </details>
            </section>

            <section className="three-answers">
              <article>
                <TrendingUp size={21} />
                <h3>Neyi çoğalt?</h3>
                <p>{derived.strongest ? `${derived.strongest.label} yapısını yeni olaylarla tekrar test et.` : "Altı farklı içerikte güçlü soru kalıplarını test et."}</p>
                <button onClick={() => setActiveTab("winners")}>Kanıtları aç</button>
              </article>
              <article>
                <Clock3 size={21} />
                <h3>Ne zaman paylaş?</h3>
                <p>{derived.todayComplete ? "Bugün tamamlandı. Sıradaki" : "Bugün"} {todayShorts.map((item) => `${item.publishTime} ${item.objective}`).join(" · ") || "saatler hesaplanıyor"}.</p>
                <button onClick={() => setActiveTab("plan")}>Takvimi aç</button>
              </article>
              <article>
                <CircleAlert size={21} />
                <h3>Neye ara ver?</h3>
                <p>{data.repetitionAlerts[0]?.label || "Aynı olay ve aynı başlık kalıbının art arda kullanımına."}</p>
                <button onClick={() => setActiveTab("winners")}>Tekrar listesini aç</button>
              </article>
            </section>
          </>
        )}

        {activeTab === "winners" && (
          <>
            <section className="explain-box">
              <Lightbulb size={24} />
              <div><h2>Burada sadece kanıtı olan kararlar var.</h2><p>Tek videoluk tesadüfleri “kazanan” saymıyoruz. Örnek sayısı yükseldikçe kararın güveni artar.</p></div>
            </section>
            {[...derived.byDimension.entries()].map(([dimension, items]) => (
              <section className="winner-section" key={dimension}>
                <div className="section-title"><div><span>PERFORMANS KIRILIMI</span><h2>{dimension}</h2></div><small>{items.length} farklı sonuç</small></div>
                <div className="winner-grid">
                  {items.slice(0, 6).map((item) => <WinnerCard key={item.id} item={item} />)}
                </div>
              </section>
            ))}
            <section className="avoid-section">
              <div className="section-title"><div><span>TEKRAR KONTROLÜ</span><h2>Şimdilik yeniden çekme</h2></div><RepeatIcon /></div>
              {data.repetitionAlerts.length ? (
                <div className="avoid-list">
                  {data.repetitionAlerts.map((alert) => (
                    <article key={alert.id}>
                      <div><strong>{alert.label}</strong><span>{alert.cooldownDays} gün ara ver</span></div>
                      <p>{alert.evidence}</p>
                      {alert.titles.slice(0, 2).map((title) => <small key={title}>“{title}”</small>)}
                    </article>
                  ))}
                </div>
              ) : <p className="empty-note">Henüz tekrara düşen bir konu görünmüyor.</p>}
            </section>
            <details className="calculation-details wide">
              <summary>Sistem “ne tutuyor?” kararını nasıl veriyor?</summary>
              <p>Her padişah, konu, başlık kalıbı ve yayın zamanı; günlük izlenme hızı, etkileşim, 1.000 izlenme başına abone ve video sayısıyla birlikte değerlendirilir. Az örnekli yüksek sonuçlar önce yeniden test edilir; doğrudan çoğaltılmaz.</p>
            </details>
          </>
        )}

        {activeTab === "plan" && (
          <>
            <section className="plan-intro">
              <div><span>30 GÜNDE 180 SHORTS</span><h2>Her gün ne çekeceğin hazır.</h2><p>Aynı başlık ve olay tekrar edilmez. Perşembe akşamları bir padişahın hayatı uzun video olarak yayınlanır.</p></div>
              <button className="primary-button" disabled={Boolean(busy)} onClick={() => runAction("plan", "/api/plan", { body: JSON.stringify({ useLocalAi: false }) })}><Sparkles size={17} /> Planı yeniden hesapla</button>
            </section>
            <section className="weekly-strip">
              {data.weeklySchedule.map((day) => (
                <article key={day.day}>
                  <strong>{day.dayLabel}</strong>
                  <span>{(day.shortSlots || []).map((slot) => `${slot.time} ${slot.objective}`).join(" · ") || day.shortsTimes.join(" · ")}</span>
                  {day.longVideoTime && <b>Uzun: {day.longVideoTime}</b>}
                  <small>{day.confidence} güven · haftalık hesap</small>
                </article>
              ))}
            </section>
            <div className="plan-grid">
              {derived.sortedDays.map(([date, items]) => <PlanDay date={date} items={items} key={date} onSelect={setSelectedPlan} />)}
            </div>
          </>
        )}

        {activeTab === "videos" && (
          <>
            <section className="explain-box">
              <FileText size={24} />
              <div><h2>Her videonun gerçek sonucu</h2><p>Skor; izlenme, izleyici tutma ve abone kazandırma gücünü birlikte özetler. Tek başına izlenmeye bakılmaz.</p></div>
            </section>
            <div className="video-table-wrap">
              <table className="video-table">
                <thead><tr><th>Video</th><th>Tür</th><th>İzlenme</th><th>İzleyici tutma</th><th>Abone / 1.000</th><th>Sonuç</th></tr></thead>
                <tbody>
                  {[...state.videos].sort((a, b) => scoreVideo(b) - scoreVideo(a)).map((video) => {
                    const conversion = ((video.subscribersGained - video.subscribersLost) / Math.max(video.views, 1)) * 1000;
                    const score = scoreVideo(video);
                    return (
                      <tr key={video.id}>
                        <td><span>{video.topic}</span><strong>{video.title}</strong></td>
                        <td><b className="type-pill">{video.contentType === "SHORT" ? "Shorts" : "Uzun"}</b></td>
                        <td>{whole.format(video.views)}</td>
                        <td>%{decimal.format(video.avgViewPercentage)}</td>
                        <td>{decimal.format(conversion)}</td>
                        <td><b className={`result-pill ${score >= 70 ? "good" : score < 45 ? "bad" : "test"}`}>{score >= 70 ? "Güçlü" : score < 45 ? "Zayıf" : "Test et"} · {score}</b></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {activeTab === "settings" && (
          <section className="settings-grid">
            <article className="setting-card featured">
              <Link2 size={24} />
              <span>YOUTUBE BAĞLANTISI</span>
              <h2>{state.auth.connected ? "Kanalın bağlı" : "Kanalını bağla"}</h2>
              <p>{state.auth.connected ? `${state.channel.title} kanalından salt okunur canlı veri alınıyor.` : "Canlı performans verilerini almak için Google hesabını bağla."}</p>
              <div className="safe-note"><ShieldCheck size={17} />Video silme, yükleme veya düzenleme izni yoktur.</div>
              <a className="primary-button" href="/api/auth/youtube">{state.auth.connected ? "Bağlantıyı yenile" : "Google ile bağlan"}</a>
            </article>
            <article className="setting-card">
              <Upload size={24} />
              <span>AYLIK STUDIO RAPORU</span>
              <h2>CTR verisini ekle</h2>
              <p>Küçük resim ve başlık sonuçlarını görmek için YouTube Studio ZIP raporunu ayda bir yükle.</p>
              <input ref={fileRef} type="file" accept=".zip,application/zip" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadStudio(file); }} />
              <button className="secondary-button" disabled={Boolean(busy)} onClick={() => fileRef.current?.click()}><Upload size={17} /> Studio ZIP yükle</button>
              <small>Son yükleme: {formatDate(state.sync.lastStudioImport)}</small>
            </article>
            <GoalSettings data={data} onUpdated={setData} onNotice={setNotice} />
            <article className="setting-card status-card">
              <Eye size={24} />
              <span>SİSTEM DURUMU</span>
              <h2>Her şey burada</h2>
              <ul>
                <li><span>Canlı bağlantı</span><strong>{state.auth.connected ? "Hazır" : "Bekliyor"}</strong></li>
                <li><span>Analiz edilen video</span><strong>{state.videos.length}</strong></li>
                <li><span>Hazır içerik planı</span><strong>{state.plan.length}</strong></li>
                <li><span>Veri saklama</span><strong>Bu bilgisayarda</strong></li>
              </ul>
            </article>
          </section>
        )}
      </main>
      {selectedPlan && <PlanDetail item={selectedPlan} onClose={() => setSelectedPlan(null)} onNotice={setNotice} />}
    </div>
  );
}

function PlanDetail({ item, onClose, onNotice }: { item: PlanItem; onClose: () => void; onNotice: (message: string) => void }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  async function copy(value: string, label: string) {
    await navigator.clipboard.writeText(value);
    onNotice(`${label} kopyalandı.`);
  }

  return (
    <div className="detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="plan-detail" role="dialog" aria-modal="true" aria-labelledby="plan-detail-title">
        <header className="detail-header">
          <div><span>{item.date} · {item.publishTime}</span><h2 id="plan-detail-title">{item.title}</h2></div>
          <button aria-label="Detayı kapat" onClick={onClose}><X size={22} /></button>
        </header>
        <div className="detail-tags">
          <b className={`objective-chip objective-${item.objective.toLocaleLowerCase("tr-TR")}`}>{item.objective} öncelikli</b>
          <b>{item.duration}</b><b>{item.strategyMode}</b><b>{item.pillar}</b>
        </div>
        <article className="detail-reason"><Lightbulb size={20} /><div><strong>Neden bu konu ve bu saat?</strong><p>{item.reason}</p></div></article>
        <article className="detail-section hook-section">
          <header><div><span>İLK 2 SANİYE</span><h3>Güçlü giriş</h3></div><button onClick={() => void copy(item.hook, "Giriş") }><Copy size={16} /> Kopyala</button></header>
          <p>{item.hook}</p>
        </article>
        <article className="detail-section voice-section">
          <header><div><span>HAZIR METİN</span><h3>Seslendirme</h3></div><button onClick={() => void copy(item.voiceover, "Seslendirme") }><Copy size={16} /> Kopyala</button></header>
          <p>{item.voiceover}</p>
          <footer><Clock3 size={15} /> Tahmini {item.estimatedSeconds} saniye · doğal ve akıcı okuma</footer>
        </article>
        <article className="detail-section cta-section">
          <header><div><span>AMAÇ: {item.objective.toLocaleUpperCase("tr-TR")}</span><h3>Kapanış</h3></div><button onClick={() => void copy(item.cta, "Kapanış") }><Copy size={16} /> Kopyala</button></header>
          <p>{item.cta}</p>
          {item.objective === "İzlenme" && <small>Bu videoda istek kullanılmaz; akıcılık ve sonuca ulaşma önceliklidir.</small>}
        </article>
        <article className="detail-section description-section">
          <header><div><span>YOUTUBE</span><h3>Açıklama ve etiketler</h3></div><button onClick={() => void copy(item.description, "Açıklama") }><Copy size={16} /> Kopyala</button></header>
          <p className="pre-line">{item.description}</p>
          <div className="hashtag-list">{item.hashtags.map((tag) => <span key={tag}>{tag}</span>)}</div>
        </article>
      </section>
    </div>
  );
}

function RepeatIcon() {
  return <CircleAlert size={24} />;
}

function GoalSettings({
  data,
  onUpdated,
  onNotice,
}: {
  data: DashboardData;
  onUpdated: (value: DashboardData) => void;
  onNotice: (value: string) => void;
}) {
  const [target, setTarget] = useState(String(data.state.goals.subscriberTarget));
  const [deadline, setDeadline] = useState(data.state.goals.deadline);
  const [saving, setSaving] = useState(false);

  async function saveGoal() {
    setSaving(true);
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscriberTarget: Number(target), deadline }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Hedef kaydedilemedi.");
      onUpdated(payload as DashboardData);
      onNotice("Hedef ve plan yeniden hesaplandı.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Hedef kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="setting-card">
      <Target size={24} />
      <span>ABONE HEDEFİ</span>
      <h2>{whole.format(Number(target) || 0)} abone</h2>
      <label>Hedef abone<input value={target} type="number" min={data.state.channel.subscriberCount} onChange={(event) => setTarget(event.target.value)} /></label>
      <label>Hedef tarihi<input value={deadline} type="date" onChange={(event) => setDeadline(event.target.value)} /></label>
      <button className="secondary-button" disabled={saving} onClick={saveGoal}><Target size={17} /> Hedefi kaydet</button>
    </article>
  );
}
