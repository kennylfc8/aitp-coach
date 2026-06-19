# AI Tennis Coach — 3D web (SPA)

Говорящий 3D-тренер по центру + теннисный дашборд сбоку. Тяжёлое (LLM, TTS) — на серверах;
браузер грузит только аватар + Three.js + lip-sync, поэтому стартует быстро.

## Запуск
```bash
cd web
npm install      # один раз
npm run dev      # http://localhost:5173
```

## Что готово (шаги 1–2)
- **Шаг 1** — оболочка: 3D-сцена (React Three Fiber) с аватаром по центру + мок-дашборд сбоку + панель управления снизу.
- **Шаг 2** — lip-sync: кнопка «▶ Тест речи» проигрывает `public/coach_test.mp3`, аватар шевелит ртом под речь (`wawa-lipsync`, язык-агностик, работает на русском).

Сейчас аватар — **процедурный плейсхолдер** (голова + рот, управляемый висемами). Сцена рендерится чисто, lip-sync виден сразу, без внешних ассетов.

## Шаг к реальному аватару (Avaturn)
1. Сделай аватар на **Avaturn** → экспортируй **GLB с ARKit-блендшейпами**. *(Ready Player Me НЕ используем — закрылся 31.01.2026.)*
2. Положи файл в `web/public/avatar.glb`.
3. В `src/components/Avatar.jsx` заменить плейсхолдер на загрузку GLB (`useGLTF`) и применять висему к морф-таргетам `viseme_<key>`:
   `mesh.morphTargetInfluences[dict["viseme_" + lipsyncManager.viseme]] = 1` (с лерпом, остальные → 0).
   15 висем: `sil PP FF TH DD kk CH SS nn RR aa E ih oh ou`.

## Дальше (не сделано)
- **Шаг 3** — текстовый чат: инпут → Claude API (через тонкий прокси, прячущий ключ) → ответ → TTS → аудио → lip-sync.
- **Шаг 4** — голос: Web Speech API (браузерный STT) → полный speech-to-speech.
- **Шаг 5** — реальные данные в дашборд + подтянуть движок тренировок/UTR из основного проекта.

## Стек
React + Vite · React Three Fiber / drei (Three.js) · wawa-lipsync · (далее) Claude API + TTS на сервере.
