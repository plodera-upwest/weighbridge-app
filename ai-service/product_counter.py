import os
import threading
import time
from dataclasses import dataclass
from typing import Dict, Optional, Tuple

try:
    import cv2
    import numpy as np
except Exception:  # pragma: no cover - reported by /health when dependencies are missing
    cv2 = None
    np = None

from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn


class StartRequest(BaseModel):
    rtspUrl: Optional[str] = None
    mode: str = "LINE_CROSSING"
    productType: str = "Billets"
    confidenceThreshold: int = 70


@dataclass
class Track:
    center: Tuple[int, int]
    last_seen: int
    counted: bool = False


class ProductCounter:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.stop_event = threading.Event()
        self.thread: Optional[threading.Thread] = None
        self.running = False
        self.detected_count = 0
        self.confirmed_count = 0
        self.confidence = 0
        self.mode = "LINE_CROSSING"
        self.product_type = "Billets"
        self.message = "Idle"
        self.fps = 0.0
        self.frame_size = "-"
        self.latest_jpeg: Optional[bytes] = None
        self.tracks: Dict[int, Track] = {}
        self.next_track_id = 1
        self.frame_index = 0

    def start(self, rtsp_url: str, mode: str, product_type: str, confidence_threshold: int) -> None:
        if cv2 is None or np is None:
            raise RuntimeError("OpenCV is not installed. Run pip install -r ai-service/requirements.txt")
        if not rtsp_url:
            raise RuntimeError("RTSP URL is required. Set AI_RTSP_URL or provide one from the app.")
        self.stop()
        with self.lock:
            self.stop_event.clear()
            self.running = True
            self.detected_count = 0
            self.confirmed_count = 0
            self.confidence = max(1, min(99, confidence_threshold))
            self.mode = mode
            self.product_type = product_type or "Billets"
            self.message = "Connecting to camera"
            self.fps = 0.0
            self.frame_size = "-"
            self.latest_jpeg = None
            self.tracks = {}
            self.next_track_id = 1
            self.frame_index = 0
        self.thread = threading.Thread(target=self._run, args=(rtsp_url,), daemon=True)
        self.thread.start()

    def stop(self) -> None:
        self.stop_event.set()
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=2)
        with self.lock:
            self.running = False
            if self.message not in {"Idle", "Stopped"}:
                self.message = "Stopped"

    def reset(self) -> None:
        with self.lock:
            self.detected_count = 0
            self.confirmed_count = 0
            self.tracks = {}
            self.next_track_id = 1
            self.message = "Counter reset"

    def confirm(self) -> None:
        with self.lock:
            self.confirmed_count = self.detected_count
            self.message = f"{self.confirmed_count} item(s) confirmed"

    def status(self) -> dict:
        with self.lock:
            return {
                "running": self.running,
                "detectedCount": self.detected_count,
                "confirmedCount": self.confirmed_count,
                "confidence": self.confidence,
                "mode": self.mode,
                "productType": self.product_type,
                "message": self.message,
                "fps": round(self.fps, 2),
                "frameSize": self.frame_size,
                "hasSnapshot": self.latest_jpeg is not None,
            }

    def snapshot(self) -> bytes:
        with self.lock:
            if not self.latest_jpeg:
                raise RuntimeError("No snapshot available yet")
            return self.latest_jpeg

    def _run(self, rtsp_url: str) -> None:
        os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")
        capture = cv2.VideoCapture(rtsp_url, cv2.CAP_FFMPEG)
        if not capture.isOpened():
            with self.lock:
                self.running = False
                self.message = "Camera connection failed"
            return

        subtractor = cv2.createBackgroundSubtractorMOG2(history=450, varThreshold=32, detectShadows=True)
        last_tick = time.time()
        frames_since_tick = 0

        while not self.stop_event.is_set():
            ok, frame = capture.read()
            if not ok:
                with self.lock:
                    self.message = "Waiting for camera frames"
                time.sleep(0.2)
                continue

            frame = self._resize(frame, 960)
            height, width = frame.shape[:2]
            line_y = int(height * 0.52)
            self.frame_index += 1
            frames_since_tick += 1

            mask = subtractor.apply(frame)
            mask = cv2.GaussianBlur(mask, (5, 5), 0)
            _, mask = cv2.threshold(mask, 210, 255, cv2.THRESH_BINARY)
            kernel = np.ones((5, 5), np.uint8)
            mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
            mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)

            contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            detections = []
            min_area = max(900, int(width * height * 0.002))
            for contour in contours:
                area = cv2.contourArea(contour)
                if area < min_area:
                    continue
                x, y, w, h = cv2.boundingRect(contour)
                if w < 18 or h < 18:
                    continue
                detections.append((x, y, w, h, (x + w // 2, y + h // 2)))

            if self.mode == "ZONE_OCCUPANCY":
                with self.lock:
                    self.detected_count = len(detections)
            else:
                self._update_tracks([item[4] for item in detections], line_y)

            annotated = frame.copy()
            cv2.line(annotated, (0, line_y), (width, line_y), (37, 99, 235), 2)
            for x, y, w, h, _center in detections:
                cv2.rectangle(annotated, (x, y), (x + w, y + h), (20, 184, 166), 2)

            with self.lock:
                count = self.detected_count
                confirmed = self.confirmed_count
                status_text = self.message

            cv2.putText(annotated, f"Detected: {count}", (18, 36), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (255, 255, 255), 2)
            cv2.putText(annotated, f"Confirmed: {confirmed}", (18, 72), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (209, 250, 229), 2)
            cv2.putText(annotated, status_text, (18, height - 18), cv2.FONT_HERSHEY_SIMPLEX, 0.58, (226, 232, 240), 1)

            encoded_ok, encoded = cv2.imencode(".jpg", annotated, [int(cv2.IMWRITE_JPEG_QUALITY), 82])
            now = time.time()
            if now - last_tick >= 1:
                fps = frames_since_tick / (now - last_tick)
                last_tick = now
                frames_since_tick = 0
            else:
                fps = self.fps

            with self.lock:
                self.latest_jpeg = encoded.tobytes() if encoded_ok else self.latest_jpeg
                self.fps = fps
                self.frame_size = f"{width}x{height}"
                self.running = True
                self.message = "Monitoring"

        capture.release()
        with self.lock:
            self.running = False
            self.message = "Stopped"

    def _update_tracks(self, centers, line_y: int) -> None:
        with self.lock:
            for center in centers:
                matched_id = None
                best_distance = 999999
                for track_id, track in self.tracks.items():
                    dx = center[0] - track.center[0]
                    dy = center[1] - track.center[1]
                    distance = (dx * dx + dy * dy) ** 0.5
                    if distance < best_distance and distance < 90:
                        best_distance = distance
                        matched_id = track_id

                if matched_id is None:
                    self.tracks[self.next_track_id] = Track(center=center, last_seen=self.frame_index)
                    self.next_track_id += 1
                    continue

                track = self.tracks[matched_id]
                previous_y = track.center[1]
                track.center = center
                track.last_seen = self.frame_index
                if not track.counted and previous_y < line_y <= center[1]:
                    track.counted = True
                    self.detected_count += 1

            stale_ids = [track_id for track_id, track in self.tracks.items() if self.frame_index - track.last_seen > 30]
            for track_id in stale_ids:
                self.tracks.pop(track_id, None)

    @staticmethod
    def _resize(frame, max_width: int):
        height, width = frame.shape[:2]
        if width <= max_width:
            return frame
        ratio = max_width / float(width)
        return cv2.resize(frame, (max_width, int(height * ratio)))


app = FastAPI(title="Weighbridge AI Product Counting Service")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
counter = ProductCounter()


@app.get("/health")
def health() -> dict:
    return {
        "ok": cv2 is not None and np is not None,
        "opencv": cv2.__version__ if cv2 is not None else None,
        "message": "Ready" if cv2 is not None and np is not None else "OpenCV dependencies are missing",
    }


@app.post("/api/counting/start")
def start_counting(request: StartRequest) -> dict:
    rtsp_url = request.rtspUrl or os.environ.get("AI_RTSP_URL", "")
    try:
        counter.start(rtsp_url, request.mode, request.productType, request.confidenceThreshold)
    except RuntimeError as error:
        raise HTTPException(status_code=400, detail=str(error))
    return counter.status()


@app.post("/api/counting/stop")
def stop_counting() -> dict:
    counter.stop()
    return counter.status()


@app.post("/api/counting/reset")
def reset_counting() -> dict:
    counter.reset()
    return counter.status()


@app.post("/api/counting/confirm")
def confirm_counting() -> dict:
    counter.confirm()
    return counter.status()


@app.get("/api/counting/status")
def status() -> dict:
    return counter.status()


@app.get("/api/counting/snapshot.jpg")
def snapshot() -> Response:
    try:
        image = counter.snapshot()
    except RuntimeError:
        raise HTTPException(status_code=404, detail="No snapshot available yet")
    return Response(content=image, media_type="image/jpeg")


if __name__ == "__main__":
    host = os.environ.get("AI_HOST", "127.0.0.1")
    port = int(os.environ.get("AI_PORT", "5055"))
    uvicorn.run(app, host=host, port=port)
