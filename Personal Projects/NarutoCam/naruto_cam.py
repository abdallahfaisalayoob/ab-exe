import cv2
import numpy as np
import mediapipe as mp
from playsound import playsound
import threading
import time

# ----------------------------
# CONFIG
# ----------------------------
NARUTO_IMAGE_PATH = "naruto.png"      # put a png image in same folder
NARUTO_SOUND_PATH = "naruto.mp3"      # put an mp3 in same folder

# how many clones of your face
CLONES = 4

# cooldown so it doesn't spam
COOLDOWN_SECONDS = 2.0

# ----------------------------
# Setup MediaPipe Hands
# ----------------------------
mp_hands = mp.solutions.hands
hands = mp_hands.Hands(
    static_image_mode=False,
    max_num_hands=1,
    min_detection_confidence=0.7,
    min_tracking_confidence=0.7
)
mp_draw = mp.solutions.drawing_utils

# ----------------------------
# Load Naruto image (overlay)
# ----------------------------
naruto_img = cv2.imread(NARUTO_IMAGE_PATH, cv2.IMREAD_UNCHANGED)

def play_sound():
    try:
        playsound(NARUTO_SOUND_PATH)
    except:
        pass

def overlay_png(frame, overlay, x, y, w, h):
    """Overlay a transparent PNG onto frame."""
    if overlay is None:
        return frame

    overlay_resized = cv2.resize(overlay, (w, h))

    if overlay_resized.shape[2] < 4:
        return frame

    alpha = overlay_resized[:, :, 3] / 255.0
    rgb = overlay_resized[:, :, :3]

    fh, fw = frame.shape[:2]
    if x < 0 or y < 0 or x + w > fw or y + h > fh:
        return frame

    for c in range(3):
        frame[y:y+h, x:x+w, c] = (
            alpha * rgb[:, :, c] +
            (1 - alpha) * frame[y:y+h, x:x+w, c]
        )

    return frame


# ----------------------------
# Simple hand sign detection
# ----------------------------
def finger_is_up(lm, tip, pip):
    # tip y < pip y means finger up (in image coords, smaller y is higher)
    return lm[tip][1] < lm[pip][1]

def detect_sign(landmarks):
    """
    Very basic sign recognition using which fingers are up.
    This is NOT perfect Naruto signs yet, but gives you a working base.
    """

    lm = [(p.x, p.y) for p in landmarks]

    # MediaPipe landmark indexes:
    # Thumb: 4 tip, 3 ip
    # Index: 8 tip, 6 pip
    # Middle: 12 tip, 10 pip
    # Ring: 16 tip, 14 pip
    # Pinky: 20 tip, 18 pip

    index_up = finger_is_up(lm, 8, 6)
    middle_up = finger_is_up(lm, 12, 10)
    ring_up = finger_is_up(lm, 16, 14)
    pinky_up = finger_is_up(lm, 20, 18)

    # SUPER simple mapping:
    # (these are placeholders to show you the concept)

    # "Tiger" sign idea: index + middle up, ring+pinky down
    if index_up and middle_up and (not ring_up) and (not pinky_up):
        return "TIGER"

    # "Ram" sign idea: all fingers up
    if index_up and middle_up and ring_up and pinky_up:
        return "RAM"

    # "Bird" sign idea: only index up
    if index_up and (not middle_up) and (not ring_up) and (not pinky_up):
        return "BIRD"

    return None


# ----------------------------
# Face detector (for clones)
# ----------------------------
face_cascade = cv2.CascadeClassifier(
    cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
)

last_trigger_time = 0
triggered = False

cap = cv2.VideoCapture(0)

print("🔥 Naruto Hand Sign Camera started.")
print("Make a sign (TIGER / RAM / BIRD) to trigger the effect.")
print("Press Q to quit.")

while True:
    ret, frame = cap.read()
    if not ret:
        break

    frame = cv2.flip(frame, 1)
    h, w = frame.shape[:2]

    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    result = hands.process(rgb)

    sign = None

    # Draw hands + detect sign
    if result.multi_hand_landmarks:
        for hand_landmarks in result.multi_hand_landmarks:
            mp_draw.draw_landmarks(frame, hand_landmarks, mp_hands.HAND_CONNECTIONS)
            sign = detect_sign(hand_landmarks.landmark)

    # Face detection for clone effect
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    faces = face_cascade.detectMultiScale(gray, 1.3, 5)

    # Trigger logic
    now = time.time()
    if sign and (now - last_trigger_time > COOLDOWN_SECONDS):
        last_trigger_time = now

        # play sound in background
        threading.Thread(target=play_sound, daemon=True).start()

        triggered = True
        trigger_sign = sign

    # If triggered, show Naruto + clones
    if triggered:
        # Naruto overlay top-right
        frame = overlay_png(frame, naruto_img, w - 220, 20, 200, 200)

        # show text
        cv2.putText(frame, f"{trigger_sign} SIGN!", (30, 60),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.4, (0, 255, 255), 3)

        # Clone effect: copy face into multiple places
        if len(faces) > 0:
            (x, y, fw, fh) = faces[0]
            face_roi = frame[y:y+fh, x:x+fw].copy()

            # spawn clones
            for i in range(CLONES):
                cx = int((i + 1) * (w / (CLONES + 1)) - fw/2)
                cy = int(h * 0.65 - fh/2)

                if 0 <= cx < w - fw and 0 <= cy < h - fh:
                    frame[cy:cy+fh, cx:cx+fw] = face_roi

        # auto turn off after 1 second
        if now - last_trigger_time > 1.0:
            triggered = False

    # show sign detected
    if sign:
        cv2.putText(frame, f"Detected: {sign}", (30, h - 30),
                    cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)

    cv2.imshow("Naruto Hand Signs - Abdallah Edition 😭🔥", frame)

    if cv2.waitKey(1) & 0xFF in [ord('q'), ord('Q')]:
        break

cap.release()
cv2.destroyAllWindows()
