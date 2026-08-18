"""Streaming chat client for DeepSeek API.

Uses httpx for streaming SSE responses, separate from the synchronous
urllib-based deepseek_client.py used for analysis.

The client supports:
- Streaming token responses via httpx.SSE
- Cancellation via asyncio.Event
- Error handling and retry logic
"""

from __future__ import annotations

import json
import logging
import time
from typing import AsyncIterator

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

# Maximum characters of paper context injected into the system prompt.
# For chat, we keep context smaller than analysis to leave room for the
# conversation history and the model's response.
MAX_CONTEXT_CHARS = 60000

# HTTP timeout for streaming connections (seconds).
STREAM_TIMEOUT = 300


class ChatClientError(RuntimeError):
    pass


def _truncate_context(text: str, max_chars: int = MAX_CONTEXT_CHARS) -> str:
    """Truncate paper context to fit within model context window.

    For chat, we prioritize the head (intro + abstract) and tail
    (conclusion + references) to give the model the most useful context.
    """
    if not text or len(text) <= max_chars:
        return text or ""

    head_size = int(max_chars * 0.5)
    tail_size = max_chars - head_size
    head = text[:head_size]
    tail = text[-tail_size:]
    return (
        head
        + "\n\n[... 中间部分内容已省略以适配上下文长度 ...]\n\n"
        + tail
    )


async def stream_chat(
    messages: list[dict],
    temperature: float = 0.7,
    max_retries: int = 2,
    model: str | None = None,
) -> AsyncIterator[str]:
    """Stream a chat completion response from DeepSeek.

    Args:
        messages: List of message dicts with 'role' and 'content' keys.
        temperature: Sampling temperature (0.0-2.0).
        max_retries: Maximum number of retry attempts for transient errors.
        model: Override model name (e.g. 'deepseek-v4-pro', 'deepseek-v4-flash').

    Yields:
        String tokens/chunks from the model response.

    Raises:
        ChatClientError: If the API call fails after all retries.
    """
    if not settings.deepseek_api_key:
        raise ChatClientError("API key not configured")

    url = f"{settings.deepseek_base_url.rstrip('/')}/chat/completions"

    effective_model = model or settings.deepseek_model

    body = {
        "model": effective_model,
        "messages": messages,
        "temperature": temperature,
        "stream": True,
    }

    last_error: Exception | None = None
    for attempt in range(max_retries + 1):
        try:
            async with httpx.AsyncClient(timeout=STREAM_TIMEOUT) as client:
                async with client.stream(
                    "POST",
                    url,
                    json=body,
                    headers={
                        "Authorization": f"Bearer {settings.deepseek_api_key}",
                        "Content-Type": "application/json",
                    },
                ) as response:
                    response.raise_for_status()

                    async for line in response.aiter_lines():
                        line = line.strip()
                        if not line or line == "data: [DONE]":
                            continue

                        if line.startswith("data: "):
                            try:
                                data = json.loads(line[6:])
                                chunk = data.get("choices", [{}])[0]
                                delta = chunk.get("delta", {})
                                content = delta.get("content", "")
                                if content:
                                    yield content
                            except (json.JSONDecodeError, KeyError, IndexError):
                                continue

                    return  # Success, exit the function

        except httpx.HTTPStatusError as exc:
            last_error = exc
            logger.warning(
                "stream_chat http_error attempt=%d/%d status=%d",
                attempt + 1, max_retries, exc.response.status_code,
            )
            if attempt < max_retries:
                await _async_sleep(1 + attempt)
                continue
        except httpx.RequestError as exc:
            last_error = exc
            logger.warning(
                "stream_chat request_error attempt=%d/%d error=%s",
                attempt + 1, max_retries, str(exc),
            )
            if attempt < max_retries:
                await _async_sleep(2 + attempt * 2)
                continue

    raise ChatClientError(
        f"stream_chat failed after {max_retries + 1} attempts: {last_error}"
    ) from last_error


async def _async_sleep(seconds: float) -> None:
    """Simple async sleep helper."""
    import asyncio
    await asyncio.sleep(seconds)


# Fast model used for lightweight tasks (e.g. session title generation).
TITLE_MODEL = "deepseek-v4-flash"

# Non-streaming timeout for short completions (title generation).
SHORT_TIMEOUT = 30


def _fallback_title(message: str) -> str:
    """Generate a title by smart truncation of the first message.

    Used as a fallback when LLM-based title generation is unavailable.
    """
    text = message.strip().replace("\n", " ").replace("\r", " ")
    text = " ".join(text.split())
    # Strip common prefix patterns so the title captures the real intent.
    for prefix in (
        "请帮我分析这段内容：", "请帮我分析这段内容:", "请帮我分析：",
        "请帮我分析:", "请分析", "请总结", "请解释", "请介绍",
        "请列出", "请生成", "请详细", "帮我", "请",
    ):
        if text.startswith(prefix):
            text = text[len(prefix):].lstrip("：:、，, ").strip()
            break
    if not text:
        text = message.strip().replace("\n", " ")
    if len(text) > 20:
        text = text[:20] + "…"
    return text or "新对话"


async def generate_title(first_message: str) -> str:
    """Generate a concise title for a chat session from the first user message.

    Uses a non-streaming LLM call with the fast model. Falls back to smart
    truncation on any error so the session always gets a title.

    Args:
        first_message: The first user message in the session.

    Returns:
        A short title string (typically ≤15 chars).
    """
    if not first_message or not first_message.strip():
        return "新对话"

    if not settings.deepseek_api_key:
        return _fallback_title(first_message)

    url = f"{settings.deepseek_base_url.rstrip('/')}/chat/completions"
    body = {
        "model": TITLE_MODEL,
        "messages": [
            {
                "role": "system",
                "content": (
                    "你是对话标题生成器。根据用户的第一条消息，提炼出对话的核心主题，"
                    "生成一个简短的标题（不超过15个字，不要加引号、书名号或标点结尾）。"
                    "只输出标题文本本身。"
                ),
            },
            {"role": "user", "content": first_message[:500]},
        ],
        "temperature": 0.3,
        "stream": False,
        "max_tokens": 30,
    }

    try:
        async with httpx.AsyncClient(timeout=SHORT_TIMEOUT) as client:
            response = await client.post(
                url,
                json=body,
                headers={
                    "Authorization": f"Bearer {settings.deepseek_api_key}",
                    "Content-Type": "application/json",
                },
            )
            response.raise_for_status()
            data = response.json()
            title = data["choices"][0]["message"]["content"].strip()
            # Clean up stray quotes / newlines the model may add.
            title = title.strip("\"'""「」『』").replace("\n", " ").strip()
            title = " ".join(title.split())
            if title and len(title) <= 30:
                return title
            return _fallback_title(first_message)
    except Exception as exc:
        logger.warning("generate_title failed, using fallback: %s", exc)
        return _fallback_title(first_message)