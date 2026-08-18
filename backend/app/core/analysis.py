"""Eight-dimension analysis orchestration.

This module centralizes prompt preparation, Deepseek integration, and the
fallback logic used when the model is unavailable in local demo environments.
"""

from __future__ import annotations

import json
import logging

from app.core.deepseek_client import DeepseekError, analyze_text
from app.core.debug_log import append_debug_record
from app.core.metadata_client import (
    MetadataError,
    extract_metadata,
    extract_abstract_only,
    _detect_language,
    _clean_abstract_citations,
    _extract_doi,
    _extract_year,
    _extract_venue,
    _extract_chinese_thesis_info,
    _DEGREE_TYPE_RE,
    _UNIV_RE,
    detect_paper_language,
)

logger = logging.getLogger(__name__)


DEFAULT_FIELDS = (
    "title",
    "title_cn",
    "title_en",
    "authors",
    "source",
    "abstract_cn",
    "abstract_en",
    "keywords",
    "year",
    "doi",
    "tldr",
    "motivation",
    "methodology",
    "experiments",
    "resources",
    "ablation",
    "conclusion",
    "strengths",
    "weaknesses",
)


def _fallback_metadata(parsed: dict[str, str]) -> dict[str, str]:
    abstract_raw = ""
    abstract_cn = ""
    abstract_en = ""

    # Only accept locally-extracted abstracts if they pass the strict validity
    # check. On the fallback path we must be extra careful not to dump
    # first-page garbage as "the abstract".
    local_candidates = [
        (parsed.get("abstract", "") or "", None),
        (parsed.get("abstract_cn", "") or "", "zh"),
        (parsed.get("abstract_en", "") or "", "en"),
    ]
    for cand, expected_lang in local_candidates:
        cand = (cand or "").strip()
        if not _is_truly_valid_abstract(cand):
            continue
        detected = _detect_language(cand)
        if expected_lang and detected != expected_lang:
            continue
        cleaned = _clean_abstract_citations(cand)
        if not abstract_raw:
            abstract_raw = cleaned
        if detected == "zh" and not abstract_cn:
            abstract_cn = cleaned
        elif detected == "en" and not abstract_en:
            abstract_en = cleaned

    # Gather parsed values from local extraction
    source = parsed.get("source", "") or ""
    year = parsed.get("year", "") or ""
    doi = parsed.get("doi", "") or ""

    # =========================================================================
    # Regex enhancement for the fallback path (LLM failed entirely,
    # so local regex is our best shot at getting DOI / venue / year).
    # =========================================================================
    full_text_for_regex = "\n".join(filter(None, [
        parsed.get("raw_text", "")[:15000],
        parsed.get("full_text", "")[:15000],
        parsed.get("candidate_text", "")[:15000],
        parsed.get("metadata_pages_text", "")[:10000],
        parsed.get("first_pages_text", "")[:10000],
        parsed.get("metadata_text", "")[:10000],
        parsed.get("abstract_region", "")[:5000],
    ]))

    if full_text_for_regex:
        paper_lang = detect_paper_language(parsed)
        is_chinese_thesis = (
            paper_lang == "zh"
            and bool(_DEGREE_TYPE_RE.search(full_text_for_regex[:8000]) or _UNIV_RE.search(full_text_for_regex[:8000]))
        )

        # DOI
        regex_doi = _extract_doi(full_text_for_regex)
        if regex_doi and not doi:
            doi = regex_doi

        # Source / venue
        if is_chinese_thesis:
            thesis_info = _extract_chinese_thesis_info(full_text_for_regex)
            if thesis_info["source"] and not source:
                source = thesis_info["source"]
        elif not source:
            regex_venue = _extract_venue(full_text_for_regex)
            if regex_venue:
                source = regex_venue

        # Year
        regex_year = _extract_year(full_text_for_regex, prefer_defense=is_chinese_thesis)
        if regex_year and not year:
            year = regex_year

    return {
        "title_cn": parsed.get("title_cn", "") or "",
        "title_en": parsed.get("title_en", "") or "",
        "authors": parsed.get("authors", "") or "",
        "source": source,
        "abstract": abstract_raw,
        "abstract_cn": abstract_cn,
        "abstract_en": abstract_en,
        "keywords": parsed.get("keywords", "") or "",
        "year": year,
        "doi": doi,
    }


def _fallback_analysis(parsed: dict[str, str]) -> dict[str, str]:
    abstract = parsed.get("abstract", "")[:1200]
    full_text = parsed.get("full_text", "")[:2400]
    return {
        "tldr": "当前为 Demo 降级输出，无法基于全文生成 TLDR；建议补充完整 PDF 后重新分析。",
        "motivation": abstract or full_text or "文中未明确提供完整摘要与正文时，仅能基于现有文本推断研究意图；建议补充完整 PDF 原文。",
        "methodology": parsed.get("method", "") or "文中未明确提供方法细节时，仅能从已有内容推断核心流程；建议补充方法部分以获得更准确的结构化分析。",
        "experiments": parsed.get("experiments", "") or "文中未明确提供实验细节时，无法确认数据集、指标与对比基线；建议补充实验章节后再分析有效性。",
        "resources": "当前版本未获取到足够信息来精确判断训练资源、算力或推理成本，因此只能标记为文中未明确说明。",
        "ablation": "当前版本未获取到完整消融信息，无法判断各模块贡献与设计必要性。",
        "conclusion": parsed.get("conclusion", "") or "文中未明确提供完整结论时，仅能依据已有内容概括作者的主要倾向。",
        "strengths": "输出结构固定，便于快速阅读、归纳和后续人工校正，适合作为论文理解的第一版草稿。",
        "weaknesses": "当前为 Demo 版本，对原文可解析文本依赖较强；若 PDF 是扫描件或文本提取失败，分析深度会明显下降。",
    }


def _is_truly_valid_abstract(text: str) -> bool:
    """Strict validity check for any candidate abstract text.

    Ensures we never fill the abstract field with garbage content like
    a raw dump of the first page (title, authors, affiliations, etc.),
    which is what happens when _locate_abstract_region captures a large
    chunk around an "Abstract." marker that contains no actual abstract.
    """
    if not text:
        return False
    stripped = text.strip()
    if len(stripped) < 80:
        return False
    lower = stripped.lower()
    # PDF structural noise markers
    bad_tokens = ("%pdf-", " endobj ", " obj <<", " endstream ", " xref ", " trailer ")
    padded = f" {lower} "
    if any(token in padded for token in bad_tokens):
        return False
    # Reject if it starts with a TOC / copyright / header marker
    first_200 = lower[:200]
    leading_indicators = (
        "contents", "table of contents", "copyright",
        "all rights reserved", "ieee", "acm ",
        "received ", "revised ", "accepted ",
    )
    if any(ind in first_200 for ind in leading_indicators):
        return False
    return True


def build_metadata_payload(parsed: dict[str, str]) -> dict[str, str]:
    logger.info(
        "metadata_build_start title=%r title_cn=%r title_en=%r authors=%r abstract_len=%s metadata_len=%s candidate_len=%s",
        parsed.get("title", "")[:120],
        parsed.get("title_cn", "")[:120],
        parsed.get("title_en", "")[:120],
        parsed.get("authors", "")[:120],
        len(parsed.get("abstract", "")),
        len(parsed.get("metadata_text", "")),
        len(parsed.get("candidate_text", "")),
    )
    paper_id = parsed.get("paper_id", "unknown")
    append_debug_record(paper_id, "metadata_build_start", parsed=parsed)
    try:
        model_result = extract_metadata(parsed)
        payload = {field: str(model_result.get(field, "")).strip() for field in ("title_cn", "title_en", "authors", "source", "abstract", "abstract_cn", "abstract_en", "keywords", "year", "doi")}

        # 1) Validate LLM output strictly — discard invalid pseudo-abstracts
        for k in ("abstract", "abstract_cn", "abstract_en"):
            if payload.get(k) and not _is_truly_valid_abstract(payload[k]):
                payload[k] = ""

        # 2) If LLM gave nothing useful, try the AI single-purpose abstract
        #    extractor on the locally-located region, then validate its output.
        if not payload.get("abstract"):
            abstract_region = parsed.get("abstract_region", "")
            if abstract_region:
                try:
                    ai_abstract = extract_abstract_only(abstract_region)
                    if ai_abstract and _is_truly_valid_abstract(ai_abstract):
                        payload["abstract"] = ai_abstract
                        lang = _detect_language(ai_abstract)
                        if lang == "zh":
                            payload["abstract_cn"] = ai_abstract
                            payload["abstract_en"] = ""
                        else:
                            payload["abstract_en"] = ai_abstract
                            payload["abstract_cn"] = ""
                except Exception as e:
                    logger.warning("extract_abstract_only failed: %s", e)

        # 3) If still nothing, check locally-extracted abstracts.
        #    DO NOT fall back to raw first_pages_text / abstract_region dumps.
        if not payload.get("abstract"):
            local_candidates = [
                parsed.get("abstract", "").strip(),
                parsed.get("abstract_en", "").strip(),
                parsed.get("abstract_cn", "").strip(),
            ]
            for cand in local_candidates:
                if _is_truly_valid_abstract(cand):
                    payload["abstract"] = cand
                    lang = _detect_language(cand)
                    if lang == "zh":
                        payload["abstract_cn"] = cand
                        payload["abstract_en"] = ""
                    else:
                        payload["abstract_en"] = cand
                        payload["abstract_cn"] = ""
                    break

        # 4) Cross-fill abstract_cn / abstract_en from the chosen abstract field.
        if not payload.get("abstract_cn"):
            candidate_cn = payload.get("abstract", "").strip()
            if candidate_cn and _detect_language(candidate_cn) == "zh":
                payload["abstract_cn"] = candidate_cn
        if not payload.get("abstract_en"):
            candidate_en = payload.get("abstract", "").strip()
            if candidate_en and _detect_language(candidate_en) == "en":
                payload["abstract_en"] = candidate_en

        # Final citation cleanup pass
        for k in ("abstract", "abstract_cn", "abstract_en"):
            if payload.get(k):
                payload[k] = _clean_abstract_citations(payload[k])

        payload["raw_json"] = json.dumps(model_result, ensure_ascii=False)
        payload["metadata_status"] = "done"
        payload["metadata_model_name"] = "deepseek"
        payload["metadata_prompt_version"] = "v1"
        payload["metadata_error_message"] = ""
        append_debug_record(paper_id, "metadata_build_done", payload=payload)
        logger.info("metadata_build_done status=done title_cn=%r title_en=%r authors=%r abstract_len=%s", payload.get("title_cn", "")[:120], payload.get("title_en", "")[:120], payload.get("authors", "")[:120], len(payload.get("abstract", "")))
        return payload
    except (MetadataError, json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
        fallback = _fallback_metadata(parsed)
        fallback["raw_json"] = json.dumps(fallback, ensure_ascii=False)
        fallback["metadata_status"] = "failed"
        fallback["metadata_model_name"] = "fallback"
        fallback["metadata_prompt_version"] = "v1"
        fallback["metadata_error_message"] = str(exc)
        append_debug_record(paper_id, "metadata_build_failed", error=str(exc), fallback=fallback)
        logger.warning("metadata_build_failed error=%s title_cn=%r title_en=%r authors=%r abstract_len=%s", exc, fallback.get("title_cn", "")[:120], fallback.get("title_en", "")[:120], fallback.get("authors", "")[:120], len(fallback.get("abstract", "")))
        return fallback


def build_analysis_payload(parsed: dict[str, str]) -> dict[str, str]:
    paper_id = parsed.get("paper_id", "unknown")
    extraction_method = parsed.get("extraction_method", "first_six_pages")
    append_debug_record(paper_id, "analysis_build_start", parsed=parsed)
    try:
        model_result = analyze_text(parsed)
        payload = {field: str(model_result.get(field, "")).strip() for field in DEFAULT_FIELDS}
        if not any(payload.get(field, "") for field in ("motivation", "methodology", "experiments", "conclusion", "title", "authors", "source")):
            raise ValueError("Deepseek returned an empty analysis payload")
        payload["raw_json"] = json.dumps(model_result, ensure_ascii=False)
        payload["analysis_status"] = "done"
        payload["model_name"] = "deepseek"
        payload["prompt_version"] = "v1"
        payload["extraction_method"] = extraction_method
        payload["error_message"] = ""
        append_debug_record(paper_id, "analysis_build_done", payload=payload)
        return payload
    except (DeepseekError, json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
        fallback = _fallback_analysis(parsed)
        fallback["raw_json"] = json.dumps(fallback, ensure_ascii=False)
        fallback["analysis_status"] = "failed"
        fallback["model_name"] = "fallback"
        fallback["prompt_version"] = "v1"
        fallback["extraction_method"] = extraction_method
        fallback["error_message"] = str(exc)
        append_debug_record(paper_id, "analysis_build_failed", error=str(exc), fallback=fallback)
        return fallback
