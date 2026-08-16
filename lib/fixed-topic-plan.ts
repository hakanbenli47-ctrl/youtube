import "server-only";
import { addDays, format } from "date-fns";
import { tr } from "date-fns/locale";
import { titleSimilarity } from "./history";
import type { ChannelState, PlanItem, WeeklyScheduleDay } from "./schema";

type ShortObjective = "İzlenme" | "Abone" | "Beğeni";

type ManualLane = {
  time: string;
  pillar: string;
  topics: readonly string[];
  reserveTopics: readonly string[];
};

const PLAN_START = new Date("2026-08-17T12:00:00+03:00");
const PLAN_DAYS = 30;
const SHORT_OBJECTIVES: ShortObjective[] = ["İzlenme", "Abone", "Beğeni", "İzlenme", "Abone", "Beğeni"];

// Kategori ve konu evreni tamamen manueldir. Sistem konu üretmez, trendden konu yazmaz
// ve günlük performansa göre başlık değiştirmez. Tek otomatik işlem güvenlik kontrolüdür:
// kanalda zaten yayınlanmış bir olay manuel listede yanlışlıkla varsa o satır atlanır ve
// AYNI kategorideki yine manuel yazılmış yedek konu kullanılır. İlk kurulumdan sonra plan kilitlenir.
const STATIC_SHORT_LANES: readonly ManualLane[] = [
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
    reserveTopics: [
      "II. Bayezid’in Oğulları Ahmed Korkut ve Selim Arasındaki Taht Mücadelesi",
      "Şehzade Korkut’un Mısır’a Gidişi ve Osmanlı’ya Geri Dönüşü",
      "Cem Sultan’ın Oğlu Murad’ın Rodos Şövalyelerine Sığınması",
      "II. Osman’ın Şehzade Mehmed’i Öldürtmesi",
      "IV. Murad’ın Şehzade Bayezid ve Süleyman’ı Öldürtmesi",
      "Sultan İbrahim’in Tahttan İndirilip IV. Mehmed’in Tahta Çıkarılması",
      "III. Osman’ın Uzun Kafes Hayatından Sonra Tahta Çıkması",
      "Abdülmecid’in Dört Oğlunun Farklı Dönemlerde Padişah Olması",
      "V. Murad’ın Çırağan Sarayı’nda Yıllarca Gözetim Altında Yaşaması",
      "VI. Mehmed’in Saltanatın Kaldırılmasından Sonra İstanbul’dan Ayrılması",
      "Şehzade Ahmed’in Yeniçerilerle Yaşadığı Taht Krizi",
      "Şehzade Kasım’ın IV. Murad Dönemindeki Taht Tehdidi",
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
    reserveTopics: [
      "III. Ahmed Döneminde Tulumbacı Ocağının Kurulması",
      "I. Mahmud Döneminde Hendesehane’nin Açılması",
      "I. Abdülhamid Döneminde Mühendishane-i Bahr-i Hümayun’un Açılması",
      "II. Mahmud’un Posta Teşkilatını Yeniden Düzenlemesi",
      "II. Mahmud’un Meclis-i Vâlâ-yı Ahkâm-ı Adliye’yi Kurması",
      "Abdülmecid Döneminde Encümen-i Daniş’in Kurulması",
      "Abdülaziz Döneminde Galatasaray Sultanisi’nin Açılması",
      "II. Abdülhamid’in Darülaceze’yi Kurması",
      "II. Abdülhamid’in Hamidiye Etfal Hastanesini Açtırması",
      "II. Mahmud’un Müsadere Uygulamasını Sınırlaması",
      "Abdülmecid Döneminde Zaptiye Teşkilatının Kurulması",
      "II. Abdülhamid Döneminde Müze-i Hümayun’un Geliştirilmesi",
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
    reserveTopics: [
      "Zitvatorok Antlaşması 1606 ve Habsburglarla Yeni Diplomatik Denge",
      "Ferhat Paşa Antlaşması 1590 ve Osmanlı’nın Doğudaki En Geniş Sınırı",
      "Nasuh Paşa Antlaşması 1612 ve Safevi Cephesindeki Geri Çekilme",
      "Serav Antlaşması 1618 ve Osmanlı-Safevi Barışı",
      "Vasvar Antlaşması 1664 ve Avusturya Cephesindeki Şaşırtıcı Barış",
      "Bucaş Antlaşması 1672 ve Lehistan Üzerindeki Osmanlı Baskısı",
      "Kal’a-i Sultaniye Antlaşması 1809 ve Boğazların Savaş Gemilerine Kapatılması",
      "Londra Konferansı 1840 ve Mehmed Ali Paşa Krizinin Çözülmesi",
      "Londra Antlaşması 1871 ve Karadeniz Hükümlerinin Değişmesi",
      "Tersane Konferansı 1876 ve Büyük Devletlerin Osmanlı’ya Baskısı",
      "Reval Görüşmesi 1908 ve Osmanlı’daki Siyasi Kriz",
      "Osmanlı’nın 1854 İngiltere-Fransa İttifakıyla Kırım Savaşı’na Girmesi",
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
    reserveTopics: [
      "Korfu Kuşatması 1716",
      "Banya Luka Savaşı 1737",
      "Fidonisi Deniz Muharebesi 1788",
      "Tendra Deniz Muharebesi 1790",
      "Aynoroz Deniz Muharebesi 1807",
      "Şumnu Kuşatması 1828",
      "Oltenitsa Savaşı 1853",
      "Cetate Savaşı 1853",
      "Alacadağ Savaşı 1877",
      "Deveboynu Savaşı 1877",
      "Kırkkilise Savaşı 1912",
      "Lüleburgaz-Bunarhisar Savaşı 1912",
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
    reserveTopics: [
      "Sakız Adası’nın 1566’da Osmanlı’ya Katılması",
      "Tebriz’in 1585’te Osmanlı Tarafından Alınması",
      "Gence’nin 1588’de Osmanlı Tarafından Alınması",
      "Tiflis’in 1723’te Osmanlı Kontrolüne Girmesi",
      "Revan’ın 1724’te Osmanlı Tarafından Alınması",
      "Azak’ın 1711’de Osmanlı’ya Geri Verilmesi",
      "Özi Kalesi’nin 1788’de Kaybı",
      "Anapa’nın 1829’da Rusya’ya Bırakılması",
      "Belgrad Kalesi’nin 1867’de Sırbistan’a Devri",
      "Niş’in 1878’de Osmanlı’dan Ayrılması",
      "Teselya’nın 1881’de Yunanistan’a Bırakılması",
      "Sana’nın 1872’de Yeniden Osmanlı Yönetimine Alınması",
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
    reserveTopics: [
      "Buçuktepe İsyanı 1446",
      "Beylerbeyi Vakası 1589",
      "1632 İstanbul Askerî Ayaklanması ve Hafız Ahmed Paşa’nın Öldürülmesi",
      "Kösem Sultan’ın 1651’de Öldürülmesiyle Yaşanan Saray Krizi",
      "Vak’a-i Hayriye 1826 ve Yeniçeri Direnişinin Sonu",
      "Softalar Gösterisi 1876 ve Abdülaziz Yönetimine Baskı",
      "Osmanlı Bankası Baskını 1896",
      "Yıldız Suikastı 1905",
      "Halâskâr Zabitan Krizi 1912",
      "Talat Paşa Hükümetinin 1918’de İstifası",
      "Yeniçeri-Sipahi Çatışmalarının 17. Yüzyıl İstanbul Siyasetine Etkisi",
      "Kavalalı Mehmed Ali Paşa Krizinde Osmanlı Ordusunun Kütahya’ya Kadar Geri Çekilmesi",
    ],
  },
] as const;

const STATIC_LONG_VIDEO_OPTIONS: ReadonlyArray<{ dayIndex: number; topics: readonly string[] }> = [
  {
    dayIndex: 3,
    topics: [
      "Malta Kuşatması 1565: Osmanlı Neden Adayı Alamadı?",
      "Osmanlı-Portekiz Mücadelesi: Hint Okyanusu’nda İmparatorluk Savaşı",
      "Yemen Seferleri: Osmanlı Neden Arabistan’ın Güneyinde Yüzyıllarca Tutunmaya Çalıştı?",
    ],
  },
  {
    dayIndex: 10,
    topics: [
      "Çanakkale Savaşı 1915: Boğazı Geçemeyen İtilaf Donanması",
      "Plevne Savunması 1877: Gazi Osman Paşa’nın Direnişi",
      "Kafkas Cephesi 1914-1918: Osmanlı’nın En Zorlu Doğu Savaşı",
    ],
  },
  {
    dayIndex: 17,
    topics: [
      "Kutü’l-Amare 1916: Bir İngiliz Ordusu Nasıl Teslim Oldu?",
      "Bağdat Cephesi 1914-1918: Osmanlı Irak’ı Neden Kaybetti?",
      "Medine Müdafaası 1916-1919: Fahreddin Paşa Neden Teslim Olmadı?",
    ],
  },
  {
    dayIndex: 24,
    topics: [
      "93 Harbi 1877-1878: Plevne’den Ayastefanos’a",
      "Trablusgarp Savaşı 1911-1912: Osmanlı Kuzey Afrika’daki Son Toprağını Nasıl Kaybetti?",
      "Birinci Balkan Savaşı 1912-1913: Osmanlı Rumeli’yi Nasıl Kaybetti?",
    ],
  },
];

const STOP_WORDS = new Set([
  "osmanlı", "osmanli", "devleti", "dönemi", "donemi", "sonrası", "sonrasi", "savaşı", "savasi",
  "seferi", "muharebesi", "kuşatması", "kusatmasi", "antlaşması", "antlasmasi", "olayı", "olayi",
  "vakası", "vakasi", "isyanı", "isyani", "krizi", "fethi", "alınması", "alinmasi", "kaybı", "kaybi",
  "geri", "nasıl", "nasil", "neden", "için", "icin", "ile", "ve", "bir", "sonra", "tarafından", "tarafindan",
  "sultan", "padişah", "padisah", "şehzade", "sehzade", "paşa", "pasa", "mehmed", "mehmet", "murad",
  "mustafa", "selim", "süleyman", "suleyman", "ahmed", "ahmet", "mahmud", "abdülhamid", "abdulhamid",
  "abdülmecid", "abdulmecid", "abdülaziz", "abdulaziz", "fatih", "kanuni", "yavuz",
]);

const PHRASE_ALIASES: Array<[RegExp, string]> = [
  [/vak\s*a\s*i\s*hayriye|vakayi hayriye|yeniçeri ocağını kaldır|yeniceri ocagini kaldir/gi, "yeniceri-kaldirma"],
  [/nizam\s*i\s*cedid/gi, "nizami-cedid"],
  [/ekber\s*ve\s*erşed|ekber\s*ve\s*ersed/gi, "ekber-ersed"],
  [/don\s*volga/gi, "don-volga"],
  [/hünkâr iskelesi|hunkar iskelesi/gi, "hunkar-iskelesi"],
  [/düyun\s*u\s*umumiye|duyun\s*u\s*umumiye/gi, "duyun-umumiye"],
  [/goeben\s*ve\s*breslau|yavuz\s*ve\s*midilli/gi, "goeben-breslau"],
];

function normalize(value: string) {
  let result = value
    .toLocaleLowerCase("tr-TR")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
  for (const [pattern, replacement] of PHRASE_ALIASES) result = result.replace(pattern, replacement);
  return result.replace(/[^a-z0-9çğıöşü\s-]/gi, " ").replace(/\s+/g, " ").trim();
}

function years(value: string) {
  return new Set(normalize(value).match(/\b(?:1[3-9]\d{2}|20\d{2})\b/g) || []);
}

function meaningfulWords(value: string) {
  return new Set(
    normalize(value)
      .split(/\s+/)
      .filter((word) => word.length >= 4 && !STOP_WORDS.has(word) && !/^\d{3,4}$/.test(word)),
  );
}

function sameHistoricalTopic(left: string, right: string) {
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return false;
  if (a === b || (a.length >= 12 && b.includes(a)) || (b.length >= 12 && a.includes(b))) return true;

  const leftYears = years(left);
  const rightYears = years(right);
  if (leftYears.size && rightYears.size && ![...leftYears].some((year) => rightYears.has(year))) return false;

  if (titleSimilarity(left, right) >= 0.36) return true;

  const leftWords = meaningfulWords(left);
  const rightWords = meaningfulWords(right);
  if (!leftWords.size || !rightWords.size) return false;
  const shared = [...leftWords].filter((word) => rightWords.has(word));
  const containment = shared.length / Math.max(1, Math.min(leftWords.size, rightWords.size));
  if (shared.length >= 3 && containment >= 0.45) return true;
  if (shared.length >= 2 && containment >= 0.66) return true;

  // Tek bir çok ayırt edici birleşik/özel olay anahtarı varsa aynı konu kabul et.
  return shared.length === 1 && shared[0].length >= 9 && containment >= 0.5;
}

function blockedTopics(state: ChannelState) {
  const planning = state.planning as (typeof state.planning & { coveredSubjects?: string[] }) | undefined;
  return [
    ...state.videos.map((video) => video.title).filter(Boolean),
    ...(planning?.coveredSubjects || []).filter(Boolean),
  ];
}

function buildManualLaneTopics(state: ChannelState) {
  const blocked = blockedTopics(state);
  const used: string[] = [];

  return STATIC_SHORT_LANES.map((lane) => {
    const candidates = [...lane.topics, ...lane.reserveTopics];
    const selected: string[] = [];

    for (const topic of candidates) {
      if (blocked.some((old) => sameHistoricalTopic(topic, old))) continue;
      if (used.some((old) => sameHistoricalTopic(topic, old))) continue;
      selected.push(topic);
      used.push(topic);
      if (selected.length === PLAN_DAYS) break;
    }

    if (selected.length < PLAN_DAYS) {
      throw new Error(`${lane.pillar} için 30 tekrarsız manuel konu bulunamadı. Manuel yedek havuzu genişletilmeli.`);
    }

    return selected;
  });
}

function buildManualLongVideos(state: ChannelState, usedShortTopics: string[]) {
  const blocked = [...blockedTopics(state), ...usedShortTopics];
  const selected: Record<number, string> = {};
  const usedLong: string[] = [];

  for (const slot of STATIC_LONG_VIDEO_OPTIONS) {
    const topic = slot.topics.find((candidate) =>
      !blocked.some((old) => sameHistoricalTopic(candidate, old)) &&
      !usedLong.some((old) => sameHistoricalTopic(candidate, old)));
    if (!topic) {
      throw new Error(`${slot.dayIndex}. gün uzun videosu için tekrarsız manuel konu kalmadı.`);
    }
    selected[slot.dayIndex] = topic;
    usedLong.push(topic);
  }

  return selected;
}

function shortPlanItem(
  dateKey: string,
  dayLabel: string,
  dayIndex: number,
  slotIndex: number,
  validatedTopics: string[][],
): PlanItem {
  const lane = STATIC_SHORT_LANES[slotIndex];
  const title = validatedTopics[slotIndex][dayIndex];
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
    reason: "Manuel sabit konu planı. Konu otomatik üretilmez; yalnızca kanalda daha önce yayınlanan aynı olaylar tek seferlik güvenlik kontrolünde elenir.",
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
    reason: "Perşembe 20:30 sabit uzun video planı. Konu manuel havuzdan seçilip mevcut kanal geçmişine karşı doğrulandıktan sonra kilitlenir.",
    voiceover: "",
    description: "",
    hashtags: [],
    cta: "",
    estimatedSeconds: 600,
    strategyMode: "Kazananı büyüt",
  };
}

export function generateChannelDrivenPlan(
  state: ChannelState,
  _adaptiveSchedule: WeeklyScheduleDay[],
): PlanItem[] {
  const validatedTopics = buildManualLaneTopics(state);
  const usedShortTopics = validatedTopics.flat();
  const longVideos = buildManualLongVideos(state, usedShortTopics);
  const plan: PlanItem[] = [];

  for (let dayIndex = 0; dayIndex < PLAN_DAYS; dayIndex += 1) {
    const date = addDays(PLAN_START, dayIndex);
    const dateKey = format(date, "yyyy-MM-dd");
    const dayLabel = format(date, "EEEE", { locale: tr });

    for (let slotIndex = 0; slotIndex < STATIC_SHORT_LANES.length; slotIndex += 1) {
      plan.push(shortPlanItem(dateKey, dayLabel, dayIndex, slotIndex, validatedTopics));
    }

    const longTitle = longVideos[dayIndex];
    if (longTitle) plan.push(longPlanItem(dateKey, dayLabel, longTitle));
  }

  return plan.sort((left, right) => left.date.localeCompare(right.date) || left.publishTime.localeCompare(right.publishTime));
}
