"""Folder API routes for PaperReading."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import List, Optional, Tuple

from fastapi import APIRouter, File, HTTPException, UploadFile

from app.models import FolderCreate, FolderPapersAssign, FolderResponse, FolderTreeNode, FolderUpdate
from app.services import (
    batch_import_papers,
    batch_move_papers,
    batch_remove_papers_from_folder,
    create_folder,
    delete_folder,
    get_folder,
    get_folder_papers,
    get_folder_tree,
    get_unassigned_papers,
    list_folders,
    move_folder,
    move_paper_to_folder,
    update_folder,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/folders", tags=["folders"])

ALLOWED_PDF_MIME_TYPES = {"application/pdf", "application/x-pdf", "application/octet-stream"}
MAX_BATCH_FILES = 50
MAX_BATCH_FILE_SIZE = 100 * 1024 * 1024  # 100 MB per file


@router.get("/tree", response_model=List[FolderTreeNode])
def get_folder_tree_api() -> List[FolderTreeNode]:
    """Return the full folder tree (up to 3 levels) with paper counts."""
    return get_folder_tree()


@router.get("", response_model=List[FolderResponse])
def list_folders_api() -> List[FolderResponse]:
    """Flat list of all folders."""
    return list_folders()


@router.get("/unassigned/papers")
def get_unassigned_papers_api() -> dict:
    """List papers not assigned to any folder."""
    papers = get_unassigned_papers()
    return {"total": len(papers), "items": papers}


@router.post("", response_model=FolderResponse)
def create_folder_api(payload: FolderCreate) -> FolderResponse:
    """Create a new folder.

    Omit ``parent_id`` (or pass null) to create a root-level folder.
    The service layer enforces the 3-level depth limit.
    """
    try:
        return create_folder(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.put("/{folder_id}", response_model=FolderResponse)
def update_folder_api(folder_id: str, payload: FolderUpdate) -> FolderResponse:
    """Rename a folder."""
    result = update_folder(folder_id, payload)
    if result is None:
        raise HTTPException(status_code=404, detail="文件夹不存在")
    return result


@router.delete("/{folder_id}")
def delete_folder_api(folder_id: str) -> dict:
    """Delete a folder.

    All subfolders are cascade-deleted. Papers in the deleted folders are
    unlinked (folder_id set to NULL) but NOT deleted.
    """
    if not delete_folder(folder_id):
        raise HTTPException(status_code=404, detail="文件夹不存在")
    return {"folder_id": folder_id, "deleted": True}


@router.put("/{folder_id}/move")
def move_folder_api(folder_id: str, new_parent_id: Optional[str] = None) -> dict:
    """Move a folder (with all its descendants) to a new parent.

    Pass new_parent_id=None to move the folder to the root level.
    Raises 400 if the move would violate the depth constraint or create a cycle.
    """
    try:
        move_folder(folder_id, new_parent_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"folder_id": folder_id, "new_parent_id": new_parent_id, "moved": True}


@router.get("/{folder_id}/papers")
def get_folder_papers_api(folder_id: str) -> dict:
    """List papers directly in a folder (non-recursive)."""
    if get_folder(folder_id) is None:
        raise HTTPException(status_code=404, detail="文件夹不存在")
    papers = get_folder_papers(folder_id)
    return {"folder_id": folder_id, "total": len(papers), "items": papers}


@router.post("/{folder_id}/import")
async def batch_import_api(folder_id: str, files: List[UploadFile] = File(...)) -> dict:
    """Batch import PDF files as new papers into a folder.

    Each file creates a new paper, stores it as the 'original' attachment,
    assigns it to the target folder, and triggers background analysis.

    Args:
        folder_id: Target folder ID.
        files: List of PDF files (multipart/form-data, field name "files").

    Returns:
        Per-file import results and aggregate counts.
    """
    if get_folder(folder_id) is None:
        raise HTTPException(status_code=404, detail="文件夹不存在")

    if not files:
        raise HTTPException(status_code=400, detail="未提供任何文件")
    if len(files) > MAX_BATCH_FILES:
        raise HTTPException(status_code=400, detail=f"单次最多导入 {MAX_BATCH_FILES} 个文件")

    file_data: List[Tuple[str, bytes]] = []
    for f in files:
        filename = Path(f.filename or "").name
        if not filename:
            continue
        if Path(filename).suffix.lower() != ".pdf":
            raise HTTPException(status_code=400, detail=f"仅支持 PDF 文件：{filename}")
        content_type = (f.content_type or "").lower()
        if content_type and content_type not in ALLOWED_PDF_MIME_TYPES:
            raise HTTPException(status_code=400, detail=f"仅支持 PDF 文件：{filename}")
        data = await f.read()
        if not data:
            raise HTTPException(status_code=400, detail=f"文件为空：{filename}")
        if len(data) > MAX_BATCH_FILE_SIZE:
            raise HTTPException(status_code=400, detail=f"文件过大（>100MB）：{filename}")
        file_data.append((filename, data))

    if not file_data:
        raise HTTPException(status_code=400, detail="没有可导入的有效文件")

    results = batch_import_papers(folder_id, file_data)
    success_count = sum(1 for r in results if r["success"])
    failed_count = len(results) - success_count
    return {
        "folder_id": folder_id,
        "total": len(results),
        "success_count": success_count,
        "failed_count": failed_count,
        "results": results,
    }


@router.post("/{folder_id}/papers")
def batch_move_papers_api(folder_id: str, payload: FolderPapersAssign) -> dict:
    """Batch-assign existing papers to a folder.

    Moves the given paper IDs into the target folder. Papers that don't
    exist are reported as failed but don't block the rest.
    """
    if get_folder(folder_id) is None:
        raise HTTPException(status_code=404, detail="文件夹不存在")
    if not payload.paper_ids:
        raise HTTPException(status_code=400, detail="未提供任何论文 ID")
    try:
        return batch_move_papers(folder_id, payload.paper_ids)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/papers/unassign")
def batch_remove_papers_api(payload: FolderPapersAssign) -> dict:
    """Batch-remove papers from any folder (set folder_id to NULL).

    Papers that don't exist are reported as failed but don't block the rest.
    """
    if not payload.paper_ids:
        raise HTTPException(status_code=400, detail="未提供任何论文 ID")
    return batch_remove_papers_from_folder(payload.paper_ids)


# --- Paper-folder assignment ---
# Defined under /papers prefix via a separate router so the URL is
# /api/v1/papers/{paper_id}/folder.
papers_folder_router = APIRouter(prefix="/papers", tags=["folders"])


@papers_folder_router.put("/{paper_id}/folder")
def move_paper_to_folder_api(paper_id: str, folder_id: Optional[str] = None) -> dict:
    """Assign a paper to a folder.

    Pass ``folder_id`` as a query parameter. Pass empty/null to remove the
    paper from its current folder.
    """
    try:
        moved = move_paper_to_folder(paper_id, folder_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not moved:
        raise HTTPException(status_code=404, detail="论文不存在")
    return {"paper_id": paper_id, "folder_id": folder_id, "updated": True}
