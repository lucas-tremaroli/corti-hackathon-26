#!/bin/bash
# Turns discharge.txt into a two-voice recording to play into the ambient
# component. Real voices are better if you can get them — replace
# public/discharge.m4a and leave everything else alone.
#
# ADTS frames carry their own headers, so per-line clips concatenate with cat.
set -euo pipefail

cd "$(dirname "$0")"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

n=0
while IFS= read -r line; do
  [[ -z $line ]] && continue
  case $line in
    Doctor:*) voice=Daniel ;;
    Patient:*) voice=Moira ;;
    *) echo "line $((n + 1)) has no speaker: $line" >&2; exit 1 ;;
  esac
  say -v "$voice" --file-format=adts --data-format=aac \
    -o "$work/$(printf '%03d' $n).aac" "${line#*: }"
  n=$((n + 1))
done < discharge.txt

cat "$work"/*.aac > "$work/all.aac"
afconvert -f m4af -d aac "$work/all.aac" ../public/discharge.m4a

echo "public/discharge.m4a — $(afinfo ../public/discharge.m4a | sed -n 's/estimated duration: //p')s, $n lines"
