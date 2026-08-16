import "server-only";
import { addDays, format } from "date-fns";
import { tr } from "date-fns/locale";
import type { ChannelState, PlanItem, WeeklyScheduleDay } from "./schema";

type ShortObjective = "İzlenme" | "Abone" | "Beğeni";

const PLAN_START = new Date("2026-08-17T12:00:00+03:00");
const PLAN_DAYS = 30;
const SHORT_OBJECTIVES: ShortObjective[] = ["İzlenme", "Abone", "Beğeni", "İzlenme", "Abone", "Beğeni"];

// Bu dosyada kategori ve konular bilerek tamamen sabittir.
// Kanal verisi, trend, benzerlik, otomatik konu üretimi veya yeniden sıralama kullanılmaz.
// 17 Ağustos 2026 - 15 Eylül 2026 arasındaki 180 Shorts konusu manuel olarak kilitlidir.
const STATIC_SHORT_LANES = [
  {
    time: "09:00",
    pillar: "Taht & Hanedan",
    topics: [
      "Şehzade Orhan’ın Bizans’a Sığınışı",
      "Osmanlı’da Şehzadelerin Sancağa Çıkma Usulünün Sona Ermesi",
      "III. Mehmed’in Şehzade Mahmud’u İdam Ettirmesi",
      "I. Ahmed’in Şehzade Mustafa’yı Öldürmeyerek Hanedan Düzenini Değiştirmesi",
      "Ekber ve Erşed Sistemine Geçiş",
      "Mustafa I’in İki Kez Tahta Çıkışı",
      "Genç Osman’ın Tahttan İndirilmesi",
      "IV. Murad’ın Çocuk Yaşta Tahta Çıkışı",
      "Kösem Sultan ile Turhan Sultan Arasındaki Naibelik Mücadelesi",
      "IV. Mehmed’in Çocuk Yaşta Tahta Çıkışı",
      "II. Süleyman’ın 39 Yıllık Kafes Hayatından Sonra Tahta Çıkışı",
      "II. Ahmed’in Kafes Hayatından Sonra Padişah Oluşu",
      "II. Mustafa’nın Edirne Vakası Sonrası Tahttan İndirilmesi",
      "III. Ahmed’in Patrona Halil İsyanı Sonrası Tahttan Çekilişi",
      "I. Mahmud’un İsyan Ortasında Tahta Çıkışı",
      "III. Selim’in Tahttan İndirilmesi",
      "IV. Mustafa’nın Tahtı Korumak İçin Şehzadeleri Öldürtme Girişimi",
      "II. Mahmud’un Alemdar Mustafa Paşa Sayesinde Tahta Çıkışı",
      "Sultan Abdülaziz’in 1876’da Tahttan İndirilmesi",
      "V. Murad’ın 93 Günlük Saltanatı",
      "II. Abdülhamid’in 1909’da Tahttan İndirilmesi",
      "Şehzadelerin Kafes Usulünde Yetiştirilmesi",
      "Cülus Bahşişinin Taht Değişimlerinde Yarattığı Baskı",
      "Valide Sultanların Naibelik Dönemleri",
      "Hanedan Kızlarının Siyasi Evlilikleri",
      "Şehzadelerin Sarayda Eğitim Düzeni",
      "Osmanlı’da Kardeş Katli Kanununun Uygulanışı",
      "Şehzade Bayezid’in Safevilere Sığınışı",
      "Cem Sultan’ın Avrupa’da Siyasi Rehineye Dönüşmesi",
      "Osmanlı Hanedanının 1924 Sürgünü",
    ],
  },
  {
    time: "11:00",
    pillar: "Padişah Kararları & Reformlar",
    topics: [
      "Fatih’in Arnavutluk Seferleri",
      "III. Murad’ın İngiltere’ye Ticari İmtiyazlar Vermesi",
      "Sokollu Mehmed Paşa’nın Don-Volga Kanalı Projesi",
      "IV. Murad’ın Kahvehane ve Tütün Yasakları",
      "Köprülü Mehmed Paşa’nın Sadrazamlığı Şartla Kabul Etmesi",
      "II. Mustafa’nın Sarayı Edirne’ye Taşıması",
      "III. Ahmed’in Avrupa’yı Yakından İzleme Politikası",
      "Yirmisekiz Çelebi Mehmed’in Paris Elçiliği",
      "I. Mahmud’un Humbaracı Ahmed Paşa’yı Göreve Getirmesi",
      "III. Selim’in Daimi Elçilikler Kurması",
      "III. Selim’in Nizam-ı Cedid’i Kurma Kararı",
      "II. Mahmud’un Yeniçeri Ocağını Kaldırma Kararı",
      "II. Mahmud’un Devlet Memurlarına Yeni Kıyafet Düzeni Getirmesi",
      "II. Mahmud’un Takvim-i Vekayi’yi Çıkarması",
      "Abdülmecid’in Tanzimat Fermanını İlan Etmesi",
      "Abdülmecid Döneminde İlk Dış Borcun Alınması",
      "Abdülaziz’in Avrupa Seyahati",
      "Abdülaziz’in Donanmaya Yaptığı Büyük Yatırım",
      "II. Abdülhamid’in Yıldız Sarayı Yönetim Sistemi",
      "II. Abdülhamid’in Telgraf Ağını Genişletmesi",
      "II. Abdülhamid’in Hicaz Demiryolu Kararı",
      "II. Abdülhamid’in Eğitim Ağı ve İdadiler",
      "Ertuğrul Fırkateyni’nin Japonya’ya Gönderilmesi",
      "Sultan Reşad’ın Rumeli Seyahati",
      "II. Mahmud’un Sened-i İttifak’ı Onaylaması",
      "III. Selim’in Selimiye Kışlasını Kurması",
      "Abdülmecid’in Dolmabahçe Sarayı’na Geçişi",
      "Abdülaziz’in Mısır Seyahati",
      "II. Abdülhamid’in II. Wilhelm’i İstanbul’da Ağırlaması",
      "Osmanlı’nın Süveyş Kanalı Sonrası Kızıldeniz Politikasını Değiştirmesi",
    ],
  },
  {
    time: "13:00",
    pillar: "Büyük Sefer & Diplomasi",
    topics: [
      "Prut Seferi ve Çar Petro’nun Kuşatılması",
      "Osmanlı’nın Lehistan Veraset Savaşı’na Müdahalesi",
      "1736-1739 Osmanlı-Rus-Avusturya Savaşı ve Belgrad Barışı",
      "Nadir Şah ile Osmanlı Arasındaki Sınır Mücadelesi",
      "Kerden Antlaşması ve Osmanlı-İran Sınırının Korunması",
      "Aynalıkavak Tenkihnamesi ve Kırım Krizi",
      "Kırım’ın Rusya Tarafından İlhakı Sonrası Osmanlı Diplomasisi",
      "Yaş Antlaşması ve Kırım’ın Kaybının Kesinleşmesi",
      "Napolyon’un Mısır’ı İşgali Sonrası Osmanlı-İngiliz İttifakı",
      "Osmanlı-Fransız İlişkilerinin 1802 Paris Antlaşması’yla Yeniden Kurulması",
      "Bükreş Antlaşması 1812 ve Besarabya’nın Kaybı",
      "Akkerman Antlaşması 1826 ve Rus Baskısı",
      "Londra Antlaşması 1827 ve Yunan Meselesi",
      "Edirne Antlaşması 1829 ve Balkanlardaki Yeni Düzen",
      "Hünkâr İskelesi Antlaşması ve Rus Koruması",
      "Kütahya Antlaşması ve Mehmed Ali Paşa Krizi",
      "Londra Boğazlar Sözleşmesi 1841",
      "Paris Antlaşması 1856 ve Osmanlı’nın Avrupa Devletler Sistemine Girişi",
      "Islahat Fermanı’nın Paris Konferansı Öncesi İlanı",
      "1878 Kıbrıs Sözleşmesi ve İngiltere ile Gizli Pazarlık",
      "Berlin Kongresi’nde Osmanlı Topraklarının Yeniden Paylaşılması",
      "Muharrem Kararnamesi ve Düyun-u Umumiye’ye Giden Süreç",
      "1897 Osmanlı-Yunan Savaşı Sonrası İstanbul Antlaşması",
      "Uşi Antlaşması ve Trablusgarp’ın Bırakılması",
      "Londra Antlaşması 1913 ve Balkan Sınırları",
      "Bükreş Antlaşması 1913 ve Balkan Dengeleri",
      "Osmanlı-Alman İttifakı 1914",
      "Goeben ve Breslau’nun Osmanlı’ya Sığınması",
      "Brest-Litovsk Sonrası Osmanlı’nın Kafkasya Kazanımları",
      "Mondros Mütarekesi’nin Osmanlı Ordusuna Getirdiği Şartlar",
    ],
  },
  {
    time: "15:00",
    pillar: "Savaş & Deniz Muharebeleri",
    topics: [
      "Navarin Faciası",
      "Çıldır Savaşı 1578",
      "Meşaleler Savaşı 1583",
      "Haçova Savaşı 1596",
      "Cecora Savaşı 1620",
      "Hotin Seferi 1621",
      "Saint Gotthard Savaşı 1664",
      "Kamaniçe Seferi 1672",
      "Parkany Muharebeleri 1683",
      "Salankamen Savaşı 1691",
      "Zenta Savaşı 1697",
      "Petrovaradin Savaşı 1716",
      "Grocka Savaşı 1739",
      "Kagul Savaşı 1770",
      "Kozluca Savaşı 1774",
      "Fokşani Savaşı 1789",
      "Rymnik Savaşı 1789",
      "İngiliz Donanmasının Çanakkale Boğazı’na Girişi 1807",
      "Varna Kuşatması 1828",
      "Kuleviça Savaşı 1829",
      "Sinop Baskını 1853",
      "Silistre Kuşatması 1854",
      "Kars Savunması 1855",
      "Dömeke Savaşı 1897",
      "Kumanova Savaşı 1912",
      "Çatalca Savunması 1912",
      "Bolayır Muharebesi 1913",
      "Birinci Gazze Savaşı 1917",
      "İkinci Gazze Savaşı 1917",
      "Üçüncü Gazze Savaşı 1917",
    ],
  },
  {
    time: "17:00",
    pillar: "Fetih & Toprak Kazanımı/Kaybı",
    topics: [
      "Belgrad’ın 1739’da Geri Alınışı",
      "Kefe’nin Osmanlı’ya Katılması",
      "Tunus’un 1574’te Kesin Olarak Alınması",
      "Revan’ın 1635’te Alınması",
      "Bağdat’ın 1638’de Geri Alınması",
      "Yanova’nın 1660’ta Alınması",
      "Uyvar’ın 1663’te Alınması",
      "Kandiye’nin 1669’da Alınması",
      "Kamaniçe’nin 1672’de Alınması",
      "Azak’ın 1700’de Kaybı",
      "Mora’nın 1715’te Geri Alınması",
      "Temeşvar’ın 1716’da Kaybı",
      "Belgrad’ın 1717’de Kaybı",
      "Orşova’nın 1738’de Geri Alınması",
      "Hotin’in 1812’de Kaybı",
      "Cezayir’in 1830’da Fransa Tarafından İşgali",
      "Mora’da Osmanlı Egemenliğinin Sona Ermesi",
      "Kars Ardahan ve Batum’un 1878’de Rusya’ya Bırakılması",
      "Bosna-Hersek’in 1878’de Avusturya Tarafından İşgali",
      "Tunus’un 1881’de Fransa Himayesine Girmesi",
      "Mısır’ın 1882’de İngiltere Tarafından İşgali",
      "Bosna-Hersek’in 1908’de Avusturya Tarafından İlhakı",
      "Selanik’in 1912’de Kaybı",
      "Yanya’nın 1913’te Kaybı",
      "İşkodra’nın 1913’te Kaybı",
      "Edirne’nin 1913’te Geri Alınışı",
      "Batum’un 1918’de Osmanlı’ya Geri Dönüşü",
      "Bakü’nün 1918’de Kafkas İslam Ordusu Tarafından Alınışı",
      "Musul’un 1918’de İngilizler Tarafından İşgali",
      "İstanbul’un 1918’de İtilaf Donanması Tarafından Fiilen İşgali",
    ],
  },
  {
    time: "19:00",
    pillar: "İsyan & Büyük Kriz",
    topics: [
      "1687 Mohaç Yenilgisi ve IV. Mehmed’in Tahttan İndirilmesi",
      "Karayazıcı Abdülhalim İsyanı",
      "Deli Hasan İsyanı",
      "Canbolatoğlu Ali Paşa İsyanı",
      "Abaza Mehmed Paşa İsyanı",
      "Vak’a-i Vakvakiye 1656",
      "Edirne Vakası 1703",
      "Patrona Halil İsyanı 1730",
      "Kabakçı Mustafa İsyanı 1807",
      "Alemdar Mustafa Paşa Vakası 1808",
      "Tepedelenli Ali Paşa İsyanı",
      "Mora İsyanı 1821",
      "Bosna Ayaklanması 1831",
      "Kuleli Vakası 1859",
      "Girit İsyanı 1866",
      "Selanik Vakası 1876",
      "Bulgar Nisan Ayaklanması 1876",
      "Çerkez Hasan Vakası 1876",
      "Ali Suavi’nin Çırağan Baskını 1878",
      "Girit Krizi 1897",
      "İlinden İsyanı 1903",
      "1908 Jön Türk Devrimi ve II. Meşrutiyet",
      "31 Mart Vakası 1909",
      "Arnavutluk İsyanı 1910",
      "Yemen’de İmam Yahya İsyanı 1911",
      "Arnavutluk İsyanı 1912",
      "Babıali Baskını 1913",
      "Mahmud Şevket Paşa Suikastı 1913",
      "Hicaz İsyanı 1916",
      "Şam’ın 1918’de Kaybıyla Sonuçlanan Cephe Çöküşü",
    ],
  },
] as const;

const STATIC_LONG_VIDEOS: Record<number, string> = {
  3: "Malta Kuşatması 1565: Osmanlı Neden Adayı Alamadı?",
  10: "Çanakkale Savaşı 1915: Boğazı Geçemeyen İtilaf Donanması",
  17: "Kutü’l-Amare 1916: Bir İngiliz Ordusu Nasıl Teslim Oldu?",
  24: "93 Harbi 1877-1878: Plevne’den Ayastefanos’a",
};

function shortPlanItem(
  dateKey: string,
  dayLabel: string,
  dayIndex: number,
  slotIndex: number,
): PlanItem {
  const lane = STATIC_SHORT_LANES[slotIndex];
  const title = lane.topics[dayIndex];
  const objective = SHORT_OBJECTIVES[slotIndex];
  return {
    id: `${dateKey}-short-${slotIndex}`,
    date: dateKey,
    dayLabel,
    format: "Shorts",
    title,
    hook: "",
    duration: "45–60 sn",
    publishTime: lane.time,
    pillar: lane.pillar,
    objective,
    priority: slotIndex === 2 || slotIndex === 3 || slotIndex === 5 ? "Yüksek" : "Normal",
    reason: "Manuel sabit konu planı. Kategori, saat ve konu otomatik olarak değiştirilemez.",
    voiceover: "",
    description: "",
    hashtags: [],
    cta: "",
    estimatedSeconds: 55,
    strategyMode: "Kazananı büyüt",
  };
}

function longPlanItem(dateKey: string, dayLabel: string, title: string): PlanItem {
  return {
    id: `${dateKey}-long`,
    date: dateKey,
    dayLabel,
    format: "Uzun Video",
    title,
    hook: "",
    duration: "8–12 dk",
    publishTime: "20:30",
    pillar: "Uzun Video — Büyük Savaş/Sefer Dosyası",
    objective: "İzlenme Süresi",
    priority: "Yüksek",
    reason: "Perşembe 20:30 sabit uzun video planı. Konu manuel olarak kilitlidir.",
    voiceover: "",
    description: "",
    hashtags: [],
    cta: "",
    estimatedSeconds: 600,
    strategyMode: "Kazananı büyüt",
  };
}

export function generateChannelDrivenPlan(
  _state: ChannelState,
  _adaptiveSchedule: WeeklyScheduleDay[],
): PlanItem[] {
  const plan: PlanItem[] = [];

  for (let dayIndex = 0; dayIndex < PLAN_DAYS; dayIndex += 1) {
    const date = addDays(PLAN_START, dayIndex);
    const dateKey = format(date, "yyyy-MM-dd");
    const dayLabel = format(date, "EEEE", { locale: tr });

    for (let slotIndex = 0; slotIndex < STATIC_SHORT_LANES.length; slotIndex += 1) {
      plan.push(shortPlanItem(dateKey, dayLabel, dayIndex, slotIndex));
    }

    const longTitle = STATIC_LONG_VIDEOS[dayIndex];
    if (longTitle) plan.push(longPlanItem(dateKey, dayLabel, longTitle));
  }

  return plan.sort((left, right) => left.date.localeCompare(right.date) || left.publishTime.localeCompare(right.publishTime));
}
