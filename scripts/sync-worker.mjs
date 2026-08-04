const baseUrl = process.env.SYNC_BASE_URL || "http://localhost:3000";
const pollMinutes = Number(process.env.SYNC_POLL_MINUTES || 30);

async function requestSync() {
  try {
    const response = await fetch(`${baseUrl}/api/sync?auto=1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const payload = await response.json();
    const message = payload.error || payload.reason || "Canlı veriler yenilendi";
    console.log(`[SYNC] ${new Date().toLocaleString("tr-TR")} — ${message}`);
  } catch {
    console.log("[SYNC] Panel açılmayı bekliyor.");
  }
}

setTimeout(requestSync, 15_000);
setInterval(requestSync, Math.max(5, pollMinutes) * 60_000);
