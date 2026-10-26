"""Vercel / ASGI entrypoint. Locally prefer: uvicorn app.main:create_app --factory."""

from app.main import create_app

app = create_app()
