import "server-only";
import { addDays, format } from "date-fns";
import { tr } from "date-fns/locale";
import type { ChannelState, PlanItem, WeeklyScheduleDay } from "./schema";

type ShortObjective = "İzlenme" | "Abone" | "Beğeni";

const PLAN_START = new Date("2026-08-18T12:00:00+03:00");
const PLAN_DAYS = 30;
const SHORT_OBJECTIVES: ShortObjective[] = ["İzlenme", "Abone", "Beğeni", "İzlenme", "Abone", "Beğeni"];

// 17 Ağustos 2026 tarihinde YouTube kanalındaki mevcut yayınlar tek tek çıkarıldı.
// Aşağıdaki 180 Shorts konusu o listede bulunmayan olaylardan manuel olarak yazıldı.
// Otomatik konu üretimi, yedek konu seçimi, trend seçimi veya performansa göre konu değiştirme yoktur.
const STATIC_SHORT_LANES = [
  {
    time: "09:00",
    pillar: "Taht & Hanedan",
    topics: [
      "II. Bayezid’in Yavuz Sultan Selim lehine tahttan çekilmek zorunda kalması",
      "Şehzade Korkut’un taht mücadelesi ve öldürülmesi",
      "Şehzade Ahmed’in Yavuz Sultan Selim’le taht mücadelesi",
      "Şehzade Bayezid’in Kanuni’ye karşı isyan edip Safevilere sığınması",
      "II. Selim’in tek hayatta kalan şehzade olarak tahta çıkışı",
      "III. Murad’ın tahta çıkınca beş kardeşini öldürtmesi",
      "III. Mehmed’in tahta çıkınca on dokuz kardeşini öldürtmesi",
      "I. Ahmed’in kardeşi Mustafa’yı öldürtmeyerek veraset düzenini değiştirmesi",
      "Mustafa I’in ilk saltanatının yalnızca üç ay sürmesi",
      "Mustafa I’in ikinci kez tahta çıkarılması",
      "IV. Murad’ın on bir yaşında tahta çıkışı",
      "Sultan İbrahim’in hanedanın tek erkek varisi olarak tahta çıkışı",
      "IV. Mehmed’in altı yaşında padişah olması",
      "Kösem Sultan ile Turhan Sultan arasındaki iktidar mücadelesi",
      "Şehzade Kasım’ın IV. Murad tarafından öldürtülmesi",
      "IV. Murad’ın şehzadeler Bayezid ve Süleyman’ı öldürtmesi",
      "II. Ahmed’in uzun kafes hayatından sonra tahta çıkışı",
      "III. Osman’ın yaklaşık yarım asırlık kafes hayatından sonra tahta çıkışı",
      "IV. Mustafa’nın II. Mahmud’u öldürtme girişimi",
      "Sultan Abdülaziz’in 1876’da tahttan indirilmesi",
      "V. Murad’ın yalnızca 93 gün tahtta kalması",
      "II. Abdülhamid’in tahta çıkarken Kanun-ı Esasi vaadiyle karşılaşması",
      "II. Abdülhamid’in 1909’da tahttan indirilmesi",
      "Mehmed Reşad’ın 65 yaşında tahta çıkışı",
      "Şehzade Abdülmecid Efendi’nin son halife seçilmesi",
      "Osmanlı hanedanının 1924’te sürgüne gönderilmesi",
      "Ekber ve Erşed usulünün Osmanlı verasetini değiştirmesi",
      "Nurbanu Sultan’ın III. Murad döneminde hanedan siyasetindeki etkisi",
      "Safiye Sultan’ın III. Mehmed dönemindeki nüfuzu",
      "Mihrimah Sultan’ın Rüstem Paşa ile evliliğinin hanedan siyasetine etkisi",
    ],
  },
  {
    time: "11:00",
    pillar: "Padişah Kararları & Reformlar",
    topics: [
      "Fatih’in Kanunname-i Âl-i Osman ile merkezi yönetimi düzenlemesi",
      "Fatih’in Sahn-ı Seman medreselerini kurdurarak eğitim sistemini merkezileştirmesi",
      "II. Bayezid’in 1509 depreminden sonra İstanbul’u yeniden inşa ettirmesi",
      "Kanuni’nin Ebussuud Efendi ile kanunları yeniden düzenlemesi",
      "Kanuni’nin Süleymaniye Külliyesi’ni büyük bir devlet projesine dönüştürmesi",
      "Takiyüddin’in İstanbul Rasathanesi’nin kurulması ve yıktırılması",
      "I. Ahmed’in Sultanahmet Camii’ni yaptırma kararı",
      "IV. Murad’ın tütün ve kahvehanelere yönelik sert yasakları",
      "III. Ahmed’in Yirmisekiz Çelebi Mehmed’i Paris’e elçi göndermesi",
      "III. Ahmed döneminde İbrahim Müteferrika’ya matbaa izni verilmesi",
      "III. Ahmed döneminde Tulumbacı Ocağı’nın kurulması",
      "I. Mahmud döneminde Hendesehane’nin açılması",
      "I. Abdülhamid döneminde Mühendishane-i Bahr-i Hümayun’un açılması",
      "III. Selim’in Avrupa’da daimi elçilikler kurması",
      "III. Selim döneminde Mühendishane-i Berr-i Hümayun’un kurulması",
      "II. Mahmud döneminde 1831 nüfus sayımının yapılması",
      "II. Mahmud’un Takvim-i Vekayi gazetesini çıkarması",
      "II. Mahmud döneminde Meclis-i Vâlâ-yı Ahkâm-ı Adliye’nin kurulması",
      "II. Mahmud döneminde Tercüme Odası’nın güçlendirilmesi",
      "II. Mahmud döneminde karantina teşkilatının kurulması",
      "II. Mahmud’un Mekteb-i Tıbbiye’yi açtırması",
      "II. Mahmud’un Mekteb-i Harbiye’yi kurdurması",
      "Abdülmecid’in Tanzimat Fermanı’nı ilan etmesi",
      "Abdülmecid’in Islahat Fermanı’nı ilan etmesi",
      "Abdülmecid döneminde ilk telgraf hattının kurulması",
      "Abdülaziz’in Avrupa seyahatine çıkan ilk Osmanlı padişahı olması",
      "Abdülaziz döneminde Galatasaray Sultanisi’nin açılması",
      "II. Abdülhamid’in Hicaz Demiryolu projesini başlatması",
      "II. Abdülhamid’in Darülaceze’yi kurdurması",
      "II. Abdülhamid döneminde Hamidiye Etfal Hastanesi’nin kurulması",
    ],
  },
  {
    time: "13:00",
    pillar: "Büyük Sefer & Diplomasi",
    topics: [
      "1485-1491 Osmanlı-Memlük Savaşı’nın neden sonuçsuz kaldığı",
      "Yavuz Sultan Selim’in 1514 Çaldıran Seferi",
      "Yavuz Sultan Selim’in 1516-1517 Mısır Seferi",
      "Kanuni’nin 1538 Boğdan Seferi",
      "Kanuni’nin 1543 Estergon Seferi",
      "Kanuni’nin 1534 Irakeyn Seferi",
      "1537 Korfu Seferi ve Osmanlı-Venedik gerilimi",
      "1555 Amasya Antlaşması ile Osmanlı-Safevi barışı",
      "1565 Malta Seferi’nin Osmanlı için sonucu",
      "1569-1571 Yemen Seferleri",
      "1570-1571 Kıbrıs Seferi",
      "1568 Edirne Antlaşması ile Habsburglarla barışın yenilenmesi",
      "1590 Ferhat Paşa Antlaşması ve doğudaki sınır genişlemesi",
      "1606 Zitvatorok Antlaşması ve Habsburglarla yeni denge",
      "1612 Nasuh Paşa Antlaşması",
      "1618 Serav Antlaşması",
      "1639 Kasr-ı Şirin Antlaşması ve İran sınırı",
      "1740 Osmanlı-Fransız kapitülasyonlarının genişletilmesi",
      "1672 Bucaş Antlaşması ve Lehistan üzerindeki Osmanlı baskısı",
      "1718 Pasarofça Antlaşması ve yeni Avrupa siyaseti",
      "1722-1727 Osmanlı-İran savaşı ve Kafkasya mücadelesi",
      "1774 Küçük Kaynarca Antlaşması’nın Osmanlı’ya ağır şartları",
      "1779 Aynalıkavak Tenkihnamesi ve Kırım meselesi",
      "1792 Yaş Antlaşması ile Kırım kaybının kesinleşmesi",
      "Napolyon’un 1798 Mısır işgali sonrası Osmanlı-İngiliz ittifakı",
      "1812 Bükreş Antlaşması ve Besarabya’nın kaybı",
      "1833 Hünkâr İskelesi Antlaşması ve Rusya ile yakınlaşma",
      "1841 Londra Boğazlar Sözleşmesi",
      "1878 Berlin Kongresi’nde Osmanlı topraklarının yeniden düzenlenmesi",
      "1914 Osmanlı-Alman İttifakı’nın imzalanması",
    ],
  },
  {
    time: "15:00",
    pillar: "Savaş & Deniz Muharebeleri",
    topics: [
      "1448 İkinci Kosova Savaşı",
      "1473 Otlukbeli Savaşı",
      "1560 Cerbe Deniz Savaşı",
      "1578 Çıldır Savaşı",
      "1583 Meşaleler Savaşı",
      "1596 Haçova Savaşı",
      "1620 Cecora Savaşı",
      "1664 Saint Gotthard Savaşı",
      "1691 Salankamen Savaşı",
      "1697 Zenta Savaşı",
      "1716 Petrovaradin Savaşı",
      "1716 Korfu Savunması",
      "1737 Banya Luka Savaşı",
      "1770 Kagul Savaşı",
      "1774 Kozluca Savaşı",
      "1788 Fidonisi Deniz Muharebesi",
      "1789 Fokşani Savaşı",
      "1789 Rymnik Savaşı",
      "1790 Tendra Deniz Muharebesi",
      "1788 Özi Kuşatması",
      "1807 Aynoroz Deniz Muharebesi",
      "1828 Varna Kuşatması",
      "1829 Kuleviça Savaşı",
      "1877 Şıpka Geçidi Muharebeleri",
      "1877 Alacadağ Savaşı",
      "1877 Deveboynu Savaşı",
      "1912 Kırkkilise Savaşı",
      "1912 Lüleburgaz-Bunarhisar Savaşı",
      "1912 Kumanova Savaşı",
      "1913 Bolayır Muharebesi",
    ],
  },
  {
    time: "17:00",
    pillar: "Fetih & Toprak Kazanımı/Kaybı",
    topics: [
      "Selanik’in 1430’da Osmanlı tarafından yeniden alınması",
      "Semendire’nin 1459’da alınması ve Sırp Despotluğu’nun sona ermesi",
      "Mora Despotluğu’nun 1460’ta Osmanlı’ya bağlanması",
      "Trabzon Rum İmparatorluğu’nun 1461’de sona ermesi",
      "Bosna Krallığı’nın 1463’te Osmanlı topraklarına katılması",
      "Eğriboz’un 1470’te Osmanlı tarafından alınması",
      "Kefe’nin 1475’te Osmanlı topraklarına katılması",
      "Otranto’nun 1480’de Osmanlı tarafından ele geçirilmesi",
      "Dulkadir Beyliği’nin 1515’te Osmanlı topraklarına katılması",
      "Tunus’un 1574’te kesin olarak Osmanlı yönetimine girmesi",
      "Tebriz’in 1585’te Osmanlı tarafından alınması",
      "Gence’nin 1588’de Osmanlı tarafından alınması",
      "Revan’ın 1635’te Osmanlı tarafından ele geçirilmesi",
      "Bağdat’ın 1638’de Osmanlı tarafından geri alınması",
      "Varat’ın 1660’ta Osmanlı tarafından alınması",
      "Uyvar’ın 1663’te Osmanlı tarafından alınması",
      "Kamaniçe’nin 1672’de Osmanlı tarafından alınması",
      "Azak’ın 1700 İstanbul Antlaşması’yla Rusya’ya bırakılması",
      "Mora’nın 1715’te Venedik’ten geri alınması",
      "Temeşvar’ın 1716’da Habsburglara kaybedilmesi",
      "Orşova’nın 1738’de Osmanlı tarafından geri alınması",
      "Cezayir’in 1830’da Fransa tarafından işgal edilmesi",
      "Kars Ardahan ve Batum’un 1878’de Rusya’ya bırakılması",
      "Kıbrıs yönetiminin 1878’de İngiltere’ye bırakılması",
      "Mısır’ın 1882’de İngiltere tarafından işgal edilmesi",
      "Doğu Rumeli’nin 1885’te Bulgaristan ile birleşmesi",
      "Girit’in 1898’de özerk hale gelmesi",
      "Trablusgarp’ın 1912’de İtalya’ya bırakılması",
      "Edirne’nin 1913’te Osmanlı tarafından geri alınması",
      "Bakü’nün 1918’de Kafkas İslam Ordusu tarafından alınması",
    ],
  },
  {
    time: "19:00",
    pillar: "İsyan & Büyük Kriz",
    topics: [
      "1446 Buçuktepe İsyanı ve Yeniçerilerin ilk büyük başkaldırısı",
      "1521 Canberdi Gazali İsyanı",
      "1524 Ahmed Paşa’nın Mısır İsyanı",
      "1526 Baba Zünnun İsyanı",
      "1527 Kalender Çelebi İsyanı",
      "16. yüzyıldaki Suhte İsyanlarının Anadolu’yu sarsması",
      "1589 Beylerbeyi Vakası ve askerlerin saraya yürümesi",
      "1622-1628 Abaza Mehmed Paşa İsyanı",
      "1632 İstanbul askerî ayaklanması ve Hafız Ahmed Paşa’nın öldürülmesi",
      "1651 Kösem Sultan’ın öldürülmesiyle yaşanan saray krizi",
      "1703 Edirne Vakası",
      "1730 Patrona Halil İsyanı",
      "1648’de Sultan İbrahim’in tahttan indirilmesiyle başlayan saray krizi",
      "1808 Alemdar Mustafa Paşa Vakası",
      "Tepedelenli Ali Paşa İsyanı",
      "1839-1841 Mehmed Ali Paşa Krizi",
      "1831 Bosna Ayaklanması",
      "1859 Kuleli Vakası",
      "1875 Hersek İsyanı",
      "1876 Softalar Gösterisi",
      "1876 Selanik Vakası",
      "1876 Bulgar Nisan Ayaklanması",
      "1876 Çerkez Hasan Vakası",
      "1878 Ali Suavi’nin Çırağan Baskını",
      "1896 Osmanlı Bankası Baskını",
      "1905 Yıldız Suikastı",
      "1909 31 Mart Vakası",
      "1910 Arnavutluk İsyanı",
      "1913 Babıali Baskını",
      "1913 Mahmud Şevket Paşa Suikastı",
    ],
  },
] as const;

const STATIC_LONG_VIDEOS: Record<number, string> = {
  2: "Osmanlı-Portekiz Hint Okyanusu Mücadelesi: Kızıldeniz ve Hint Deniz Yolunda İmparatorluk Savaşı",
  9: "Plevne Savunması 1877: Gazi Osman Paşa’nın Aylarca Süren Direnişi",
  16: "Kutü’l-Amare 1916: Bir İngiliz Ordusu Nasıl Teslim Oldu?",
  23: "Medine Müdafaası 1916-1919: Fahreddin Paşa Neden Teslim Olmadı?",
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
    reason: "Manuel sabit konu. Otomatik üretim veya otomatik konu değişimi yok.",
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
    reason: "Perşembe 20:30 sabit uzun video. Konu manuel olarak kilitlidir.",
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
