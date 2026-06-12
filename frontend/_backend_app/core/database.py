"""MongoDB client singleton (Motor). Motor is imported lazily so the module
can load on serverless runtimes where motor isn't installed (scores-only deploy)."""
import logging
from typing import Optional, Any
from .config import MONGO_URL, DB_NAME

logger = logging.getLogger("banbansports.db")

_client: Optional[Any] = None
_db: Optional[Any] = None


async def init_db() -> Optional[Any]:
    global _client, _db
    try:
        from motor.motor_asyncio import AsyncIOMotorClient  # lazy
        _client = AsyncIOMotorClient(MONGO_URL, serverSelectionTimeoutMS=3000)
        _db = _client[DB_NAME]
        # Quick ping
        await _client.admin.command('ping')
        # TTL + unique indexes
        try:
            await _db.livescore_cache.create_index("cached_at", expireAfterSeconds=120)
            await _db.users.create_index("email", unique=True)
            # Test kullanıcılar 24 saat sonra otomatik silinir (cleanup TTL)
            await _db.users.create_index(
                "test_expires_at", expireAfterSeconds=0,
                partialFilterExpression={"test": True},
            )
            await _db.predictions.create_index([("user_id", 1), ("match_id", 1)], unique=True)
            await _db.chat_messages.create_index("ts")
            await _db.password_reset_tokens.create_index("expires_at", expireAfterSeconds=0)
            await _db.push_subscriptions.create_index("endpoint", unique=True)
            await _db.push_subscriptions.create_index("created_at")
        except Exception as e:
            logger.debug(f"index init: {e}")
        logger.info("MongoDB connected")
        return _db
    except Exception as e:
        logger.warning(f"MongoDB connect failed (cache disabled): {e}")
        _client = None
        _db = None
        return None


def get_db() -> Optional[Any]:
    return _db


async def close_db() -> None:
    global _client
    if _client:
        _client.close()
        _client = None
