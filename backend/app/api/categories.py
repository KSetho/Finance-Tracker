from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.dependencies.auth import current_owner
from app.dependencies.db import get_db
from app.models import CategoryType
from app.schemas.category import CategoryList
from app.services import category_service
from app.services.auth_service import AuthContext

router = APIRouter(prefix="/categories", tags=["categories"])


@router.get("", response_model=CategoryList)
def list_categories(
    type: CategoryType | None = Query(default=None),
    context: AuthContext = Depends(current_owner),
    db: Session = Depends(get_db),
) -> dict:
    return {"items": category_service.list_categories(db, context.user_id, type)}
