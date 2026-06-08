"""
predict.py
==========
Load a saved model and run predictions on the MNIST test set.
Also shows a few example predictions with ASCII art digits.

Usage:
    python predict.py

Author: Abdallah Faisal Ayoob
"""

import numpy as np
from neural_net import NeuralNetwork
from data_loader import load_mnist

MODEL_PATH   = "model.npz"
LAYER_SIZES  = [784, 128, 64, 10]


def ascii_digit(image_flat):
    """Print a 28x28 digit as ASCII art in the terminal."""
    pixels = (image_flat * 255).astype(int).reshape(28, 28)
    chars = " .:-=+*#%@"
    for row in pixels:
        print("".join(chars[min(p * len(chars) // 256, len(chars) - 1)] for p in row))


# ── Load ─────────────────────────────────────────────────────────────────────
_, _, X_test, y_test = load_mnist()

model = NeuralNetwork(LAYER_SIZES)
model.load(MODEL_PATH)

# ── Evaluate ─────────────────────────────────────────────────────────────────
test_acc = model.evaluate(X_test, y_test)
print(f"\nTest accuracy: {test_acc * 100:.2f}%\n")

# ── Show 5 random examples ────────────────────────────────────────────────────
y_true = np.argmax(y_test, axis=1)
indices = np.random.choice(len(X_test), 5, replace=False)

for i, idx in enumerate(indices):
    pred = model.predict(X_test[idx:idx+1])[0]
    true = y_true[idx]
    result = "CORRECT" if pred == true else "WRONG"
    print(f"--- Sample {i+1} | True: {true} | Predicted: {pred} | {result} ---")
    ascii_digit(X_test[idx])
    print()
