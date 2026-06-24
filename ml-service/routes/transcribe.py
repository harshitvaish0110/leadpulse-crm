"""
Voice transcription route.
Step 1: Transcribe audio with OpenAI Whisper.
Step 2: Extract structured sales data from transcript with Claude.
"""

import os
import json
import tempfile
from flask import Blueprint, request, jsonify

transcribe_bp = Blueprint("transcribe", __name__)


def _extract_with_claude(transcript_text: str) -> dict:
    """Use Claude to extract structured sales call data from transcript."""
    from services.claude_service import get_json_response

    prompt = f"""Extract structured data from this sales call transcript.

Transcript:
{transcript_text}

Return this exact JSON structure:
{{
  "summary": "2-3 sentence summary of the call",
  "sentiment": "POSITIVE or NEUTRAL or NEGATIVE",
  "actionItems": ["list of specific next actions"],
  "objections": ["customer concerns or objections raised"],
  "pricingMentions": ["any budget or pricing figures mentioned"],
  "nextSteps": "agreed next step or follow-up",
  "keyTopics": ["main topics discussed"]
}}"""

    return get_json_response(prompt, system_extra="You extract structured sales call data.")


@transcribe_bp.route("/", methods=["POST"])
def transcribe():
    """
    POST /transcribe/
    Form data: audio file (field name: 'audio')
    Returns: {
        transcript, summary, sentiment, actionItems,
        objections, pricingMentions, nextSteps, keyTopics
    }
    """
    if "audio" not in request.files:
        return jsonify({"error": "No audio file provided. Use field name 'audio'."}), 400

    audio_file = request.files["audio"]
    if not audio_file.filename:
        return jsonify({"error": "Empty filename"}), 400

    # Determine file extension
    ext = audio_file.filename.rsplit(".", 1)[-1].lower() if "." in audio_file.filename else "mp3"
    allowed_exts = {"mp3", "mp4", "wav", "m4a", "webm", "ogg", "flac"}
    if ext not in allowed_exts:
        return jsonify({"error": f"Unsupported audio format: {ext}"}), 400

    tmp_path = None
    try:
        # ── Step 1: Save to temp file ──────────────────────────────────
        with tempfile.NamedTemporaryFile(suffix=f".{ext}", delete=False) as tmp:
            audio_file.save(tmp.name)
            tmp_path = tmp.name

        # ── Step 2: Transcribe with Whisper ────────────────────────────
        api_key = os.getenv("OPENAI_API_KEY", "").strip()
        if not api_key:
            return jsonify({"error": "OPENAI_API_KEY not configured"}), 503

        from openai import OpenAI
        openai_client = OpenAI(api_key=api_key)

        with open(tmp_path, "rb") as f:
            transcript_response = openai_client.audio.transcriptions.create(
                model="whisper-1",
                file=f,
                language="en",
                response_format="text",
            )

        transcript_text = transcript_response if isinstance(transcript_response, str) else transcript_response.text

        # ── Step 3: Extract structured data with Claude ─────────────────
        try:
            extraction = _extract_with_claude(transcript_text)
        except Exception as claude_err:
            # Claude extraction failed — return transcript with fallback structure
            extraction = {
                "summary": "Could not extract summary — Claude unavailable.",
                "sentiment": "NEUTRAL",
                "actionItems": [],
                "objections": [],
                "pricingMentions": [],
                "nextSteps": "",
                "keyTopics": [],
                "claudeError": str(claude_err),
            }

        extraction["transcript"] = transcript_text
        return jsonify(extraction)

    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        # Always clean up temp file
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)
