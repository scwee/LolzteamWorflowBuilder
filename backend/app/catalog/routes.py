from fastapi import APIRouter, Depends, Query

from app.owner import get_owner
from app.catalog.loader import get_endpoint, list_endpoints, list_tags
from app.db.models import User

router = APIRouter(prefix="/catalog", tags=["catalog"])


@router.get("")
async def catalog_list(
    q: str | None = Query(default=None),
    tag: str | None = Query(default=None),
    current_user: User = Depends(get_owner),
) -> list[dict]:
    _ = current_user
    return list_endpoints(q=q, tag=tag)


@router.get("/tags")
async def catalog_tags(current_user: User = Depends(get_owner)) -> list[dict]:
    _ = current_user
    return list_tags()


@router.get("/{endpoint_id:path}")
async def catalog_one(endpoint_id: str, current_user: User = Depends(get_owner)) -> dict:
    _ = current_user
    endpoint = get_endpoint(endpoint_id)
    if not endpoint:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="Endpoint not found")
    return endpoint
