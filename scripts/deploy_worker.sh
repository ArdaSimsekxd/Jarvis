#!/usr/bin/env bash
# Jarvis botunu Cloudflare'e kurar ve Telegram'ı ona bağlar. GitHub Actions içinde çalışır.
# Repo herkese açık olduğu için kayıtlara hesap kimliği ya da adres yazmamaya dikkat eder.
set -euo pipefail

: "${CLOUDFLARE_API_TOKEN:?eksik}" "${TELEGRAM_BOT_TOKEN:?eksik}" "${TELEGRAM_CHAT_ID:?eksik}"

CF=https://api.cloudflare.com/client/v4
cf() { curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" "$@"; }
fail() { echo "::error::$1"; exit 1; }

echo "1/6 Cloudflare hesabı bulunuyor"
ACCOUNT=$(cf "$CF/accounts" | jq -r '.result[0].id // empty')
[ -n "$ACCOUNT" ] || fail "Cloudflare hesabı okunamadı. CLOUDFLARE_API_TOKEN doğru mu, hesap e-postası doğrulandı mı?"
echo "::add-mask::$ACCOUNT"
export CLOUDFLARE_ACCOUNT_ID="$ACCOUNT"

echo "2/6 Hatırlatma deposu hazırlanıyor"
KV=$(cf "$CF/accounts/$ACCOUNT/storage/kv/namespaces?per_page=100" | jq -r '.result[]? | select(.title=="jarvis") | .id')
if [ -z "$KV" ]; then
  KV=$(cf -X POST "$CF/accounts/$ACCOUNT/storage/kv/namespaces" -d '{"title":"jarvis"}' | jq -r '.result.id // empty')
fi
[ -n "$KV" ] || fail "KV deposu oluşturulamadı. Anahtar 'Edit Cloudflare Workers' şablonuyla mı üretildi?"
echo "::add-mask::$KV"
sed -i "s/__KV_ID__/$KV/" worker/wrangler.toml

echo "3/6 workers.dev adresi hazırlanıyor"
SUB=$(cf "$CF/accounts/$ACCOUNT/workers/subdomain" | jq -r '.result.subdomain // empty')
if [ -z "$SUB" ]; then
  SUB="jarvis-${ACCOUNT:0:10}"
  cf -X PUT "$CF/accounts/$ACCOUNT/workers/subdomain" -d "{\"subdomain\":\"$SUB\"}" | jq -e '.success' >/dev/null \
    || fail "workers.dev adresi oluşturulamadı."
fi
echo "::add-mask::$SUB"

echo "4/6 Bot yükleniyor"
WEBHOOK_SECRET=$(printf '%s' "jarvis-webhook-$TELEGRAM_BOT_TOKEN" | sha256sum | cut -c1-48)
echo "::add-mask::$WEBHOOK_SECRET"
cd worker
npx --yes wrangler@4 deploy
# DISPATCH_TOKEN varsa bot zamanlayıcı olur: Canvas/mail kontrolünü ve sabah özetini kendisi başlatır.
[ -n "${DISPATCH_TOKEN:-}" ] || echo "::notice::DISPATCH_TOKEN girilmemiş; zamanlama GitHub'ın kendi (gecikebilen) zamanlayıcısında kalıyor."
jq -n --arg a "$TELEGRAM_BOT_TOKEN" --arg b "$TELEGRAM_CHAT_ID" --arg c "$WEBHOOK_SECRET" --arg d "${DISPATCH_TOKEN:-}" \
  '{TELEGRAM_BOT_TOKEN:$a, TELEGRAM_CHAT_ID:$b, WEBHOOK_SECRET:$c} + (if $d != "" then {GH_TOKEN:$d} else {} end)' > "$RUNNER_TEMP/secrets.json"
npx --yes wrangler@4 secret bulk "$RUNNER_TEMP/secrets.json"
rm -f "$RUNNER_TEMP/secrets.json"
cd ..

echo "5/6 Telegram bota bağlanıyor"
TG="https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN"
curl -sS "$TG/setWebhook" \
  --data-urlencode "url=https://jarvis.$SUB.workers.dev/telegram" \
  --data-urlencode "secret_token=$WEBHOOK_SECRET" \
  --data-urlencode 'allowed_updates=["message"]' | jq -e '.ok' >/dev/null \
  || fail "Telegram webhook ayarlanamadı."

echo "6/6 Komut menüsü ayarlanıyor"
curl -sS "$TG/setMyCommands" -H "Content-Type: application/json" -d '{"commands":[
  {"command":"yemek","description":"Bugünün yemek menüsü"},
  {"command":"hatirlat","description":"Hatırlatma ekle: /hatirlat 15:00 kütüphane"},
  {"command":"hatirlatmalar","description":"Bekleyen hatırlatmalar"},
  {"command":"sil","description":"Hatırlatma sil: /sil 1"},
  {"command":"yardim","description":"Bütün komutlar"}
]}' | jq -e '.ok' >/dev/null || echo "::warning::Komut menüsü ayarlanamadı (bot yine de çalışır)."

echo "Kurulum tamam."
