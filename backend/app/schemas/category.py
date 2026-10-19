import uuid

from pydantic import BaseModel

from app.models import CategoryType


class CategoryOut(BaseModel):
    id: uuid.UUID
    name: str
    category_type: CategoryType
    is_system: bool


class CategoryList(BaseModel):
    items: list[CategoryOut]
