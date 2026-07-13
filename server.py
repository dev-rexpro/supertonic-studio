"""
Supertonic3 Voice Clone Studio — Web Server
FastAPI backend wrapping train_style.py and generate.py for the web GUI.
"""

import os
import sys
import json
import time
import threading
import subprocess
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, UploadFile, File, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ===== Paths =====
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
VOICES_DIR = os.path.join(BASE_DIR, "voices")
SAMPLES_DIR = os.path.join(BASE_DIR, "samples")
LOGS_DIR = os.path.join(BASE_DIR, "logs")
STYLES_DIR = os.path.join(BASE_DIR, "supertonic3", "voice_styles")
WEB_DIR = os.path.join(BASE_DIR, "web")

os.makedirs(VOICES_DIR, exist_ok=True)
os.makedirs(SAMPLES_DIR, exist_ok=True)
os.makedirs(LOGS_DIR, exist_ok=True)

# Add project root to path for helper imports
sys.path.insert(0, BASE_DIR)

# ===== App =====
app = FastAPI(title="Supertonic3 Voice Clone Studio")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ===== Training State =====
class TrainingState:
    def __init__(self):
        self.process: Optional[subprocess.Popen] = None
        self.status = "idle"  # idle | running | completed | error | stopped
        self.logs: list[str] = []
        self.config: dict = {}
        self.start_time: Optional[float] = None
        self.lock = threading.Lock()

    def reset(self):
        self.process = None
        self.status = "idle"
        self.logs = []
        self.config = {}
        self.start_time = None


training_state = TrainingState()


# ===== Lazy TTS Loader =====
_tts_instance = None
_tts_lock = threading.Lock()


def get_tts():
    global _tts_instance
    if _tts_instance is None:
        with _tts_lock:
            if _tts_instance is None:
                from helper import load_text_to_speech
                _tts_instance = load_text_to_speech(
                    os.path.join(BASE_DIR, "supertonic3", "onnx")
                )
    return _tts_instance


# ===== Pydantic Models =====
class TrainConfig(BaseModel):
    name: str = "mb4"
    gender: str = "M"
    target_wav_path: str = "voices/mb4.wav"
    reference_style: str = "auto"
    seed: int = 49
    speed: float = 1.05
    num_steps: int = 3000
    learning_rate: float = 0.0002
    vocoder_steps: int = 6
    save_steps: int = 500
    early_stop_loss_threshold: float = 0.015


class GenerateRequest(BaseModel):
    text: str
    lang: str = "en"
    style: str
    total_step: int = 6
    speed: float = 1.05


# =====================================================================
#  VOICE ENDPOINTS
# =====================================================================

@app.get("/api/voices")
async def list_voices():
    voices = []
    if os.path.exists(VOICES_DIR):
        for f in sorted(os.listdir(VOICES_DIR)):
            if f.lower().endswith((".wav", ".mp3", ".flac", ".ogg")):
                fpath = os.path.join(VOICES_DIR, f)
                voices.append({
                    "filename": f,
                    "size": os.path.getsize(fpath),
                    "modified": datetime.fromtimestamp(
                        os.path.getmtime(fpath)
                    ).isoformat(),
                })
    return {"voices": voices}


@app.post("/api/voices/upload")
async def upload_voice(file: UploadFile = File(...)):
    allowed = (".wav", ".mp3", ".flac", ".ogg")
    if not file.filename.lower().endswith(allowed):
        raise HTTPException(400, f"Only audio files {allowed} are supported")
    filepath = os.path.join(VOICES_DIR, file.filename)
    content = await file.read()
    with open(filepath, "wb") as f:
        f.write(content)
    return {"message": f"Uploaded {file.filename}", "filename": file.filename}


@app.delete("/api/voices/{filename}")
async def delete_voice(filename: str):
    filepath = os.path.join(VOICES_DIR, filename)
    if not os.path.exists(filepath):
        raise HTTPException(404, "Voice file not found")
    os.remove(filepath)
    return {"message": f"Deleted {filename}"}


@app.get("/api/voices/{filename}/audio")
async def get_voice_audio(filename: str):
    filepath = os.path.join(VOICES_DIR, filename)
    if not os.path.exists(filepath):
        raise HTTPException(404, "Voice file not found")
    media = "audio/mpeg" if filename.endswith(".mp3") else "audio/wav"
    return FileResponse(filepath, media_type=media)


# =====================================================================
#  STYLE ENDPOINTS
# =====================================================================

@app.get("/api/styles")
async def list_styles():
    styles = []

    # Built-in styles from supertonic3/voice_styles/
    if os.path.exists(STYLES_DIR):
        for f in sorted(os.listdir(STYLES_DIR)):
            if f.endswith(".json"):
                styles.append({
                    "name": f.replace(".json", ""),
                    "filename": f,
                    "path": f"supertonic3/voice_styles/{f}",
                    "type": "built-in",
                })

    # Trained styles from logs/
    if os.path.exists(LOGS_DIR):
        for subdir in sorted(os.listdir(LOGS_DIR)):
            subdir_path = os.path.join(LOGS_DIR, subdir)
            if os.path.isdir(subdir_path):
                for f in sorted(os.listdir(subdir_path)):
                    if f.endswith(".json") and f != "train_config.json":
                        styles.append({
                            "name": f.replace(".json", ""),
                            "filename": f,
                            "path": f"logs/{subdir}/{f}",
                            "type": "trained",
                        })
    return {"styles": styles}


# =====================================================================
#  SAMPLE ENDPOINTS
# =====================================================================

@app.get("/api/samples")
async def list_samples():
    samples = []
    if os.path.exists(SAMPLES_DIR):
        for f in sorted(os.listdir(SAMPLES_DIR), reverse=True):
            if f.lower().endswith((".wav", ".mp3", ".flac", ".ogg")):
                fpath = os.path.join(SAMPLES_DIR, f)
                samples.append({
                    "filename": f,
                    "size": os.path.getsize(fpath),
                    "modified": datetime.fromtimestamp(
                        os.path.getmtime(fpath)
                    ).isoformat(),
                })
    return {"samples": samples}


@app.get("/api/samples/{filename}/audio")
async def get_sample_audio(filename: str):
    filepath = os.path.join(SAMPLES_DIR, filename)
    if not os.path.exists(filepath):
        raise HTTPException(404, "Sample not found")
    media = "audio/mpeg" if filename.endswith(".mp3") else "audio/wav"
    return FileResponse(filepath, media_type=media)


@app.delete("/api/samples/{filename}")
async def delete_sample(filename: str):
    filepath = os.path.join(SAMPLES_DIR, filename)
    if not os.path.exists(filepath):
        raise HTTPException(404, "Sample not found")
    os.remove(filepath)
    return {"message": f"Deleted {filename}"}


# =====================================================================
#  TRAINING ENDPOINTS
# =====================================================================

def _read_process_output(process, state):
    """Background thread: reads subprocess stdout line-by-line."""
    try:
        for line in iter(process.stdout.readline, ""):
            if line:
                with state.lock:
                    state.logs.append(line.rstrip("\n\r"))
        process.wait()
        with state.lock:
            if state.status == "running":
                state.status = (
                    "completed" if process.returncode == 0 else "error"
                )
    except Exception as e:
        with state.lock:
            state.logs.append(f"[ERROR] {e}")
            state.status = "error"


@app.post("/api/train/start")
async def start_training(config: TrainConfig):
    if training_state.status == "running":
        raise HTTPException(409, "Training is already running")

    training_state.logs = []
    training_state.config = config.model_dump()
    training_state.status = "running"
    training_state.start_time = time.time()

    cmd = [
        sys.executable, "-u", "train_style.py",
        "--name", config.name,
        "--gender", config.gender,
        "--target-wav-path", config.target_wav_path,
        "--reference-style", config.reference_style,
        "--seed", str(config.seed),
        "--speed", str(config.speed),
        "--num-steps", str(config.num_steps),
        "--learning-rate", str(config.learning_rate),
        "--vocoder-steps", str(config.vocoder_steps),
        "--save-steps", str(config.save_steps),
        "--early-stop-loss-threshold", str(config.early_stop_loss_threshold),
    ]

    try:
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            cwd=BASE_DIR,
        )
        training_state.process = process

        reader = threading.Thread(
            target=_read_process_output,
            args=(process, training_state),
            daemon=True,
        )
        reader.start()

        return {"message": "Training started", "config": config.model_dump()}
    except Exception as e:
        training_state.status = "error"
        training_state.logs.append(f"Failed to start: {e}")
        raise HTTPException(500, f"Failed to start training: {e}")


@app.get("/api/train/status")
async def get_training_status(since: int = Query(0)):
    with training_state.lock:
        elapsed = None
        if training_state.start_time and training_state.status == "running":
            elapsed = time.time() - training_state.start_time

        return {
            "status": training_state.status,
            "logs": training_state.logs[since:],
            "total_logs": len(training_state.logs),
            "config": training_state.config,
            "elapsed": elapsed,
        }


@app.post("/api/train/stop")
async def stop_training():
    if training_state.status != "running" or training_state.process is None:
        raise HTTPException(400, "No training is running")

    training_state.process.terminate()
    try:
        training_state.process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        training_state.process.kill()

    with training_state.lock:
        training_state.status = "stopped"
        training_state.logs.append("[INFO] Training stopped by user")

    return {"message": "Training stopped"}


# =====================================================================
#  GENERATE ENDPOINT
# =====================================================================

# Using `def` (not async) so FastAPI runs it in a threadpool automatically —
# this prevents the heavy ONNX inference from blocking the event loop.
@app.post("/api/generate")
def generate_speech(req: GenerateRequest):
    import soundfile as sf
    from helper import load_voice_style

    style_path = os.path.join(BASE_DIR, req.style)
    if not os.path.exists(style_path):
        raise HTTPException(404, f"Style file not found: {req.style}")

    try:
        tts = get_tts()
        voice_style = load_voice_style([style_path])

        wav, duration = tts(req.text, req.lang, voice_style, req.total_step, req.speed)

        voice_name = os.path.basename(req.style).replace(".json", "")
        timestamp = int(time.time())
        fname = f"{voice_name}_{timestamp}.wav"

        w = wav[0, : int(tts.sample_rate * duration[0].item())]
        sf.write(os.path.join(SAMPLES_DIR, fname), w, tts.sample_rate)

        return {"filename": fname, "audio_url": f"/api/samples/{fname}/audio"}
    except Exception as e:
        raise HTTPException(500, f"Generation failed: {e}")


# =====================================================================
#  UTTERANCES CONFIG ENDPOINT
# =====================================================================

@app.get("/api/config/utterances")
async def get_utterances():
    try:
        from configs import texts
        return {"utterances": texts}
    except Exception as e:
        raise HTTPException(500, f"Failed to read utterances: {e}")


# =====================================================================
#  SERVE FRONTEND  (must be LAST — catch-all mount)
# =====================================================================
app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")


# ===== Entry Point =====
if __name__ == "__main__":
    import uvicorn

    print("\n" + "=" * 52)
    print("  Supertonic3 Voice Clone Studio")
    print("  Open  http://localhost:8000  in your browser")
    print("=" * 52 + "\n")
    uvicorn.run(app, host="0.0.0.0", port=8000)
