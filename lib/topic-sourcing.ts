import "server-only";

import { detectHistoryTopic, detectOttomanRuler, titleSimilarity } from "./history";
import type { ChannelState, TrendVideo, VideoMetric } from "./schema";

const DAY_MS = 86_400_000;
const HARD_DUPLICATE_PENALTY = -1_000_000;

const TREND_NOISE = new Set([
  "short", "shorts", "youtube", "yt", "tarih", "tarihi", "osmanli", "osmanlı",
  "inanilmaz", "inanılmaz", "sok", "şok", "gercek", "gerçek", "bilinmeyen", "bak",
  "izle", "kesfet", "keşfet", "viral", "video", "neden", "nasil", "nasıl", "neydi",
  "miydi", "mi", "icin", "için", "sonra", "gercekte", "gerçekte", "oldu", "etti",
]);

// 30 günlük 6 Shorts planı tekrar fallback'ine düşmesin diye geniş, tekil konu evreni.
// Her satır farklı bir olay, kurum, kişi, yapı, uygulama veya diplomatik kırılmadır.
const FRESH_SUBJECTS = [
  "Söğüt uç bölgesi", "Domaniç yaylak düzeni", "Koyunhisar Savaşı", "Karacahisar'ın alınışı",
  "Bilecik ve Yarhisar'ın alınışı", "İnegöl'ün fethi", "Bursa kuşatmasının uzun sürmesi", "Pelekanon Savaşı",
  "İznik'in alınışı", "İzmit'in alınışı", "Karesi Beyliği'nin katılması", "Çimpe Kalesi",
  "Osmanlı'nın Rumeli'ye ilk kalıcı geçişi", "Edirne'nin fethi", "Sırpsındığı Savaşı", "Çirmen Savaşı",
  "Birinci Kosova Savaşı", "Niğbolu Savaşı", "Anadolu Hisarı'nın yapılması", "Ankara Savaşı",
  "Fetret Devri şehzade mücadelesi", "Musa Çelebi'nin Rumeli hakimiyeti", "Şeyh Bedreddin isyanı", "Düzmece Mustafa olayı",
  "Selanik'in Osmanlı'ya geçişi", "Varna Savaşı", "İkinci Kosova Savaşı", "Rumeli Hisarı'nın inşası",
  "İstanbul kuşatmasında Boğaz kontrolü", "Haliç zinciri", "Şahi toplarının dökümü", "Gemilerin Haliç'e indirilmesi",
  "İstanbul'un fethinden sonra Galata", "Mora Seferi", "Trabzon Rum İmparatorluğu'nun sonu", "Bosna'nın fethi",
  "Otlukbeli Savaşı", "Kırım Hanlığı ile ittifak", "Kefe'nin alınışı", "Arnavutluk seferleri",
  "İşkodra kuşatması", "Otranto Seferi", "Fatih'in kanunnamesi", "Cem Sultan krizi",
  "Kili ve Akkirman'ın alınışı", "Modon ve Koron seferleri", "Safevi-Osmanlı geriliminin başlangıcı", "Şahkulu İsyanı",
  "Çaldıran Savaşı", "Turnadağ Savaşı", "Mercidabık Savaşı", "Ridaniye Savaşı",
  "Memlük Devleti'nin sona ermesi", "Hilafet meselesinin Osmanlı'daki yeri", "Belgrad'ın fethi", "Rodos'un fethi",
  "Mohaç Savaşı", "Budin'in Osmanlı yönetimine geçişi", "Birinci Viyana Kuşatması", "Alman Seferi",
  "Irakeyn Seferi", "Bağdat'ın ilk Osmanlı fethi", "Preveze Deniz Savaşı", "Barbaros Hayreddin Paşa",
  "Cerbe Deniz Savaşı", "Malta Kuşatması", "Zigetvar Seferi", "Kanuni'nin ölümünün gizlenmesi",
  "Kıbrıs'ın fethi", "İnebahtı Deniz Savaşı", "Sokollu Mehmed Paşa'nın kanal projeleri", "Don-Volga Kanalı girişimi",
  "Süveyş Kanalı fikrinin Osmanlı'daki ilk örnekleri", "Tunus'un alınışı", "1574 Tunus Seferi", "Osmanlı-Safevi 1578 savaşı",
  "Özdemiroğlu Osman Paşa", "Çıldır Savaşı", "Meşaleler Savaşı", "Eğri Kalesi'nin alınışı",
  "Haçova Savaşı", "Celali isyanlarının büyümesi", "Karayazıcı Abdülhalim isyanı", "Deli Hasan isyanı",
  "Kuyucu Murad Paşa'nın Celali siyaseti", "Nasuh Paşa Antlaşması", "Serav Antlaşması", "Ekber ve Erşed uygulaması",
  "Kafes usulünün yaygınlaşması", "Sultanahmet Camii'nin altı minaresi", "Hotin Seferi", "Genç Osman'ın tahttan indirilmesi",
  "Abaza Mehmed Paşa isyanı", "IV. Murad'ın kahvehane yasakları", "Revan Seferi", "Bağdat'ın geri alınışı",
  "Kasr-ı Şirin Antlaşması", "Sultan İbrahim'in tahttan indirilmesi", "Girit Savaşı", "Kandiye Kuşatması",
  "Köprülü Mehmed Paşa'nın şartları", "Fazıl Ahmed Paşa dönemi", "Uyvar'ın fethi", "Bucaş Antlaşması",
  "Merzifonlu Kara Mustafa Paşa", "İkinci Viyana Kuşatması", "Kutsal İttifak Savaşları", "Budin'in kaybı",
  "Mohaç'ın 1687'de kaybı", "Belgrad'ın 1688'de kaybı", "Salankamen Savaşı", "Zenta Savaşı",
  "Karlofça Antlaşması", "İstanbul Antlaşması 1700", "Edirne Vakası", "Prut Seferi",
  "Azak'ın geri alınışı", "Mora'nın yeniden alınışı", "Pasarofça Antlaşması", "Lale Devri",
  "Nevşehirli Damat İbrahim Paşa", "Yirmisekiz Çelebi Mehmed'in Paris elçiliği", "İbrahim Müteferrika Matbaası", "Patrona Halil İsyanı",
  "Humbaracı Ahmed Paşa", "Belgrad Antlaşması 1739", "Nadir Şah ile Osmanlı ilişkileri", "Kerden Antlaşması",
  "III. Mustafa'nın askeri reform arayışı", "Baron de Tott", "Sürat Topçuları Ocağı", "Çeşme Baskını",
  "Küçük Kaynarca Antlaşması", "Kırım Hanlığı'nın bağımsızlaştırılması", "Aynalıkavak Tenkihnamesi", "Kırım'ın Rusya tarafından ilhakı",
  "Nizam-ı Cedid ordusu", "İrad-ı Cedid hazinesi", "III. Selim'in daimi elçilikleri", "Kabakçı Mustafa İsyanı",
  "Alemdar Mustafa Paşa", "Sened-i İttifak", "Sekban-ı Cedid", "Vak'a-i Hayriye",
  "Asakir-i Mansure-i Muhammediye", "II. Mahmud'un kıyafet reformu", "Tercüme Odası", "Takvim-i Vekayi",
  "Mekteb-i Tıbbiye'nin açılması", "Mekteb-i Harbiye'nin açılması", "Mehmed Ali Paşa krizi", "Kütahya Antlaşması",
  "Hünkar İskelesi Antlaşması", "Nizip Savaşı", "Tanzimat Fermanı", "1840 Ceza Kanunu",
  "Islahat Fermanı", "Kırım Savaşı", "Osmanlı'nın ilk dış borcu", "Paris Antlaşması 1856",
  "Telgrafın Osmanlı'da yayılması", "Demiryolunun Osmanlı'ya gelişi", "Dolmabahçe Sarayı", "Sultan Abdülaziz'in Avrupa seyahati",
  "Osmanlı donanmasının zırhlı gemileri", "Midhat Paşa", "Birinci Meşrutiyet", "Kanun-ı Esasi",
  "Tersane Konferansı", "93 Harbi", "Plevne Savunması", "Gazi Osman Paşa",
  "Ayastefanos Antlaşması", "Berlin Antlaşması", "Kıbrıs'ın İngiltere yönetimine bırakılması", "Düyun-u Umumiye",
  "Muharrem Kararnamesi", "Yıldız Sarayı", "Hamidiye Alayları", "Hicaz Demiryolu",
  "Bağdat Demiryolu", "Ermeni reformları meselesi", "1897 Osmanlı-Yunan Savaşı", "Dömeke Savaşı",
  "II. Meşrutiyet", "31 Mart Vakası", "Hareket Ordusu", "II. Abdülhamid'in tahttan indirilmesi",
  "Trablusgarp Savaşı", "Uşi Antlaşması", "Birinci Balkan Savaşı", "Edirne'nin 1913'te geri alınışı",
  "İkinci Balkan Savaşı", "Babıali Baskını", "Mahmud Şevket Paşa suikastı", "Osmanlı'nın Birinci Dünya Savaşı'na girişi",
  "Goeben ve Breslau gemileri", "Sarıkamış Harekatı", "Çanakkale Deniz Zaferi", "Çanakkale kara savaşları",
  "Kutü'l-Amare Kuşatması", "Kanal Harekatı", "Hicaz İsyanı", "Medine Müdafaası",
  "Fahreddin Paşa", "Galiçya Cephesi", "Kafkas İslam Ordusu", "Bakü'nün 1918'de alınışı",
  "Mondros Mütarekesi", "İstanbul'un İtilaf kuvvetlerince işgali", "Meclis-i Mebusan'ın son dönemi", "Misak-ı Milli",
  "Saltanatın kaldırılması", "Osmanlı hanedanının sürgünü", "Topkapı Sarayı'nın yönetim düzeni", "Divan-ı Hümayun",
  "Kubbealtı toplantıları", "Sadrazamlık makamı", "Nişancı görevi", "Defterdar görevi",
  "Kazasker görevi", "Şeyhülislamlık makamı", "Kadıların şehir yönetimi", "Enderun Mektebi",
  "Birun teşkilatı", "Devşirme sistemi", "Kapıkulu ocakları", "Yeniçeri ulufesi",
  "Cülus bahşişi", "Acemi Ocağı", "Cebeci Ocağı", "Topçu Ocağı",
  "Lağımcı Ocağı", "Humbaracı Ocağı", "Akıncılar", "Azap askerleri",
  "Deliler askeri birlikleri", "Martolos teşkilatı", "Tımar sistemi", "Zeamet sistemi",
  "Has toprakları", "İltizam sistemi", "Malikane sistemi", "Avarız vergisi",
  "Cizye vergisinin toplanması", "Narh sistemi", "Lonca teşkilatı", "Gedik usulü",
  "Bedestenler", "Kapan hanları", "İstanbul'un iaşe sistemi", "Vakıf sistemi",
  "İmaretler", "Kervansaraylar", "Menzil teşkilatı", "Derbent teşkilatı",
  "Ulak sistemi", "Sürre alayları", "Hac yollarının güvenliği", "Kapitülasyonların ilk dönemi",
  "Tercümanlar ve dragomanlar", "Millet sistemi", "Fenerli Rum aileleri", "Eflak ve Boğdan voyvodaları",
  "Kırım Hanlığı'nın Osmanlı sistemindeki yeri", "Dubrovnik'in Osmanlı ile ilişkisi", "Venedik balyosları", "Fransa daimi elçiliği ilişkileri",
  "Osmanlı kahvehaneleri", "Tulumbacılar", "Ramazan mahyaları", "Surre-i Hümayun töreni",
  "Şehzade sünnet şenlikleri", "Surname geleneği", "Matrakçı Nasuh", "Evliya Çelebi",
  "Katip Çelebi", "Koçi Bey Risalesi", "Naima Tarihi", "Takiyüddin Rasathanesi",
  "Rasathanenin yıkılması", "Mimar Sinan", "Süleymaniye Külliyesi", "Selimiye Camii",
  "Mihrimah Sultan külliyeleri", "Rüstem Paşa Camii", "Sultanahmet Camii", "Nuruosmaniye Camii",
  "Topkapı Sarayı Hazine Dairesi", "Harem'in saray içindeki işlevi", "Valide Sultanların siyasi etkisi", "Kösem Sultan",
  "Turhan Sultan", "Hürrem Sultan", "Mihrimah Sultan", "Safiye Sultan",
  "Nurbanu Sultan", "Köprülü ailesi", "Çandarlı ailesi", "Sokollu Mehmed Paşa",
  "Pargalı İbrahim Paşa", "Lala Mustafa Paşa", "Kılıç Ali Paşa", "Piyale Paşa",
  "Turgut Reis", "Kemal Reis", "Piri Reis", "Seydi Ali Reis",
  "Piri Reis'in dünya haritası", "Kitab-ı Bahriye", "Osmanlı tersaneleri", "Tersane-i Amire",
  "Kadırgadan kalyona geçiş", "Osmanlı'da top döküm teknolojisi", "Tophane-i Amire", "Baruthaneler",
  "Mehter teşkilatı", "Matbah-ı Amire", "Helvahane", "Bostancı Ocağı",
  "Hasbahçeler", "Kağıthane mesireleri", "Çiçek aşısının Avrupa'ya aktarılması", "Lady Mary Montagu'nun İstanbul mektupları",
  "Osmanlı'da karantina uygulaması", "Karantina Meclisi", "Posta Nezareti", "Şirket-i Hayriye",
  "Boğaziçi vapurları", "Galata Köprüsü", "Tünel'in açılması", "Dersaadet tramvayları",
];

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function ageDays(video: VideoMetric) {
  const publishedAt = new Date(video.publishedAt).getTime();
  if (!Number.isFinite(publishedAt)) return 365;
  return Math.max(0.25, (Date.now() - publishedAt) / DAY_MS);
}

function normalize(value: string) {
  return value
    .toLocaleLowerCase("tr-TR")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9çğıöşü\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function meaningfulWords(value: string) {
  return new Set(
    normalize(value)
      .split(/\s+/)
      .filter((word) => word.length >= 3 && !TREND_NOISE.has(word)),
  );
}

function overlapScore(leftTitle: string, rightTitle: string) {
  const left = meaningfulWords(leftTitle);
  const right = meaningfulWords(rightTitle);
  if (!left.size || !right.size) return { shared: 0, containment: 0, jaccard: 0 };
  const shared = [...left].filter((word) => right.has(word)).length;
  const containment = shared / Math.max(1, Math.min(left.size, right.size));
  const jaccard = shared / Math.max(1, new Set([...left, ...right]).size);
  return { shared, containment, jaccard };
}

function sameHistoricalSubject(leftTitle: string, rightTitle: string) {
  const left = normalize(leftTitle);
  const right = normalize(rightTitle);
  if (!left || !right) return false;
  if (left === right || left.includes(right) || right.includes(left)) return true;
  if (titleSimilarity(leftTitle, rightTitle) >= 0.31) return true;

  const leftRuler = detectOttomanRuler(leftTitle);
  const rightRuler = detectOttomanRuler(rightTitle);
  const overlap = overlapScore(leftTitle, rightTitle);

  // Aynı padişah + aynı iki anlamlı kavram = farklı hook olsa bile aynı konu.
  if (leftRuler !== "Diğer Osmanlı" && leftRuler === rightRuler && overlap.shared >= 2 && overlap.containment >= 0.42) return true;

  // Padişah adı değişse dahi aynı savaş, kurum, antlaşma veya yer adı tekrarını kes.
  if (overlap.shared >= 3 && overlap.containment >= 0.55) return true;
  if (overlap.shared >= 2 && overlap.containment >= 0.72) return true;

  return false;
}

function isCoveredByChannel(state: ChannelState, candidate: string) {
  return state.videos.some((video) => sameHistoricalSubject(candidate, video.title));
}

function cleanTrendTitle(value: string) {
  const withoutTags = value
    .replace(/#[\p{L}\p{N}_]+/gu, " ")
    .replace(/[|•·]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = withoutTags.split(/\s+/).filter((word) => {
    const key = normalize(word);
    return key.length > 1 && !TREND_NOISE.has(key);
  });
  return words.join(" ").replace(/^[\-–—:;,]+|[\-–—:;,]+$/g, "").replace(/\s+/g, " ").trim();
}

function adaptTrendTitle(trend: TrendVideo, index: number) {
  const clean = cleanTrendTitle(trend.title).replace(/[?!\.]+$/g, "").trim();
  if (clean.length < 10) return null;
  const ruler = detectOttomanRuler(clean);
  const templates = ruler !== "Diğer Osmanlı"
    ? [`${clean}: Asıl Kırılma Noktası Neydi?`, `${clean}: Kaynaklar Ne Söylüyor?`, `${clean}: ${ruler} İçin Neden Önemliydi?`]
    : [`${clean}: Osmanlı İçin Neden Önemliydi?`, `${clean}: Gerçekte Ne Oldu?`, `${clean}: Dengeleri Nasıl Değiştirdi?`];
  return templates[index % templates.length];
}

function freshSubjectTitle(subject: string, index: number) {
  const templates = [
    `${subject} Osmanlı İçin Neden Önemliydi?`,
    `${subject} Dengeleri Nasıl Değiştirdi?`,
    `${subject} Hakkında En Kritik Ayrıntı Neydi?`,
    `${subject} Osmanlı'yı Nasıl Etkiledi?`,
  ];
  return templates[index % templates.length];
}

function ownVideoStrength(video: VideoMetric) {
  const age = ageDays(video);
  const dailyVelocity = (video.viewsLast7Days || 0) > 0
    ? (video.viewsLast7Days || 0) / Math.max(1, Math.min(7, age))
    : (video.viewsLast28Days || 0) > 0
      ? (video.viewsLast28Days || 0) / Math.max(1, Math.min(28, age))
      : age <= 8 && (video.recentVelocity || 0) > 0
        ? video.recentVelocity || 0
        : age <= 28
          ? video.views / Math.max(1, age)
          : 0;
  const retentionValue = video.avgViewPercentage > 0 && (video.retention10Percent || 0) > 0
    ? video.avgViewPercentage * 0.65 + (video.retention10Percent || 0) * 0.35
    : video.avgViewPercentage || video.retention10Percent || 0;
  const retention = retentionValue > 0 ? clamp(retentionValue / 85, 0.5, 1.35) : 0.85;
  const engaged = (video.engagedViewRate || 0) > 0 ? clamp((video.engagedViewRate || 0) / 65, 0.55, 1.35) : 0.85;
  const likeRate = video.likes / Math.max(video.views, 1) * 100;
  const subscriberRate = Math.max(0, video.subscribersGained - video.subscribersLost) / Math.max(video.analyticsViews || video.views, 1) * 1000;
  return Math.log10(dailyVelocity + 10) * 12 * Math.sqrt(retention * engaged) + clamp(likeRate, 0, 12) * 1.2 + clamp(subscriberRate, 0, 15) * 1.6;
}

function topicRelatedness(candidate: string, reference: string) {
  let relatedness = titleSimilarity(candidate, reference);
  const candidateRuler = detectOttomanRuler(candidate);
  const referenceRuler = detectOttomanRuler(reference);
  if (candidateRuler !== "Diğer Osmanlı" && candidateRuler === referenceRuler) relatedness = Math.max(relatedness, 0.34);
  if (detectHistoryTopic(candidate) === detectHistoryTopic(reference)) relatedness = Math.max(relatedness, 0.2);
  return clamp(relatedness, 0, 1);
}

/**
 * YouTube API takipçilerin tek tek izleme geçmişini vermez. Bu skor bunun yerine
 * kanalın kendi Shorts kitlesinin hangi padişah, olay ve başlık kümelerinde
 * yüksek hız, tutma, beğeni ve abone dönüşümü ürettiğini kullanır.
 * Daha önce işlenen tarihî konuya HARD_DUPLICATE_PENALTY verilir; tekrar puanlanamaz.
 */
export function audienceAffinityScore(state: ChannelState, candidate: string) {
  if (isCoveredByChannel(state, candidate)) return HARD_DUPLICATE_PENALTY;
  const shorts = state.videos
    .filter((video) => video.contentType === "SHORT" && video.views > 0)
    .sort((left, right) => ownVideoStrength(right) - ownVideoStrength(left))
    .slice(0, 30);
  if (!shorts.length) return 0;
  const weighted = shorts
    .map((video) => {
      const relatedness = topicRelatedness(candidate, video.title);
      return { relatedness, value: ownVideoStrength(video) * relatedness };
    })
    .filter((row) => row.relatedness >= 0.18)
    .sort((left, right) => right.value - left.value)
    .slice(0, 6);
  if (!weighted.length) return 0;
  const average = weighted.reduce((sum, row) => sum + row.value, 0) / weighted.length;
  return clamp(average * 0.42, 0, 38);
}

export function viralDemandScore(state: ChannelState, candidate: string) {
  if (isCoveredByChannel(state, candidate)) return HARD_DUPLICATE_PENALTY;
  const trends = [...(state.trends || [])]
    .filter((trend) => trend.title && trend.trendScore > 0)
    .sort((left, right) => right.trendScore - left.trendScore)
    .slice(0, 30);
  if (!trends.length) return 0;
  const maxTrend = Math.max(...trends.map((trend) => trend.trendScore), 1);
  let best = 0;
  for (const trend of trends) {
    const demand = clamp(trend.trendScore / maxTrend, 0, 1);
    const relatedness = topicRelatedness(candidate, trend.title);
    best = Math.max(best, relatedness * (18 + demand * 42));
  }
  return clamp(best, 0, 60);
}

export function buildViralTopicCandidates(state: ChannelState, seed = 0) {
  const trends = [...(state.trends || [])]
    .filter((trend) => trend.title && trend.trendScore > 0)
    .sort((left, right) => right.trendScore - left.trendScore || right.viewsPerDay - left.viewsPerDay)
    .slice(0, 30);
  const maxTrend = Math.max(1, ...trends.map((trend) => trend.trendScore));
  const seen: string[] = [];
  const results: Array<{ title: string; viralBonus: number; sourceTitle: string }> = [];

  const pushUnique = (title: string, viralBonus: number, sourceTitle: string) => {
    if (!title || isCoveredByChannel(state, title)) return;
    if (seen.some((existing) => sameHistoricalSubject(title, existing))) return;
    seen.push(title);
    results.push({ title, viralBonus, sourceTitle });
  };

  trends.forEach((trend, index) => {
    const title = adaptTrendTitle(trend, index + seed);
    if (!title) return;
    const demand = clamp(trend.trendScore / maxTrend, 0, 1);
    pushUnique(title, 28 + demand * 52, trend.title);
  });

  // Viral tarama yetersiz kaldığında eski konulara dönmek yerine yepyeni tarih konuları eklenir.
  // Sıralama seed ile döndürülür; plan her yenilendiğinde aynı ilk birkaç maddeye saplanmaz.
  for (let offset = 0; offset < FRESH_SUBJECTS.length; offset += 1) {
    const index = (offset + seed * 17) % FRESH_SUBJECTS.length;
    const subject = FRESH_SUBJECTS[index];
    const title = freshSubjectTitle(subject, index + seed);
    const demand = viralDemandScore(state, title);
    pushUnique(title, Math.max(8, demand > 0 ? demand * 0.55 : 8), `Yeni konu evreni: ${subject}`);
  }

  return results;
}
