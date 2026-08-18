"""Paper API routes for the demo backend."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from threading import Thread
from typing import List, Optional

from fastapi import APIRouter, Body, File, HTTPException, UploadFile
from pydantic import BaseModel
from fastapi.responses import FileResponse

from app.db.sqlite import to_utc_isoformat
from app.models import AnalysisCreate, PaperCreate, PaperDetailResponse, PaperResponse, PaperUpdate, SearchResultItem, SearchResultResponse
from app.services import (
    SEARCH_FIELD_LABELS,
    auto_parse_and_analyze,
    check_duplicate_paper,
    continue_analysis_after_duplicate,
    create_paper,
    delete_attachment_file,
    delete_paper,
    ensure_analysis_placeholder,
    get_paper,
    get_paper_annotations,
    save_paper_annotations,
    search_papers,
    update_paper,
    upsert_analysis,
    upsert_attachment_file,
)

logger = logging.getLogger(__name__)

ALLOWED_ATTACHMENT_TYPES = {"original", "translated", "mapped"}
ALLOWED_PDF_MIME_TYPES = {"application/pdf", "application/x-pdf", "application/octet-stream"}

router = APIRouter(prefix="/papers", tags=["papers"])


def _to_utc_isoformat(value) -> str:
    """兼容旧代码，委托给公共函数。"""
    return to_utc_isoformat(value)


def _resolve_extraction_methods_for_list(paper_ids: List[str]) -> dict[str, str]:
    """Bulk-lookup extraction_method for a list of paper IDs.

    Prefers paper_analysis.extraction_method (latest analysis) over
    paper_texts.metadata.extraction_method, then falls back to status.
    This avoids N+1 queries in the list view.
    """
    from app.db import session

    if not paper_ids:
        return {}
    placeholders = ", ".join("?" for _ in paper_ids)
    result: dict[str, str] = {}

    with session() as conn:
        # 1) analysis table
        rows = conn.execute(
            f"SELECT paper_id, extraction_method FROM paper_analysis WHERE paper_id IN ({placeholders}) AND extraction_method IS NOT NULL",
            tuple(paper_ids),
        ).fetchall()
        for r in rows:
            if r["extraction_method"]:
                result[r["paper_id"]] = r["extraction_method"]

        missing = [pid for pid in paper_ids if pid not in result]
        if missing:
            placeholders2 = ", ".join("?" for _ in missing)
            rows = conn.execute(
                f"SELECT paper_id, extraction_method FROM paper_texts WHERE paper_id IN ({placeholders2}) AND text_scope = 'metadata' AND extraction_method IS NOT NULL",
                tuple(missing),
            ).fetchall()
            for r in rows:
                if r["extraction_method"]:
                    result[r["paper_id"]] = r["extraction_method"]

    return result


@router.get("", response_model=List[PaperResponse])
def list_papers_api() -> List[PaperResponse]:
    from app.db import session

    with session() as conn:
        rows = conn.execute("SELECT * FROM papers ORDER BY created_at DESC").fetchall()

    paper_ids = [r["id"] for r in rows]
    extraction_methods = _resolve_extraction_methods_for_list(paper_ids)

    def _default_extraction_method(status: str) -> str:
        if status in ("mineru_converted", "mineru_processing"):
            return "mineru"
        return "first_six_pages"

    return [PaperResponse(
        id=row["id"],
        title=row["title"] or "",
        title_cn=row["title_cn"] or "",
        title_en=row["title_en"] or "",
        authors=row["authors"] or "",
        publish_date=row["publish_date"] or "",
        abstract=row["abstract"] or "",
        source_url=row["source_url"] or "",
        status=row["status"] or "uploaded",
        folder_id=row["folder_id"] if "folder_id" in row.keys() else None,
        created_at=_to_utc_isoformat(row["created_at"]),
        updated_at=_to_utc_isoformat(row["updated_at"]),
        extraction_method=extraction_methods.get(
            row["id"],
            _default_extraction_method(row["status"] or "uploaded"),
        ),
    ) for row in rows]


# ========== Search ==========


@router.get("/search", response_model=SearchResultResponse)
def search_papers_api(
    q: str,
    deep: bool = False,
    limit: int = 100,
    folder_id: Optional[str] = None,
    tag_ids: Optional[str] = None,
    fuzzy: bool = False,
) -> SearchResultResponse:
    """Search papers with optional deep (high-order) mode.

    Basic search (deep=False):
        Substring match on title / title_cn / title_en / authors / abstract.
        Results ordered by created_at DESC. Useful for quick lookups.

    Deep search (deep=True):
        Weighted search across 9 field groups (title, keywords, abstract,
        TLDR, authors, source, 8-dim analysis, DOI, year). Results ordered by
        relevance score DESC, with matched_fields and snippet for each item.

    Fuzzy mode (fuzzy=True):
        Enables approximate matching via edit distance and prefix matching.
        Works with both basic and deep search.

    Filter params:
        folder_id: Restrict results to papers in a specific folder.
        tag_ids: Comma-separated tag IDs; papers must have ALL specified tags.

    Args:
        q: Search query string. Whitespace-separated terms are matched as
            substrings (case-insensitive).
        deep: If True, enable weighted deep search.
        limit: Maximum number of results (default 100, capped at 200).
        folder_id: Optional folder ID filter.
        tag_ids: Optional comma-separated tag ID filter.
        fuzzy: If True, enable fuzzy/approximate matching.

    Returns:
        SearchResultResponse with query, deep, total, and items list.
    """
    limit = max(1, min(int(limit), 200))
    tag_id_list = [t.strip() for t in tag_ids.split(",") if t.strip()] if tag_ids else None
    result = search_papers(
        query=q,
        deep=deep,
        limit=limit,
        folder_id=folder_id,
        tag_ids=tag_id_list,
        fuzzy=fuzzy,
    )

    # Resolve extraction_method in bulk for all matched paper IDs
    paper_ids = [item["id"] for item in result["items"]]
    extraction_methods = _resolve_extraction_methods_for_list(paper_ids)

    def _default_extraction_method(status: str) -> str:
        if status in ("mineru_converted", "mineru_processing"):
            return "mineru"
        return "first_six_pages"

    items = [
        SearchResultItem(
            id=item["id"],
            title=item["title"],
            title_cn=item["title_cn"],
            title_en=item["title_en"],
            authors=item["authors"],
            publish_date=item["publish_date"],
            abstract=item["abstract"],
            source_url=item["source_url"],
            status=item["status"],
            folder_id=item.get("folder_id"),
            created_at=item["created_at"],
            updated_at=item["updated_at"],
            extraction_method=extraction_methods.get(
                item["id"],
                _default_extraction_method(item["status"]),
            ),
            score=item["score"],
            matched_fields=item["matched_fields"],
            snippet=item["snippet"],
        )
        for item in result["items"]
    ]

    return SearchResultResponse(
        query=result["query"],
        deep=result["deep"],
        total=result["total"],
        items=items,
    )


@router.get("/search/field-labels")
def get_search_field_labels_api() -> dict:
    """Return human-readable labels for deep search matched fields.

    Used by the frontend to render matched field tags (e.g. "title" -> "标题").
    """
    return {"labels": SEARCH_FIELD_LABELS}


@router.post("", response_model=PaperResponse)
def create_paper_api(payload: PaperCreate) -> PaperResponse:
    paper_id = create_paper(payload)
    ensure_analysis_placeholder(paper_id)
    # 获取数据库中创建的记录以获取时间戳
    from app.db import session
    with session() as conn:
        row = conn.execute("SELECT created_at, updated_at, folder_id FROM papers WHERE id = ?", (paper_id,)).fetchone()
    return PaperResponse(
        id=paper_id,
        title=payload.title,
        title_cn=payload.title_cn,
        title_en=payload.title_en,
        authors=payload.authors,
        publish_date=payload.publish_date,
        abstract=payload.abstract,
        source_url=payload.source_url,
        status=payload.status,
        folder_id=row["folder_id"] if row and "folder_id" in row.keys() else None,
        created_at=_to_utc_isoformat(row["created_at"]) if row else "",
        updated_at=_to_utc_isoformat(row["updated_at"]) if row else "",
    )


@router.put("/{paper_id}", response_model=PaperResponse)
def update_paper_api(paper_id: str, payload: PaperUpdate) -> PaperResponse:
    result = update_paper(paper_id, payload)
    if not result.get("updated"):
        paper = get_paper(paper_id)
        if paper is None:
            raise HTTPException(status_code=404, detail="Paper not found")
    paper = get_paper(paper_id)
    if paper is None:
        raise HTTPException(status_code=404, detail="Paper not found")
    # 获取数据库中最新的时间戳和 folder_id
    from app.db import session
    with session() as conn:
        row = conn.execute("SELECT created_at, updated_at, folder_id FROM papers WHERE id = ?", (paper_id,)).fetchone()
    return PaperResponse(
        id=paper.id,
        title=paper.title,
        title_cn=paper.title_cn,
        title_en=paper.title_en,
        authors=paper.authors,
        publish_date=paper.publish_date,
        abstract=paper.abstract,
        source_url=paper.source_url,
        status=paper.status,
        folder_id=row["folder_id"] if row and "folder_id" in row.keys() else None,
        created_at=_to_utc_isoformat(row["created_at"]) if row else "",
        updated_at=_to_utc_isoformat(row["updated_at"]) if row else "",
    )


@router.delete("/{paper_id}")
def delete_paper_api(paper_id: str) -> dict:
    if not delete_paper(paper_id):
        raise HTTPException(status_code=404, detail="Paper not found")
    return {"paper_id": paper_id, "deleted": True}


@router.get("/{paper_id}", response_model=PaperDetailResponse)
def get_paper_api(paper_id: str) -> PaperDetailResponse:
    paper = get_paper(paper_id)
    if paper is None:
        raise HTTPException(status_code=404, detail="Paper not found")
    return paper


@router.get("/{paper_id}/attachments/{attachment_type}")
def get_attachment_file_api(paper_id: str, attachment_type: str):
    paper = get_paper(paper_id)
    if paper is None:
        raise HTTPException(status_code=404, detail="Paper not found")

    attachment = next((item for item in paper.attachments if item.attachment_type == attachment_type), None)
    if attachment is None:
        raise HTTPException(status_code=404, detail="Attachment not found")

    file_path = Path(attachment.file_path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(
        path=file_path,
        media_type="application/pdf",
        filename=file_path.name,
        # Never cache: a cached full-file 200 from a download would clash with
        # pdf.js' Range requests on the same URL, causing "Failed to fetch".
        headers={"Cache-Control": "no-store"},
    )


@router.delete("/{paper_id}/attachments/{attachment_type}")
def delete_attachment_api(paper_id: str, attachment_type: str) -> dict:
    if attachment_type == "original":
        raise HTTPException(status_code=400, detail="原件不允许删除，请使用替换功能")
    if not delete_attachment_file(paper_id, attachment_type):
        raise HTTPException(status_code=404, detail="Attachment not found")
    return {"paper_id": paper_id, "attachment_type": attachment_type, "deleted": True}


# ========== Paper Annotations ==========
# Annotations (highlights, shapes, freetext notes, drawings) are stored per
# (paper_id, attachment_type) as a JSON array of highlight objects. Positions
# use PDF-page-relative normalized coordinates so they stay attached to content
# across zoom/scroll. The frontend sends the full annotation array on save.


class AnnotationsPayload(BaseModel):
    annotations: List = []


@router.get("/{paper_id}/annotations/{attachment_type}")
def get_annotations_api(paper_id: str, attachment_type: str) -> dict:
    if get_paper(paper_id) is None:
        raise HTTPException(status_code=404, detail="Paper not found")
    if attachment_type not in ALLOWED_ATTACHMENT_TYPES:
        raise HTTPException(status_code=400, detail="Invalid attachment type")
    return get_paper_annotations(paper_id, attachment_type)


@router.put("/{paper_id}/annotations/{attachment_type}")
def save_annotations_api(paper_id: str, attachment_type: str, payload: AnnotationsPayload) -> dict:
    if get_paper(paper_id) is None:
        raise HTTPException(status_code=404, detail="Paper not found")
    if attachment_type not in ALLOWED_ATTACHMENT_TYPES:
        raise HTTPException(status_code=400, detail="Invalid attachment type")
    return save_paper_annotations(paper_id, attachment_type, payload.annotations)


@router.post("/{paper_id}/reanalyze")
def reanalyze_paper_api(paper_id: str, force_mineru_refresh: bool = False) -> dict:
    """Trigger re-analysis for a paper.

    By default, reanalysis reuses an existing MinerU Markdown result if one
    is present (to save API quota and compute). Pass ``force_mineru_refresh=true``
    as a query parameter to re-run the MinerU conversion as well.

    Args:
        paper_id: Paper ID to reanalyze.
        force_mineru_refresh: If True, ignore cached MinerU Markdown and
            re-run the conversion. Defaults to False.

    Returns:
        Status dict indicating the reanalysis has started.
    """
    paper = get_paper(paper_id)
    if paper is None:
        raise HTTPException(status_code=404, detail="Paper not found")

    def worker() -> None:
        original = next((item for item in paper.attachments if item.attachment_type == "original"), None)
        if original is None:
            return
        try:
            auto_parse_and_analyze(
                paper_id,
                original.file_path,
                force_mineru_refresh=force_mineru_refresh,
            )
        except Exception:
            logger.exception(
                "Background reanalyze failed paper_id=%s",
                paper_id,
            )
            _mark_paper_failed(paper_id, "后台分析线程异常，请重试或联系管理员")

    Thread(target=worker, daemon=True).start()
    return {
        "paper_id": paper_id,
        "status": "running",
        "force_mineru_refresh": force_mineru_refresh,
    }


def _mark_paper_failed(paper_id: str, error: str) -> None:
    """Update paper status to failed and log the error.

    Called from background thread exception handlers to ensure the UI
    reflects the failure instead of being stuck in 'analyzing'.
    """
    from app.db import session as db_session
    from app.core.debug_log import log_task_event

    try:
        with db_session() as conn:
            conn.execute(
                "UPDATE papers SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (paper_id,),
            )
        log_task_event(
            paper_id, step="分析任务", status="failed",
            error=error[:300],
        )
    except Exception:
        logger.exception("Failed to mark paper %s as failed", paper_id)


def _background_parse_and_analyze(paper_id: str, temp_path: str) -> None:
    try:
        auto_parse_and_analyze(paper_id, temp_path)
    except Exception:
        logger.exception(
            "Background auto_parse_and_analyze failed paper_id=%s",
            paper_id,
        )
        _mark_paper_failed(paper_id, "后台分析线程异常，请重试或联系管理员")
    finally:
        Path(temp_path).unlink(missing_ok=True)


@router.post("/{paper_id}/attachments/upload")
def upload_attachment_file_api(
    paper_id: str,
    attachment_type: str,
    file: UploadFile = File(...),
) -> dict:
    if get_paper(paper_id) is None:
        raise HTTPException(status_code=404, detail="Paper not found")

    if attachment_type not in ALLOWED_ATTACHMENT_TYPES:
        raise HTTPException(status_code=400, detail="Invalid attachment type")

    filename = Path(file.filename or "").name
    if not filename:
        raise HTTPException(status_code=400, detail="Missing filename")
    if Path(filename).suffix.lower() != ".pdf":
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")

    content_type = (file.content_type or "").lower()
    if content_type and content_type not in ALLOWED_PDF_MIME_TYPES:
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")

    temp_dir = Path("/tmp") / "paperreading"
    temp_dir.mkdir(parents=True, exist_ok=True)
    temp_path = temp_dir / filename
    temp_path.write_bytes(file.file.read())

    if temp_path.stat().st_size == 0:
        temp_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    attachment_id = upsert_attachment_file(paper_id, attachment_type, str(temp_path), filename)
    response = {
        "paper_id": paper_id,
        "attachment_id": attachment_id,
        "attachment_type": attachment_type,
        "file_name": filename,
        "file_size": temp_path.stat().st_size,
        "mime_type": content_type or "application/pdf",
    }

    if attachment_type == "original":
        thread = Thread(target=_background_parse_and_analyze, args=(paper_id, str(temp_path)), daemon=True)
        thread.start()
        response["analysis_triggered"] = True
        response["analysis_status"] = "running"
    else:
        Path(temp_path).unlink(missing_ok=True)

    if attachment_type == "original":
        ensure_analysis_placeholder(paper_id)

    return response


@router.post("/{paper_id}/analysis", response_model=dict)
def trigger_analysis_api(paper_id: str, payload: AnalysisCreate) -> dict:
    if get_paper(paper_id) is None:
        raise HTTPException(status_code=404, detail="Paper not found")
    analysis_id = upsert_analysis(paper_id, payload)
    return {"paper_id": paper_id, "analysis_id": analysis_id, "status": payload.analysis_status}


# ========== MinerU PDF to Markdown Conversion Endpoints ==========


def _get_pdf_path_for_mineru(paper_id: str) -> Optional[Path]:
    """Get the original PDF path for a paper.

    Args:
        paper_id: Paper ID to look up.

    Returns:
        Path to the original PDF or None if not found.
    """
    paper = get_paper(paper_id)
    if paper is None:
        return None

    original = next((a for a in paper.attachments if a.attachment_type == "original"), None)
    if original is None:
        return None

    pdf_path = Path(original.file_path)
    if not pdf_path.exists():
        return None

    return pdf_path


@router.get("/{paper_id}/task-logs")
def get_task_logs_api(paper_id: str) -> dict:
    """Get task log entries for a paper's analysis progress.

    Returns structured log entries for terminal-style display in the frontend.

    Args:
        paper_id: Paper ID to fetch logs for.

    Returns:
        Dict with paper_id and list of task log entries.
    """
    if get_paper(paper_id) is None:
        raise HTTPException(status_code=404, detail="Paper not found")

    from app.core.debug_log import read_task_logs
    entries = read_task_logs(paper_id)
    return {
        "paper_id": paper_id,
        "entries": entries,
    }


@router.post("/{paper_id}/convert-to-markdown")
def convert_to_markdown_api(paper_id: str, enable_ocr: bool = False) -> dict:
    """Convert a paper's PDF to Markdown using MinerU API.

    Args:
        paper_id: Paper ID to convert.
        enable_ocr: Whether to enable OCR for scanned documents.

    Returns:
        Conversion result with status and markdown path.
    """
    paper = get_paper(paper_id)
    if paper is None:
        raise HTTPException(status_code=404, detail="Paper not found")

    pdf_path = _get_pdf_path_for_mineru(paper_id)
    if pdf_path is None:
        raise HTTPException(
            status_code=400,
            detail="No PDF file found for this paper. Please upload a PDF first.",
        )

    # Check if MinerU is configured
    from app.core.config import settings
    if not settings.mineru_token:
        raise HTTPException(
            status_code=400,
            detail="MinerU API token is not configured. Please configure it in Settings.",
        )

    def worker() -> None:
        try:
            from app.services.mineru_service import convert_pdf_to_markdown
            result = convert_pdf_to_markdown(
                paper_id=paper_id,
                pdf_path=pdf_path,
                enable_ocr=enable_ocr,
            )
            logger.info("MinerU conversion completed for paper %s: %s", paper_id, result.get("status"))
        except Exception as e:
            logger.error("MinerU conversion failed for paper %s: %s", paper_id, str(e))

    Thread(target=worker, daemon=True).start()

    return {
        "paper_id": paper_id,
        "status": "submitted",
        "message": "PDF to Markdown conversion started via MinerU. "
                   "Check status with GET /papers/{paper_id}/mineru-status",
    }


@router.get("/{paper_id}/mineru-status")
def get_mineru_status_api(paper_id: str) -> dict:
    """Get the MinerU conversion status for a paper.

    Args:
        paper_id: Paper ID to check.

    Returns:
        MinerU conversion status or 404 if no conversion exists.
    """
    if get_paper(paper_id) is None:
        raise HTTPException(status_code=404, detail="Paper not found")

    from app.services.mineru_service import get_mineru_status
    status = get_mineru_status(paper_id)

    if status is None:
        return {
            "paper_id": paper_id,
            "status": "not_found",
            "message": "No MinerU conversion found for this paper.",
        }

    return status


@router.get("/{paper_id}/mineru-markdown")
def get_mineru_markdown_api(paper_id: str) -> dict:
    """Get the MinerU-generated Markdown content for a paper.

    Args:
        paper_id: Paper ID to get Markdown for.

    Returns:
        Markdown content or 404 if not available.
    """
    if get_paper(paper_id) is None:
        raise HTTPException(status_code=404, detail="Paper not found")

    from app.services.mineru_service import get_mineru_markdown
    markdown = get_mineru_markdown(paper_id)

    if markdown is None:
        raise HTTPException(
            status_code=404,
            detail="MinerU Markdown not available. Run conversion first.",
        )

    return {
        "paper_id": paper_id,
        "markdown": markdown,
    }


@router.get("/{paper_id}/mineru-markdown-file")
def download_mineru_markdown_file_api(paper_id: str) -> FileResponse:
    """Download the MinerU-generated Markdown file.

    Args:
        paper_id: Paper ID to download Markdown for.

    Returns:
        FileResponse with the Markdown file.
    """
    if get_paper(paper_id) is None:
        raise HTTPException(status_code=404, detail="Paper not found")

    from app.services.mineru_service import get_mineru_status
    status = get_mineru_status(paper_id)

    if status is None or not status.get("markdown_path"):
        raise HTTPException(
            status_code=404,
            detail="MinerU Markdown file not available. Run conversion first.",
        )

    markdown_path = Path(status["markdown_path"])
    if not markdown_path.exists():
        raise HTTPException(status_code=404, detail="Markdown file not found on disk")

    return FileResponse(
        path=markdown_path,
        media_type="text/markdown",
        filename=f"{paper_id}_mineru.md",
    )


# --- Duplicate Detection Endpoints ---

class DuplicateCheckRequest(BaseModel):
    title: str = ""
    title_cn: str = ""
    title_en: str = ""
    authors: str = ""
    keywords: str = ""
    doi: str = ""
    exclude_paper_id: str = ""


@router.post("/check-duplicate")
def check_duplicate_api(payload: DuplicateCheckRequest) -> dict:
    """Check for duplicate papers in the database.

    Args:
        payload: DuplicateCheckRequest with paper metadata.

    Returns:
        Dict with has_duplicates, candidates list, and total_count.
    """
    candidates = check_duplicate_paper(**payload.model_dump())
    return {
        "has_duplicates": len(candidates) > 0,
        "candidates": candidates,
        "total_count": len(candidates),
    }


@router.post("/{paper_id}/continue-analysis")
def continue_analysis_api(paper_id: str) -> dict:
    """Continue analysis after confirming duplicate detection.

    Spawns a background thread to run the (potentially long) 8-dimension
    analysis so the HTTP request returns immediately. The frontend polls
    the paper status to detect completion.

    Args:
        paper_id: Paper ID to continue analysis for.

    Returns:
        Dict with paper_id, status, and message.
    """
    paper = get_paper(paper_id)
    if paper is None:
        raise HTTPException(status_code=404, detail="Paper not found")

    if paper.status != "duplicate_detected":
        raise HTTPException(
            status_code=400,
            detail=f"Paper {paper_id} is not in duplicate_detected status (current: {paper.status})",
        )

    def worker() -> None:
        try:
            continue_analysis_after_duplicate(paper_id)
        except Exception:
            logger.exception(
                "Background continue_analysis_after_duplicate failed paper_id=%s",
                paper_id,
            )
            _mark_paper_failed(paper_id, "查重后继续分析失败，请重试或联系管理员")

    Thread(target=worker, daemon=True).start()
    return {
        "paper_id": paper_id,
        "status": "running",
        "message": "Analysis resumed after duplicate confirmation",
    }


@router.get("/{paper_id}/duplicate-candidates")
def get_duplicate_candidates_api(paper_id: str) -> dict:
    """Fetch stored duplicate candidates for a paper.

    Args:
        paper_id: Paper ID to fetch duplicate candidates for.

    Returns:
        Dict with candidates list.
    """
    from app.db import session as db_session

    paper = get_paper(paper_id)
    if paper is None:
        raise HTTPException(status_code=404, detail="Paper not found")

    if paper.status != "duplicate_detected":
        return {
            "candidates": [],
            "total_count": 0,
            "message": "Paper is not in duplicate_detected status",
        }

    candidates = []
    with db_session() as conn:
        row = conn.execute(
            """
            SELECT sections_json FROM paper_texts
            WHERE paper_id = ? AND text_scope = 'metadata'
            ORDER BY updated_at DESC
            LIMIT 1
            """,
            (paper_id,),
        ).fetchone()

        if row and row["sections_json"]:
            try:
                sections = json.loads(row["sections_json"])
                candidates = sections.get("duplicate_candidates", [])
            except (ValueError, TypeError):
                pass

    return {
        "paper_id": paper_id,
        "candidates": candidates,
        "total_count": len(candidates),
    }
