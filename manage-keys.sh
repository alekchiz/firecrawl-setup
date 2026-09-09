#!/usr/bin/env bash
# Управление персональными ключами доступа к воркерам.
# Выдача/отзыв действуют СРАЗУ (без перезапуска контейнеров): воркер читает
# tokens.txt на каждый запрос.
#
# Примеры:
#   ./manage-keys.sh gen alice      # выдать ключ алисе
#   ./manage-keys.sh list            # список
#   ./manage-keys.sh revoke <token|user>
#
# Формат tokens.txt:  <token> <user>

set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF="${DIR}/tokens.txt"

gen_token() { openssl rand -hex 20; }

case "${1:-help}" in
  gen)
    user="${2:-}"
    [ -n "$user" ] || { echo "укажи пользователя: $0 gen <user>"; exit 1; }
    touch "$TF"; chmod 600 "$TF"
    if grep -qE " ${user}$" "$TF"; then echo "пользователь '$user' уже есть:"; list; exit 1; fi
    tok="$(gen_token)"
    printf '%s %s\n' "$tok" "$user" >> "$TF"
    echo "Выдан ключ для '${user}':"
    echo "  AUTH_TOKEN=${tok}"
    ;;
  list)
    touch "$TF"
    if [ ! -s "$TF" ]; then echo "(нет ключей)"; exit 0; fi
    if command -v column >/dev/null 2>&1; then
        (echo "TOKEN USER"; cat "$TF") | column -t
    else
        echo "TOKEN USER"; cat "$TF"
    fi
    ;;
  revoke)
    key="${2:-}"
    [ -n "$key" ] || { echo "укажи: $0 revoke <token|user>"; exit 1; }
    [ -f "$TF" ] || { echo "файла токенов нет"; exit 1; }
    sed -i "/^${key} /d; / ${key}$/d; /^${key}$/d" "$TF"
    echo "Отозван: $key"
    ;;
  help|*) 
    echo "USAGE: $0 gen <user> | list | revoke <token|user>"
    ;;
esac
