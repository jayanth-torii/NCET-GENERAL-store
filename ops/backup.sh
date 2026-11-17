#!/usr/bin/env bash
# Nightly backup of the Store POS database.
# - Daily dump:   /backups/daily/storepos_YYYY-MM-DD.dump   (30 kept)
# - Monthly dump: /backups/monthly/storepos_YYYY-MM.dump    (12 kept, taken on the 1st)
# - Optional cloud copy: set CLOUD_CMD to a command that receives the file path,
#   e.g. "rclone copy {} remote:storepos" with an encrypted rclone remote.
set -euo pipefail
mkdir -p /backups/daily /backups/monthly
DAY=$(date +%F)
FILE="/backups/daily/storepos_${DAY}.dump"
pg_dump -Fc -f "${FILE}.tmp"
mv "${FILE}.tmp" "${FILE}"
# verify the dump is readable
pg_restore --list "${FILE}" > /dev/null
if [ "$(date +%d)" = "01" ]; then
  cp "${FILE}" "/backups/monthly/storepos_$(date +%Y-%m).dump"
fi
ls -1t /backups/daily/*.dump   | tail -n +31 | xargs -r rm -f
ls -1t /backups/monthly/*.dump | tail -n +13 | xargs -r rm -f
if [ -n "${CLOUD_CMD:-}" ]; then
  eval "${CLOUD_CMD//\{\}/$FILE}"
fi
echo "$(date '+%F %T') backup ok: ${FILE}" >> /backups/backup.log
