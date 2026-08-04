import "server-only";

import { addDays, format } from "date-fns";
import { tr } from "date-fns/locale";
import { detectHistoryTopic, detectOttomanRuler, titleSimilarity } from "./history";
import { buildAdaptiveWeeklySchedule, currentIstanbulWeekKey } from "./scheduling";
import type { ChannelState, PlanItem, WeeklyScheduleDay } from "./schema";

const discoveryIdeas = [
  "I. Murad Edirne’yi Neden Başkent Yaptı?",
  "Yıldırım Bayezid’e ‘Yıldırım’ Lakabı Ne Zaman Verildi?",
  "Çelebi Mehmed Fetret Devri’ni Nasıl Bitirdi?",
  "II. Murad Tahtı Neden İki Kez Bıraktı?",
  "Fatih’in İstanbul Kuşatmasındaki En Riskli Kararı Neydi?",
  "Cem Sultan Olayı II. Bayezid’i Nasıl Sıkıştırdı?",
  "Yavuz, Çaldıran Seferinde En Çok Neyi Göze Aldı?",
  "Kanuni Belgrad’ı Neden İlk Büyük Hedef Seçti?",
  "II. Selim Neden Ordunun Başında Sefere Çıkmadı?",
  "III. Murad Döneminde Saray Neden Büyüdü?",
  "III. Mehmed’in Eğri Seferindeki Kırılma Anı Neydi?",
  "I. Ahmed Veraset Sistemini Neden Değiştirdi?",
  "Genç Osman Yeniçeri Ocağını Neden Değiştirmek İstedi?",
  "IV. Murad Bağdat Seferine Neden Bizzat Çıktı?",
  "Sultan İbrahim Nasıl Tahttan İndirildi?",
  "IV. Mehmed Neden Yönetimi Köprülülere Bıraktı?",
  "II. Süleyman Tahta Çıktığında Devletin En Büyük Sorunu Neydi?",
  "II. Mustafa Karlofça Sonrası Neyi Değiştirmek İstedi?",
  "III. Ahmed’in Tahtını Patrona Halil İsyanı Nasıl Sarstı?",
  "I. Mahmud İsyandan Sonra Düzeni Nasıl Kurdu?",
  "III. Mustafa Orduyu Neden Yenilemek İstedi?",
  "I. Abdülhamid Kırım Krizinde Hangi Seçeneklerle Karşılaştı?",
  "III. Selim Nizam-ı Cedid’i Neden Kurdu?",
  "II. Mahmud Yeniçeri Ocağını Nasıl Kaldırdı?",
  "Abdülmecid Tanzimat’ı Neden Destekledi?",
  "Abdülaziz Donanmaya Neden Bu Kadar Yatırım Yaptı?",
  "V. Murad’ın Saltanatı Neden 93 Gün Sürdü?",
  "II. Abdülhamid Telgraf Ağını Neden Büyüttü?",
  "V. Mehmed Döneminde İktidar Gerçekte Kimdeydi?",
  "VI. Mehmed Tahta Çıktığında Önünde Hangi Seçenekler Vardı?",
];

const conversionIdeas = [
  "Kosova Zaferi Osmanlı’nın Balkanlardaki Gücünü Nasıl Değiştirdi?",
  "Ankara Savaşı’nda Yıldırım Bayezid’in Planı Nerede Bozuldu?",
  "Fetret Devri’nde Osmanlı Neden Tamamen Dağılmadı?",
  "Varna Savaşı II. Murad’ın Tahta Dönüşünü Nasıl Etkiledi?",
  "Şahi Topları İstanbul Kuşatmasında Gerçekte Ne Kadar Etkiliydi?",
  "Otlukbeli Savaşı Osmanlı’nın Doğu Siyasetini Nasıl Değiştirdi?",
  "Çaldıran’da Osmanlı Ordusunun En Büyük Üstünlüğü Neydi?",
  "Rodos’un Fethi Akdeniz Dengesini Nasıl Değiştirdi?",
  "İnebahtı Yenilgisi Osmanlı Donanmasını Bitirdi mi?",
  "Osmanlı’da Tımar Sistemi Orduyu Nasıl Besliyordu?",
  "Haçova’da Savaşın Seyri Nasıl Tersine Döndü?",
  "Ekber ve Erşed Sistemi Taht Kavgalarını Bitirdi mi?",
  "Hotin Seferi Genç Osman’ın Sonunu Nasıl Hazırladı?",
  "Bağdat’ın Geri Alınması IV. Murad İçin Neden Önemliydi?",
  "Girit Savaşı Neden 24 Yıl Sürdü?",
  "Köprülü Reformları Devleti Nasıl Toparladı?",
  "II. Viyana Kuşatması Sonrası Savunma Hattı Neden Çözüldü?",
  "Karlofça Antlaşması Osmanlı İçin Neden Bir Dönüm Noktasıydı?",
  "Prut Seferi’nde Rus Ordusu Nasıl Kuşatıldı?",
  "Patrona Halil İsyanı Lale Devri’ni Nasıl Bitirdi?",
  "Humbaracı Ahmed Paşa Osmanlı Ordusunda Neyi Değiştirdi?",
  "Küçük Kaynarca Antlaşması Neden Bu Kadar Ağırdı?",
  "Nizam-ı Cedid Ordusu Neden Kalıcı Olamadı?",
  "Vak’a-i Hayriye Sonrası Yeni Ordu Nasıl Kuruldu?",
  "Tanzimat Fermanı Osmanlı Tebaasına Ne Vaat Etti?",
  "Islahat Fermanı Avrupa Baskısıyla mı İlan Edildi?",
  "Kırım Savaşı Osmanlı Maliyesini Nasıl Etkiledi?",
  "93 Harbi Osmanlı’nın Balkanlarını Nasıl Değiştirdi?",
  "Balkan Savaşları’nda Rumeli Neden Bu Kadar Hızlı Kaybedildi?",
  "Mondros Mütarekesi Osmanlı Ordusuna Ne Getirdi?",
];

const engagementIdeas = [
  "I. Murad Kosova’da Nasıl Öldü: Kaynaklar Aynı Şeyi mi Söylüyor?",
  "Yıldırım Bayezid Timur’un Esiri Olarak Nasıl Yaşadı?",
  "Çelebi Mehmed Neden ‘Osmanlı’nın İkinci Kurucusu’ Sayılır?",
  "II. Murad’ın Vasiyetinde Bursa’yı Seçmesinin Nedeni Neydi?",
  "Fatih’in Ölümü Zehirlenme miydi: Belgeler Ne Söylüyor?",
  "II. Bayezid ile Cem Sultan Mücadelesinde Kaynaklar Ne Söylüyor?",
  "Yavuz’un Ölümü Neden Ordudan Gizlendi?",
  "Kanuni’nin Son Seferinde Ölümü Nasıl Saklandı?",
  "II. Selim Gerçekten ‘Sarı Selim’ miydi?",
  "III. Murad’ın Çocuklarının Sayısı Hakkındaki İddialar Doğru mu?",
  "III. Mehmed’in Kardeş Katli Kararı Nasıl Açıklanıyordu?",
  "I. Ahmed Sultanahmet Camii’ni Neden Yaptırdı?",
  "Genç Osman’ın Son Saatlerinde Ne Yaşandı?",
  "IV. Murad’ın Yasakları Gerçekte Ne Kadar Sertti?",
  "Sultan İbrahim Hakkındaki ‘Deli’ Anlatısı Ne Kadar Güvenilir?",
  "IV. Mehmed Neden ‘Avcı’ Lakabıyla Anıldı?",
  "II. Süleyman Tahta Çıkarken Neden Ağladı?",
  "II. Mustafa Edirne’de Yaşamayı Neden Tercih Etti?",
  "III. Ahmed’in Lale Devri Gerçekten Sadece Eğlence miydi?",
  "I. Mahmud Döneminde Matbaa Neden Tartışma Yarattı?",
  "III. Mustafa’nın Kâhinlere İnandığı İddiası Nereden Geliyor?",
  "I. Abdülhamid’in Ölümü Neden Cephe Haberine Bağlanır?",
  "III. Selim’in Besteleri Padişahlığını Nasıl Yansıtıyor?",
  "II. Mahmud’a Neden ‘Gavur Padişah’ Dendi?",
  "Abdülmecid’in Dolmabahçe Sarayı Kararı Neden Tartışıldı?",
  "Abdülaziz’in Ölümü İntihar mıydı: İki Görüş Ne Söylüyor?",
  "V. Murad’ın Tahttan İndirilmesinde Hangi Raporlar Etkili Oldu?",
  "II. Abdülhamid’in ‘Kızıl Sultan’ Lakabı Nereden Geliyor?",
  "V. Mehmed Reşad Neden Sembolik Bir Padişah Sayılır?",
  "VI. Mehmed’in Ülkeden Ayrılışı Kaçış mıydı, Zorunluluk mu?",
];

const longBiographies = [
  "I. Murad’ın Hayatı: Beylikten Balkan İmparatorluğuna 7 Dönüm Noktası",
  "Yıldırım Bayezid’in Hayatı: Hızlı Yükselişten Ankara Savaşı’na",
  "Çelebi Mehmed’in Hayatı: Dağılan Devleti Yeniden Birleştiren Padişah",
  "II. Murad’ın Hayatı: Tahtı İki Kez Bırakan Savaşçı Padişah",
  "Fatih Sultan Mehmed’in Hayatı: Tahta Çıkışından Son Seferine",
];

const shortLibraries = [discoveryIdeas, conversionIdeas, engagementIdeas];

const FACT_BANK: Array<[RegExp, string]> = [
  [/edirne/i, "Edirne, Balkan seferlerinin merkezine yakınlığı ve Meriç üzerindeki stratejik konumuyla öne çıktı. Başkentin buraya taşınması, Osmanlı'nın yalnızca Anadolu'da kalan bir beylik olmadığını açıkça gösterdi."],
  [/fetret/i, "Ankara Savaşı'ndan sonra şehzadeler yaklaşık on bir yıl boyunca taht için mücadele etti. Çelebi Mehmed rakiplerini sırayla etkisizleştirip merkezi otoriteyi yeniden kurduğu için ikinci kurucu olarak anıldı."],
  [/tahtı neden iki kez|tahta dönüş/i, "II. Murad tahtı genç Mehmed'e bıraktığında hem içeride hem dışarıda büyük baskı oluştu. Haçlı tehdidi ve devlet adamlarının çağrısı onu yeniden ordunun başına, ardından tahta dönmeye zorladı."],
  [/istanbul kuşat|şahi top/i, "Kuşatma yalnızca büyük toplarla kazanılmadı. Boğazın kesilmesi, donanmanın Haliç'e indirilmesi ve kara surlarına aralıksız baskı kurulması aynı planın birbirini tamamlayan parçalarıydı."],
  [/cem sultan/i, "Cem Sultan'ın Avrupa'da tutulması, II. Bayezid'in dış politikasını yıllarca sınırladı. Avrupa sarayları Cem'i askeri bir rakipten çok, Osmanlı'ya karşı kullanılabilecek siyasi bir koz olarak gördü."],
  [/çaldıran/i, "Çaldıran'da Osmanlı'nın ateşli silahları ve düzenli savaş hattı belirleyici oldu. Yavuz'un asıl riski ise uzun ikmal hattına rağmen ordusunu hızla doğuya götürmesiydi."],
  [/belgrad/i, "Belgrad, Orta Avrupa yollarını ve Tuna hattını kontrol eden güçlü bir kaleydi. Kanuni'nin ilk büyük hedef olarak burayı seçmesi, sonraki Macaristan seferlerinin kapısını açtı."],
  [/ordunun başında sefere çıkmadı|sarı selim/i, "II. Selim döneminde seferlerin yönetimi büyük ölçüde sadrazam Sokollu Mehmed Paşa ve serdarlara bırakıldı. Bu durum, padişahın ordunun başında bulunması geleneğinde belirgin bir değişimdi."],
  [/saray neden büyüdü|çocuklarının sayısı/i, "III. Murad döneminde hanedan, saray görevlileri ve harem çevresi genişledi. Bu büyüme yalnızca kişisel tercihlerle değil, devlet işlerinin saray merkezinde daha kalabalık bir ağla yürütülmesiyle ilgiliydi."],
  [/eğri sefer|haçova/i, "1596 seferinde Eğri Kalesi alındı; ardından Haçova'da Osmanlı ordusu dağılma tehlikesi yaşadı. Cephe gerisindeki birliklerin karşı saldırısı savaşın yönünü beklenmedik biçimde çevirdi."],
  [/veraset|ekber ve erşed/i, "I. Ahmed'den sonra hanedanın en yaşlı ve uygun erkeğinin tahta çıkması güç kazandı. Bu değişim şehzadelerin sancakta yönetim tecrübesi kazanması geleneğini zayıflatırken kardeş katli riskini azalttı."],
  [/genç osman|hotin/i, "Hotin Seferi'nde yaşanan disiplin sorunları Genç Osman'ın yeni bir askeri güç kurma düşüncesini keskinleştirdi. Yeniçeriler bu hazırlığı kendi varlıklarına tehdit sayınca kriz padişahın tahttan indirilmesine kadar büyüdü."],
  [/bağdat/i, "Bağdat'ın geri alınması Osmanlı'nın doğu sınırı ve kutsal şehir yolları için büyük önem taşıyordu. IV. Murad sefere bizzat katılarak hem ordudaki otoritesini hem de merkezi gücü göstermek istedi."],
  [/köprülü/i, "Köprülü Mehmed Paşa görevi geniş yetkilerle kabul etti. Mali disiplin, liyakatli atamalar ve askeri baskı sayesinde kısa sürede merkezî otoriteyi toparladı; fakat yöntemleri oldukça sertti."],
  [/karlofça/i, "1699 Karlofça Antlaşması, Osmanlı'nın büyük ölçekte toprak bıraktığı ilk antlaşmalardan biriydi. Devlet artık yalnızca fetih planlayan taraf değil, Avrupa dengesinde kayıpları sınırlamaya çalışan bir güçtü."],
  [/patrona halil|lale devri/i, "1730 isyanı ekonomik sıkıntılar, yönetici çevrelere tepki ve savaş yenilgileriyle büyüdü. Patrona Halil'in öncülüğündeki hareket III. Ahmed'in tahttan çekilmesiyle Lale Devri'ni bitirdi."],
  [/nizam-ı cedid/i, "III. Selim Avrupa tarzında eğitim alan ve ayrı gelir kaynakları bulunan yeni bir ordu kurdu. Yeniçerilerin, bazı ulema çevrelerinin ve çıkarı bozulan grupların direnci reformu siyasi bir krize dönüştürdü."],
  [/yeniçeri ocağını nasıl kaldırdı|vak.?a-i hayriye/i, "II. Mahmud önce kendisine bağlı yeni birlikler ve siyasi destek hazırladı. 1826'daki ayaklanma sırasında Yeniçeri kışlaları topa tutuldu, ocak kaldırıldı ve yerine Asakir-i Mansure kuruldu."],
  [/tanzimat/i, "1839 Tanzimat Fermanı can, mal ve namus güvenliği; düzenli vergi ve kurallı askerlik vaat ediyordu. Amaç hem merkezi devleti güçlendirmek hem de içeride ve dışarıda meşruiyet sağlamaktı."],
  [/donanma/i, "Abdülaziz döneminde donanma büyük gemilerle hızla genişletildi ve dünyanın sayılı filolarından biri hâline geldi. Ancak gemilerin alım ve bakım maliyeti devlet bütçesi üzerinde ağır bir yük oluşturdu."],
  [/93 gün|v\. murad/i, "V. Murad 1876'da tahta çıktı; sağlık durumu devlet işlerini sürdüremeyecek düzeyde görüldü. Doktor raporları ve siyasi kriz sonucunda saltanatı yalnızca doksan üç gün sürdü."],
  [/telgraf/i, "II. Abdülhamid telgrafı yalnızca haberleşme aracı olarak değil, taşradan hızlı bilgi alma ve yönetimi merkezde toplama yöntemi olarak kullandı. Hatlar demiryolları ve idari merkezlerle birlikte genişledi."],
  [/kosova/i, "Kosova zaferi Osmanlı'nın Balkanlardaki siyasi üstünlüğünü güçlendirdi. I. Murad'ın savaş alanında ölmesi ise zaferin hemen ardından hanedan devamlılığı sorununu gündeme getirdi."],
  [/ankara savaşı/i, "Yıldırım Bayezid'in ordusundaki bazı Anadolu birlikleri savaş sırasında Timur tarafına geçti. Susuzluk, yorgunluk ve ordunun kanatlarındaki çözülme Osmanlı planını bozdu."],
  [/varna/i, "II. Murad tahtı oğluna bıraktıktan sonra Haçlı ordusunun ilerleyişi üzerine yeniden çağrıldı. Varna'daki zafer, genç Mehmed'in değil deneyimli Murad'ın yönetimde kalmasını bir süre daha gerekli kıldı."],
  [/otlukbeli/i, "1473 Otlukbeli Savaşı'nda Osmanlı'nın düzenli ateşli silah gücü Akkoyunlu ordusuna üstün geldi. Zafer, Fatih'in Anadolu'daki merkezi otoritesini güçlendirdi."],
  [/rodos/i, "Rodos, Doğu Akdeniz deniz yollarını tehdit eden Saint Jean Şövalyelerinin merkeziydi. 1522'de adanın alınması, Mısır ve Suriye yollarının güvenliğini artırdı."],
  [/inebahtı/i, "İnebahtı'da Osmanlı donanması çok ağır kayıp verdi; fakat ertesi yıl büyük ölçüde yeniden kuruldu. Asıl kayıp gemiden çok, deneyimli denizci ve komutanların yerinin kolay doldurulamamasıydı."],
  [/tımar/i, "Tımar sistemi, vergi gelirini doğrudan maaş vermeden sipahilere tahsis ediyordu. Sipahi bunun karşılığında atlı asker yetiştiriyor ve sefer zamanı ordunun bölgesel gücünü oluşturuyordu."],
  [/girit savaşı/i, "Girit Savaşı'nın yirmi dört yıl sürmesinin temel nedeni Venedik'in deniz üstünlüğü ve Kandiye'nin güçlü savunmasıydı. Osmanlı kuşatmayı sürdürürken ikmal hatları sürekli baskı altında kaldı."],
  [/prut/i, "1711'de Osmanlı kuvvetleri Prut Nehri yakınında Rus ordusunu çevreledi. Çatışmalar ve ikmal sıkıntısı sonunda Rusya anlaşmayı kabul ederek Azak'ı geri verdi."],
  [/küçük kaynarca/i, "1774 Küçük Kaynarca Antlaşması Kırım Hanlığı'nı Osmanlı'dan kopardı ve Rusya'ya önemli siyasi haklar sağladı. Bu sonuç Karadeniz dengesini kalıcı biçimde değiştirdi."],
  [/kırım savaşı/i, "Kırım Savaşı Osmanlı'yı İngiltere ve Fransa ile aynı cephede Rusya'ya karşı savaştırdı. Savaş giderleri için alınan ilk dış borçlar mali bağımlılığın başlangıcı oldu."],
  [/93 harbi/i, "1877-78 savaşı Osmanlı için ağır askeri ve demografik sonuçlar doğurdu. Balkanlarda toprak kayıpları yaşanırken yüz binlerce Müslüman göçmen Anadolu'ya yöneldi."],
  [/balkan savaşları/i, "Balkan devletlerinin eş zamanlı saldırısı, Osmanlı ordusunun seferberlik ve komuta sorunlarıyla birleşti. Rumeli'deki toprakların büyük bölümü birkaç ay içinde kaybedildi."],
  [/mondros/i, "Mondros Mütarekesi Osmanlı ordularının terhisini ve stratejik noktaların İtilaf Devletlerince işgal edilebilmesini öngörüyordu. Bu maddeler kısa sürede fiili işgallerin dayanağı oldu."],
  [/fatih.*ölüm|zehirlenme/i, "Fatih 1481'de yeni bir sefere çıkarken Gebze yakınında öldü. Zehirlenme iddiası yüzyıllardır tartışılsa da kesin kanıt yok; çağdaş bilgiler hastalık ihtimalini de güçlü tutuyor."],
  [/kanuni.*ölüm|son sefer/i, "Kanuni Zigetvar Kuşatması sırasında öldüğünde haber ordunun düzeni bozulmasın diye bir süre gizlendi. Sadrazam Sokollu Mehmed Paşa dönüş hazırlıklarını kontrollü biçimde yürüttü."],
];

type ShortObjective = "İzlenme" | "Abone" | "Beğeni";

function istanbulTodayAtNoon() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  return new Date(`${get("year")}-${get("month")}-${get("day")}T12:00:00+03:00`);
}

function titleFact(title: string) {
  return FACT_BANK.find(([rule]) => rule.test(title))?.[1]
    || "Bu olay tek bir kahraman ya da tek bir hatayla açıklanamaz. Dönemin askeri imkânları, saray dengeleri ve rakip güçlerin kararları sonucu birlikte şekillendirdi.";
}

function strongHook(title: string) {
  return `${title.replace(/\?$/, "")}… Cevap, ilk bakışta göründüğünden daha karmaşık.`;
}

function objectiveCta(objective: ShortObjective) {
  if (objective === "Abone") return "Osmanlı tarihini nedenleri ve sonuçlarıyla öğrenmek için abone ol; sıradaki bölümde bu kararın devamına bakacağız.";
  if (objective === "Beğeni") return "Sence bu karar doğru muydu? Katılıyorsan videoyu beğen; farklı düşünüyorsan gerekçeni yorumlara yaz.";
  return "Sonuç değişmedi: küçük görünen bu karar, Osmanlı'nın sonraki adımını belirleyen kırılma noktalarından biri oldu.";
}

function buildVoiceover(title: string, objective: ShortObjective) {
  const hook = strongHook(title);
  const fact = titleFact(title);
  const bridge = "Buradaki asıl ayrıntı şu: sonucu yalnızca son ana bakarak değil, o kararı zorlayan şartlarla birlikte okumak gerekiyor.";
  const evidence = "Bu yüzden olayı değerlendirirken tek bir kişiye odaklanmak yerine, kararın öncesini ve ortaya çıkardığı uzun vadeli sonucu birlikte görmek gerekir.";
  const cta = objectiveCta(objective);
  const voiceover = `${hook} ${fact} ${bridge} ${evidence} ${cta}`;
  const wordCount = voiceover.trim().split(/\s+/).length;
  return {
    hook,
    voiceover,
    cta,
    estimatedSeconds: Math.max(30, Math.min(50, Math.round(wordCount / 2.25))),
  };
}

function hashtagsFor(title: string) {
  const ruler = detectOttomanRuler(title).replace(/[^\p{L}\p{N}]/gu, "");
  const topic = detectHistoryTopic(title).replace(/[^\p{L}\p{N}]/gu, "");
  return [...new Set(["#OsmanlıTarihi", ruler !== "DiğerOsmanlı" ? `#${ruler}` : "#Osmanlı", `#${topic}`, "#Tarih", "#Shorts"])];
}

function objectiveScore(state: ChannelState, title: string, objective: ShortObjective) {
  const topic = detectHistoryTopic(title);
  const ruler = detectOttomanRuler(title);
  const matches = state.videos.filter((video) => detectHistoryTopic(video.title) === topic || detectOttomanRuler(video.title) === ruler);
  const values = matches.map((video) => {
    if (objective === "Abone") return ((video.subscribersGained - video.subscribersLost) / Math.max(video.views, 1)) * 1000;
    if (objective === "Beğeni") return (video.likes / Math.max(video.views, 1)) * 1000;
    const age = Math.max(1, (Date.now() - new Date(video.publishedAt).getTime()) / 86_400_000);
    return (video.engagedViews ?? video.views) / age;
  });
  const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  return { value: average, samples: matches.length };
}

function pickIdea(
  state: ChannelState,
  objective: ShortObjective,
  strategyMode: PlanItem["strategyMode"],
  usedTitles: string[],
  usedRulersToday: Set<string>,
  seed: number,
) {
  const libraryIndex = objective === "İzlenme" ? 0 : objective === "Abone" ? 1 : 2;
  const unused = shortLibraries[libraryIndex].filter((title) => !usedTitles.includes(title));
  const differentRuler = unused.filter((title) => !usedRulersToday.has(detectOttomanRuler(title)));
  const pool = differentRuler.length ? differentRuler : unused;
  const candidates = pool
    .map((title) => {
      const performance = objectiveScore(state, title, objective);
      const similarity = Math.max(0, ...state.videos.map((video) => titleSimilarity(title, video.title)), ...usedTitles.map((used) => titleSimilarity(title, used)));
      const novelty = 1 - similarity;
      const testBonus = strategyMode === "Kontrollü test" ? Math.max(0, 5 - performance.samples) * 18 : 0;
      const evidenceBonus = strategyMode === "Kazananı büyüt" ? Math.min(8, performance.samples) * 8 : 0;
      return { title, performance, score: performance.value + novelty * 35 + testBonus + evidenceBonus };
    })
    .filter((candidate) => candidate.title && candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, "tr"));
  return candidates[seed % Math.max(1, Math.min(candidates.length, 5))]?.title
    || unused[0]
    || shortLibraries[libraryIndex][seed % shortLibraries[libraryIndex].length];
}

export function generateMonthlyPlan(state: ChannelState, adaptiveSchedule?: WeeklyScheduleDay[]): PlanItem[] {
  const start = istanbulTodayAtNoon();
  const plan: PlanItem[] = [];
  let biographyIndex = 0;
  const scheduleByDay = adaptiveSchedule || buildAdaptiveWeeklySchedule(state);
  const usedTitles: string[] = [];
  const dataBasis = state.videos.length
    ? `${state.videos.filter((video) => video.contentType === "SHORT").length} canlı Shorts örneğine göre`
    : "başlangıç testi olarak";

  for (let dayIndex = 0; dayIndex < 30; dayIndex += 1) {
    const date = addDays(start, dayIndex);
    const dateKey = format(date, "yyyy-MM-dd");
    const schedule = scheduleByDay.find((item) => item.day === date.getDay());
    if (!schedule) continue;

    const usedRulersToday = new Set<string>();
    const slots = schedule.shortSlots || schedule.shortsTimes.map((time, index) => ({
      time,
      objective: (["İzlenme", "Abone", "Beğeni"] as ShortObjective[])[index],
      score: 50,
      sampleSize: 0,
      reason: schedule.evidence,
      change: "Test" as const,
    }));
    slots.forEach((slot, slotIndex) => {
      const weekIndex = Math.floor(dayIndex / 7);
      const strategyMode: PlanItem["strategyMode"] = slotIndex === (dayIndex + weekIndex) % 3
        ? "Kontrollü test"
        : slotIndex === 0
          ? "Kazananı büyüt"
          : "Denge";
      const title = pickIdea(state, slot.objective, strategyMode, usedTitles, usedRulersToday, dayIndex + slotIndex * 11 + weekIndex * 3);
      const content = buildVoiceover(title, slot.objective);
      const hashtags = hashtagsFor(title);
      usedTitles.push(title);
      usedRulersToday.add(detectOttomanRuler(title));
      plan.push({
        id: `${dateKey}-short-${slotIndex}`,
        date: dateKey,
        dayLabel: format(date, "EEEE", { locale: tr }),
        format: "Shorts",
        title,
        hook: content.hook,
        duration: `${content.estimatedSeconds} sn`,
        publishTime: slot.time,
        pillar: detectHistoryTopic(title),
        objective: slot.objective,
        priority: dayIndex < 7 ? "Yüksek" : "Normal",
        reason: `${dataBasis}; ${slot.reason.toLocaleLowerCase("tr-TR")} Bu içerik ${strategyMode.toLocaleLowerCase("tr-TR")} grubunda.`,
        voiceover: content.voiceover,
        description: `${title}\n\nBu kısa videoda olayın nedenini, kırılma anını ve Osmanlı üzerindeki sonucunu sade biçimde anlatıyoruz.\n\n${hashtags.join(" ")}`,
        hashtags,
        cta: content.cta,
        estimatedSeconds: content.estimatedSeconds,
        strategyMode,
      });
    });

    if (schedule.longVideoTime) {
      const title = longBiographies[biographyIndex % longBiographies.length];
      plan.push({
        id: `${dateKey}-long-biography`,
        date: dateKey,
        dayLabel: format(date, "EEEE", { locale: tr }),
        format: "Uzun Video",
        title,
        hook: "İlk 20 saniyede padişahın hayatındaki en büyük çelişkiyi ve videonun cevaplayacağı üç soruyu göster.",
        duration: "10–14 dk",
        publishTime: schedule.longVideoTime,
        pillar: "Padişahın Hayatı",
        objective: "İzlenme Süresi",
        priority: "Kritik",
        reason: "Perşembe kanalın en güçlü günü; 20:30 uzun video için dört haftalık kontrollü test saatidir.",
        voiceover: "Açılışta padişahın hayatındaki en büyük çelişkiyi tek cümlede kur. Ardından çocukluğu ve tahta çıkışı, üç dönüm noktası, en tartışmalı kararı, son yılları ve bıraktığı mirası kronolojik olarak anlat.",
        description: `${title}\n\nBu bölümde padişahın hayatını kronolojik bir anlatıyla; kararları, savaşları, krizleri ve bıraktığı miras üzerinden inceliyoruz.\n\n#OsmanlıTarihi #Padişahlar #Tarih`,
        hashtags: ["#OsmanlıTarihi", "#Padişahlar", "#Tarih"],
        cta: "Bu serinin sonraki padişahını kaçırmamak için abone ol.",
        estimatedSeconds: 720,
        strategyMode: "Kazananı büyüt",
      });
      biographyIndex += 1;
    }
  }

  return plan.sort((left, right) => left.date.localeCompare(right.date) || left.publishTime.localeCompare(right.publishTime));
}

export function planReviewStamp(weeklySchedule: WeeklyScheduleDay[]) {
  return { weekKey: currentIstanbulWeekKey(), generatedAt: new Date().toISOString(), weeklySchedule };
}

export async function enhancePlanWithOllama(state: ChannelState, plan: PlanItem[]): Promise<PlanItem[]> {
  const baseUrl = process.env.OLLAMA_URL;
  const model = process.env.OLLAMA_MODEL;
  if (!baseUrl || !model) return plan;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: false,
        format: "json",
        prompt: [
          "Sen yalnızca Osmanlı tarihi anlatan Türkçe YouTube kanalının editörüsün.",
          "Aşağıdaki planın SADECE title alanlarını somut, kaynaklandırılabilir ve merak uyandırıcı hâle getir.",
          "Padişah, olay, kurum veya birincil kaynak belirt; tarihsel iddia uydurma.",
          "Aynı padişahı aynı gün tekrar etme, mevcut kanal başlıklarını kopyalama ve format/saat sayısını değiştirme.",
          "Aynı sayıda öğeyi {id,title} JSON dizisi olarak döndür.",
          `Kanal: ${state.channel.title}`,
          JSON.stringify(plan.map(({ id, title, pillar, format }) => ({ id, title, pillar, format }))),
        ].join("\n"),
      }),
    });
    if (!response.ok) return plan;
    const payload = (await response.json()) as { response?: string };
    const improved = JSON.parse(payload.response || "[]") as Array<{ id: string; title: string }>;
    const byId = new Map(improved.map((item) => [item.id, item.title]));
    return plan.map((item) => ({ ...item, title: byId.get(item.id) || item.title }));
  } catch {
    return plan;
  } finally {
    clearTimeout(timer);
  }
}
