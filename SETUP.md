# SETUP — запуск проекта на новом компьютере

Всё, что НЕ приезжает с `git clone`, и как это восстановить. Проверено на Windows;
пути в коде относительные, привязки к конкретной машине нет.

## 0. Забрать со старого компа (пока есть доступ!)

| Что | Где лежит | Зачем |
|---|---|---|
| **`.env`** (главное!) | корень репо | все API-ключи; в гите его НЕТ |
| `data/players/` | корень репо | профили игроков телеграм-бота (история, UTR, программы) |

Если `.env` не забрать — ключи придётся выпускать заново (список ниже).

## 1. Клонировать

```powershell
git clone https://github.com/kennylfc8/aitp-coach.git
cd aitp-coach
```

## 2. `.env` в корне репо

```
TELEGRAM_BOT_TOKEN=      # @BotFather в Telegram
ANTHROPIC_API_KEY=       # console.anthropic.com
OPENAI_API_KEY=          # platform.openai.com (TTS-голос тренера + Whisper)
YOUTUBE_API_KEY=         # console.cloud.google.com → YouTube Data API v3
REPLICATE_API_TOKEN=     # replicate.com (клон голоса)
REPLICATE_VOICE_SAMPLE=  # URL сэмпла голоса для клона
```

## 3. Python (бот + API-сервер)

- Установить **Python 3.12** (python.org), на Windows запускается как `py -3.12`.
- `py -3.12 -m pip install -r requirements.txt`

## 4. Node (3D-веб)

- Установить **Node.js 18+** (LTS с nodejs.org).
- `cd web && npm install`
- (опционально, конвейер анимаций) `cd tools/retarget && npm install`

## 5. Rhubarb Lip Sync (точный липсинк; опционально)

Бинарник не в гите (~30 МБ). Скачать **Rhubarb-Lip-Sync-1.14.0-Windows.zip**:
https://github.com/DanielSWolf/rhubarb-lip-sync/releases
Распаковать так, чтобы существовал `tools/Rhubarb-Lip-Sync-1.14.0-Windows/rhubarb.exe`
(этот путь ждёт `server.py`). Без него всё работает — липсинк падает на
менее точный realtime-анализ звука.

## 6. FBX2glTF (только для конвертации новых Mixamo-анимаций; опционально)

https://github.com/facebookincubator/FBX2glTF/releases → `FBX2glTF-windows-x64.exe`,
положить куда угодно и звать по пути. Готовые анимации уже в `web/public/anims/`.

## 7. Запуск

```powershell
# API-сервер (проксирует Claude/TTS/липсинк для веба) — порт 8000
py -3.12 -m uvicorn server:app --port 8000 --reload

# 3D-веб (Vite) — порт 5173
cd web
npm run dev

# Телеграм-бот (отдельно от веба, можно не запускать)
py -3.12 -m src.main
```

## 8. Проверка, что всё живое

1. http://localhost:5173 → тренер стоит на неоновом корте (темы NEON/CLAY/BLUE в топбаре);
2. DEMO.LAB → SERVE → пауза/скраб/орбита работают;
3. GRIP.CAM → камера наезжает на хват, чипы CONTINENTAL/EASTERN/SEMI-WESTERN меняют хват;
4. Написать тренеру в командной строке → голосовой ответ с липсинком
   (если шаг 5 пропущен — рот двигается по FFT, чуть менее точно);
5. QA-простыня хвата: открыть `mockups/qa/index.html` (пересобрать: `node tools/qa/report.mjs`).

## Полезные dev-флаги URL (веб)

`?theme=neon|clay|blue` — тема; `?fit=sport` — кепка+визор (пока тело в костюме);
`?lookhand=1&ang=0..359&d=0.45` — макро-камера на кисть; `?nocourt`, `?nogrid`,
`?nomodel` — отключалки; `?char=ch28` — старый персонаж.

## Что где лежит

- `src/` — телеграм-бот (aiogram) · `server.py` — FastAPI-прокси для веба
- `web/` — React+R3F: тренер, DEMO.LAB, GRIP.CAM, темы корта
- `tools/retarget/bake.mjs` — перенос чужих анимаций на скелет тренера
- `tools/qa/` — QA-матрица хвата · `mockups/` — визуальные эталоны/скрины
- `PROJECT_STATUS.md` — актуальный статус проекта (остальные корневые .md — старьё)
