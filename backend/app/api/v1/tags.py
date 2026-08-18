"""Tag API routes for PaperReading.

Two routers, mirroring the folders pattern:
- ``router`` (prefix /tags): tag CRUD + merge + tag->papers listing.
- ``papers_tag_router`` (prefix /papers): paper->tag assignment endpoints
  exposed under /papers/{paper_id}/tags so URLs stay co-located with paper
  resources, analogous to /papers/{paper_id}/folder.
"""

from __future__ import annotations

import logging
from typing import List

from fastapi import APIRouter, HTTPException

from app.models import PaperTagsAssign, TagCreate, TagMerge, TagPapersAssign, TagResponse, TagUpdate
from app.services import (
    add_paper_tag,
    batch_add_papers,
    batch_remove_papers,
    create_tag,
    delete_tag,
    get_all_paper_tags,
    get_paper_tags,
    get_tag,
    get_tag_available_papers,
    get_tag_papers,
    list_tags,
    merge_tags,
    remove_paper_tag,
    set_paper_tags,
    update_tag,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tags", tags=["tags"])


@router.get("", response_model=List[TagResponse])
def list_tags_api() -> List[TagResponse]:
    """Flat list of all tags with per-tag paper counts."""
    return list_tags()


# Declared before /{tag_id} routes so the literal path wins (FastAPI matches
# in declaration order). Returns all (paper, tag) links for sidebar rendering.
@router.get("/paper-map")
def get_paper_map_api() -> dict:
    """Bulk list of every paper-tag link, grouped-flat for the frontend.

    Returns a flat list of {paper_id, tag_id, name, color}; the client groups
    by paper_id to render per-paper color dots and drawer checkmarks without
    N+1 requests.
    """
    return {"items": get_all_paper_tags()}


@router.post("", response_model=TagResponse)
def create_tag_api(payload: TagCreate) -> TagResponse:
    """Create a tag.

    If a tag with the same name already exists (case-insensitive), the
    existing tag is returned (auto-reuse) instead of erroring.
    """
    try:
        return create_tag(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.put("/{tag_id}", response_model=TagResponse)
def update_tag_api(tag_id: str, payload: TagUpdate) -> TagResponse:
    """Rename and/or recolor a tag.

    Renaming to a name already used by a *different* tag is rejected — use
    the merge endpoint to consolidate tags.
    """
    try:
        result = update_tag(tag_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if result is None:
        raise HTTPException(status_code=404, detail="标签不存在")
    return result


@router.delete("/{tag_id}")
def delete_tag_api(tag_id: str) -> dict:
    """Delete a tag. Its paper links are cleared by FK ON DELETE CASCADE."""
    if not delete_tag(tag_id):
        raise HTTPException(status_code=404, detail="标签不存在")
    return {"tag_id": tag_id, "deleted": True}


@router.post("/merge", response_model=TagResponse)
def merge_tags_api(payload: TagMerge) -> TagResponse:
    """Merge source tags into the target tag.

    All paper-tag links from each source are copied into the target (deduped
    by the composite PK), then the source tags are deleted. The target's own
    name/color are preserved.
    """
    try:
        return merge_tags(payload.source_ids, payload.target_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/{tag_id}/papers")
def get_tag_papers_api(tag_id: str) -> dict:
    """List papers carrying the given tag."""
    if get_tag(tag_id) is None:
        raise HTTPException(status_code=404, detail="标签不存在")
    papers = get_tag_papers(tag_id)
    return {"tag_id": tag_id, "total": len(papers), "items": papers}


@router.get("/{tag_id}/papers/available")
def get_tag_available_papers_api(tag_id: str) -> dict:
    """List papers NOT yet carrying the given tag (for the batch-add picker)."""
    if get_tag(tag_id) is None:
        raise HTTPException(status_code=404, detail="标签不存在")
    papers = get_tag_available_papers(tag_id)
    return {"tag_id": tag_id, "total": len(papers), "items": papers}


@router.post("/{tag_id}/papers/assign")
def batch_add_papers_api(tag_id: str, payload: TagPapersAssign) -> dict:
    """Batch-link many papers to a tag. No count cap (flat many-to-many)."""
    try:
        return batch_add_papers(tag_id, payload.paper_ids)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/{tag_id}/papers/unassign")
def batch_remove_papers_api(tag_id: str, payload: TagPapersAssign) -> dict:
    """Batch-unlink many papers from a tag. No count cap."""
    return batch_remove_papers(tag_id, payload.paper_ids)


# --- Paper-tag assignment ---
# Exposed under /papers prefix via a separate router so the URL is
# /api/v1/papers/{paper_id}/tags, analogous to /papers/{paper_id}/folder.
papers_tag_router = APIRouter(prefix="/papers", tags=["tags"])


@papers_tag_router.get("/{paper_id}/tags", response_model=List[TagResponse])
def get_paper_tags_api(paper_id: str) -> List[TagResponse]:
    """List all tags on a paper, ordered by name."""
    return get_paper_tags(paper_id)


@papers_tag_router.put("/{paper_id}/tags", response_model=List[TagResponse])
def set_paper_tags_api(paper_id: str, payload: PaperTagsAssign) -> List[TagResponse]:
    """Full-replace a paper's tags (diff-based, minimal writes)."""
    try:
        return set_paper_tags(paper_id, payload.tag_ids)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@papers_tag_router.post("/{paper_id}/tags/{tag_id}", response_model=List[TagResponse])
def add_paper_tag_api(paper_id: str, tag_id: str) -> List[TagResponse]:
    """Add a single tag to a paper (idempotent)."""
    try:
        return add_paper_tag(paper_id, tag_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@papers_tag_router.delete("/{paper_id}/tags/{tag_id}", response_model=List[TagResponse])
def remove_paper_tag_api(paper_id: str, tag_id: str) -> List[TagResponse]:
    """Remove a single tag from a paper."""
    return remove_paper_tag(paper_id, tag_id)
