"""Audio transcription route — uses OpenAI Whisper for speech-to-text."""

from flask import Blueprint, request, jsonify

transcribe_bp = Blueprint("transcribe", __name__)


@transcribe_bp.route("/audio", methods=["POST"])
def transcribe_audio():
    """
    POST /transcribe/audio
    Body: multipart form with 'file' field (audio file)
    Returns: { "transcript": "...", "summary": "...", "sentiment": {...} }
    """
    if "file" not in request.files:
        return jsonify({"error": "No audio file provided"}), 400

    # Stub — will use OpenAI Whisper in Phase 5
    return jsonify({
        "transcript": "Stub — Whisper transcription not yet configured",
        "summary": "",
        "sentiment": {"label": "NEUTRAL", "score": 0.5},
    })
