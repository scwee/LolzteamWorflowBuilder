"""Single-tenant local owner — one system user per builder instance."""

from fastapi import Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import User
from app.db.session import async_session_factory, get_db

LOCAL_USERNAME = "local"
# Not used for login; satisfies NOT NULL password_hash column.
_UNUSABLE_PASSWORD = "!"


async def ensure_local_owner() -> User:
    async with async_session_factory() as session:
        result = await session.execute(select(User).where(User.username == LOCAL_USERNAME))
        user = result.scalar_one_or_none()
        if user:
            return user
        user = User(
            username=LOCAL_USERNAME,
            password_hash=_UNUSABLE_PASSWORD,
            is_admin=True,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        return user


async def get_owner(db: AsyncSession = Depends(get_db)) -> User:
    result = await db.execute(select(User).where(User.username == LOCAL_USERNAME))
    user = result.scalar_one_or_none()
    if user:
        return user
    user = User(
        username=LOCAL_USERNAME,
        password_hash=_UNUSABLE_PASSWORD,
        is_admin=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user
