export function turkishUiMessage(value: unknown, fallback = "Bir hata oluştu.") {
  const raw = value instanceof Error ? value.message : typeof value === "string" ? value : "";
  const message = raw.trim();
  if (!message) return fallback;

  const normalized = message.toLocaleLowerCase("en-US");
  if (normalized.includes("the string did not match the expected pattern")) {
    return "İşlem sırasında beklenmeyen bir veri biçimiyle karşılaşıldı. Sayfayı yenileyip tekrar dene.";
  }
  if (normalized.includes("failed to fetch") || normalized.includes("networkerror")) {
    return "Sunucuya ulaşılamadı. İnternet bağlantını kontrol edip tekrar dene.";
  }
  if (normalized.includes("load failed")) {
    return "İstek tamamlanamadı. Sayfayı yenileyip tekrar dene.";
  }
  if (normalized.includes("abort") || normalized.includes("timed out") || normalized.includes("timeout")) {
    return "İşlem zaman aşımına uğradı. Birkaç saniye sonra tekrar dene.";
  }
  if (normalized.includes("invalid url") || normalized.includes("invalid uri")) {
    return "Bağlantı adresi geçersiz görünüyor. Sistem bağlantı ayarını kontrol et.";
  }
  if (normalized.includes("unauthorized") || normalized.includes("unauthenticated")) {
    return "YouTube oturumu doğrulanamadı. Bağlantı durumunu kontrol et.";
  }
  if (normalized.includes("forbidden")) {
    return "Bu işlem için gerekli YouTube izni bulunmuyor.";
  }

  return message;
}
