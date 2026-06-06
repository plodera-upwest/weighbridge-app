import os
import threading
import time
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

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
    rect: Tuple[int, int, int, int]
    center: Tuple[int, int]
    last_seen: int
    first_seen: int
    last_moved_frame: int
    previous_rect: Tuple[int, int, int, int]
    previous_center: Tuple[int, int]
    counted: bool = False
    warning_sent: bool = False


@dataclass
class Detection:
    rect: Tuple[int, int, int, int]
    center: Tuple[int, int]
    confidence: int
    elongation: float


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
        self.warnings: List[dict] = []
        self.last_frame_at = 0.0
        self.last_count_frame = -9999
        self.low_confidence_frames = 0
        self.distorted_frames = 0
        self.expected_direction = 0

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
            self.warnings = []
            self.last_frame_at = 0.0
            self.last_count_frame = -9999
            self.low_confidence_frames = 0
            self.distorted_frames = 0
            self.expected_direction = 0
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
            self.warnings = []
            self.last_count_frame = -9999
            self.low_confidence_frames = 0
            self.distorted_frames = 0
            self.expected_direction = 0
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
                "warnings": list(self.warnings),
                "activeTracks": len(self.tracks),
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
            gate_x = int(width * 0.62)
            self.frame_index += 1
            frames_since_tick += 1

            hot_mask, motion_mask = self._build_billet_mask(frame, subtractor)
            contours, _ = cv2.findContours(hot_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            detections = self._detect_hot_billets(contours, width, height)
            scene_message = self._evaluate_scene_health(detections, hot_mask, motion_mask)

            if self.mode == "ZONE_OCCUPANCY":
                with self.lock:
                    self.detected_count = len(detections)
            else:
                self._update_tracks(detections, gate_x)

            annotated = frame.copy()
            cv2.line(annotated, (gate_x, 0), (gate_x, height), (37, 99, 235), 2)
            cv2.putText(annotated, "Count gate", (max(8, gate_x - 78), 24), cv2.FONT_HERSHEY_SIMPLEX, 0.58, (255, 237, 213), 2)
            for detection in detections:
                x, y, w, h = detection.rect
                cv2.rectangle(annotated, (x, y), (x + w, y + h), (20, 184, 166), 2)
                cv2.putText(annotated, f"{detection.confidence}%", (x, max(18, y - 8)), cv2.FONT_HERSHEY_SIMPLEX, 0.48, (209, 250, 229), 1)

            with self.lock:
                count = self.detected_count
                confirmed = self.confirmed_count
                status_text = scene_message
                warnings = list(self.warnings)

            cv2.putText(annotated, f"Detected: {count}", (18, 36), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (255, 255, 255), 2)
            cv2.putText(annotated, f"Confirmed: {confirmed}", (18, 72), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (209, 250, 229), 2)
            cv2.putText(annotated, status_text, (18, height - 42), cv2.FONT_HERSHEY_SIMPLEX, 0.58, (226, 232, 240), 1)
            if warnings:
                cv2.putText(annotated, f"Warning: {warnings[0]['message']}", (18, height - 18), cv2.FONT_HERSHEY_SIMPLEX, 0.58, (0, 213, 255), 2)

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
                self.last_frame_at = now
                self.message = scene_message

        capture.release()
        with self.lock:
            self.running = False
            self.message = "Stopped"

    def _build_billet_mask(self, frame, subtractor):
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        b_channel, g_channel, r_channel = cv2.split(frame)
        h_channel, s_channel, v_channel = cv2.split(hsv)

        white_hot = cv2.inRange(v_channel, 235, 255)
        orange_hot = cv2.inRange(hsv, np.array([0, 55, 150]), np.array([42, 255, 255]))
        red_hot = cv2.inRange(hsv, np.array([165, 45, 145]), np.array([179, 255, 255]))
        red_dominant = ((r_channel > 165) & (r_channel > g_channel * 1.05) & (r_channel > b_channel * 1.35)).astype(np.uint8) * 255

        hot_mask = cv2.bitwise_or(white_hot, orange_hot)
        hot_mask = cv2.bitwise_or(hot_mask, red_hot)
        hot_mask = cv2.bitwise_or(hot_mask, red_dominant)

        motion_mask = subtractor.apply(frame)
        _, motion_mask = cv2.threshold(motion_mask, 180, 255, cv2.THRESH_BINARY)
        hot_mask = cv2.bitwise_and(hot_mask, cv2.bitwise_or(motion_mask, hot_mask))

        kernel = np.ones((7, 7), np.uint8)
        hot_mask = cv2.GaussianBlur(hot_mask, (5, 5), 0)
        _, hot_mask = cv2.threshold(hot_mask, 110, 255, cv2.THRESH_BINARY)
        hot_mask = cv2.morphologyEx(hot_mask, cv2.MORPH_OPEN, kernel)
        hot_mask = cv2.morphologyEx(hot_mask, cv2.MORPH_CLOSE, kernel, iterations=2)
        return hot_mask, motion_mask

    def _detect_hot_billets(self, contours, width: int, height: int) -> List[Detection]:
        detections: List[Detection] = []
        min_area = max(850, int(width * height * 0.0014))
        for contour in contours:
            area = cv2.contourArea(contour)
            if area < min_area:
                continue

            rect = cv2.minAreaRect(contour)
            (box_width, box_height) = rect[1]
            short_side = max(1.0, min(box_width, box_height))
            long_side = max(box_width, box_height)
            elongation = long_side / short_side
            if elongation < 2.8:
                continue

            x, y, w, h = cv2.boundingRect(contour)
            if w < 24 or h < 10:
                continue

            size_score = min(25, int(area / max(1, min_area) * 8))
            shape_score = min(35, int((elongation - 2.8) * 10))
            brightness_score = 35
            confidence = max(1, min(99, 40 + size_score + shape_score + brightness_score))
            detections.append(Detection(rect=(x, y, w, h), center=(x + w // 2, y + h // 2), confidence=confidence, elongation=elongation))
        return detections

    def _evaluate_scene_health(self, detections: List[Detection], hot_mask, motion_mask) -> str:
        warnings: List[dict] = []
        total_pixels = max(1, hot_mask.shape[0] * hot_mask.shape[1])
        hot_pixels = int(cv2.countNonZero(hot_mask))
        moving_pixels = int(cv2.countNonZero(motion_mask))
        hot_ratio = hot_pixels / total_pixels
        moving_ratio = moving_pixels / total_pixels

        scene_message = "Waiting for billet"

        if detections:
            self.low_confidence_frames = 0
            self.distorted_frames = 0
            scene_message = "Billet candidate detected"
        elif hot_ratio > 0.22:
            self.distorted_frames += 1
            self.low_confidence_frames = 0
            scene_message = "Camera frame unstable"
        elif hot_ratio > 0.003 and moving_ratio > 0.002:
            self.low_confidence_frames += 1
            self.distorted_frames = 0
            scene_message = "Hot motion under review"
        else:
            self.low_confidence_frames = 0
            self.distorted_frames = 0

        if self.distorted_frames >= 6:
            warnings.append({"code": "FRAME_DISTORTION", "severity": "WARNING", "message": "Camera image has excessive bright noise or distortion; check stream quality before counting."})

        if self.low_confidence_frames >= 10:
            warnings.append({"code": "LOW_CONFIDENCE", "severity": "WARNING", "message": "Hot movement detected but billet shape was not confirmed."})

        with self.lock:
            existing = [warning for warning in self.warnings if warning.get("code") in {"STALLED_BILLET", "WRONG_DIRECTION"}]
            self.warnings = (warnings + existing)[-4:]
        return scene_message

    def _update_tracks(self, detections: List[Detection], gate_x: int) -> None:
        with self.lock:
            for detection in detections:
                center = detection.center
                matched_id = None
                best_distance = 999999
                max_track_distance = min(260, max(120, int(max(detection.rect[2], detection.rect[3]) * 0.45)))
                for track_id, track in self.tracks.items():
                    dx = center[0] - track.center[0]
                    dy = center[1] - track.center[1]
                    distance = (dx * dx + dy * dy) ** 0.5
                    if distance < best_distance and distance < max_track_distance:
                        best_distance = distance
                        matched_id = track_id

                if matched_id is None:
                    self.tracks[self.next_track_id] = Track(
                        rect=detection.rect,
                        center=center,
                        last_seen=self.frame_index,
                        first_seen=self.frame_index,
                        last_moved_frame=self.frame_index,
                        previous_rect=detection.rect,
                        previous_center=center,
                    )
                    self.next_track_id += 1
                    continue

                track = self.tracks[matched_id]
                previous_rect = track.rect
                previous_center = track.center
                dx = center[0] - previous_center[0]
                dy = center[1] - previous_center[1]
                distance = (dx * dx + dy * dy) ** 0.5
                if distance > 1.5:
                    track.last_moved_frame = self.frame_index
                    track.warning_sent = False
                    self.warnings = [warning for warning in self.warnings if warning.get("code") != "STALLED_BILLET"]
                if self.expected_direction == 0 and abs(dx) > 8:
                    self.expected_direction = 1 if dx > 0 else -1

                track.previous_rect = previous_rect
                track.previous_center = previous_center
                track.rect = detection.rect
                track.center = center
                track.last_seen = self.frame_index
                frames_alive = self.frame_index - track.first_seen
                effective_fps = max(8.0, self.fps or 0.0)
                stall_frame_limit = max(960, int(effective_fps * 120))

                if not track.counted and frames_alive > 60 and self.frame_index - track.last_moved_frame > stall_frame_limit and not track.warning_sent:
                    track.warning_sent = True
                    self._push_warning_locked("STALLED_BILLET", "WARNING", "Billet has not moved for an extended period; review only if conveyor cooling flow has stopped.")

                prev_front = previous_rect[0] + previous_rect[2]
                curr_front = detection.rect[0] + detection.rect[2]
                if self.expected_direction < 0:
                    prev_front = previous_rect[0]
                    curr_front = detection.rect[0]

                cooldown_clear = self.frame_index - self.last_count_frame > 18
                if self.expected_direction >= 0:
                    crossed_gate = prev_front < gate_x <= curr_front or previous_center[0] < gate_x <= center[0]
                    crossed_reverse = previous_rect[0] >= gate_x > detection.rect[0]
                else:
                    crossed_gate = prev_front > gate_x >= curr_front or previous_center[0] > gate_x >= center[0]
                    crossed_reverse = previous_rect[0] + previous_rect[2] <= gate_x < detection.rect[0] + detection.rect[2]

                if not track.counted and frames_alive >= 2 and crossed_reverse and self.detected_count > 0:
                    self._push_warning_locked("WRONG_DIRECTION", "WARNING", "Billet moved opposite the learned count direction; not counted.")

                if not track.counted and frames_alive >= 2 and crossed_gate and cooldown_clear:
                    track.counted = True
                    self.detected_count += 1
                    self.last_count_frame = self.frame_index
                elif not track.counted and frames_alive >= 2 and crossed_gate and not cooldown_clear:
                    self._push_warning_locked("COOLDOWN", "INFO", "Possible duplicate billet ignored during count cooldown.")

            stale_ids = [track_id for track_id, track in self.tracks.items() if self.frame_index - track.last_seen > 30]
            for track_id in stale_ids:
                self.tracks.pop(track_id, None)

    def _push_warning_locked(self, code: str, severity: str, message: str) -> None:
        self.warnings = [warning for warning in self.warnings if warning.get("code") != code]
        self.warnings.append({"code": code, "severity": severity, "message": message})
        self.warnings = self.warnings[-4:]

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
