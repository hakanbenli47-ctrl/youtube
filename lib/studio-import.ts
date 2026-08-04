import "server-only";

import AdmZip from "adm-zip";
import { parse } from "csv-parse/sync";
import type { ChannelState, DailyMetric, VideoMetric } from "./schema";
import { detectHistoryTopic } from "./history";

function numberValue(value: unknown) {
  if (value === null || value === undefined || value === "") return 0;
  return Number(String(value).replace(",", ".")) || 0;
}

function isoDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? new Date().toISOString().slice(0, 10)
    : parsed.toISOString().slice(0, 10);
}

function parseCsv(text: string) {
  return parse(text, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
  }) as Record<string, string>[];
}

export function importStudioZip(buffer: Buffer, current: ChannelState): ChannelState {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  const tableEntry = entries.find((entry) => entry.entryName.includes("Tablo verileri"));
  const totalsEntry = entries.find((entry) => entry.entryName.includes("Toplamlar"));

  if (!tableEntry || !totalsEntry) {
    throw new Error("ZIP içinde 'Tablo verileri.csv' ve 'Toplamlar.csv' bulunamadı.");
  }

  const tableRows = parseCsv(tableEntry.getData().toString("utf8"));
  const dailyRows = parseCsv(totalsEntry.getData().toString("utf8"));
  const totalRow = tableRows.find((row) => row["İçerik"] === "Toplam");

  const videos: VideoMetric[] = tableRows
    .filter((row) => row["İçerik"] && row["İçerik"] !== "Toplam")
    .map((row) => {
      const views = numberValue(row["Görüntüleme"]);
      const watchHours = numberValue(row["İzlenme süresi (saat)"]);
      const durationSeconds = numberValue(row["Süre"]);
      const avgViewDurationSeconds = views > 0 ? (watchHours * 3600) / views : 0;
      const title = row["Video başlığı"] || "Başlıksız video";
      const id = row["İçerik"];
      const looksLikeShort =
        /#shorts|#shortvideo/i.test(title) ||
        (durationSeconds > 0 && durationSeconds <= 180);

      return {
        id,
        title,
        publishedAt: isoDate(row["Videonun yayınlanma tarihi"]),
        durationSeconds,
        contentType: looksLikeShort ? "SHORT" : "LONG",
        views,
        watchHours,
        subscribersGained: numberValue(row["Aboneler"]),
        subscribersLost: 0,
        impressions: row["Gösterimler"] === "" ? null : numberValue(row["Gösterimler"]),
        ctr:
          row["Gösterim tıklama oranı (%)"] === ""
            ? null
            : numberValue(row["Gösterim tıklama oranı (%)"]),
        avgViewDurationSeconds,
        avgViewPercentage:
          durationSeconds > 0 ? (avgViewDurationSeconds / durationSeconds) * 100 : 0,
        likes: 0,
        comments: 0,
        topic: detectHistoryTopic(title),
      };
    });

  const daily: DailyMetric[] = dailyRows.map((row) => ({
    date: row["Tarih"],
    views: numberValue(row["Görüntüleme"]),
    watchMinutes: 0,
    subscribersGained: 0,
    subscribersLost: 0,
    likes: 0,
    comments: 0,
    shares: 0,
  }));

  const views = numberValue(totalRow?.["Görüntüleme"]) || videos.reduce((a, b) => a + b.views, 0);
  const watchHours =
    numberValue(totalRow?.["İzlenme süresi (saat)"]) ||
    videos.reduce((a, b) => a + b.watchHours, 0);
  const subscribers = numberValue(totalRow?.["Aboneler"]);
  const impressions = numberValue(totalRow?.["Gösterimler"]);
  const ctr = numberValue(totalRow?.["Gösterim tıklama oranı (%)"]);

  return {
    ...current,
    channel: {
      ...current.channel,
      subscriberCount: current.channel.subscriberCount,
      videoCount: Math.max(current.channel.videoCount, videos.length),
      viewCount: views,
    },
    totals: {
      views,
      watchHours,
      netSubscribers: subscribers,
      impressions,
      ctr,
    },
    videos,
    daily,
    sync: {
      ...current.sync,
      lastStudioImport: new Date().toISOString(),
      status: "ready",
      message: `${videos.length} içerik Studio raporundan işlendi`,
    },
  };
}
