import os
from pathlib import Path

# Load .env FIRST before any other imports
from dotenv import load_dotenv
env_path = Path(__file__).parent.parent / ".env"
result = load_dotenv(dotenv_path=env_path, override=True)
print(f"[DEBUG] .env loaded from: {env_path}")
print(f"[DEBUG] .env exists: {env_path.exists()}")
print(f"[DEBUG] load_dotenv result: {result}")
print(f"[DEBUG] ANTHROPIC_API_KEY present: {'ANTHROPIC_API_KEY' in os.environ}")

import logging
from aiogram import Dispatcher, Bot
from aiogram.fsm.storage.memory import MemoryStorage

from .bot import router

# Setup logging to file
log_dir = Path("logs")
log_dir.mkdir(exist_ok=True)

formatter = logging.Formatter(
    "%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)

# File handler
file_handler = logging.FileHandler(log_dir / "bot.log", encoding="utf-8")
file_handler.setLevel(logging.DEBUG)
file_handler.setFormatter(formatter)

# Console handler
console_handler = logging.StreamHandler()
console_handler.setLevel(logging.INFO)
console_handler.setFormatter(formatter)

# Root logger
root_logger = logging.getLogger()
root_logger.setLevel(logging.DEBUG)
root_logger.addHandler(file_handler)
root_logger.addHandler(console_handler)


async def main():
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    if not token:
        raise ValueError("TELEGRAM_BOT_TOKEN not set in environment")

    bot = Bot(token=token)
    storage = MemoryStorage()
    dp = Dispatcher(storage=storage)

    dp.include_router(router)

    @dp.update.outer_middleware()
    async def _log_updates(handler, event, data):
        m = getattr(event, "message", None)
        if m is not None:
            logging.getLogger("bot").info(
                f"RAW message: content_type={m.content_type} text={m.text!r} from={getattr(m.from_user,'id',None)}"
            )
        else:
            logging.getLogger("bot").info(f"RAW non-message update: {event.event_type}")
        return await handler(event, data)

    print("Bot starting...")
    await dp.start_polling(bot)


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
