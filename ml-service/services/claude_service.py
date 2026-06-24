"""
Gemini AI service — uses google-genai (new official SDK).
Model: gemini-2.0-flash — FREE tier (15 req/min, 1M tokens/day).
Get free key: https://aistudio.google.com/apikey
"""

import os
import json

_client = None


def get_client():
    global _client
    if _client is None:
        api_key = os.getenv("GEMINI_API_KEY", "").strip()
        if not api_key or api_key == "your-gemini-api-key-here":
            raise RuntimeError(
                "GEMINI_API_KEY not set. Get a FREE key at "
                "https://aistudio.google.com/apikey and add it to your .env file"
            )
        from google import genai
        _client = genai.Client(api_key=api_key)
    return _client


MODEL      = "models/gemini-2.5-flash"
MINI_MODEL = "models/gemini-2.5-flash"

_SYSTEM_PROMPT = """You are LeadPulse's AI CRM assistant. You answer questions about the user's CRM data.

RULES:
1. Answer ONLY from the provided CRM data context below.
2. If the answer is not clearly present, say: "I don't have that specific information in your CRM data."
3. Be concise and specific. Reference contact names, deal titles, and dollar values directly.
4. Never fabricate CRM data, names, or numbers.
5. Format responses using plain text. Use bullet points for lists.
6. Keep answers under 200 words unless the user explicitly asks for detail."""


def stream_rag_answer(question: str, context: str, history: list = None):
    """
    Stream a RAG-grounded answer from Gemini as text chunks (generator).
    """
    from google import genai
    from google.genai import types

    client = get_client()

    # Build conversation history
    contents = []
    for turn in (history or [])[-6:]:
        role    = turn.get("role", "")
        content = turn.get("content", "")
        if role == "user":
            contents.append(types.Content(role="user",  parts=[types.Part(text=content)]))
        elif role in ("assistant", "model"):
            contents.append(types.Content(role="model", parts=[types.Part(text=content)]))

    user_msg = f"CRM Data Context:\n{context}\n\n---\n\nQuestion: {question}"
    contents.append(types.Content(role="user", parts=[types.Part(text=user_msg)]))

    response = client.models.generate_content_stream(
        model=MODEL,
        contents=contents,
        config=types.GenerateContentConfig(
            system_instruction=_SYSTEM_PROMPT,
            max_output_tokens=800,
            temperature=0.5,
        ),
    )

    for chunk in response:
        if chunk.text:
            yield chunk.text


def get_json_response(prompt: str, system_extra: str = "") -> dict:
    """Get a structured JSON dict from Gemini."""
    from google import genai
    from google.genai import types

    client = get_client()

    system = (
        "You are a JSON extraction assistant. "
        + system_extra
        + " IMPORTANT: Reply with valid JSON only. No markdown fences, no explanation."
    )

    response = client.models.generate_content(
        model=MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=system,
            max_output_tokens=800,
            temperature=0.2,
            response_mime_type="application/json",
        ),
    )

    text = response.text.strip()
    if text.startswith("```"):
        text = text.replace("```json", "").replace("```", "").strip()

    return json.loads(text)


def get_text_response(prompt: str, system: str = "", max_tokens: int = 400) -> str:
    """Get a plain-text response from Gemini (non-streaming)."""
    from google import genai
    from google.genai import types

    client = get_client()

    response = client.models.generate_content(
        model=MINI_MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=system or "You are a helpful CRM assistant.",
            max_output_tokens=max_tokens,
            temperature=0.5,
        ),
    )
    return response.text
