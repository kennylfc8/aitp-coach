"""
Clone a coach's voice into MiniMax and print the resulting voice_id.

Prereqs in .env: MINIMAX_API_KEY, MINIMAX_GROUP_ID
Audio sample: mp3/m4a/wav, 10 sec – 5 min, < 20 MB, clean speech (no music/noise).
ONLY clone a real person's voice with their consent.

Usage:
    py -3.12 clone_voice.py path/to/coach.mp3 [VoiceIdName]

Then put the printed id into .env:
    MINIMAX_VOICE_ID=<voice_id>
"""

import sys
import os
import requests
from dotenv import load_dotenv

load_dotenv()
KEY = os.getenv("MINIMAX_API_KEY")
GROUP = os.getenv("MINIMAX_GROUP_ID")
BASE = "https://api.minimax.io/v1"


def main():
    if len(sys.argv) < 2:
        print("usage: py -3.12 clone_voice.py <audio_file> [VoiceIdName]")
        return
    path = sys.argv[1]
    # voice_id rules: unique, >=8 chars, starts with a letter, letters+digits
    voice_id = sys.argv[2] if len(sys.argv) > 2 else "CoachVoice001"

    if not (KEY and GROUP):
        print("❌ Нет MINIMAX_API_KEY / MINIMAX_GROUP_ID в .env")
        return
    if not os.path.exists(path):
        print(f"❌ Файл не найден: {path}")
        return

    headers = {"Authorization": f"Bearer {KEY}"}

    # 1) upload sample
    print(f"⬆️  Загружаю {path} ...")
    with open(path, "rb") as f:
        up = requests.post(
            f"{BASE}/files/upload?GroupId={GROUP}",
            headers=headers,
            data={"purpose": "voice_clone"},
            files={"file": f},
            timeout=120,
        )
    if up.status_code != 200:
        print(f"❌ Upload error {up.status_code}: {up.text[:300]}")
        return
    file_id = (up.json().get("file") or {}).get("file_id")
    if not file_id:
        print(f"❌ Нет file_id в ответе: {up.text[:300]}")
        return
    print(f"✅ file_id = {file_id}")

    # 2) clone
    print(f"🧬 Клонирую как voice_id='{voice_id}' ...")
    cl = requests.post(
        f"{BASE}/voice_clone?GroupId={GROUP}",
        headers={**headers, "Content-Type": "application/json"},
        json={"file_id": file_id, "voice_id": voice_id},
        timeout=120,
    )
    print(f"Ответ: {cl.status_code} {cl.text[:300]}")
    if cl.status_code == 200 and '"status_code":0' in cl.text.replace(" ", ""):
        print("\n🎉 Готово! Добавь в .env:")
        print(f"   MINIMAX_VOICE_ID={voice_id}")
    else:
        print("\n⚠️ Что-то пошло не так — смотри ответ выше.")


if __name__ == "__main__":
    main()
