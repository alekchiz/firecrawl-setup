#!/usr/bin/env bash
# Впрыскивает IPv4-first для Node в Dockerfile-ы Firecrawl.
# Причина: у сервера нет IPv6-маршрута, а registry.npmjs.org (Cloudflare)
# отдаёт AAAA -> node/corepack висит на IPv6. NODE_OPTIONS=--dns-result-order=ipv4first
# заставляет ходить по IPv4.
#
# Использование: bash patch-ipv4.sh [/путь/к/firecrawl]
set -euo pipefail

FC_DIR="${1:-$HOME/app/firecrawl}"
if [ ! -d "$FC_DIR" ]; then
  echo "Не вижу каталог Firecrawl: $FC_DIR"
  exit 1
fi

count=0
while IFS= read -r df; do
  if grep -q 'dns-result-order=ipv4first' "$df"; then
    continue
  fi
  # вставляем ENV сразу после строки FROM *node*
  if grep -qE '^FROM .*node' "$df"; then
    perl -0pi -e 's/(^FROM [^\n]*node[^\n]*\n)/$1ENV NODE_OPTIONS=--dns-result-order=ipv4first\n/g' "$df"
    count=$((count+1))
    echo "pached: $df"
  fi
done < <(grep -rlE '^FROM .*node' "$FC_DIR" --include=Dockerfile* 2>/dev/null || true)

echo "Пропатчено Dockerfile: $count"
echo "Готово. Проверка:"
grep -rn 'dns-result-order' "$FC_DIR"/Dockerfile* apps 2>/dev/null | head