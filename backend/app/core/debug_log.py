"""Debug log helpers for paper parsing workflows."""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.core.config import settings


def _debug_dir() -> Path:
    path = settings.workspace_dir / "debug_logs"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _task_log_dir() -> Path:
    path = settings.workspace_dir / "task_logs"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _safe_text(value: Any, limit: int = 2000) -> Any:
    if isinstance(value, str):
        return value[:limit]
    if isinstance(value, (list, tuple)):
        return [_safe_text(item, limit=limit) for item in value]
    if isinstance(value, dict):
        return {str(key): _safe_text(val, limit=limit) for key, val in value.items()}
    return value


def debug_log_path(paper_id: str) -> Path:
    ts = datetime.now(timezone.utc).strftime("%Y%m%d")
    return _debug_dir() / f"{ts}_{paper_id}.jsonl"


def task_log_path(paper_id: str) -> Path:
    return _task_log_dir() / f"{paper_id}.jsonl"


def append_debug_record(paper_id: str, stage: str, **payload: Any) -> Path:
    record = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "paper_id": paper_id,
        "stage": stage,
        **{key: _safe_text(value) for key, value in payload.items()},
    }
    path = debug_log_path(paper_id)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False) + "\n")
    return path


def clear_task_logs(paper_id: str) -> None:
    """Remove the task log file so a fresh analysis run starts clean."""
    path = task_log_path(paper_id)
    path.unlink(missing_ok=True)


def log_task_event(
    paper_id: str,
    step: str,
    api: str = "",
    status: str = "running",
    duration_ms: int = 0,
    detail: str = "",
    fallback: bool = False,
    error: str = "",
) -> Path:
    """Write a structured task log entry for the frontend terminal display.

    For a given paper/step, this creates a new entry.  Use ``log_task_update``
    to *update* the last matching entry instead of appending a new one.

    Args:
        paper_id: Target paper ID.
        step: Human-readable step name (e.g. '上传文件', 'MinerU 解析').
        api: API or function called (e.g. 'mineru.convert_pdf_to_markdown').
        status: 'running' | 'success' | 'failed' | 'skipped' | 'fallback'.
        duration_ms: Duration in milliseconds (0 for running steps).
        detail: Additional detail text.
        fallback: Whether this step was a fallback (OCR fallback etc.).
        error: Error message if status is 'failed'.

    Returns:
        Path to the task log file.
    """
    record = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "paper_id": paper_id,
        "step": step,
        "api": api,
        "status": status,
        "duration_ms": duration_ms,
        "detail": detail[:500] if detail else "",
        "fallback": fallback,
        "error": error[:500] if error else "",
    }
    path = task_log_path(paper_id)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False) + "\n")
    return path


def log_task_update(
    paper_id: str,
    step: str,
    api: str = "",
    status: str = "success",
    duration_ms: int = 0,
    detail: str = "",
    fallback: bool = False,
    error: str = "",
) -> Path:
    """Update the last task-log entry for *step* instead of appending a new one.

    This avoids the "running" + "success" duplicate rows that appeared when
    the terminal first reported a step as running and later marked it done.

    If no matching entry exists yet the call falls back to ``log_task_event``.
    """
    path = task_log_path(paper_id)
    existing: list[dict[str, Any]] = []
    if path.exists():
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if line:
                    try:
                        existing.append(json.loads(line))
                    except json.JSONDecodeError:
                        pass

    # Find the last entry whose step matches
    idx = -1
    for i in range(len(existing) - 1, -1, -1):
        if existing[i].get("step") == step:
            idx = i
            break

    if idx == -1:
        # No matching entry – create a new one
        return log_task_event(
            paper_id, step, api, status, duration_ms, detail, fallback, error
        )

    # Merge the new fields into the existing entry
    existing[idx]["ts"] = datetime.now(timezone.utc).isoformat()
    if api:
        existing[idx]["api"] = api
    existing[idx]["status"] = status
    if duration_ms:
        existing[idx]["duration_ms"] = duration_ms
    if detail:
        existing[idx]["detail"] = detail[:500]
    existing[idx]["fallback"] = fallback
    if error:
        existing[idx]["error"] = error[:500]

    # Rewrite the whole file
    with path.open("w", encoding="utf-8") as handle:
        for entry in existing:
            handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
    return path


def read_task_logs(paper_id: str) -> list[dict[str, Any]]:
    """Read all task log entries for a paper, newest first.

    Args:
        paper_id: Target paper ID.

    Returns:
        List of task log entries (most recent first).
    """
    path = task_log_path(paper_id)
    if not path.exists():
        return []
    entries = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                entries.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return entries


def task_log_timer() -> float:
    """Return the current high-resolution timestamp for duration calculation."""
    return time.perf_counter()
