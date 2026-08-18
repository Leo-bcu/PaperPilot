"""Chat API routes for AI-assisted reading conversations.

Provides endpoints for:
- Session management (create, list, get, delete)
- Streaming chat with context anchoring (SSE via StreamingResponse)
- Message editing, regeneration, and deletion
- Quick command templates
"""

from __future__ import annotations

import json
import logging
from typing import AsyncGenerator, List, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.core.chat_client import ChatClientError, stream_chat
from app.services.chat_service import (
    add_message,
    build_chat_messages,
    clear_session_messages,
    create_session,
    delete_session,
    ensure_session_title,
    get_quick_commands,
    get_session,
    list_sessions,
    soft_delete_message,
    update_message,
    update_session_title,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["chat"])


# ========== Request/Response Models ==========


class CreateSessionRequest(BaseModel):
    paper_id: str
    title: str = ""


class SendMessageRequest(BaseModel):
    message: str
    selected_text: str = ""
    edit_message_id: str = ""  # If set, treat as editing/replacing this message
    model: str = ""  # Optional model override (e.g. 'deepseek-v4-pro', 'deepseek-v4-flash')


class EditMessageRequest(BaseModel):
    content: str


class RegenerateRequest(BaseModel):
    """Used to regenerate the last assistant response."""
    pass


# ========== Session Endpoints ==========


@router.post("/sessions")
def create_session_api(payload: CreateSessionRequest) -> dict:
    """Create a new chat session for a paper.

    Args:
        payload: CreateSessionRequest with paper_id and optional title.

    Returns:
        Session dict.
    """
    session = create_session(payload.paper_id, payload.title)
    return session


@router.get("/sessions")
def list_sessions_api(paper_id: str) -> dict:
    """List all chat sessions for a paper.

    Args:
        paper_id: Paper ID to list sessions for.

    Returns:
        Dict with sessions list.
    """
    sessions = list_sessions(paper_id)
    return {"sessions": sessions}


@router.get("/sessions/{session_id}")
def get_session_api(session_id: str) -> dict:
    """Get a chat session with all its messages.

    Args:
        session_id: Session ID.

    Returns:
        Session dict with messages, or 404.
    """
    session_data = get_session(session_id)
    if not session_data:
        raise HTTPException(status_code=404, detail="Chat session not found")
    return session_data


@router.delete("/sessions/{session_id}")
def delete_session_api(session_id: str) -> dict:
    """Delete a chat session and all its messages.

    Args:
        session_id: Session ID to delete.

    Returns:
        Confirmation dict.
    """
    if not delete_session(session_id):
        raise HTTPException(status_code=404, detail="Chat session not found")
    return {"session_id": session_id, "deleted": True}


@router.put("/sessions/{session_id}/title")
def update_session_title_api(session_id: str, payload: dict) -> dict:
    """Update the title of a chat session.

    Args:
        session_id: Session ID.
        payload: Dict with 'title' field.

    Returns:
        Confirmation dict.
    """
    title = payload.get("title", "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title cannot be empty")
    update_session_title(session_id, title)
    return {"session_id": session_id, "title": title}


@router.post("/sessions/{session_id}/clear")
def clear_session_api(session_id: str) -> dict:
    """Clear all messages in a session (soft delete for recovery).

    Args:
        session_id: Session ID to clear.

    Returns:
        Confirmation dict.
    """
    clear_session_messages(session_id)
    return {"session_id": session_id, "cleared": True}


# ========== Message Endpoints ==========


@router.post("/sessions/{session_id}/messages/stream")
async def stream_chat_message_api(
    session_id: str,
    payload: SendMessageRequest,
) -> StreamingResponse:
    """Send a message and stream the AI response via SSE.

    This is the core chat endpoint. It:
    1. Loads the session and its conversation history
    2. Builds context-anchored messages with paper full text
    3. Streams the AI response token by token
    4. Saves both user message and assistant response

    Args:
        session_id: Session ID.
        payload: SendMessageRequest with message, selected_text, etc.

    Returns:
        StreamingResponse with SSE events.
    """
    session_data = get_session(session_id)
    if not session_data:
        raise HTTPException(status_code=404, detail="Chat session not found")

    paper_id = session_data["paper_id"]

    # Save user message. If user had selected text (划词即问), persist it as a
    # dedicated citation so the UI can render a reference badge post-hoc.
    user_citations: Optional[List[dict]] = None
    if payload.selected_text and payload.selected_text.strip():
        user_citations = [{"section": None, "page": None,
                           "quote": payload.selected_text.strip(),
                           "_type": "selected_text"}]
    user_msg = add_message(
        session_id=session_id,
        role="user",
        content=payload.message,
        citations=user_citations,
    )

    # Build conversation history (exclude the message being edited)
    history = []
    skip_next_assistant = False
    for msg in session_data["messages"]:
        if payload.edit_message_id and msg["id"] == payload.edit_message_id:
            skip_next_assistant = True
            continue
        if skip_next_assistant and msg["role"] == "assistant":
            skip_next_assistant = False
            continue
        if msg["role"] in ("user", "assistant"):
            history.append({"role": msg["role"], "content": msg["content"]})

    # If editing, remove the old message and its assistant response from history
    if payload.edit_message_id:
        # Soft-delete the old user message
        soft_delete_message(payload.edit_message_id)
        # Also soft-delete the assistant response that follows it
        # (find the assistant message after this user message)
        msgs = session_data["messages"]
        found = False
        for m in msgs:
            if found and m["role"] == "assistant":
                soft_delete_message(m["id"])
                break
            if m["id"] == payload.edit_message_id:
                found = True

    # Build the full messages for the LLM
    messages = build_chat_messages(
        paper_id=paper_id,
        conversation_history=history,
        user_message=payload.message,
        selected_text=payload.selected_text,
    )

    async def event_generator() -> AsyncGenerator[str, None]:
        assistant_content = ""
        try:
            async for chunk in stream_chat(messages, temperature=0.7, model=payload.model or None):
                assistant_content += chunk
                # SSE format
                data = json.dumps({"content": chunk, "done": False}, ensure_ascii=False)
                yield f"data: {data}\n\n"
        except ChatClientError as e:
            error_data = json.dumps({
                "content": f"\n\n[错误：{str(e)}]",
                "done": True,
                "error": True,
            }, ensure_ascii=False)
            yield f"data: {error_data}\n\n"
            return

        # Save the assistant response BEFORE the done event so the frontend's
        # follow-up getChatSession() call reliably sees the persisted message.
        if assistant_content:
            add_message(
                session_id=session_id,
                role="assistant",
                content=assistant_content,
            )

        # Send the done event FIRST so the frontend immediately knows
        # streaming is complete (removes the cursor, enables input).
        # Title generation happens after — the connection stays open
        # but the UI already reflects completion.
        final_data = json.dumps({
            "content": "",
            "done": True,
        }, ensure_ascii=False)
        yield f"data: {final_data}\n\n"

        # Auto-generate a session title from the first message if the session
        # has no title yet. Runs after the done event so it doesn't block the
        # streaming completion signal.
        try:
            await ensure_session_title(session_id, payload.message)
        except Exception as exc:  # noqa: BLE001 - title failure must not break chat
            logger.warning("Failed to auto-generate title: %s", exc)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.put("/sessions/{session_id}/messages/{message_id}")
def edit_message_api(
    session_id: str,
    message_id: str,
    payload: EditMessageRequest,
) -> dict:
    """Edit a user message. This will also invalidate subsequent assistant responses.

    Args:
        session_id: Session ID.
        message_id: Message ID to edit.
        payload: EditMessageRequest with new content.

    Returns:
        Confirmation dict.
    """
    # Soft-delete the old message and all subsequent messages
    session_data = get_session(session_id)
    if not session_data:
        raise HTTPException(status_code=404, detail="Chat session not found")

    found = False
    for msg in session_data["messages"]:
        if msg["id"] == message_id:
            found = True
        if found:
            soft_delete_message(msg["id"])

    if not found:
        raise HTTPException(status_code=404, detail="Message not found")

    # Create the edited version
    new_msg = add_message(
        session_id=session_id,
        role="user",
        content=payload.content,
    )

    return {"message_id": new_msg["id"], "session_id": session_id}


@router.delete("/sessions/{session_id}/messages/{message_id}")
def delete_message_api(session_id: str, message_id: str) -> dict:
    """Delete a message (soft delete).

    Args:
        session_id: Session ID.
        message_id: Message ID to delete.

    Returns:
        Confirmation dict.
    """
    soft_delete_message(message_id)
    return {"message_id": message_id, "deleted": True}


# ========== Quick Commands ==========


@router.get("/quick-commands")
def get_quick_commands_api() -> dict:
    """Get the list of quick command templates.

    Returns:
        Dict with commands list.
    """
    commands = get_quick_commands()
    return {"commands": commands}