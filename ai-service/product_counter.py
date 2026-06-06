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


class PointRequest(BaseModel):
    x: float
    y: float


class CountingFilters(BaseModel):
    minWidth: Optional[int] = None
    maxWidth: Optional[int] = None
    minHeight: Optional[int] = None
    maxHeight: Optional[int] = None
    minAspectRatio: Optional[float] = None
    maxAspectRatio: Optional[float] = None
    countGateRatio: Optional[float] = None
    movementDirection: Optional[str] = None
    trackingTimeoutFrames: Optional[int] = None
    duplicateWindowSeconds: Optional[float] = None
    conveyorRoi: Optional[List[PointRequest]] = None
    ignoreZones: Optional[List[List[PointRequest]]] = None


class StartRequest(BaseModel):
    rtspUrl: Optional[str] = None
    mode: str = "LINE_CROSSING"
    productType: str = "Billets"
    confidenceThreshold: int = 70
    filters: Optional[CountingFilters] = None


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
    box: Tuple[Tuple[int, int], Tuple[int, int], Tuple[int, int], Tuple[int, int]]
    track_id: Optional[int] = None


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
        self.gate_ratio = self._configured_float("AI_COUNT_GATE_RATIO", 0.62, 0.25, 0.9)
        self.duplicate_window_seconds = self._configured_float("AI_DUPLICATE_WINDOW_SECONDS", 20.0, 3.0, 90.0)
        self.duplicate_y_tolerance = int(self._configured_float("AI_DUPLICATE_Y_TOLERANCE", 45.0, 15.0, 140.0))
        self.recent_gate_counts: List[Tuple[int, int]] = []
        self.min_box_width = 35
        self.max_box_width = 620
        self.min_box_height = 8
        self.max_box_height = 140
        self.min_aspect_ratio = 3.0
        self.max_aspect_ratio = 28.0
        self.movement_direction = "AUTO"
        self.tracking_timeout_frames = 45
        self.conveyor_roi = self._default_conveyor_roi()
        self.ignore_zones = self._default_ignore_zones()

    def start(self, rtsp_url: str, mode: str, product_type: str, confidence_threshold: int, filters: Optional[CountingFilters] = None) -> None:
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
            self.gate_ratio = self._configured_float("AI_COUNT_GATE_RATIO", 0.62, 0.25, 0.9)
            self.duplicate_window_seconds = self._configured_float("AI_DUPLICATE_WINDOW_SECONDS", 20.0, 3.0, 90.0)
            self.duplicate_y_tolerance = int(self._configured_float("AI_DUPLICATE_Y_TOLERANCE", 45.0, 15.0, 140.0))
            self.recent_gate_counts = []
            self._apply_filters(filters)
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
            self.recent_gate_counts = []
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
            gate_x = int(width * self.gate_ratio)
            gate_band_width = max(18, int(width * 0.035))
            self.frame_index += 1
            frames_since_tick += 1

            hot_mask, motion_mask = self._build_billet_mask(frame, subtractor)
            roi_mask = self._build_counting_mask(width, height)
            hot_mask = cv2.bitwise_and(hot_mask, roi_mask)
            motion_mask = cv2.bitwise_and(motion_mask, roi_mask)
            contours, _ = cv2.findContours(hot_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            detections = self._detect_hot_billets(contours, width, height)
            scene_message = self._evaluate_scene_health(detections, hot_mask, motion_mask)

            if self.mode == "ZONE_OCCUPANCY":
                with self.lock:
                    self.detected_count = len(detections)
            else:
                self._update_tracks(detections, gate_x, gate_band_width)

            annotated = frame.copy()
            self._draw_counting_zones(annotated, width, height)
            cv2.line(annotated, (gate_x, 0), (gate_x, height), (37, 99, 235), 2)
            cv2.rectangle(annotated, (max(0, gate_x - gate_band_width), 0), (min(width - 1, gate_x + gate_band_width), height), (37, 99, 235), 1)
            cv2.putText(annotated, "Count gate", (max(8, gate_x - 78), 24), cv2.FONT_HERSHEY_SIMPLEX, 0.58, (255, 237, 213), 2)
            for detection in detections:
                x, y, w, h = detection.rect
                box = np.array(detection.box, dtype=np.int32)
                cv2.polylines(annotated, [box], True, (0, 0, 255), 2)
                label = f"B{detection.track_id or '-'} {detection.confidence}%"
                cv2.putText(annotated, label, (x, max(18, y - 8)), cv2.FONT_HERSHEY_SIMPLEX, 0.48, (255, 255, 255), 2)

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

        open_kernel = np.ones((3, 3), np.uint8)
        close_kernel = np.ones((5, 5), np.uint8)
        hot_mask = cv2.GaussianBlur(hot_mask, (5, 5), 0)
        _, hot_mask = cv2.threshold(hot_mask, 110, 255, cv2.THRESH_BINARY)
        hot_mask = cv2.morphologyEx(hot_mask, cv2.MORPH_OPEN, open_kernel, iterations=1)
        hot_mask = cv2.morphologyEx(hot_mask, cv2.MORPH_CLOSE, close_kernel, iterations=1)
        return hot_mask, motion_mask

    def _detect_hot_billets(self, contours, width: int, height: int) -> List[Detection]:
        detections: List[Detection] = []
        min_area = max(280, int(self.min_box_width * self.min_box_height * 0.7))
        for contour in contours:
            area = cv2.contourArea(contour)
            if area < min_area:
                continue

            rect = cv2.minAreaRect(contour)
            (box_width, box_height) = rect[1]
            short_side = max(1.0, min(box_width, box_height))
            long_side = max(box_width, box_height)
            elongation = long_side / short_side
            if elongation < self.min_aspect_ratio or elongation > self.max_aspect_ratio:
                continue

            x, y, w, h = cv2.boundingRect(contour)
            if w < self.min_box_width or h < self.min_box_height:
                continue
            if w > self.max_box_width or h > self.max_box_height:
                continue
            center = (x + w // 2, y + h // 2)
            if not self._point_allowed(center, width, height):
                continue

            size_score = min(25, int(area / max(1, min_area) * 8))
            shape_score = min(35, int((elongation - self.min_aspect_ratio) * 10))
            brightness_score = 35
            confidence = max(1, min(99, 40 + size_score + shape_score + brightness_score))
            if confidence < self.confidence:
                continue
            box_points = cv2.boxPoints(rect)
            box = tuple((int(point[0]), int(point[1])) for point in box_points)
            detections.append(Detection(rect=(x, y, w, h), center=center, confidence=confidence, elongation=elongation, box=box))
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
            existing = [warning for warning in self.warnings if warning.get("code") in {"STALLED_BILLET"}]
            self.warnings = (warnings + existing)[-4:]
        return scene_message

    def _update_tracks(self, detections: List[Detection], gate_x: int, gate_band_width: int) -> None:
        with self.lock:
            assigned_tracks = set()
            active_direction = self._active_direction_locked()
            ordered_detections = sorted(detections, key=lambda item: item.center[0], reverse=active_direction < 0)
            for detection in ordered_detections:
                center = detection.center
                matched_id = None
                best_distance = 999999
                max_track_distance = min(260, max(120, int(max(detection.rect[2], detection.rect[3]) * 0.45)))
                for track_id, track in self.tracks.items():
                    if track_id in assigned_tracks:
                        continue
                    dx = center[0] - track.center[0]
                    dy = center[1] - track.center[1]
                    distance = (dx * dx + dy * dy) ** 0.5
                    if distance < best_distance and distance < max_track_distance:
                        best_distance = distance
                        matched_id = track_id

                if matched_id is None:
                    detection.track_id = self.next_track_id
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

                assigned_tracks.add(matched_id)
                detection.track_id = matched_id
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
                if self.movement_direction == "AUTO" and self.expected_direction == 0 and abs(dx) > 8:
                    self.expected_direction = 1 if dx > 0 else -1

                active_direction = self._active_direction_locked()
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

                if active_direction == 0 or not self._trajectory_allowed(dx, dy, active_direction):
                    continue

                if active_direction > 0:
                    crossed_gate = previous_center[0] < gate_x <= center[0]
                else:
                    crossed_gate = previous_center[0] > gate_x >= center[0]

                if not track.counted and frames_alive >= 2 and crossed_gate:
                    crossing_y = self._gate_crossing_y(previous_center, center, gate_x)
                    if self._is_recent_duplicate_count(crossing_y):
                        continue
                    track.counted = True
                    self.detected_count += 1
                    self.last_count_frame = self.frame_index
                    self.recent_gate_counts.append((self.frame_index, crossing_y))

            stale_ids = [track_id for track_id, track in self.tracks.items() if self.frame_index - track.last_seen > self.tracking_timeout_frames]
            for track_id in stale_ids:
                self.tracks.pop(track_id, None)

    def _active_direction_locked(self) -> int:
        if self.movement_direction == "LEFT_TO_RIGHT":
            return 1
        if self.movement_direction == "RIGHT_TO_LEFT":
            return -1
        return self.expected_direction

    @staticmethod
    def _trajectory_allowed(dx: int, dy: int, direction: int) -> bool:
        if direction == 0 or dx * direction <= 0:
            return False
        if abs(dx) < 1:
            return False
        return abs(dy) <= max(48, abs(dx) * 2.2)

    def _is_recent_duplicate_count(self, crossing_y: int) -> bool:
        effective_fps = max(8.0, self.fps or 0.0)
        window_frames = max(24, int(effective_fps * self.duplicate_window_seconds))
        self.recent_gate_counts = [
            (frame, y_value)
            for frame, y_value in self.recent_gate_counts
            if self.frame_index - frame <= window_frames
        ]
        return any(abs(y_value - crossing_y) <= self.duplicate_y_tolerance for _frame, y_value in self.recent_gate_counts)

    @staticmethod
    def _gate_crossing_y(previous_center: Tuple[int, int], center: Tuple[int, int], gate_x: int) -> int:
        previous_x, previous_y = previous_center
        current_x, current_y = center
        delta_x = current_x - previous_x
        if abs(delta_x) > 1:
            ratio = (gate_x - previous_x) / delta_x
            if 0 <= ratio <= 1:
                return int(previous_y + ratio * (current_y - previous_y))
        return current_y

    def _push_warning_locked(self, code: str, severity: str, message: str) -> None:
        self.warnings = [warning for warning in self.warnings if warning.get("code") != code]
        self.warnings.append({"code": code, "severity": severity, "message": message})
        self.warnings = self.warnings[-4:]

    def _apply_filters(self, filters: Optional[CountingFilters]) -> None:
        self.min_box_width = self._filter_int(filters.minWidth if filters else None, 35, 10, 900)
        self.max_box_width = self._filter_int(filters.maxWidth if filters else None, 620, self.min_box_width, 960)
        self.min_box_height = self._filter_int(filters.minHeight if filters else None, 8, 4, 300)
        self.max_box_height = self._filter_int(filters.maxHeight if filters else None, 140, self.min_box_height, 500)
        self.min_aspect_ratio = self._filter_float(filters.minAspectRatio if filters else None, 3.0, 1.2, 40.0)
        self.max_aspect_ratio = self._filter_float(filters.maxAspectRatio if filters else None, 28.0, self.min_aspect_ratio, 80.0)
        self.gate_ratio = self._filter_float(filters.countGateRatio if filters else None, self.gate_ratio, 0.1, 0.9)
        self.duplicate_window_seconds = self._filter_float(filters.duplicateWindowSeconds if filters else None, self.duplicate_window_seconds, 2.0, 120.0)
        self.tracking_timeout_frames = self._filter_int(filters.trackingTimeoutFrames if filters else None, 45, 10, 240)
        direction = (filters.movementDirection if filters else None) or "AUTO"
        direction = direction.upper().replace(" ", "_").replace("-", "_")
        self.movement_direction = direction if direction in {"AUTO", "LEFT_TO_RIGHT", "RIGHT_TO_LEFT"} else "AUTO"
        self.conveyor_roi = self._sanitize_polygon(filters.conveyorRoi if filters else None) or self._default_conveyor_roi()
        self.ignore_zones = [
            polygon
            for polygon in (self._sanitize_polygon(zone) for zone in (filters.ignoreZones if filters else []) or [])
            if polygon
        ] or self._default_ignore_zones()

    @staticmethod
    def _filter_int(value: Optional[int], default: int, minimum: int, maximum: int) -> int:
        try:
            parsed = int(value if value is not None else default)
        except (TypeError, ValueError):
            parsed = default
        return max(minimum, min(maximum, parsed))

    @staticmethod
    def _filter_float(value: Optional[float], default: float, minimum: float, maximum: float) -> float:
        try:
            parsed = float(value if value is not None else default)
        except (TypeError, ValueError):
            parsed = default
        return max(minimum, min(maximum, parsed))

    @staticmethod
    def _default_conveyor_roi() -> List[Tuple[float, float]]:
        return [(0.04, 0.24), (0.78, 0.20), (0.97, 0.86), (0.06, 0.88)]

    @staticmethod
    def _default_ignore_zones() -> List[List[Tuple[float, float]]]:
        return [
            [(0.0, 0.0), (1.0, 0.0), (1.0, 0.18), (0.0, 0.18)],
            [(0.84, 0.48), (1.0, 0.48), (1.0, 1.0), (0.84, 1.0)],
        ]

    @staticmethod
    def _sanitize_polygon(points: Optional[List[PointRequest]]) -> List[Tuple[float, float]]:
        if not points or len(points) < 3:
            return []
        polygon: List[Tuple[float, float]] = []
        for point in points:
            try:
                x_value = max(0.0, min(1.0, float(point.x)))
                y_value = max(0.0, min(1.0, float(point.y)))
            except (TypeError, ValueError):
                continue
            polygon.append((x_value, y_value))
        return polygon if len(polygon) >= 3 else []

    def _build_counting_mask(self, width: int, height: int):
        mask = np.zeros((height, width), dtype=np.uint8)
        roi = self._polygon_to_pixels(self.conveyor_roi, width, height)
        cv2.fillPoly(mask, [roi], 255)
        for zone in self.ignore_zones:
            cv2.fillPoly(mask, [self._polygon_to_pixels(zone, width, height)], 0)
        return mask

    def _point_allowed(self, center: Tuple[int, int], width: int, height: int) -> bool:
        point = (float(center[0]), float(center[1]))
        roi = self._polygon_to_pixels(self.conveyor_roi, width, height)
        if cv2.pointPolygonTest(roi, point, False) < 0:
            return False
        for zone in self.ignore_zones:
            if cv2.pointPolygonTest(self._polygon_to_pixels(zone, width, height), point, False) >= 0:
                return False
        return True

    def _draw_counting_zones(self, frame, width: int, height: int) -> None:
        roi = self._polygon_to_pixels(self.conveyor_roi, width, height)
        cv2.polylines(frame, [roi], True, (255, 170, 0), 2)
        for zone in self.ignore_zones:
            points = self._polygon_to_pixels(zone, width, height)
            overlay = frame.copy()
            cv2.fillPoly(overlay, [points], (30, 41, 59))
            cv2.addWeighted(overlay, 0.18, frame, 0.82, 0, frame)
            cv2.polylines(frame, [points], True, (148, 163, 184), 1)

    @staticmethod
    def _polygon_to_pixels(points: List[Tuple[float, float]], width: int, height: int):
        return np.array(
            [[int(max(0.0, min(1.0, x_value)) * width), int(max(0.0, min(1.0, y_value)) * height)] for x_value, y_value in points],
            dtype=np.int32,
        )

    @staticmethod
    def _configured_float(name: str, default: float, minimum: float, maximum: float) -> float:
        try:
            value = float(os.environ.get(name, default))
        except (TypeError, ValueError):
            value = default
        return max(minimum, min(maximum, value))

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
        counter.start(rtsp_url, request.mode, request.productType, request.confidenceThreshold, request.filters)
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
