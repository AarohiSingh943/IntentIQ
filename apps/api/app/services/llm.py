"""Language-model providers used to refine intent. Every provider returns a plain dict or None;
the deterministic compiler decides what to keep."""

from __future__ import annotations

import json
import re
from typing import Any, Protocol

import httpx

from app.core.config import Settings
from app.core.logging import get_logger
from app.domain.intent import LLM_SCHEMA_HINT

logger = get_logger("llm")

SYSTEM_PROMPT = (
    "You compile a person's free-text wish for their next few hours into a strict JSON object "
    "for a city itinerary planner. Reply with JSON only, no prose, no code fences. Use null when "
    "the text gives no signal. Never invent a start time or duration that is not implied. "
    "Field guide: " + json.dumps(LLM_SCHEMA_HINT)
)


def extract_json(text: str) -> dict[str, Any] | None:
    if not text:
        return None
    cleaned = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.MULTILINE).strip()
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        data = json.loads(cleaned[start : end + 1])
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


class IntentModel(Protocol):
    name: str

    async def refine(self, query: str, local_time_iso: str) -> dict[str, Any] | None: ...


class GeminiIntentModel:
    name = "gemini"

    def __init__(self, api_key: str, model: str, timeout: float, user_agent: str):
        self.url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        self.api_key = api_key
        self.timeout = timeout
        self.user_agent = user_agent

    async def refine(self, query: str, local_time_iso: str) -> dict[str, Any] | None:
        payload = {
            "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
            "contents": [{"role": "user", "parts": [{"text": f"Local time now: {local_time_iso}\nWish: {query}"}]}],
            "generationConfig": {"responseMimeType": "application/json", "temperature": 0.2, "maxOutputTokens": 400},
        }
        async with httpx.AsyncClient(timeout=self.timeout, headers={"user-agent": self.user_agent}) as client:
            response = await client.post(self.url, params={"key": self.api_key}, json=payload)
        response.raise_for_status()
        body = response.json()
        text = body.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
        return extract_json(text)


class AnthropicIntentModel:
    name = "anthropic"

    def __init__(self, api_key: str, model: str, timeout: float, user_agent: str):
        self.api_key = api_key
        self.model = model
        self.timeout = timeout
        self.user_agent = user_agent

    async def refine(self, query: str, local_time_iso: str) -> dict[str, Any] | None:
        payload = {
            "model": self.model,
            "max_tokens": 400,
            "temperature": 0.2,
            "system": SYSTEM_PROMPT,
            "messages": [{"role": "user", "content": f"Local time now: {local_time_iso}\nWish: {query}"}],
        }
        headers = {
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
            "user-agent": self.user_agent,
        }
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post("https://api.anthropic.com/v1/messages", headers=headers, json=payload)
        response.raise_for_status()
        blocks = response.json().get("content", [])
        text = "".join(block.get("text", "") for block in blocks if block.get("type") == "text")
        return extract_json(text)


def build_intent_model(settings: Settings) -> IntentModel | None:
    if settings.llm_provider == "gemini" and settings.gemini_api_key:
        return GeminiIntentModel(settings.gemini_api_key, settings.gemini_model, settings.llm_timeout_seconds, settings.user_agent)
    if settings.llm_provider == "anthropic" and settings.anthropic_api_key:
        return AnthropicIntentModel(settings.anthropic_api_key, settings.anthropic_model, settings.llm_timeout_seconds, settings.user_agent)
    return None


async def refine_safely(model: IntentModel | None, query: str, local_time_iso: str) -> dict[str, Any] | None:
    if model is None:
        return None
    try:
        return await model.refine(query, local_time_iso)
    except httpx.HTTPStatusError as exc:  # never log the URL: it may carry the API key
        logger.warning("%s refinement failed: HTTP %s", model.name, exc.response.status_code)
        return None
    except Exception as exc:  # noqa: BLE001 - any upstream failure degrades to rules
        logger.warning("%s refinement failed: %s", model.name, type(exc).__name__)
        return None
