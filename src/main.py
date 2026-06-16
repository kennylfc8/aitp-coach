import os
import logging
from dotenv import load_dotenv
from aiogram import Dispatcher, Bot
from aiogram.fsm.storage.memory import MemoryStorage

from .bot import router

load_dotenv()
logging.basicConfig(level=logging.INFO)


async def main():
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    if not token:
        raise ValueError("TELEGRAM_BOT_TOKEN not set in environment")

    bot = Bot(token=token)
    storage = MemoryStorage()
    dp = Dispatcher(storage=storage)

    dp.include_router(router)

    print("Bot starting...")
    await dp.start_polling(bot)


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
