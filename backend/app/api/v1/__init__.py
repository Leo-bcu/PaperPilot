from fastapi import APIRouter

from .papers import router as papers_router
from .folders import papers_folder_router, router as folders_router
from .tags import papers_tag_router, router as tags_router
from .settings import router as settings_router
from .chat import router as chat_router

api_router = APIRouter()
api_router.include_router(papers_router)
api_router.include_router(folders_router)
api_router.include_router(papers_folder_router)
api_router.include_router(tags_router)
api_router.include_router(papers_tag_router)
api_router.include_router(settings_router)
api_router.include_router(chat_router)
